"""회의(11/19)에서 정한 수정: 방장이 정한 지역·업종, 방장 초기화, 지역 검증, 선택지 정리."""
import json
import threading
import urllib.request as urlreq
from http.server import ThreadingHTTPServer

import pytest

from moim import eatpl, estimate, options
from moim.server import App, make_handler
from moim.store import Store
from moim.wsgi import _api_methods


class CountingClient(eatpl.SampleClient):
    """샘플 데이터 + 검색어 기록 + 원하면 장애."""
    def __init__(self, fail=False):
        super().__init__()
        self.calls, self.fail = [], fail

    def search(self, location, business_type=None):
        self.calls.append(location)
        if self.fail:
            raise eatpl.EatplError("장애")
        return super().search(location, business_type)


@pytest.fixture
def env(tmp_path):
    client = CountingClient()
    srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(App(Store(str(tmp_path / "m.sqlite3")), client)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}", client
    srv.shutdown()


def call(base, path, method="GET", body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urlreq.Request(base + path, data=data, method=method,
                         headers={"Content-Type": "application/json"} if data else {})
    try:
        with urlreq.urlopen(req) as r:
            return r.status, json.loads(r.read())
    except urlreq.HTTPError as e:
        return e.code, json.loads(e.read())


def me(name, **kw):
    return {"name": name, "region": "강남", "place_type": "restaurant", "styles": [], "budget": None,
            "atmospheres": [], "allergies": [], **kw}


def test_host_fixed_region_and_type_win_over_participants(env):
    base, _ = env
    st, room = call(base, "/api/rooms", "POST", {"title": "t", "target_size": 3, "region": "홍대입구역", "place_type": "bar"})
    assert st == 201 and room["region"] == "홍대" and room["place_type"] == "bar" and room["host_token"]
    rid = room["id"]
    # 참여자가 다른 지역·업종을 보내도 방장이 정한 값으로 저장된다 (종류는 그 업종 안에서 고름)
    st, p = call(base, f"/api/rooms/{rid}/participants", "POST", me("가", styles=["포차·소주"]))
    assert st == 201
    st, view = call(base, f"/api/rooms/{rid}")
    assert view["participants"][0]["region"] == "홍대" and view["participants"][0]["place_type"] == "bar"
    assert view["region"] == "홍대" and view["place_type"] == "bar" and "host_token" not in json.dumps(view)
    # 수정해도 마찬가지
    st, _ = call(base, f"/api/rooms/{rid}/participants/{p['id']}", "PUT", {**me("가", place_type="cafe"), "token": p["token"]})
    assert st == 200 and call(base, f"/api/rooms/{rid}")[1]["participants"][0]["place_type"] == "bar"
    # 정원이 찰 때만 추천하며, 방장이 정한 지역·업종으로만 계산한다.
    assert call(base, f"/api/rooms/{rid}/recommend", "POST", {})[0] == 409
    for name in ("나", "다"):
        assert call(base, f"/api/rooms/{rid}/participants", "POST", me(name))[0] == 201
    st, rec = call(base, f"/api/rooms/{rid}/recommend", "POST", {"region": "강남", "place_type": "cafe"})
    assert st == 200 and rec["region"] == "홍대" and rec["place_type"] == "bar"
    assert call(base, f"/api/rooms/{rid}/participants/{p['id']}", "DELETE", {"token": p["token"]})[0] == 200
    assert call(base, f"/api/rooms/{rid}/recommend", "POST", {})[0] == 409


def test_old_room_without_settings_still_works(env):
    base, _ = env
    st, room = call(base, "/api/rooms", "POST", {"title": "t"})
    assert st == 201 and room["region"] is None
    assert call(base, f"/api/rooms/{room['id']}/participants", "POST", me("가"))[0] == 201
    st, rec = call(base, f"/api/rooms/{room['id']}/recommend", "POST", {})
    assert st == 200 and rec["region"] == "강남"


def test_only_host_can_reset_room(env):
    base, _ = env
    _, room = call(base, "/api/rooms", "POST", {"title": "t", "target_size": 2, "region": "강남", "place_type": "cafe"})
    rid = room["id"]
    _, p = call(base, f"/api/rooms/{rid}/participants", "POST", me("가"))
    assert call(base, f"/api/rooms/{rid}", "DELETE", {"host_token": p["token"]})[0] == 403  # 참여자 토큰으로는 안 됨
    assert call(base, f"/api/rooms/{rid}", "DELETE", {})[0] == 403
    assert call(base, f"/api/rooms/{rid}", "DELETE", {"host_token": room["host_token"]}) == (200, {"ok": True})
    st, body = call(base, f"/api/rooms/{rid}")
    assert st == 404 and "찾을 수 없어요" in body["message"]
    assert call(base, f"/api/rooms/{rid}/participants", "POST", me("나"))[0] == 404


@pytest.mark.parametrize("text", ["asdfgh", "강", "!!", "강남🍕", "", "   "])
def test_region_check_rejects_bad_text(env, text):
    base, client = env
    st, body = call(base, "/api/regions/check", "POST", {"region": text})
    assert st == 400 and body["message"] and client.calls == []  # 형식이 틀리면 검색하지 않음


def test_region_check_presets_aliases_and_search(env):
    base, client = env
    assert call(base, "/api/regions/check", "POST", {"region": "홍대입구역"}) == (200, {"ok": True, "region": "홍대"})
    assert call(base, "/api/regions/check", "POST", {"region": " 성수 "})[1]["region"] == "성수"
    assert client.calls == []  # 목록에 있는 지역은 검색 없이 통과
    st, body = call(base, "/api/regions/check", "POST", {"region": "없는동네동"})
    assert st == 400 and "찾지 못했어요" in body["message"]
    call(base, "/api/regions/check", "POST", {"region": "없는동네동"})
    assert client.calls == ["없는동네동"]  # 같은 지역은 한 번만 검색 (저장해 둠)


def test_region_check_does_not_block_when_search_is_down(tmp_path):
    app = App(Store(str(tmp_path / "x.sqlite3")), CountingClient(fail=True))
    out = app.check_region("망원동")
    assert out["ok"] and out["warning"]


def test_room_creation_validates_region_and_type(env):
    base, _ = env
    assert call(base, "/api/rooms", "POST", {"title": "t", "region": "Gangnam"})[0] == 400
    assert call(base, "/api/rooms", "POST", {"title": "t", "place_type": "pub"})[0] == 400


def test_options_after_meeting():
    assert "공부·작업" not in options.STYLES["cafe"]
    assert options.ATMOSPHERES == [
        "조용한", "대화하기 좋은", "아늑·편안", "데이트·느낌있는", "야외좌석·테라스",
        "넓은·단체석", "룸 있음", "가성비", "작업하기 좋은",
    ]
    assert set(options.STYLES["cafe"]) == {"커피 맛집", "디저트-케이크", "베이커리", "아이스크림 빙수", "브런치·샐러드"}
    with pytest.raises(ValueError):
        options.validate_preference(me("가", place_type="cafe", styles=["공부·작업"]))


@pytest.mark.parametrize("btype, name, want", [
    ("호프", "생맥주집", ["활기찬"]), ("분식", "김밥천국", []), ("뷔페", "호텔 뷔페", []),
    ("일반한식", "한식당", []), ("카페", "동네 커피", []),
])
def test_rule_atmospheres_have_a_reason(btype, name, want):
    assert estimate.rule_atmospheres(btype, name) == want


def test_old_ai_cache_does_not_infer_new_atmosphere_preferences():
    rule = {"price_band": 1, "atmospheres": [], "styles": [], "allergy_risk": {}, "source": "rule"}
    merged = estimate._merge(rule, {"price_band": None, "atmospheres": ["조용한", "가성비", "활기찬"], "styles": []})
    assert merged["atmospheres"] == ["활기찬"] and merged["price_band"] == 1


def test_wsgi_allows_new_routes():
    assert _api_methods("/api/regions/check") == ("POST",)
    assert "DELETE" in _api_methods("/api/rooms/abcd1234")


def test_share_image_and_icon_are_served(env):
    base, _ = env
    for path in ("/static/og.png", "/static/icon.png"):
        with urlreq.urlopen(base + path) as r:
            assert r.status == 200 and r.read(8) == b"\x89PNG\r\n\x1a\n"


def test_every_restaurant_and_bar_style_has_a_business_type_or_name_rule():
    # 3/6 카테고리 확인: 잇플 업종 → 우리 종류. 식당은 9종류 모두 업종으로, 술집은 전통주만 이름 규칙으로.
    from moim.eatpl import BAR_TYPES, RESTAURANT_TYPES
    by_type = lambda types: {estimate._STYLE_BY_TYPE[t] for t in types if t in estimate._STYLE_BY_TYPE}
    assert set(options.STYLES["restaurant"]) <= by_type(RESTAURANT_TYPES)
    assert set(options.STYLES["bar"]) - by_type(BAR_TYPES) == {"전통주"}
    assert any(style == "전통주" for _, style, _ in estimate._STYLE_BY_NAME)
    place = {"id": "x", "name": "가게", "business_type": "칵테일바", "category": "bar"}
    assert "와인·칵테일 바" in estimate.rule_estimate(place, [])["styles"]
