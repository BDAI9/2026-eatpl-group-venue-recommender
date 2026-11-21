"""참여자가 고를 수 있는 선택지. 화면과 서버 검증, AI 프롬프트가 모두 이 목록을 쓴다."""

from __future__ import annotations

import re
from unicodedata import normalize

REGIONS = ["홍대", "합정", "연남", "성수", "건대", "강남", "신촌", "이태원", "종로", "을지로", "잠실", "여의도"]

# 시작 화면과 사용자가 흔히 쓰는 역·동 이름을 검색 가능한 지역으로 맞춘다.
# 명시한 별칭만 바꾸고 다른 직접 입력은 보존한다.
REGION_ALIASES = {
    "홍대입구": "홍대", "홍대입구역": "홍대",
    "강남역": "강남", "성수역": "성수",
    "종로·광화문": "종로", "광화문": "종로", "광화문역": "종로",
}


_HANGUL = re.compile(r"[가-힣]")
_REGION_CHARS = re.compile(r"[가-힣0-9·\s]+")


def check_region_text(value: object) -> str:
    """지역 입력의 형식만 검사하고 정리한다. 실제로 가게가 있는지는 서버가 검색으로 확인한다."""
    if not isinstance(value, str) or not value.strip():
        raise ValueError("지역이나 역 이름을 입력해 주세요.")
    clean = " ".join(normalize("NFC", value).split())
    if len(clean) > MAX_CUSTOM:
        raise ValueError(f"지역은 {MAX_CUSTOM}자 이내로 입력해 주세요.")
    if not _REGION_CHARS.fullmatch(clean) or len(_HANGUL.findall(clean)) < 2:
        raise ValueError("지역은 한글로 입력해 주세요. 예: 강남, 성수동, 홍대입구역")
    return normalize_region(clean)


def normalize_region(value: str) -> str:
    clean = value.strip()
    compact = clean.replace(" ", "")
    return REGION_ALIASES.get(compact, compact if compact in REGIONS else clean)


_ROMAN_REGIONS = dict(zip(
    ("hongdae", "hapjeong", "yeonnam", "seongsu", "kondae", "gangnam",
     "sinchon", "itaewon", "jongno", "euljiro", "jamsil", "yeouido"),
    REGIONS,
))
_KEYBOARD_JAMO = str.maketrans(
    "qwertyuiopasdfghjklzxcvbnmQWERTYUIOPASDFGHJKLZXCVBNM",
    "ㅂㅈㄷㄱㅅㅛㅕㅑㅐㅔㅁㄴㅇㄹㅎㅗㅓㅏㅣㅋㅌㅊㅍㅠㅜㅡ"
    "ㅃㅉㄸㄲㅆㅛㅕㅑㅒㅖㅁㄴㅇㄹㅎㅗㅓㅏㅣㅋㅌㅊㅍㅠㅜㅡ",
)
_ONSETS = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
_VOWELS = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
_FINALS = " ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ"
_VOWEL_PAIRS = {"ㅗㅏ": "ㅘ", "ㅗㅐ": "ㅙ", "ㅗㅣ": "ㅚ", "ㅜㅓ": "ㅝ",
                "ㅜㅔ": "ㅞ", "ㅜㅣ": "ㅟ", "ㅡㅣ": "ㅢ"}
_FINAL_PAIRS = {"ㄱㅅ": "ㄳ", "ㄴㅈ": "ㄵ", "ㄴㅎ": "ㄶ", "ㄹㄱ": "ㄺ", "ㄹㅁ": "ㄻ",
                "ㄹㅂ": "ㄼ", "ㄹㅅ": "ㄽ", "ㄹㅌ": "ㄾ", "ㄹㅍ": "ㄿ", "ㄹㅎ": "ㅀ", "ㅂㅅ": "ㅄ"}
_COMPAT_JAMO = str.maketrans(
    "ᄀᄂᄃᄅᄆᄇᄉᄋᄌᄎᄏᄐᄑᄒᆨᆫᆮᆯᆷᆸᆺᆼᆽᆾᆿᇀᇁᇂᅡᅢᅣᅤᅥᅦᅧᅨᅩᅪᅫᅬᅭᅮᅯᅰᅱᅲᅳᅴᅵ",
    "ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ",
)


def _jamo(value: str) -> str:
    return normalize("NFD", value).translate(_COMPAT_JAMO)


def _compose_keyboard(jamo: str) -> str:
    """Compose two-set keyboard jamo, carrying a consonant into the next syllable when needed."""
    result = []
    i = 0
    while i < len(jamo):
        onset = jamo[i]
        if onset not in _ONSETS or i + 1 >= len(jamo) or jamo[i + 1] not in _VOWELS:
            result.append(onset)
            i += 1
            continue

        vowel = jamo[i + 1]
        i += 2
        pair = _VOWEL_PAIRS.get(vowel + jamo[i:i + 1])
        if pair:
            vowel = pair
            i += 1

        final = " "
        if i < len(jamo) and jamo[i] in _FINALS and not (
            i + 1 < len(jamo) and jamo[i + 1] in _VOWELS
        ):
            final = jamo[i]
            i += 1
            pair = _FINAL_PAIRS.get(final + jamo[i:i + 1])
            if pair and not (i + 1 < len(jamo) and jamo[i + 1] in _VOWELS):
                final = pair
                i += 1

        code = (_ONSETS.index(onset) * 21 + _VOWELS.index(vowel)) * 28 + _FINALS.index(final)
        result.append(chr(0xAC00 + code))
    return "".join(result)


def region_suggestions(value: object, *, allow_korean_typos: bool = True) -> list[str]:
    if not isinstance(value, str) or not 2 <= len(value.strip()) <= MAX_CUSTOM:
        return []
    compact = re.sub(r"[\s.,!·_-]", "", value)
    if compact.lower() in _ROMAN_REGIONS:
        return [_ROMAN_REGIONS[compact.lower()]]
    if re.fullmatch(r"[A-Za-z]+", compact):
        typed = compact.translate(_KEYBOARD_JAMO)
        exact = _compose_keyboard(typed)
        if re.fullmatch(r"[가-힣]{2,}", exact):
            return [exact]
    elif allow_korean_typos and re.fullmatch(r"[가-힣ㄱ-ㅎㅏ-ㅣ]+", compact):
        typed = _jamo(compact)
    else:
        return []
    candidates = {**{r: r for r in REGIONS}, **REGION_ALIASES}
    matches = []
    for alias, region in candidates.items():
        expected = _jamo(alias)
        if typed == expected:
            return [region]
        if len(expected) >= 4 and (
            len(typed) == len(expected) and sum(a != b for a, b in zip(typed, expected)) == 1
            or len(typed) == len(expected) + 1 and any(
                typed[:i] + typed[i + 1:] == expected for i in range(len(typed))
            )
            or typed.startswith(expected) and typed[len(expected):] == expected[-1] * 2
        ):
            matches.append(region)
    return list(dict.fromkeys(matches))[:5]


# 잇플 검색은 '주소 글자'로 찾는다. 주소에는 '홍대'·'건대'·'신촌'이 거의 없어서 실제 주소 표기로 바꿔 검색한다.
# 2026-11-17 실데이터 확인: '홍대'는 카페 0곳, '신촌'은 절반이 서울 밖, '건대'는 23곳 → 아래 주소는 모두 서울 100%.
REGION_QUERIES = {
    "홍대": ["서울 마포구 서교동", "서울 마포구 동교동"],
    "합정": ["서울 마포구 합정동"],
    "연남": ["서울 마포구 연남동"],
    "성수": ["서울 성동구 성수동"],
    "건대": ["서울 광진구 화양동"],
    "강남": ["서울 강남구 역삼동"],
    "신촌": ["서울 서대문구 창천동"],
    "이태원": ["서울 용산구 이태원동"],
    "종로": ["서울 종로구"],
    "을지로": ["서울 중구 을지로"],
    "잠실": ["서울 송파구 잠실동"],
    "여의도": ["서울 영등포구 여의도동"],
}
REGION_QUERIES["성수동"] = REGION_QUERIES["성수"]

PLACE_TYPES = {"cafe": "카페", "restaurant": "식당", "bar": "술집"}

DESSERT_STYLE = "디저트-케이크"
ICE_CREAM_STYLE = "아이스크림 빙수"
BRUNCH_STYLE = "브런치·샐러드"
VEGETARIAN_STYLE = "채식"

STYLES = {
    "cafe": ["커피 맛집", DESSERT_STYLE, "베이커리", ICE_CREAM_STYLE, BRUNCH_STYLE],
    "restaurant": ["한식", "중식", "일식", "양식", "아시안", "기타외국식", "고기-구이", "분식", "치킨버거피자"],
    "bar": ["호프·맥주", "이자카야", "와인·칵테일 바", "포차·소주", "전통주"],
}
STYLE_PREFERENCES = {"restaurant": [VEGETARIAN_STYLE]}
_STYLE_ALIASES = {
    "cafe": {"디저트·케이크": DESSERT_STYLE, "케이크 메뉴 있음": DESSERT_STYLE},
    "restaurant": {"고기·구이": "고기-구이", "치킨·버거·피자": "치킨버거피자"},
}

def allowed_styles(place_type: str) -> list[str]:
    return STYLES[place_type] + STYLE_PREFERENCES.get(place_type, [])

def canonical_styles(place_type: str, styles: list[str]) -> list[str]:
    aliases = _STYLE_ALIASES.get(place_type, {})
    allowed = allowed_styles(place_type)
    return list(dict.fromkeys(tag for value in styles if (tag := aliases.get(value, value)) in allowed))

STYLE_LABEL = {"cafe": "카페 스타일", "restaurant": "먹고 싶은 음식", "bar": "술집 종류"}

# 1인 예산 구간. 값이 클수록 비싸다.
BUDGETS = {1: "1만원 이하", 2: "1~2만원", 3: "2~3만원", 4: "3~5만원", 5: "5만원 이상"}

GROUP_SEATING = "넓은·단체석"
OUTDOOR_SEATING = "야외좌석·테라스"
PRIVATE_ROOM = "룸 있음"
DATE_ATMOSPHERE = "데이트·느낌있는"
CAFE_WORK_ATMOSPHERE = "작업하기 좋은"
ATMOSPHERE_LIMIT = 3
LEGACY_ATMOSPHERE = "활기찬"
ATMOSPHERES = [
    "조용한", "대화하기 좋은", "아늑·편안", DATE_ATMOSPHERE, OUTDOOR_SEATING,
    GROUP_SEATING, PRIVATE_ROOM, "가성비", CAFE_WORK_ATMOSPHERE,
]
_ATMOSPHERE_ALIASES = {
    "넓은 단체석": GROUP_SEATING, "단체석": GROUP_SEATING, "야외 좌석": OUTDOOR_SEATING,
    "분위기 있는 (인테리어 좋은)": DATE_ATMOSPHERE,
}
_ACCEPTED_ATMOSPHERES = [*ATMOSPHERES, LEGACY_ATMOSPHERE]


def canonical_atmospheres(values: list[str], place_type: str | None = None) -> list[str]:
    return list(dict.fromkeys(
        tag for value in values
        if (tag := _ATMOSPHERE_ALIASES.get(value, value)) in _ACCEPTED_ATMOSPHERES
        and (tag != CAFE_WORK_ATMOSPHERE or place_type in (None, "cafe"))
    ))

# 최근 결제 데이터의 방문 특성에 대해 우선순위를 부여하는 선택 항목.
# 확정적인 서비스 제공 여부나 안전 조건이 아닌 선호로만 사용한다.
SIGNALS = {"동네 맛집": "local_customer", "외국인 맛집": "foreign_customer",
           "직장인 맛집": "group_customer"}
_SIGNAL_ALIASES = {
    "동네 주민 방문": "동네 맛집", "외국인 방문": "외국인 맛집", "직장인 방문": "직장인 맛집",
}


def canonical_signals(values: list[str]) -> list[str]:
    return list(dict.fromkeys(tag for value in values if (tag := _SIGNAL_ALIASES.get(value, value)) in SIGNALS))

ALLERGIES = ["갑각류(새우·게)", "조개류", "생선", "오징어", "땅콩", "견과류", "우유·유제품", "달걀",
             "밀·글루텐", "대두", "메밀", "복숭아", "토마토", "돼지고기", "소고기", "닭고기"]

MAX_NAME = 20
MAX_CUSTOM = 40
MAX_PARTICIPANTS = 30


def catalog() -> dict:
    """화면에 내려줄 전체 선택지."""
    return {
        "regions": REGIONS,
        "place_types": PLACE_TYPES,
        "styles": STYLES,
        "style_preferences": STYLE_PREFERENCES,
        "style_label": STYLE_LABEL,
        "budgets": {str(k): v for k, v in BUDGETS.items()},
        "atmospheres": ATMOSPHERES,
        "atmosphere_limit": ATMOSPHERE_LIMIT,
        "cafe_work_atmosphere": CAFE_WORK_ATMOSPHERE,
        "legacy_atmosphere": LEGACY_ATMOSPHERE,
        "signals": list(SIGNALS),
        "signal_fields": SIGNALS,
        "allergies": ALLERGIES,
    }


def _text(value, field, max_len, required=True):
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > max_len:
        raise ValueError(f"{field}: {max_len}자 이내로 입력해 주세요.")
    return value.strip()


def _pick_many(value, allowed, field, limit=None):
    if value is None:
        return []
    if not isinstance(value, list) or any(v not in allowed for v in value):
        raise ValueError(f"{field}: 목록에 있는 값만 고를 수 있어요.")
    out = list(dict.fromkeys(value))
    if limit and len(out) > limit:
        raise ValueError(f"{field}: 최대 {limit}개까지 고를 수 있어요.")
    return out


def validate_preference(payload: object) -> dict:
    """참여자 한 명의 입력을 검사하고 정리한다."""
    if not isinstance(payload, dict):
        raise ValueError("입력 형식이 올바르지 않아요.")
    allowed = {"name", "region", "place_type", "styles", "budget", "atmospheres", "signals", "allergies", "allergy_other"}
    if set(payload) - allowed:
        raise ValueError("알 수 없는 입력 항목이 있어요.")

    name = _text(payload.get("name"), "이름", MAX_NAME)
    region = normalize_region(_text(payload.get("region"), "지역", MAX_CUSTOM))
    place_type = payload.get("place_type")
    if place_type not in PLACE_TYPES:
        raise ValueError("카페·식당·술집 중 하나를 골라 주세요.")
    styles = _pick_many(payload.get("styles"), [*allowed_styles(place_type), *_STYLE_ALIASES.get(place_type, {})],
                       STYLE_LABEL[place_type])
    styles = canonical_styles(place_type, styles)
    budget = payload.get("budget")
    if budget is not None and (isinstance(budget, bool) or budget not in BUDGETS):
        raise ValueError("예산 구간을 다시 골라 주세요.")
    atmospheres = canonical_atmospheres(_pick_many(
        payload.get("atmospheres"), [*_ACCEPTED_ATMOSPHERES, *_ATMOSPHERE_ALIASES], "분위기"))
    if len(atmospheres) > ATMOSPHERE_LIMIT:
        raise ValueError(f"분위기: 최대 {ATMOSPHERE_LIMIT}개까지 고를 수 있어요.")
    if place_type != "cafe" and CAFE_WORK_ATMOSPHERE in atmospheres:
        raise ValueError("‘작업하기 좋은’ 옵션은 카페에서만 선택할 수 있어요.")
    signals = canonical_signals(_pick_many(payload.get("signals"), [*SIGNALS, *_SIGNAL_ALIASES], "맛집 유형"))
    allergies = _pick_many(payload.get("allergies"), ALLERGIES, "알레르기")
    other = payload.get("allergy_other")
    if other is not None and other != "":
        other = _text(other, "기타 알레르기", MAX_CUSTOM)
    else:
        other = None

    return {"name": name, "region": region, "place_type": place_type, "styles": styles, "budget": budget,
            "atmospheres": atmospheres, "signals": signals, "allergies": allergies, "allergy_other": other}
