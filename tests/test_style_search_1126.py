"""11/26 팀 점검 결과 반영: 고른 종류 0개, 커피·도넛 체인 섞임, 술집 종류 연관성.

실데이터(2026-11-26) 요약: 지역만으로 검색하면 잇플이 매출 상위 100곳만 주고, 그 안에 양식·아시안·이자카야가
거의 없다 (강남 역삼동: 양식 0곳). 업종을 지정해 검색하면 이탈리아음식 20곳, 아시안 30곳, 이자카야 28곳이 나온다.
"""

import pytest

from moim import eatpl
from moim.recommend import recommend, search_region, style_search_types

URL = "https://web.paybooc.ai/mer/web/profile/"
LOC = "서울 강남구 역삼동"


class TypedClient:
    """지역만 검색하면 한식만, 업종을 지정하면 그 업종을 주는 가짜 잇플."""
    source = "kskill"

    ROWS = {
        None: [("역삼 백반", "백반/한정식"), ("역삼 고깃집", "고기구이")],
        "이탈리아음식": [("지아니스 나폴리", "이탈리아음식")],
        "서양음식": [("투썸플레이스 강남", "서양음식"), ("역삼 비스트로", "서양음식")],
        "기타외국식": [("크리스피크림 강남역점", "기타외국식"), ("트로이케밥", "기타외국식")],
        "아시안": [("포냐 베트남쌀국수", "아시안")],
        "주점": [("역삼 맥주집", "호프"), ("강남일미포차", "주점")],
        "이자카야": [("이자카야나무", "이자카야")],
        "기타주점": [("팀홀튼 강남", "기타주점"), ("아리계곡", "기타주점")],
    }

    def __init__(self):
        self.calls = []

    def search(self, location, business_type=None):
        self.calls.append(business_type)
        rows = self.ROWS.get(business_type, []) if location == LOC else []
        return [eatpl.map_place({"merNm": n, "merTpbuzNm": t, "merAddr": f"서울 강남구 테헤란로 {i} (역삼동)",
                                 "merUrl": URL + f"{t}{i}".replace("/", "")})
                for i, (n, t) in enumerate(rows)]


@pytest.fixture(autouse=True)
def no_details_or_ai(monkeypatch):
    monkeypatch.delenv("EATPL_DETAIL_ENABLED", raising=False)
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)


def person(place_type, styles):
    return {"name": "가", "region": "강남", "place_type": place_type, "styles": styles, "budget": None,
            "atmospheres": [], "signals": [], "allergies": []}


def names(out):
    return [p["name"] for p in out["results"]]


def test_picked_style_searches_its_business_types():
    assert style_search_types("restaurant", ["양식"]) == ["서양음식", "이탈리아음식", "프랑스음식", "기타외국식"]
    assert style_search_types("restaurant", []) == []
    assert set(style_search_types("bar", ["전통주"])) == {"기타주점", "주점", "호프"}
    client = TypedClient()
    found = search_region(client, "강남", "restaurant", styles=["양식"])
    assert "이탈리아음식" in client.calls and "지아니스 나폴리" in [p["name"] for p in found]


def test_western_no_longer_empty_in_gangnam():
    out = recommend([person("restaurant", ["양식"])], TypedClient(), region="강남", place_type="restaurant",
                    api_key="")
    assert out["status"] == "ok"
    assert "지아니스 나폴리" in names(out) and "역삼 비스트로" in names(out)
    assert "투썸플레이스 강남" not in names(out)  # 잇플이 커피 체인을 서양음식으로 등록해도 식당 추천에서 뺀다


def test_donut_chain_not_recommended_as_foreign_food():
    out = recommend([person("restaurant", ["기타외국식"])], TypedClient(), region="강남",
                    place_type="restaurant", api_key="")
    assert names(out) == ["트로이케밥"]
    assert eatpl.category_of("기타외국식", "크리스피크림 강남역점") == "cafe"
    assert eatpl.category_of("기타주점", "팀홀튼 강남") == "cafe"


def test_bar_style_filters_and_pocha_needs_name():
    izakaya = recommend([person("bar", ["이자카야"])], TypedClient(), region="강남", place_type="bar", api_key="")
    assert names(izakaya) == ["이자카야나무"]
    pocha = recommend([person("bar", ["포차·소주"])], TypedClient(), region="강남", place_type="bar", api_key="")
    assert names(pocha) == ["강남일미포차"]  # '기타주점'이라고 다 포차로 보지 않는다 (아리계곡 제외)


def test_bar_style_without_match_falls_back_with_notice():
    out = recommend([person("bar", ["전통주"])], TypedClient(), region="강남", place_type="bar", api_key="")
    assert out["status"] == "ok" and out["results"]
    assert any("전통주" in w and "다른 술집" in w for w in out["warnings"])


def test_search_count_stays_small():
    client = TypedClient()
    search_region(client, "강남", "restaurant", styles=["한식", "양식", "일식", "중식", "아시안"])
    assert len(client.calls) <= 1 + 8
    assert "백반/한정식" not in client.calls and "이탈리아음식" in style_search_types("restaurant", ["한식", "양식"])
