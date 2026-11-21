import pytest

from moim import details, eatpl, estimate, options, recommend, server
from moim.regions import address_candidates, matches_selected_area


@pytest.mark.parametrize("value", ["hongdae", "ghdeo", "ghdeoo", "홍 댑 .", "ㅎ ㅗ ㅇㄷ ㅐ", "홍대ㅐㅐ"])
def test_region_input_suggests_hongdae(value):
    assert options.region_suggestions(value) == ["홍대"]
    assert options.check_region_text("홍 대") == "홍대"


@pytest.mark.parametrize(("keys", "korean"), [
    ("tkdtn", "상수"), ("tjdtn", "성수"), ("tjdtnehd", "성수동"),
    ("dusgmlehd", "연희동"), ("gkqwjddur", "합정역"),
])
def test_keyboard_composes_exact_region_before_fuzzy_suggestions(keys, korean):
    assert options.region_suggestions(keys) == [korean]


def test_keyboard_choice_and_korean_input_resolve_the_same_region(monkeypatch):
    monkeypatch.delenv("KAKAO_REST_API_KEY", raising=False)
    monkeypatch.setattr(server, "_REGION_CACHE", {})

    class Client:
        source = "kskill"

        def search(self, query):
            if query == "상수동":
                return [{"address": "서울 마포구 독막로20길 14 (상수동)"}]
            if query == "연희동":
                return [{"address": "서울 서대문구 연희로 72 (연희동)"},
                        {"address": "인천 서구 서곶로 112 (연희동)"}]
            return []

    app = server.App(None, Client())
    for keys, korean in [("tkdtn", "상수"), ("tjdtn", "성수"), ("tjdtnehd", "성수동"), ("dusgmlehd", "연희동")]:
        assert app.check_region(keys)["candidates"] == [korean]
    assert app.check_region("상수")["region"] == "서울특별시 마포구 상수동"
    assert app.check_region("성수")["region"] == "성수"
    assert app.check_region("성수동")["region"] == "성수동"
    assert app.check_region("연희동")["candidates"] == [
        "서울특별시 서대문구 연희동", "인천광역시 서구 연희동",
    ]


def test_missing_literal_hangul_does_not_switch_to_a_different_region(monkeypatch):
    monkeypatch.setattr(server, "find_stations", lambda _: ())
    monkeypatch.delenv("KAKAO_REST_API_KEY", raising=False)
    monkeypatch.setattr(server, "_REGION_CACHE", {})

    class Client:
        source = "kskill"

        def search(self, query):
            return []

    with pytest.raises(ValueError, match="'상수'에서 가게를 찾지 못했어요"):
        server.App(None, Client()).check_region("상수")


def test_ambiguous_region_uses_distinct_qualified_addresses(monkeypatch):
    monkeypatch.delenv("KAKAO_REST_API_KEY", raising=False)
    assert address_candidates("합정동", [
        {"address": "서울 마포구 독막로 88 (합정동)"},
        {"address": "경기 평택시 합정동 812"},
        {"address": "경기 평택시 합정동 813"},
    ]) == ["경기도 평택시 합정동", "서울특별시 마포구 합정동"]
    assert address_candidates("광주", []) == ["광주광역시", "경기도 광주시"]
    assert matches_selected_area("광주광역시", "광주 북구 우치로 12")
    assert not matches_selected_area("광주광역시", "경기 광주시 경안로 12")


def test_shindang_looks_up_the_same_neighborhood_and_deduplicates_addresses(monkeypatch):
    monkeypatch.delenv("KAKAO_REST_API_KEY", raising=False)
    monkeypatch.setattr(server, "_REGION_CACHE", {})
    areas = {
        "신당동": [
            {"address": "대구 달서구 계대동문로 1 (신당동)"},
            {"address": "대구광역시 달서구 달서대로 713 (신당동)"},
            {"address": "서울 중구 퇴계로 406 (신당동)"},
            {"address": "충남 천안시 서북구 천안대로 1331 (신당동)"},
            {"address": "경북 구미시 산동면 신당로"},
        ],
        "신당": [{"address": "경북 구미시 산동면 신당로"}],
        "대구 달서구 신당동": [{"address": "대구 달서구 계대동문로 1 (신당동)"}],
    }

    class Client:
        source = "kskill"

        def search(self, query):
            return areas.get(query, [])

    app = server.App(None, Client())
    wanted = {
        "대구광역시 달서구 신당동",
        "서울특별시 중구 신당동",
        "충청남도 천안시 서북구 신당동",
    }
    for region in ("신당", "신당동"):
        status, result = app.handle("POST", "/api/regions/check", {"region": region})
        assert status == 200 and result["ok"] is False
        assert set(result["candidates"]) == wanted
        assert len(result["candidates"]) == len(wanted)

    assert app.check_region("대구광역시 달서구 신당동") == {
        "ok": True, "region": "대구광역시 달서구 신당동",
    }
    assert matches_selected_area("대구광역시 달서구 신당동", "대구 달서구 계대동문로 1 (신당동)")
    assert not matches_selected_area("대구광역시 달서구 신당동", "서울 중구 퇴계로 406 (신당동)")


def test_address_and_kakao_aliases_merge_to_one_name(monkeypatch):
    monkeypatch.setenv("KAKAO_REST_API_KEY", "test-key")
    monkeypatch.setattr("moim.regions._map_address_matches",
                        lambda query, key: {"대구광역시 달서구 신당동"})
    assert address_candidates("신당동", [
        {"address": "대구 달서구 계대동문로 1 (신당동)"},
        {"address": "대구광역시 달서구 달서대로 713 (신당동)"},
    ]) == ["대구광역시 달서구 신당동"]


def test_profile_html_limits_evidence_to_visible_sections():
    html = """
    <p class="name">광고 케이크</p>
    <div class="ple-menu-wrap">
      <p class="tit">메뉴</p>
      <div class="item"><p class="name">아메리카노</p><p class="price">4,700원</p></div>
      <div class="item"><p class="name"><b>바스크</b> 치즈케이크</p><p class="price">8,800원</p></div>
      <div class="item"><p class="name">팬케이크</p><p class="price">6,000원</p></div>
    </div>
    <div class="ai-ple-info"><ul><li>대화하기 좋아요</li></ul></div>
    <div class="service-wrap"><ul><li>단체석 있음</li><li>야외 좌석 없음</li></ul></div>
    """
    profile = details.parse_profile(html)
    assert details.cake_items(profile) == ["바스크 치즈케이크"]
    assert details.cafe_price(profile, details.cake_items(profile)) == {
        "band": 2, "amount": 13500, "items": ["아메리카노", "바스크 치즈케이크"]
    }
    assert details.atmosphere_evidence(profile) == {
        "넓은·단체석": {"source": "services", "text": "단체석 있음"},
        "대화하기 좋은": {"source": "review", "text": "대화하기 좋아요"},
    }
    assert profile["review"] == ["대화하기 좋아요"]


def test_profile_recommendation_does_not_guess_cake_or_facilities(monkeypatch):
    monkeypatch.setenv("EATPL_DETAIL_ENABLED", "1")
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)
    places = [
        {"id": "unverified", "name": "케이크 카페", "category": "cafe", "business_type": "카페", "sales_rank": 1},
        {"id": "verified", "name": "조각 카페", "category": "cafe", "business_type": "카페", "sales_rank": 10},
    ]
    monkeypatch.setattr(recommend, "search_region", lambda *args, **kwargs: places)
    monkeypatch.setattr(details, "profiles", lambda *args, **kwargs: (
        {"verified": {"menu": [{"name": "치즈케이크", "price": "8,800원"}], "services": ["야외 좌석"]}}, False
    ))
    from types import SimpleNamespace
    out = recommend.recommend(
        [{"name": "나", "region": "성수", "place_type": "cafe", "styles": ["케이크 메뉴 있음"],
          "budget": None, "atmospheres": ["야외 좌석"], "allergies": []}],
        SimpleNamespace(source="kskill")
    )
    verified, unverified = out["results"]
    assert verified["id"] == "verified" and verified["score"] == 4
    assert verified["estimate"]["dessert_items"] == ["치즈케이크"]
    assert verified["estimate"]["styles"] == [options.DESSERT_STYLE]
    assert unverified["score"] == 0


def test_openrouter_rejects_unquoted_claims_and_paid_models(monkeypatch):
    monkeypatch.setenv("OPENROUTER_MODEL", "provider/model,provider/free:free")
    assert estimate._models() == ["provider/free:free"]
    item = {
        "atmosphere_evidence": {"조용한": "조용해요", "야외 좌석": "조용해요", "활기찬": "활기차요"},
        "style_evidence": {"커피 맛집": "모르는 메뉴"},
        "cake_item": "없는 메뉴",
        "category": "bar",
        "category_evidence": "없는 문구",
    }
    profile = {"menu": [{"name": "아메리카노"}], "review": ["조용해요"]}
    result = estimate._grounded_ai(item, {"detail": profile}, "cafe", [])
    assert result["atmospheres"] == []
    assert result["styles"] == [] and result["cake_item"] is None
    assert result["verified_category"] is None


def test_atmosphere_rules_check_evidence_and_group_size():
    profile = {
        "services": ["룸은 6인부터 예약 가능", "테라스 이용 불가"],
        "review": [
            "저녁에는 매장이 조용하고 한적해요.",
            "친구와 대화 나누기 좋은 공간이에요.",
            "8명이 한 테이블에 앉을 수 있어요.",
            "가격 대비 양이 푸짐해요.",
            "테라스에서 앉아 식사했어요.",
            "프라이빗한 룸이 있어요.",
            "빈티지 소품이 인상적이에요.",
            "편안하게 머물 수 있는 공간이에요.",
            "좌석마다 콘센트가 있어요.",
        ],
    }
    evidence = details.atmosphere_evidence(profile, 8)
    assert set(evidence) == set(options.ATMOSPHERES) - {options.OUTDOOR_SEATING}
    assert evidence[options.PRIVATE_ROOM] == {"source": "services", "text": "룸은 6인부터 예약 가능"}
    assert evidence["조용한"]["text"].startswith("저녁에는")
    assert options.PRIVATE_ROOM not in details.atmosphere_evidence(profile, 4)
    assert details.atmosphere_evidence({"review": ["야외 테이블에서 식사했어요."]}) == {
        options.OUTDOOR_SEATING: {"source": "review", "text": "야외 테이블에서 식사했어요."},
    }
    assert details.atmosphere_evidence({"review": [
        "주차 공간이 넓고 주차가 편해요.", "테라스가 보이는 창가예요.", "무료 와이파이가 있어요.",
        "가격이 저렴해요.", "가성비가 좋지 않아요.", "대화하기 힘들어요.", "프라이빗한 분위기예요.",
    ]}) == {}


def test_atmosphere_review_beyond_original_limit_changes_recommendation(monkeypatch):
    from types import SimpleNamespace

    monkeypatch.setenv("EATPL_DETAIL_ENABLED", "1")
    places = [
        {"id": str(i), "name": f"카페 {i}", "category": "cafe", "business_type": "카페", "sales_rank": i}
        for i in range(35)
    ]
    quote = "조용한 분위기라 대화 나누기 좋아요."
    monkeypatch.setattr(recommend, "search_region", lambda *args, **kwargs: places)

    def profiles(candidates, *, background):
        assert len(candidates) == 30
        return {p["id"]: {"review": [quote]} for p in candidates if p["id"] == "25"}, False

    monkeypatch.setattr(details, "profiles", profiles)
    pref = options.validate_preference({
        "name": "나", "region": "홍대", "place_type": "cafe", "atmospheres": ["대화하기 좋은"],
    })
    out = recommend.recommend([pref], SimpleNamespace(source="kskill"), api_key="")
    assert out["results"][0]["id"] == "25"
    assert quote in out["results"][0]["reasons"][0]
    assert len(out["results"]) == recommend.TOP_N


def test_legacy_atmospheres_keep_saved_preferences():
    old = ["넓은 단체석", "단체석", "야외 좌석", "활기찬"]
    pref = options.validate_preference({
        "name": "나", "region": "홍대", "place_type": "restaurant", "atmospheres": old,
    })
    assert pref["atmospheres"] == [options.GROUP_SEATING, options.OUTDOOR_SEATING, "활기찬"]
    public = server._public({"id": "room", "title": "모임", "target_size": None,
                             "participants": [{**pref, "atmospheres": old}]})
    assert public["participants"][0]["atmospheres"] == pref["atmospheres"]
    assert public["summary"]["atmospheres"] == dict.fromkeys(pref["atmospheres"], 1)


def test_atmosphere_rename_and_cafe_only_work_preference():
    legacy_date = "분위기 있는 (인테리어 좋은)"
    preference = {"name": "나", "region": "홍대", "place_type": "cafe",
                  "atmospheres": [legacy_date, options.DATE_ATMOSPHERE, options.CAFE_WORK_ATMOSPHERE]}
    validated = options.validate_preference(preference)
    assert validated["atmospheres"] == [options.DATE_ATMOSPHERE, options.CAFE_WORK_ATMOSPHERE]
    with pytest.raises(ValueError, match="카페에서만"):
        options.validate_preference({**preference, "place_type": "restaurant"})
    old_restaurant = {**validated, "place_type": "restaurant"}
    assert recommend.summarize([old_restaurant])["atmospheres"] == {options.DATE_ATMOSPHERE: 1}

    profile = {"review": ["빈티지 소품이 있고 좌석마다 콘센트가 있어요."]}
    assert set(details.atmosphere_evidence(profile, place_type="cafe")) == {
        options.DATE_ATMOSPHERE, options.CAFE_WORK_ATMOSPHERE,
    }
    assert set(details.atmosphere_evidence(profile, place_type="bar")) == {options.DATE_ATMOSPHERE}


@pytest.mark.parametrize(("business_type", "expected"), [
    ("서양음식", ["양식"]),
    ("이탈리아음식", ["양식"]),
    ("프랑스음식", ["양식"]),
    ("멕시칸", ["기타외국식"]),
    ("기타외국식", ["기타외국식"]),
    ("아시안", ["아시안"]),
    ("샌드위치/토스트", []),
    ("비건/채식/사찰", ["채식"]),
])
def test_restaurant_types_use_exact_eatpl_mapping_even_with_ai(monkeypatch, business_type, expected):
    place = {"id": "x", "name": "매장", "category": "restaurant", "business_type": business_type}
    ai = {"styles": ["양식", "아시안", "기타외국식"], "price_band": None, "atmospheres": []}
    monkeypatch.setattr(estimate, "ai_estimate", lambda *args: {"x": ai})
    estimates, _ = estimate.estimate_places([place], "restaurant", [], api_key="test")
    assert estimates["x"]["styles"] == expected


def test_requested_restaurant_kind_filters_results_and_vegetarian_is_optional(monkeypatch):
    from types import SimpleNamespace

    monkeypatch.delenv("EATPL_DETAIL_ENABLED", raising=False)
    places = [
        {"id": str(i), "name": name, "category": "restaurant", "business_type": btype, "sales_rank": i}
        for i, (name, btype) in enumerate([
            ("타코", "멕시칸"), ("샌드위치", "샌드위치/토스트"), ("아시안", "아시안"),
            ("파스타", "이탈리아음식"), ("기타", "기타외국식"), ("사찰", "비건/채식/사찰"),
        ])
    ]
    monkeypatch.setattr(recommend, "search_region", lambda *args, **kwargs: places)
    client = SimpleNamespace(source="kskill")
    prefs = {"name": "나", "region": "성수", "place_type": "restaurant", "budget": None,
             "atmospheres": [], "allergies": []}
    for styles, expected in [
        (["아시안", "채식"], ["아시안"]), (["양식"], ["파스타"]), (["기타외국식"], ["타코", "기타"]),
        (["양식", "기타외국식"], ["타코", "파스타", "기타"]),
    ]:
        out = recommend.recommend([{**prefs, "styles": styles}], client, api_key="")
        assert [item["name"] for item in out["results"]] == expected
    out = recommend.recommend([{**prefs, "styles": ["채식"]}], client, api_key="")
    assert len(out["results"]) == len(places)
    assert out["results"][0]["name"] == "사찰" and out["results"][0]["score"] == 1


def test_frozen_dessert_requires_eatpl_subtype_and_does_not_count_as_a_cake():
    shop = {"id": "ice", "name": "디저트 빙수", "category": "cafe", "business_type": "아이스크림/요거트/빙수"}
    assert estimate.rule_estimate(shop, [])["styles"] == [options.ICE_CREAM_STYLE]
    menu = [{"name": "빙수"}, {"name": "아이스크림"}, {"name": "스콘"}]
    assert details.dessert_items({"menu": menu}) == ["스콘"]
    claims = {"style_evidence": {options.ICE_CREAM_STYLE: "빙수"}}
    assert estimate._grounded_ai(claims, {"detail": {"menu": menu}}, "cafe", [])["styles"] == []


def test_old_cake_votes_are_merged_into_one_dessert_selection():
    assert options.canonical_styles("cafe", ["케이크 메뉴 있음", "디저트·케이크"]) == [options.DESSERT_STYLE]


def test_brunch_selection_requires_the_eatpl_subtype(monkeypatch):
    brunch_style = options.BRUNCH_STYLE
    brunch_type = eatpl.BRUNCH_BUSINESS_TYPE
    assert eatpl.category_of(brunch_type, "브런치 펍") == "cafe"
    monkeypatch.setattr(estimate, "ai_estimate", lambda places, *args: {
        p["id"]: {"styles": [brunch_style], "price_band": None, "atmospheres": []}
        for p in places
    })
    preference = options.validate_preference({
        "name": "나", "region": "홍대", "place_type": "cafe", "styles": [brunch_style],
    })
    client = eatpl.SampleClient()
    results = recommend.recommend([preference], client, api_key="test")["results"]
    assert [p["business_type"] for p in results] == [brunch_type]
    assert brunch_style in results[0]["estimate"]["styles"]
    any_results = recommend.recommend([{**preference, "styles": []}], client, api_key="")["results"]
    assert {p["business_type"] for p in any_results} == {brunch_type, "카페"}
    multiple = [{**preference, "styles": [brunch_style, "커피 맛집"]}]
    mixed_results = recommend.recommend(multiple, client, api_key="")["results"]
    assert {p["name"] for p in mixed_results} == {"홍대 브런치 카페 (가상)", "홍대 로스터리 카페 (가상)"}
