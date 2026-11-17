"""실제 환경 진단: OpenRouter AI 추정과 잇플 검색이 실제로 어떻게 동작하는지 확인하고 보고서를 남긴다.

실행 (저장소 폴더에서):  python -m moim.diagnose
옵션: --no-ai  --no-eatpl  --regions 홍대,성수,강남

- 키·기관명은 보고서에 쓰지 않는다 (있는지 여부와 앞 글자만).
- 결과: diagnose_report.md (사람이 읽는 요약), diagnose_report.json (전체 기록)
- OpenRouter 요청은 모델 수 + 최대 3번, 잇플 요청은 지역 수 × 2 + 4번 정도 쓴다.
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import tempfile
import time
from collections import Counter
from pathlib import Path
from urllib import error

from . import estimate, options
from .eatpl import EatplError, SampleClient, make_client
from . import recommend as rec_mod
from .recommend import recommend
from .server import ROOT, load_dotenv
from .store import Store

TEST_PLACES = [
    {"id": "t1", "name": "홍대 새우튀김 우동", "business_type": "국수/면/만두", "category": "restaurant"},
    {"id": "t2", "name": "성수 딸기 케이크 카페", "business_type": "카페", "category": "cafe"},
    {"id": "t3", "name": "강남 한우 오마카세", "business_type": "일반한식", "category": "restaurant"},
    {"id": "t4", "name": "을지로 노포 생맥주 호프", "business_type": "호프", "category": "bar"},
    {"id": "t5", "name": "연남 비건 샐러드", "business_type": "비건/채식/사찰", "category": "restaurant"},
]
TEST_ALLERGENS = ["갑각류(새우·게)", "밀·글루텐", "우유·유제품"]
BAR_TYPES = ["호프", "이자카야", "바(bar)", "기타주점"]
SOURCE_LABEL = {"eatpl": "잇플 직접 API", "kskill": "K-Skill 프록시(잇플)", "sample": "샘플(가상)"}

GROUPS = [
    ("식당 · 한식/일식 · 갑각류 알레르기", "restaurant", [
        {"name": "가", "styles": ["한식", "일식"], "budget": 2, "atmospheres": ["대화하기 좋은"], "allergies": ["갑각류(새우·게)"]},
        {"name": "나", "styles": ["한식"], "budget": 3, "atmospheres": ["조용한"], "allergies": []},
        {"name": "다", "styles": ["양식"], "budget": 2, "atmospheres": ["대화하기 좋은"], "allergies": []}]),
    ("카페 · 디저트 · 조용한", "cafe", [
        {"name": "가", "styles": ["디저트·케이크"], "budget": 2, "atmospheres": ["조용한"], "allergies": []},
        {"name": "나", "styles": ["디저트·케이크", "커피 맛집"], "budget": 1, "atmospheres": ["감성·인테리어"], "allergies": ["견과류"]}]),
    ("술집 · 이자카야/호프 · 밀 알레르기", "bar", [
        {"name": "가", "styles": ["이자카야"], "budget": 3, "atmospheres": ["대화하기 좋은"], "allergies": ["밀·글루텐"]},
        {"name": "나", "styles": ["호프·맥주"], "budget": 2, "atmospheres": ["활기찬"], "allergies": []},
        {"name": "다", "styles": ["이자카야"], "budget": 3, "atmospheres": [], "allergies": []}]),
]


def _mask(value: str) -> str:
    return f"{value[:1]}***({len(value)}자)" if value else "(없음)"


def _now() -> float:
    return time.perf_counter()


def check_env() -> dict:
    inst = os.getenv("EATPL_INSTITUTION", "").strip()
    return {
        "eatpl_institution": _mask(inst),
        "eatpl_env": os.getenv("EATPL_ENV", "").strip() or "dev",
        "openrouter_key": "있음" if os.getenv("OPENROUTER_API_KEY", "").strip() else "없음",
        "openrouter_models": estimate._models(),
    }


def check_ai(api_key: str) -> list[dict]:
    """모델마다 같은 5개 가게를 추정시켜 응답 형식·속도·내용을 기록한다."""
    all_styles = list(dict.fromkeys(x for t in options.STYLES.values() for x in t))  # 식당·카페·술집이 섞여 있어서
    system = estimate._SYSTEM % (", ".join(options.ATMOSPHERES), ", ".join(all_styles))
    user = json.dumps({"요청한 알레르기": TEST_ALLERGENS,
                       "가게": [{"id": p["id"], "이름": p["name"], "업종": p["business_type"]} for p in TEST_PLACES]},
                      ensure_ascii=False)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    out = []
    for model in estimate._models():
        rec = {"model": model}
        t0 = _now()
        try:
            text = estimate._post(api_key, model, messages, timeout=60)
            rec["seconds"] = round(_now() - t0, 1)
            rec["raw_start"] = text[:300]
            obj = estimate._parse_json(text)
            items = obj.get("places") if isinstance(obj, dict) else None
            rec["json_ok"] = isinstance(items, list)
            by_id = {str(i.get("id")): i for i in (items or []) if isinstance(i, dict)}
            rec["ids_returned"] = f"{sum(1 for p in TEST_PLACES if p['id'] in by_id)}/{len(TEST_PLACES)}"
            rec["places"] = {}
            for p in TEST_PLACES:
                if p["id"] in by_id:
                    cleaned = estimate._clean_ai(by_id[p["id"]], p["category"], TEST_ALLERGENS)
                    cleaned.pop("source", None)
                    rec["places"][p["name"]] = cleaned
            rec["status"] = "ok" if rec["json_ok"] else "형식 오류"
        except error.HTTPError as e:
            rec.update(status=f"HTTP {e.code}", seconds=round(_now() - t0, 1))
            try:
                rec["error_body"] = e.read(400).decode("utf-8", "replace")
            except Exception:
                pass
        except Exception as e:  # 진단이므로 어떤 오류든 기록하고 다음 모델로
            rec.update(status=type(e).__name__, detail=str(e)[:200], seconds=round(_now() - t0, 1))
        out.append(rec)
        print(f"  AI {model}: {rec['status']} ({rec.get('seconds')}초)")
    return out


def _summarize_places(places: list, region: str) -> dict:
    ranks = [p["sales_rank"] for p in places if p.get("sales_rank") is not None]
    return {
        "rows": len(places),
        "business_types": dict(Counter(p.get("business_type") for p in places).most_common(25)),
        "categories": dict(Counter(p.get("category") for p in places)),
        "detail_url_ok": sum(1 for p in places if p.get("eatpl_url")),
        "in_seoul": sum(1 for p in places if (p.get("address") or "").startswith("서울")),
        "allSaleRnk": ({"min": min(ranks), "median": statistics.median(ranks), "max": max(ranks), "n": len(ranks)}
                       if ranks else None),
        "first_rows": [{k: p.get(k) for k in ("name", "business_type", "category", "address", "sales_rank")}
                       for p in places[:5]],
    }


def check_eatpl(client, regions: list[str]) -> list[dict]:
    """지역마다 원래 이름과 실제 주소 표기(REGION_QUERIES)로 검색해 비교한다."""
    calls = []
    for r in regions:
        for loc in dict.fromkeys([r] + options.REGION_QUERIES.get(r, [])):
            calls += [(r, loc, None), (r, loc, "카페")]
    bar_types = ["주점", "칵테일바"] if client.source == "kskill" else BAR_TYPES
    first = options.REGION_QUERIES.get(regions[0], [regions[0]])[0]
    calls += [(regions[0], first, t) for t in bar_types]
    out = []
    for region, loc, btype in calls:
        rec = {"region": region, "location": loc, "merTpbuzNm": btype}
        t0 = _now()
        try:
            places = client.search(loc, btype)
            rec.update(status="ok", seconds=round(_now() - t0, 2), **_summarize_places(places, region))
        except EatplError as e:
            rec.update(status="error", message=str(e), seconds=round(_now() - t0, 2))
        out.append(rec)
        print(f"  잇플 {loc} {btype or '(전체)'}: {rec['status']} {rec.get('rows', '')}건")
    return out


def check_recommend(client, store, region: str, use_ai: bool) -> list[dict]:
    out = []
    for label, ptype, members in GROUPS:
        people = [options.validate_preference({"region": region, "place_type": ptype, **m}) for m in members]
        t0 = _now()
        try:
            # 서버와 같은 방식: 먼저 규칙 결과를 바로 받고, AI가 끝나면 다시 요청해 AI 반영 결과를 받는다
            res = recommend(people, client, store, api_key=None if use_ai else "", background=True)
            first = round(_now() - t0, 2)
            if res.get("ai_pending"):
                for job in list(rec_mod._jobs.values()):
                    if job.get("thread"):
                        job["thread"].join(180)
                res = recommend(people, client, store, api_key=None if use_ai else "", background=True)
        except Exception as e:
            out.append({"group": label, "status": type(e).__name__, "detail": str(e)[:200]})
            continue
        rec = {"group": label, "region": res["region"], "place_type": ptype, "status": res["status"],
               "message": res.get("message"), "first_response_seconds": first,
               "seconds": round(_now() - t0, 1), "warnings": res["warnings"],
               "results": len(res["results"]), "excluded": len(res["excluded"]),
               "excluded_examples": res["excluded"][:5],
               "top": [{"name": r["name"], "business_type": r["business_type"], "score": r["score"],
                        "sales_rank": r["sales_rank"], "estimate_source": r["estimate"]["source"],
                        "price_band": r["estimate"]["price_band"], "styles": r["estimate"]["styles"],
                        "atmospheres": r["estimate"]["atmospheres"], "reasons": r["reasons"],
                        "cautions": r["cautions"], "has_eatpl_link": bool(r["eatpl_url"])}
                       for r in res["results"][:5]]}
        out.append(rec)
        print(f"  추천 [{label}]: {rec['status']} 결과 {rec['results']}곳, 제외 {rec['excluded']}곳 "
              f"(첫 화면 {first}초, AI 반영까지 {rec['seconds']}초)")
    return out


def to_markdown(report: dict) -> str:
    L = ["# 진단 보고서", "", f"- 실행 시각: {report['ran_at']}", f"- 데이터: {report['data_source']}"]
    for k, v in report["env"].items():
        L.append(f"- {k}: {v}")
    if report.get("ai") is not None:
        L += ["", "## OpenRouter 모델별 결과", "", "| 모델 | 결과 | 초 | 받은 가게 |", "| --- | --- | --- | --- |"]
        for r in report["ai"]:
            L.append(f"| {r['model']} | {r['status']} | {r.get('seconds', '')} | {r.get('ids_returned', '')} |")
        for r in report["ai"]:
            if r.get("places"):
                L += ["", f"### {r['model']} 추정 내용", ""]
                for name, est in r["places"].items():
                    L.append(f"- {name}: 가격대 {est['price_band']} · 분위기 {est['atmospheres']} · 종류 {est['styles']}"
                             f" · 알레르기 {est['allergy_risk']}")
    if report.get("eatpl") is not None:
        L += ["", "## 잇플 검색", "", "| 지역 | 검색 주소 | 업종 | 결과 | 건수 | 서울 | 상세링크 | 분류(카페/식당/술집/기타) | 초 |",
              "| --- | --- | --- | --- | --- | --- | --- | --- | --- |"]
        for r in report["eatpl"]:
            c = r.get("categories") or {}
            L.append(f"| {r['region']} | {r['location']} | {r['merTpbuzNm'] or '(전체)'} | {r['status']} {r.get('message', '')} | "
                     f"{r.get('rows', '')} | {r.get('in_seoul', '')} | {r.get('detail_url_ok', '')} | "
                     f"{c.get('cafe', 0)}/{c.get('restaurant', 0)}/{c.get('bar', 0)}/{c.get('unknown', 0)} | {r.get('seconds', '')} |")
        ok = [r for r in report["eatpl"] if r["status"] == "ok" and r.get("rows")]
        if ok:
            L += ["", f"첫 검색({ok[0]['location']}) 업종 분포: {ok[0]['business_types']}", f"allSaleRnk: {ok[0]['allSaleRnk']}"]
    if report.get("recommend") is not None:
        L += ["", "## 실제 추천 결과"]
        for g in report["recommend"]:
            L += ["", f"### {g['group']} — {g['status']} {g.get('message') or ''}",
                  f"결과 {g.get('results')}곳 · 제외 {g.get('excluded')}곳 · 첫 화면 {g.get('first_response_seconds')}초 · "
                  f"AI 반영까지 {g.get('seconds')}초 · 경고 {g.get('warnings')}", ""]
            for i, t in enumerate(g.get("top", []), 1):
                L.append(f"{i}. {t['name']} ({t['business_type']}) 점수 {t['score']} · 순위값 {t['sales_rank']} · "
                         f"{t['estimate_source']} · 이유 {t['reasons']} · 주의 {t['cautions']}")
    return "\n".join(L) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser(description="실제 환경 진단")
    ap.add_argument("--no-ai", action="store_true")
    ap.add_argument("--no-eatpl", action="store_true")
    ap.add_argument("--regions", default="홍대,성수,강남")
    args = ap.parse_args()
    load_dotenv()
    regions = [r.strip() for r in args.regions.split(",") if r.strip()]
    store = Store(str(ROOT / "moim.sqlite3"))  # 거래추적번호 순번을 서버와 같이 써야 번호가 겹치지 않는다
    client = make_client(store)
    report = {"ran_at": time.strftime("%Y-%m-%d %H:%M:%S"), "env": check_env(),
              "data_source": SOURCE_LABEL.get(client.source, client.source)}
    print("1) 설정:", report["env"])

    key = os.getenv("OPENROUTER_API_KEY", "").strip()
    if args.no_ai or not key:
        report["ai"] = None
        print("2) AI 확인 건너뜀" + ("" if args.no_ai else " (OPENROUTER_API_KEY 없음)"))
    else:
        print("2) OpenRouter 모델별 확인")
        report["ai"] = check_ai(key)

    if args.no_eatpl or client.source == "sample":
        report["eatpl"] = None
        print("3) 잇플 확인 건너뜀" + ("" if args.no_eatpl else " (기관명·EATPL_SOURCE 설정 없음)"))
    else:
        print("3) 잇플 검색 확인")
        report["eatpl"] = check_eatpl(client, regions)

    print("4) 실제 추천 확인")
    rec_client = client if not args.no_eatpl else SampleClient()
    # 추정 캐시는 임시 파일에: 서버 DB에 남은 예전 추정을 쓰지 않고 지금 프롬프트·규칙을 그대로 확인한다
    # (Windows는 열린 SQLite 파일을 바로 못 지워서 임시 폴더에 그대로 둔다)
    tmp = Path(tempfile.mkdtemp(prefix="moim-diag-"))
    report["recommend"] = check_recommend(rec_client, Store(str(tmp / "diag.sqlite3")), regions[0],
                                          use_ai=bool(key) and not args.no_ai)

    (ROOT / "diagnose_report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (ROOT / "diagnose_report.md").write_text(to_markdown(report), encoding="utf-8")
    print(f"\n보고서 저장: {ROOT / 'diagnose_report.md'}")


if __name__ == "__main__":
    main()
