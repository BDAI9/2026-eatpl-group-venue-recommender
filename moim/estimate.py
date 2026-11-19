"""가게별 추정: 가격대, 분위기, 종류(양식/이자카야 등), 알레르기 위험.

잇플 데이터에는 가격·메뉴·재료·분위기가 없다. 그래서
1) 업종(merTpbuzNm)으로 확실히 알 수 있는 것(종류, 대표적인 알레르기 위험)은 규칙으로 정하고,
2) 가격대와 분위기 등은 OpenRouter AI가 가게 이름·업종으로 추정한다.
AI 추정은 틀릴 수 있으므로 화면에 'AI 추정'으로 표시한다. 알레르기는 로컬 규칙으로만 판단한다.
"""

from __future__ import annotations

import json
import os
import re
import socket
from urllib import error, request

from .options import ATMOSPHERES, BUDGETS, STYLES

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
DEFAULT_MODELS = ["google/gemma-4-31b-it:free", "google/gemma-4-26b-a4b-it:free", "nvidia/nemotron-3.5-lightning:free"]
BATCH = 20
RISK = ("unknown", "low", "medium", "high")

# ---------------------------------------------------------------- 규칙
_STYLE_BY_TYPE = {}
for _style, _types in {
    "한식": ["일반한식", "한정식", "기타한식", "백반/한정식", "찜/탕/찌개", "도시락/죽", "전/부침개", "해산물구이/찜"],
    "중식": ["중국음식", "마라탕", "양꼬치", "기타중식"],
    "일식": ["일식회집", "스시/초밥", "일식돈가스", "일식라멘", "기타일식", "횟집"],
    "양식": ["서양음식", "이탈리아음식", "프랑스음식", "멕시칸", "샌드위치/토스트"],
    "아시안": ["아시안", "기타외국식"],
    "고기·구이": ["갈비전문점", "고기구이", "곱창전골/구이", "족발/보쌈"],
    "분식": ["분식", "김밥전문점", "떡볶이전문점", "국수/면/만두"],
    "치킨·버거·피자": ["치킨", "피자", "버거"],
    "채식": ["비건/채식/사찰"],
    "호프·맥주": ["호프"],
    "이자카야": ["이자카야"],
    "와인·칵테일 바": ["바(bar)", "칵테일바"],
    "포차·소주": ["기타주점"],
    "베이커리": ["기타베이커리", "빵/도넛"],  # 빙수·아이스크림은 자동으로 '디저트'를 붙이지 않음 (실측: 상위가 전부 빙수집)
}.items():
    for _t in _types:
        _STYLE_BY_TYPE[_t] = _style

_SEAFOOD = {"갑각류(새우·게)": "high", "조개류": "high", "생선": "high", "오징어": "high"}
_ALLERGY_BY_TYPE = {
    "일식회집": _SEAFOOD, "스시/초밥": _SEAFOOD, "해산물구이/찜": _SEAFOOD, "횟집": _SEAFOOD,
    "기타일식": {"생선": "medium", "대두": "medium", "밀·글루텐": "medium"},
    "기타중식": {"갑각류(새우·게)": "medium", "대두": "medium", "밀·글루텐": "medium"},
    "백반/한정식": {"대두": "medium"}, "기타한식": {"대두": "medium"},
    "기타베이커리": {"밀·글루텐": "high", "우유·유제품": "medium", "달걀": "medium", "견과류": "medium"},
    "빵/도넛": {"밀·글루텐": "high", "우유·유제품": "medium", "달걀": "medium", "견과류": "medium"},
    "아이스크림/요거트/빙수": {"우유·유제품": "high"},
    "브런치카페/샐러드": {"밀·글루텐": "medium", "달걀": "medium", "우유·유제품": "medium"},
    "샌드위치/토스트": {"밀·글루텐": "high", "달걀": "medium", "우유·유제품": "medium"},
    "중국음식": {"갑각류(새우·게)": "medium", "대두": "medium", "밀·글루텐": "medium"},
    "마라탕": {"갑각류(새우·게)": "medium", "대두": "high", "땅콩": "medium", "밀·글루텐": "medium"},
    "일식돈가스": {"돼지고기": "high", "밀·글루텐": "high", "달걀": "medium"},
    "일식라멘": {"돼지고기": "high", "밀·글루텐": "high", "달걀": "medium"},
    "치킨": {"닭고기": "high", "밀·글루텐": "medium"},
    "피자": {"밀·글루텐": "high", "우유·유제품": "high", "토마토": "high"},
    "버거": {"밀·글루텐": "high", "소고기": "high", "우유·유제품": "medium", "달걀": "medium", "토마토": "medium"},
    "이탈리아음식": {"밀·글루텐": "high", "우유·유제품": "high", "토마토": "medium"},
    "국수/면/만두": {"밀·글루텐": "high"},
    "분식": {"밀·글루텐": "medium", "달걀": "medium"},
    "떡볶이전문점": {"밀·글루텐": "medium"},
    "김밥전문점": {"달걀": "medium"},
    "족발/보쌈": {"돼지고기": "high"},
    "갈비전문점": {"돼지고기": "medium", "소고기": "medium"},
    # 술집·한식: 가게 이름만으로는 AI가 대부분 '판단 불가'로 답해서 대표 메뉴 기준으로 규칙을 둔다
    "호프": {"밀·글루텐": "high", "닭고기": "medium"},           # 맥주(보리·밀), 튀김·치킨 안주
    "이자카야": {"밀·글루텐": "medium", "대두": "medium", "생선": "medium", "갑각류(새우·게)": "medium"},
    "기타주점": {"갑각류(새우·게)": "medium", "오징어": "medium", "밀·글루텐": "medium"},
    "일반한식": {"대두": "medium"},                              # 장류
    "찜/탕/찌개": {"대두": "medium"},
    "고기구이": {"돼지고기": "medium", "소고기": "medium"},
    "곱창전골/구이": {"소고기": "medium", "돼지고기": "medium"},
    "카페": {"우유·유제품": "medium", "밀·글루텐": "medium", "달걀": "medium", "견과류": "medium"},
}


# 가게 이름에 드러난 종류. 카페·술집은 업종만으로 종류를 알 수 없어서 이름으로 보완한다.
_STYLE_BY_NAME = [
    ("cafe", "디저트·케이크", ("디저트", "케이크", "케익", "마카롱", "빙수", "와플", "타르트", "dessert", "cake")),
    ("cafe", "베이커리", ("베이커리", "빵", "브레드", "베이글", "bakery", "bread")),
    ("cafe", "커피 맛집", ("로스터리", "로스터스", "로스팅", "에스프레소", "커피", "roast", "coffee", "espresso")),
    ("bar", "와인·칵테일 바", ("와인", "칵테일", "위스키", "wine", "cocktail", "whisky")),
    ("bar", "이자카야", ("이자카야", "izakaya", "사케")),
    ("bar", "포차·소주", ("포차", "포장마차", "소주")),
    ("bar", "전통주", ("전통주", "막걸리")),
    ("bar", "호프·맥주", ("호프", "맥주", "비어", "brew", "beer", "pub")),
]

# 가게 이름에 드러난 재료 → 위험 '높음'. 업종 규칙보다 구체적이라 안전 쪽으로 더한다.
_ALLERGY_BY_NAME = [
    ("갑각류(새우·게)", ("새우", "대하", "게장", "꽃게", "킹크랩", "대게", "크랩", "랍스터", "가재", "shrimp", "crab", "lobster")),
    ("조개류", ("조개", "굴", "전복", "홍합", "가리비", "바지락", "꼬막", "oyster")),
    ("생선", ("생선", "횟집", "스시", "초밥", "연어", "참치", "장어", "고등어", "갈치", "복어", "아구", "아귀", "sushi", "salmon")),
    ("오징어", ("오징어", "squid")),
    ("땅콩", ("땅콩", "peanut")),
    ("견과류", ("호두", "아몬드", "피스타치오", "마카다미아", "견과")),
    ("우유·유제품", ("치즈", "크림", "우유", "밀크", "라떼", "젤라또", "cheese", "milk")),
    ("달걀", ("계란", "달걀", "오믈렛", "에그", "egg")),
    ("밀·글루텐", ("우동", "라멘", "라면", "칼국수", "국수", "파스타", "피자", "빵", "베이커리", "만두", "돈가스", "돈까스",
                "튀김", "수제비", "베이글", "pasta", "pizza", "bakery",
                "맥주", "비어", "beer", "brew")),  # 실측: '봉구비어'(기타주점)가 밀 알레르기 모임에 추천됨
    ("대두", ("두부", "콩국수", "청국장", "된장", "tofu")),
    ("메밀", ("메밀", "소바", "막국수")),
    ("복숭아", ("복숭아", "peach")),
    ("토마토", ("토마토", "tomato")),
    ("돼지고기", ("돼지", "삼겹", "족발", "보쌈", "돈가스", "돈까스", "돈코츠", "순대", "pork")),
    ("소고기", ("소고기", "한우", "우대갈비", "스테이크", "곱창", "육회", "beef", "steak")),
    ("닭고기", ("치킨", "닭", "삼계탕", "chicken")),
]


def _name_has(name: str, words) -> bool:
    low = name.lower()
    return any(w in low for w in words)


def rule_estimate(place: dict, allergens: list[str]) -> dict:
    btype = place.get("business_type")
    name = place.get("name") or ""
    category = place.get("category")
    styles = [_STYLE_BY_TYPE[btype]] if btype in _STYLE_BY_TYPE else []
    for cat, style, words in _STYLE_BY_NAME:
        if cat == category and style not in styles and _name_has(name, words):
            styles.append(style)
    risks = dict(_ALLERGY_BY_TYPE.get(btype, {}))
    for allergen, words in _ALLERGY_BY_NAME:
        if _name_has(name, words):
            risks[allergen] = "high"
    price = rule_price(btype, name)
    return {"price_band": price, "atmospheres": rule_atmospheres(btype, name, price), "styles": styles,
            "allergy_risk": {a: risks.get(a, "unknown") for a in allergens}, "source": "rule"}


# 잇플 응답에는 가격이 없어서, AI 추정이 없을 때(첫 화면·AI 한도 초과·상위 12곳 밖) 쓰는 업종별 기본 가격대.
# 1인 기준 1=1만원 이하, 2=1~2만원, 3=2~3만원, 4=3~5만원, 5=5만원 이상. AI 추정이 있으면 AI 값을 쓴다.
_PRICE_BY_TYPE = {}
for _band, _types in {
    1: ["카페", "기타베이커리", "빵/도넛", "아이스크림/요거트/빙수", "김밥전문점", "분식", "떡볶이전문점",
        "도시락/죽", "버거", "샌드위치/토스트"],
    2: ["브런치카페/샐러드", "일반한식", "기타한식", "백반/한정식", "국수/면/만두", "찜/탕/찌개", "전/부침개",
        "중국음식", "기타중식", "마라탕", "일식라멘", "일식돈가스", "기타일식", "아시안", "멕시칸", "기타외국식",
        "치킨", "피자", "비건/채식/사찰", "호프"],
    3: ["고기구이", "갈비전문점", "곱창전골/구이", "족발/보쌈", "양꼬치", "해산물구이/찜", "스시/초밥",
        "이탈리아음식", "서양음식", "한정식", "뷔페", "이자카야", "기타주점", "주점", "바(bar)", "칵테일바"],
    4: ["일식회집", "횟집", "프랑스음식"],
}.items():
    for _t in _types:
        _PRICE_BY_TYPE[_t] = _band
_PRICE_BY_NAME = [(5, ("오마카세", "파인다이닝", "호텔", "omakase")), (4, ("한우", "코스", "와인", "스테이크"))]


# 업종·가격대·이름으로 근거를 댈 수 있는 분위기만 규칙으로 붙인다. '조용한'·'대화하기 좋은'은 AI 추정에 맡긴다.
_ATMOS_BY_TYPE = {
    "활기찬": {"호프", "기타주점", "주점", "고기구이", "곱창전골/구이", "치킨", "양꼬치"},
    "넓은·단체석": {"뷔페", "갈비전문점", "한정식", "백반/한정식"},
}
_ATMOS_BY_NAME = [("활기찬", ("포차", "펍", "pub", "호프")), ("넓은·단체석", ("단체", "연회", "뷔페"))]


def rule_atmospheres(business_type, name: str = "", price: int | None = None) -> list[str]:
    out = [a for a, types in _ATMOS_BY_TYPE.items() if business_type in types]
    out += [a for a, words in _ATMOS_BY_NAME if a not in out and _name_has(name or "", words)]
    if price == 1:
        out.append("가성비")  # 업종 기준 1인 1만원 이하
    return [a for a in out if a in ATMOSPHERES][:3]


def rule_price(business_type, name: str = "") -> int | None:
    band = _PRICE_BY_TYPE.get(business_type)
    for at_least, words in _PRICE_BY_NAME:
        if band is not None and _name_has(name or "", words):
            band = max(band, at_least)
            break
    return band


# ---------------------------------------------------------------- AI
_SYSTEM = """너는 음식점·카페·술집 정보를 추정하는 도우미야. 가게 이름과 업종만 보고 일반적인 경우를 추정해.
반드시 JSON 하나로만 답해: {"places": [{"id": "...", "price_band": 1~5 또는 null, "atmospheres": [...], "styles": [...]}]}
- price_band: 1인 기준 1=1만원 이하, 2=1~2만원, 3=2~3만원, 4=3~5만원, 5=5만원 이상. 모르면 null.
  카페는 음료와 디저트 하나 기준이라 대부분 1이나 2야. 이름에 오마카세·파인다이닝·호텔처럼 비싼 신호가 있을 때만 높게 잡아.
- atmospheres: 아래 목록에서만, 그럴 가능성이 높은 것 최대 3개: %s
- styles: 아래 목록에서만, 해당하는 것: %s
- 모든 가게의 id를 그대로 돌려줘. 설명은 쓰지 마."""


def _models() -> list[str]:
    raw = os.getenv("OPENROUTER_MODEL", "")
    return [m.strip() for m in raw.split(",") if m.strip()] or list(DEFAULT_MODELS)


def _post(api_key: str, model: str, messages: list[dict], timeout: float = 90) -> str:  # 실측: 무료 모델 응답 40~70초
    body = json.dumps({"model": model, "messages": messages, "temperature": 0,
                       "response_format": {"type": "json_object"}}, ensure_ascii=False).encode("utf-8")
    req = request.Request(OPENROUTER_URL, data=body, method="POST", headers={
        "Authorization": f"Bearer {api_key}", "Content-Type": "application/json", "X-Title": "BDAI moim"})
    with request.urlopen(req, timeout=timeout) as resp:
        data = json.loads(resp.read(2_000_000))
    return data["choices"][0]["message"]["content"] or ""


def _parse_json(text: str) -> dict:
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", (text or "").strip())
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        m = re.search(r"\{.*\}", text, re.S)
        if not m:
            raise ValueError("JSON 없음")
        return json.loads(m.group(0))


def _clean_ai(item: dict, place_type: str, allergens: list[str]) -> dict:
    band = item.get("price_band")
    band = band if isinstance(band, int) and not isinstance(band, bool) and band in BUDGETS else None
    atmos = [a for a in item.get("atmospheres") or [] if a in ATMOSPHERES][:3]
    styles = [s for s in item.get("styles") or [] if s in STYLES[place_type]]
    # 이름과 업종만으로는 알레르기 안전성을 확인할 수 없다.
    risk = {a: "unknown" for a in allergens}
    return {"price_band": band, "atmospheres": list(dict.fromkeys(atmos)), "styles": list(dict.fromkeys(styles)),
            "allergy_risk": risk, "source": "ai"}


def ai_estimate(places: list[dict], place_type: str, allergens: list[str], api_key: str) -> dict:
    """AI로 추정. 모델을 순서대로 시도하고 모두 실패하면 RuntimeError(한국어 메시지)."""
    system = _SYSTEM % (", ".join(ATMOSPHERES), ", ".join(STYLES[place_type]))
    # 참여자의 건강 정보는 외부 모델에 보내지 않는다.
    user = json.dumps({"가게": [{"id": p["id"], "이름": p["name"], "업종": p.get("business_type")} for p in places]},
                      ensure_ascii=False)
    messages = [{"role": "system", "content": system}, {"role": "user", "content": user}]
    last = "알 수 없는 오류"
    for model in _models():
        try:
            obj = _parse_json(_post(api_key, model, messages))
        except error.HTTPError as e:
            if e.code in (401, 402):
                raise RuntimeError("OpenRouter 키가 올바르지 않거나 크레딧이 부족해요.") from e
            last = f"HTTP {e.code}"
            continue
        except (error.URLError, TimeoutError, socket.timeout, ValueError, KeyError, IndexError, TypeError) as e:
            last = type(e).__name__
            continue
        items = obj.get("places") if isinstance(obj, dict) else None
        if not isinstance(items, list):
            last = "형식 오류"
            continue
        by_id = {str(i.get("id")): i for i in items if isinstance(i, dict)}
        return {p["id"]: _clean_ai(by_id[p["id"]], place_type, allergens) for p in places if p["id"] in by_id}
    raise RuntimeError(f"AI 추정에 실패했어요 ({last}). 업종 정보만으로 추천했어요.")


def _merge(rule: dict, ai: dict | None) -> dict:
    if not ai:
        return rule
    # 과거 캐시를 포함해 AI의 안전 추정은 사용하지 않는다. 특히 low가 unknown을
    # 덮어써 확인 필요 안내가 사라지는 일이 없도록 한다.
    risk = dict(rule["allergy_risk"])
    styles = list(dict.fromkeys(rule["styles"] + ai["styles"]))  # 업종·이름으로 확실한 것 먼저, AI 추정을 더함
    price = ai["price_band"] if ai.get("price_band") is not None else rule.get("price_band")
    atmos = list(dict.fromkeys(rule["atmospheres"] + ai["atmospheres"]))[:3]  # 근거 있는 규칙 먼저
    return {"price_band": price, "atmospheres": atmos,
            "styles": styles, "allergy_risk": risk, "source": "ai"}


def pending_ai(places: list[dict], allergens: list[str], store=None, ai_limit: int | None = None) -> list[dict]:
    """estimate_places가 AI에 보낼 가게(캐시 없는 앞쪽 ai_limit개)를 미리 알려준다."""
    cached = store.get_estimates([p["id"] for p in places], allergens) if store else {}
    todo = [p for p in places if p["id"] not in cached]
    return todo if ai_limit is None else todo[:max(ai_limit, 0)]


def estimate_places(places: list[dict], place_type: str, allergens: list[str], store=None,
                    api_key: str | None = None, ai_limit: int | None = None) -> tuple[dict, list[str]]:
    """{place_id: 추정} 와 경고 목록을 돌려준다.

    - 저장된 AI 추정(캐시)이 있으면 다시 부르지 않는다.
    - ai_limit: 캐시가 없는 가게 중 앞에서부터 이 수만큼만 AI로 추정한다 (무료 모델 하루 요청 수 절약).
      나머지는 업종·이름 규칙 추정을 쓴다. 호출하는 쪽이 유력한 후보를 앞에 둔다.
    """
    api_key = api_key if api_key is not None else os.getenv("OPENROUTER_API_KEY", "").strip()
    warnings: list[str] = []
    cached = store.get_estimates([p["id"] for p in places], allergens) if store else {}
    todo = [p for p in places if p["id"] not in cached]
    ai_todo = todo if ai_limit is None else todo[:max(ai_limit, 0)]
    ai_results: dict = {}
    if ai_todo and api_key:
        for i in range(0, len(ai_todo), BATCH):
            try:
                ai_results.update(ai_estimate(ai_todo[i:i + BATCH], place_type, allergens, api_key))
            except RuntimeError as e:
                if str(e) not in warnings:
                    warnings.append(str(e))
    elif todo and not api_key:
        warnings.append("OPENROUTER_API_KEY가 없어 가격대·분위기는 추정하지 않고 업종 정보로만 추천했어요.")
    fresh = {p["id"]: _merge(rule_estimate(p, allergens), ai_results.get(p["id"])) for p in todo}
    if store:
        store.save_estimates({k: v for k, v in fresh.items() if v["source"] == "ai"}, allergens)
    # 저장된 추정도 최신 규칙과 다시 합친다 (규칙이 나중에 강화돼도 위험도가 낮게 남지 않게)
    reused = {p["id"]: _merge(rule_estimate(p, allergens), cached[p["id"]]) for p in places if p["id"] in cached}
    return {**reused, **fresh}, warnings
