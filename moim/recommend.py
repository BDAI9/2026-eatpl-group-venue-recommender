"""참여자 선호를 합쳐 가게를 추천한다.

- 지역과 장소 종류(카페/식당/술집)는 참여자 투표로 정한다(직접 바꿀 수도 있음).
- 알레르기: 누구 하나라도 가진 알레르기의 위험이 '높음'인 가게는 제외, '보통·모름'은 주의 표시.
- 선호(종류·예산·분위기): 같은 선호를 고른 사람이 많을수록 점수가 높다.
- background=True(서버): 무료 AI는 응답에 30~60초 걸려서, 먼저 업종 규칙으로 결과를 바로 주고
  AI 추정은 뒤에서 돌려 저장한다. 화면이 잠시 뒤 다시 요청하면 AI가 반영된 결과가 나온다.
"""

from __future__ import annotations

import os
import threading
import time
from collections import Counter

from .eatpl import EatplError, search_places
from .estimate import estimate_places, pending_ai
from .options import BUDGETS, PLACE_TYPES, REGIONS

TOP_N = 10
AI_LIMIT = 20  # 추천 한 번에 AI로 추정할 최대 가게 수 (= AI 요청 최대 1번)
RETRY_AFTER = 300  # AI 추정이 실패하면 이 시간(초) 동안은 다시 시도하지 않는다 (무료 한도 보호)
W_STYLE, W_BUDGET_FIT, W_BUDGET_OVER, W_ATMOS, W_MEDIUM_RISK = 3, 2, -2, 1, -2


def _rank_key(place: dict):
    """동점일 때 순서: 잇플 매출 순위값이 작은 곳 먼저(값이 없으면 뒤), 그다음 이름."""
    rank = place.get("sales_rank")
    return (rank if rank is not None else 10 ** 9, place.get("name", ""))


def allergens_of(people: list[dict]) -> dict[str, list[str]]:
    """{알레르기: [이름...]}"""
    out: dict[str, list[str]] = {}
    for p in people:
        for a in p.get("allergies", []) + ([p["allergy_other"]] if p.get("allergy_other") else []):
            out.setdefault(a, []).append(p["name"])
    return out


def _winner(counter: Counter, order: list[str]):
    if not counter:
        return None
    best = max(counter.values())
    tied = [k for k in counter if counter[k] == best]
    return sorted(tied, key=lambda k: order.index(k) if k in order else len(order))[0]


def summarize(people: list[dict]) -> dict:
    regions = Counter(p["region"] for p in people)
    types = Counter(p["place_type"] for p in people)
    styles = {t: Counter(s for p in people if p["place_type"] == t for s in p["styles"]) for t in PLACE_TYPES}
    return {
        "count": len(people),
        "regions": dict(regions.most_common()),
        "place_types": {t: types.get(t, 0) for t in PLACE_TYPES},
        "styles": {t: dict(c.most_common()) for t, c in styles.items()},
        "budgets": {str(b): sum(1 for p in people if p.get("budget") == b) for b in BUDGETS},
        "atmospheres": dict(Counter(a for p in people for a in p["atmospheres"]).most_common()),
        "allergies": allergens_of(people),
        "region": _winner(regions, REGIONS),
        "place_type": _winner(types, list(PLACE_TYPES)),
    }


def score_place(place: dict, est: dict, people: list[dict], place_type: str, allergy_people: dict) -> dict:
    reasons, cautions, score = [], [], 0
    # 알레르기
    unknown = []
    for allergen, names in allergy_people.items():
        risk = est["allergy_risk"].get(allergen, "unknown")
        who = ", ".join(names)
        if risk == "high":
            return {"excluded": True, "reason": f"{allergen} 알레르기({who}) 위험이 높은 곳이에요."}
        if risk == "medium":
            score += W_MEDIUM_RISK
            cautions.append(f"{allergen} 포함 가능성 있음 ({who}) — 매장에 꼭 확인하세요.")
        elif risk == "unknown":
            unknown.append(allergen)
    if unknown:
        cautions.append(f"알레르기 정보 없음: {', '.join(unknown)} — 매장에 확인하세요.")
    # 종류
    # 한 사람은 한 번만 센다: 종류를 여러 개 가진 가게라도 같은 사람이 두 번 점수를 주지 않게
    voters = [p for p in people if p["place_type"] == place_type and p["styles"]]
    style_fans = set()
    for style in est["styles"]:
        fans = [p for p in voters if style in p["styles"]]
        if fans:
            style_fans.update(id(p) for p in fans)
            reasons.append(f"{len(voters)}명 중 {len(fans)}명이 원하는 {style}")
    score += W_STYLE * len(style_fans)
    # 예산
    band = est["price_band"]
    budget_people = [p for p in people if p.get("budget")]
    if band and budget_people:
        fit = [p for p in budget_people if band <= p["budget"]]
        over = [p for p in budget_people if band > p["budget"] + 1]
        score += W_BUDGET_FIT * len(fit) + W_BUDGET_OVER * len(over)
        reasons.append(f"1인 {BUDGETS[band]} 추정 · 예산 맞는 사람 {len(fit)}/{len(budget_people)}")
    elif budget_people:
        cautions.append("가격대 정보 없음")
    # 분위기
    for a in est["atmospheres"]:
        fans = [p for p in people if a in p["atmospheres"]]
        if fans:
            score += W_ATMOS * len(fans)
            reasons.append(f"분위기 '{a}' 원하는 사람 {len(fans)}명")
    return {"excluded": False, "score": score, "reasons": reasons, "cautions": cautions}


# 백그라운드 AI 작업: key=(장소 종류, 알레르기, 보낼 가게 id들) → {"state", "warnings", "at", "thread"}
_jobs: dict = {}
_jobs_lock = threading.Lock()


def _start_ai_job(key, ordered, place_type, allergens, store, api_key) -> dict:
    """같은 작업이 돌고 있으면 그대로 두고, 최근 실패했으면 RETRY_AFTER 동안 다시 시작하지 않는다."""
    with _jobs_lock:
        job = _jobs.get(key)
        if job and (job["state"] == "running" or
                    (job["state"] == "failed" and time.time() - job["at"] < RETRY_AFTER)):
            return job
        job = {"state": "running", "warnings": [], "at": time.time()}

        def run():
            try:
                _, warnings = estimate_places(ordered, place_type, allergens, store=store, api_key=api_key,
                                              ai_limit=AI_LIMIT)
            except Exception as e:  # 백그라운드라 어떤 오류든 기록만 하고 다음 요청에서 알린다
                warnings = [f"AI 추정 중 오류가 났어요 ({type(e).__name__}). 업종 정보로만 추천했어요."]
            with _jobs_lock:
                job.update(state="failed" if warnings else "done", warnings=warnings, at=time.time())

        job["thread"] = threading.Thread(target=run, daemon=True)
        _jobs[key] = job
        job["thread"].start()
        return job


def recommend(people: list[dict], client, store=None, *, region: str | None = None,
              place_type: str | None = None, api_key: str | None = None, background: bool = False) -> dict:
    if not people:
        raise ValueError("아직 참여한 사람이 없어요.")
    summary = summarize(people)
    region = (region or summary["region"] or "").strip()
    place_type = place_type or summary["place_type"]
    if not region or place_type not in PLACE_TYPES:
        raise ValueError("지역과 장소 종류를 확인해 주세요.")

    out = {"region": region, "place_type": place_type, "summary": summary, "source": client.source,
           "results": [], "excluded": [], "warnings": [], "status": "ok"}
    try:
        places = search_places(client, region, place_type)
    except EatplError as e:
        out.update(status="error", message=str(e))
        return out
    if not places:
        out.update(status="empty", message=f"{region}에서 {PLACE_TYPES[place_type]}을(를) 찾지 못했어요. 지역을 바꿔 보세요.")
        return out

    allergy_people = summary["allergies"]
    allergens = list(allergy_people)
    # 1차: 규칙(+저장된 AI 추정)으로 점수 → 유력 후보부터 AI에 보낸다. 규칙상 위험 '높음'은 AI가 낮출 수 없으니 보내지 않는다.
    first, _ = estimate_places(places, place_type, allergens, store=store, api_key="", ai_limit=0)
    prelim = []
    for p in places:
        s = score_place(p, first[p["id"]], people, place_type, allergy_people)
        if not s["excluded"]:
            prelim.append((s["score"], p))
    prelim.sort(key=lambda x: (-x[0], _rank_key(x[1])))
    ordered = [p for _, p in prelim]
    key_ = api_key if api_key is not None else os.getenv("OPENROUTER_API_KEY", "").strip()
    out["ai_pending"] = False
    if background and key_:
        # 유력 후보 상위 AI_LIMIT곳 중 아직 추정이 없는 곳만 보낸다. 전체에서 고르면 화면이 다시 물을 때마다
        # 다음 20곳을 또 보내서 무료 한도를 금방 쓴다.
        top = ordered[:AI_LIMIT]
        todo = pending_ai(top, allergens, store)
        estimates, warnings = first, []
        if todo:
            job = _start_ai_job((place_type, tuple(sorted(allergens)), tuple(p["id"] for p in todo)),
                                top, place_type, allergens, store, key_)
            if job["state"] == "running":
                out["ai_pending"] = True
            else:
                warnings = list(job["warnings"])
    else:
        estimates, warnings = estimate_places(ordered, place_type, allergens, store=store, api_key=key_,
                                              ai_limit=AI_LIMIT)
        estimates = {**first, **estimates}
    out["warnings"] = warnings
    scored = []
    for p in places:
        est = estimates[p["id"]]
        s = score_place(p, est, people, place_type, allergy_people)
        if s["excluded"]:
            out["excluded"].append({"name": p["name"], "reason": s["reason"]})
            continue
        scored.append({**p, "estimate": est, **{k: s[k] for k in ("score", "reasons", "cautions")}})
    scored.sort(key=lambda x: (-x["score"], _rank_key(x)))
    out["results"] = scored[:TOP_N]
    if not out["results"]:
        out.update(status="empty", message="알레르기 조건 때문에 추천할 수 있는 곳이 없어요. 장소 종류를 바꿔 보세요.")
    return out
