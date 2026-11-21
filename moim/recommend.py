"""참여자 선호를 합쳐 가게를 추천한다.

- 지역과 장소 종류(카페/식당/술집)는 참여자 투표로 정한다(직접 바꿀 수도 있음).
- 알레르기: 누구 하나라도 가진 알레르기의 위험이 '높음'인 가게는 제외, '보통·모름'은 주의 표시.
- 선호(종류·예산·분위기): 같은 선호를 고른 사람이 많을수록 점수가 높다.
- background=True(서버): 무료 AI는 응답에 30~60초 걸려서, 먼저 업종 규칙으로 결과를 바로 주고
  AI 추정은 뒤에서 돌려 저장한다. 화면이 잠시 뒤 다시 요청하면 AI가 반영된 결과가 나온다.
"""

from __future__ import annotations

import os
import math
import threading
from concurrent.futures import ThreadPoolExecutor
import time
from collections import Counter

from . import details
from .eatpl import BRUNCH_BUSINESS_TYPE, EXCLUDED_TYPES, EatplError, evidence_category, search_places
from .estimate import estimate_places, pending_ai, rule_estimate
from .options import (
    ATMOSPHERES, BRUNCH_STYLE, BUDGETS, DESSERT_STYLE, GROUP_SEATING, ICE_CREAM_STYLE, PLACE_TYPES,
    REGION_QUERIES, REGIONS, SIGNALS, STYLES, VEGETARIAN_STYLE, canonical_atmospheres, canonical_signals,
    canonical_styles, normalize_region,
)
from .regions import matches_selected_area, search_terms
from .stations import STATION_RADIUS_M, StationLookupError, candidate_areas, require_station, station_input, tm128

TOP_N = 10
AI_LIMIT = 12  # 실측: 무료 모델이 20곳이면 110~120초 → 화면 상위 10곳 + 여유 2곳  # 추천 한 번에 AI로 추정할 최대 가게 수 (= AI 요청 최대 1번)
ATMOSPHERE_DETAIL_LIMIT = 30
RETRY_AFTER = 300  # AI 추정이 실패하면 이 시간(초) 동안은 다시 시도하지 않는다 (무료 한도 보호)
W_STYLE, W_BUDGET_FIT, W_BUDGET_OVER, W_ATMOS, W_MEDIUM_RISK = 3, 2, -2, 1, -2
W_SIGNAL = 2
W_VEGETARIAN = 1


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


def _summarize_styles(people: list[dict], place_type: str) -> dict[str, int]:
    cuisines = set(STYLES[place_type])
    counts: Counter[str] = Counter()
    flexible = 0
    for person in people:
        if person["place_type"] != place_type:
            continue
        picked = canonical_styles(place_type, person["styles"])
        counts.update(picked)
        if cuisines.isdisjoint(picked):
            flexible += 1
    voted_cuisines = cuisines.intersection(counts)
    if voted_cuisines:
        for cuisine in voted_cuisines:
            counts[cuisine] += flexible
    elif flexible:
        counts["아무거나"] = flexible
    return dict(counts.most_common())


def summarize(people: list[dict]) -> dict:
    regions = Counter(p["region"] for p in people)
    types = Counter(p["place_type"] for p in people)
    return {
        "count": len(people),
        "regions": dict(regions.most_common()),
        "place_types": {t: types.get(t, 0) for t in PLACE_TYPES},
        "styles": {t: _summarize_styles(people, t) for t in PLACE_TYPES},
        "budgets": {str(b): sum(1 for p in people if p.get("budget") == b) for b in BUDGETS},
        "atmospheres": dict(Counter(
            a for p in people for a in canonical_atmospheres(p.get("atmospheres", []), p["place_type"])).most_common()),
        "signals": dict(Counter(s for p in people for s in canonical_signals(p.get("signals", []))).most_common()),
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
    selections = [set(canonical_styles(place_type, p["styles"])) for p in people if p["place_type"] == place_type]
    cuisines = set(STYLES[place_type])
    voters = [picked & cuisines for picked in selections if picked & cuisines]
    matched_styles = [tag for tag in canonical_styles(place_type, est["styles"]) if tag in cuisines]
    matches = set(matched_styles)
    score += W_STYLE * sum(bool(picked & matches) for picked in voters)
    flexible = len(selections) - len(voters)
    for style in matched_styles:
        fans = sum(style in picked for picked in voters)
        if fans:
            reasons.append(f"{style} {fans + flexible}명")
    if place_type == "restaurant" and VEGETARIAN_STYLE in est["styles"]:
        fans = sum(VEGETARIAN_STYLE in picked for picked in selections)
        if fans:
            score += W_VEGETARIAN * fans
            reasons.append(f"{fans}명이 선호한 채식 · 잇플 업종 기준")
    # 예산
    band = est["price_band"]
    budget_people = [p for p in people if p.get("budget")]
    if band and budget_people:
        fit = [p for p in budget_people if band <= p["budget"]]
        over = [p for p in budget_people if band > p["budget"] + 1]
        score += W_BUDGET_FIT * len(fit) + W_BUDGET_OVER * len(over)
        how = "업종 기준 추정" if est.get("source") == "rule" else "추정"
        price = est.get("menu_price")
        basis = (f"메뉴 조합 {' + '.join(price['items'])} {price['amount']:,}원"
                 if price else f"1인 {BUDGETS[band]} {how}")
        reasons.append(f"{basis} · 예산 맞는 사람 {len(fit)}명")
    elif budget_people:
        cautions.append("가격대 정보 없음")
    # 분위기
    atmosphere_votes = Counter(
        a for p in people for a in canonical_atmospheres(p.get("atmospheres", []), p["place_type"]))
    evidence = est.get("atmosphere_evidence", {})
    for a in est["atmospheres"]:
        fans = atmosphere_votes[a]
        if fans:
            reason = f"분위기 '{a}' 원하는 사람 {fans}명"
            match = evidence.get(a)
            score += W_ATMOS * fans * (0.5 if match and match.get("hint") else 1)
            if match:
                source = "잇플 편의 안내" if match["source"] == "services" else "잇플 후기 요약"
                if match.get("hint"):
                    source += " · 좌석 정보 미확인"
                reason += f" · {source} · {match['text']}"
            reasons.append(reason)
    if atmosphere_votes[GROUP_SEATING] and GROUP_SEATING not in evidence and place.get("group_customer") is True:
        score += 0.5 * atmosphere_votes[GROUP_SEATING]
        reasons.append("잇플 결제 데이터 · 저녁 단체 결제 이력 · 좌석 정보 미확인")
    # 제공처가 명시적으로 true로 준 방문 특성만 선호 점수에 반영한다.
    # false/미확인은 보장이나 불리한 판정으로 바꾸지 않는다.
    signal_votes = Counter(s for p in people for s in canonical_signals(p.get("signals", [])))
    for label, field in SIGNALS.items():
        fans = signal_votes[label]
        if fans and place.get(field) is True:
            score += W_SIGNAL * fans
            reasons.append(f"{fans}명이 선호한 {label} 신호")
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


# 카페 검색('카페')에 안 잡히는 카페류 업종. 디저트·베이커리를 고른 사람을 위해 따로 검색한다.
CAFE_EXTRA_TYPES = ("기타베이커리", "빵/도넛", "아이스크림/요거트/빙수", BRUNCH_BUSINESS_TYPE)


def search_region(client, region: str, place_type: str, *, include_unknown: bool = False) -> list[dict]:
    """지역 이름을 실제 주소 표기로 바꿔 검색하고 합친다 (샘플 데이터는 지역 이름 그대로).

    첫 검색이 실패하면 EatplError를 그대로 올리고, 보조 검색(두 번째 주소·카페류 업종) 실패는 건너뛴다.
    """
    real = client.source != "sample"
    station = require_station(region) if real and station_input(region) else None
    center = tm128(station.longitude, station.latitude) if station else None
    queries = REGION_QUERIES.get(normalize_region(region)) if real and not station else None
    areas = candidate_areas(station) if station else queries or (search_terms(region) if real else [region])
    seen, out = set(), []

    def add(found):
        for p in found:
            category = evidence_category(p) if include_unknown else p["category"]
            eligible = category == place_type or (
                include_unknown and category == "unknown" and p.get("business_type") not in EXCLUDED_TYPES
            )
            if not eligible or p["id"] in seen:
                continue
            if queries and p.get("address") and not p["address"].startswith("서울"):
                continue  # 다른 도시의 같은 동 이름 (예: 경기 평택시 합정동)
            if center:
                point = p.get("tm128")
                if not point:
                    continue
                distance = math.dist(center, point)
                if distance > STATION_RADIUS_M:
                    continue
                p = {**p, "distance_m": round(distance)}
            elif real and not queries and not matches_selected_area(region, p.get("address") or ""):
                continue
            seen.add(p["id"])
            out.append({**p, "category": category} if category != p["category"] else p)

    # 검색을 동시에 보내고(실측: 차례로 10번이면 4.5초), 결과는 보낸 순서대로 합친다
    jobs = []
    for index, loc in enumerate(areas):
        jobs.append((loc, None, True))
        if real and place_type == "cafe" and (not station or index == 0):
            jobs += [(loc, btype, False) for btype in CAFE_EXTRA_TYPES]

    def run(job):
        loc, btype, main = job
        try:
            return (search_places(client, loc, place_type, include_unknown=include_unknown)
                    if main else client.search(loc, btype)), None
        except EatplError as e:
            return [], e

    with ThreadPoolExecutor(max_workers=min(len(jobs), 6)) as pool:
        results = list(pool.map(run, jobs))
    for found, _ in results:
        add(found)
    if station and all(error is not None for _, error in results):
        raise results[0][1]
    if not station and results[0][1] is not None:
        raise results[0][1]  # 첫 주소의 기본 검색이 실패하면 알린다 (보조 검색 결과만 보여 주면 오해를 산다)
    return out


def _estimates_with_profiles(ordered, first, place_type, allergens, store, api_key, background,
                             *, atmosphere_requested, party_size):
    # Select a stable group before enrichment so polling doesn't keep fetching new shops.
    # Leave room for directly classified matches when ambiguous candidates rank highly.
    known = [p for p in ordered if p["category"] == place_type]
    ambiguous = [p for p in ordered if p["category"] == "unknown"]
    reserve = min(len(ambiguous), 3)
    direct = known[:AI_LIMIT - reserve]
    top = direct + ambiguous[:AI_LIMIT - len(direct)]
    profile_places = top
    if atmosphere_requested:
        profile_places = top + known[len(direct):len(direct) + ATMOSPHERE_DETAIL_LIMIT - len(top)]
    profiles, loading = details.profiles(profile_places, background=background)
    evidence_places = [
        {**p, "detail": profiles[p["id"]]} for p in top
        if profiles.get(p["id"], {}).get("menu") or profiles.get(p["id"], {}).get("review")
    ]
    estimate_map = dict(first)
    warnings = []
    ai_pending = False
    if api_key and evidence_places and not loading:
        if background and store:
            cached, _ = estimate_places(evidence_places, place_type, allergens, store=store, api_key="", ai_limit=0)
            estimate_map.update(cached)
            todo = pending_ai(evidence_places, allergens, store, place_type=place_type)
            if todo:
                key = ("profile", place_type, tuple(sorted(allergens)),
                       tuple((p["id"], repr(p["detail"])) for p in todo))
                job = _start_ai_job(key, evidence_places, place_type, allergens, store, api_key)
                ai_pending = job["state"] == "running"
                warnings = job["warnings"]
        else:
            fresh, warnings = estimate_places(evidence_places, place_type, allergens, store=store, api_key=api_key)
            estimate_map.update(fresh)

    for place in ordered:
        pid = place["id"]
        profile = profiles.get(pid, {})
        menu = profile.get("menu", [])
        est = estimate_map[pid]
        rule = rule_estimate(place, allergens)
        cakes = details.cake_items(profile) if place_type == "cafe" else []
        item = est.get("cake_item")
        if place_type == "cafe" and item and details.supports_cake_inference(item) and item not in cakes:
            cakes.append(item)
        desserts = list(dict.fromkeys(cakes + details.dessert_items(profile))) if place_type == "cafe" else []
        styles = canonical_styles(place_type, [*rule["styles"], *est["styles"]])
        if place_type == "cafe":
            styles = [tag for tag in styles if tag != DESSERT_STYLE]
            if desserts:
                styles.append(DESSERT_STYLE)
        menu_price = details.cafe_price(profile, cakes) if place_type == "cafe" else None
        atmosphere_matches = details.atmosphere_evidence(profile, party_size, place_type=place_type)
        estimate_map[pid] = {
            **est, "styles": styles, "cake_items": cakes, "dessert_items": desserts, "menu_available": bool(menu),
            "price_band": menu_price["band"] if menu_price else rule["price_band"], "menu_price": menu_price,
            "atmospheres": list(dict.fromkeys([*est["atmospheres"], *atmosphere_matches])),
            "atmosphere_evidence": atmosphere_matches,
        }
    return estimate_map, warnings, {"details_pending": loading, "ai_pending": ai_pending}


def recommend(people: list[dict], client, store=None, *, region: str | None = None,
              place_type: str | None = None, api_key: str | None = None, party_size: int | None = None,
              background: bool = False) -> dict:
    if not people:
        raise ValueError("아직 참여한 사람이 없어요.")
    summary = summarize(people)
    region = (region or summary["region"] or "").strip()
    place_type = place_type or summary["place_type"]
    if not region or place_type not in PLACE_TYPES:
        raise ValueError("지역과 장소 종류를 확인해 주세요.")

    out = {"region": region, "place_type": place_type, "summary": summary, "source": client.source,
           "results": [], "excluded": [], "warnings": [], "status": "ok"}
    use_details = client.source == "kskill" and details.enabled()
    if client.source != "sample" and station_input(region):
        out["station_radius_m"] = STATION_RADIUS_M
    try:
        places = search_region(client, region, place_type, include_unknown=use_details)
    except (EatplError, StationLookupError) as e:
        out.update(status="error", message=str(e))
        return out
    if not places:
        area = f"{region} 반경 {STATION_RADIUS_M}m" if out.get("station_radius_m") else region
        out.update(status="empty", message=f"{area}에서 {PLACE_TYPES[place_type]}을(를) 찾지 못했어요. 지역을 바꿔 보세요.")
        return out

    allergy_people = summary["allergies"]
    allergens = list(allergy_people)
    # 1차: 규칙(+저장된 AI 추정)으로 점수 → 유력 후보부터 AI에 보낸다. 규칙상 위험 '높음'은 AI가 낮출 수 없으니 보내지 않는다.
    estimate_store = None if use_details else store
    first, _ = estimate_places(places, place_type, allergens, store=estimate_store, api_key="", ai_limit=0)
    prelim = []
    for p in places:
        s = score_place(p, first[p["id"]], people, place_type, allergy_people)
        if not s["excluded"]:
            prelim.append((s["score"], p))
    prelim.sort(key=lambda x: (-x[0], _rank_key(x[1])))
    ordered = [p for _, p in prelim]
    key_ = api_key if api_key is not None else os.getenv("OPENROUTER_API_KEY", "").strip()
    out["ai_pending"] = False
    out["details_pending"] = False
    if use_details:
        estimates, warnings, detail_state = _estimates_with_profiles(
            ordered, first, place_type, allergens, store, key_, background,
            atmosphere_requested=any(a in ATMOSPHERES for a in summary["atmospheres"]),
            party_size=party_size or len(people),
        )
        out.update(detail_state)
    elif background and key_:
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
    picked_styles = set(summary["styles"][place_type]) & set(STYLES[place_type])
    required_styles = set()
    if place_type == "restaurant" or BRUNCH_STYLE in picked_styles or picked_styles == {ICE_CREAM_STYLE}:
        required_styles = picked_styles
    scored = []
    for p in places:
        est = estimates[p["id"]]
        if use_details and p["category"] == "unknown" and est.get("verified_category") != place_type:
            continue
        if required_styles and not required_styles.intersection(est["styles"]):
            continue
        s = score_place(p, est, people, place_type, allergy_people)
        if s["excluded"]:
            out["excluded"].append({"name": p["name"], "reason": s["reason"]})
            continue
        scored.append({**p, "estimate": est, **{k: s[k] for k in ("score", "reasons", "cautions")}})
    wants_dessert = place_type == "cafe" and DESSERT_STYLE in summary["styles"]["cafe"]
    scored.sort(key=lambda p: (
        wants_dessert and not p["estimate"].get("dessert_items"), -p["score"], _rank_key(p)
    ))
    out["results"] = scored[:TOP_N]
    if (use_details and scored and wants_dessert
            and not any(p["estimate"].get("dessert_items") for p in scored)
            and not (out["details_pending"] or out["ai_pending"])):
        warnings.append("디저트·케이크 메뉴를 확인한 카페가 없어요. 일반 카페를 보여드려요.")
    if not out["results"]:
        if out["details_pending"] or out["ai_pending"]:
            out.update(status="pending", message="상세 정보를 확인하고 있어요.")
        elif out["excluded"]:
            out.update(status="empty", message="알레르기 조건 때문에 추천할 수 있는 곳이 없어요. 장소 종류를 바꿔 보세요.")
        elif required_styles:
            labels = ", ".join(tag for tag in STYLES[place_type] if tag in required_styles)
            out.update(status="empty", message=f"선택한 종류({labels})에 맞는 곳을 찾지 못했어요.")
        else:
            out.update(status="empty", message="선택한 업종을 확인한 장소가 없어요.")
    return out
