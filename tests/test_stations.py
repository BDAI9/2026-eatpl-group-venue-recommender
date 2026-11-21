from types import SimpleNamespace

import pytest

from moim import recommend, server, stations
from moim.eatpl import map_place
from moim.store import Store


@pytest.fixture
def map_proxy(monkeypatch):
    stations._station_rows.cache_clear()
    stations.candidate_areas.cache_clear()
    queries = []

    def kakao(route, **params):
        queries.append((route, params))
        if route == "coord2region":
            return [{"region_type": "B", "address_name": "서울특별시 중구 태평로2가"}]
        if params["q"] != "시청역":
            return []
        return [
            {"place_name": name, "address_name": area, "x": lon, "y": lat}
            for name, area, lon, lat in (
                ("시청역 1호선", "서울 중구 정동 5-5", "126.977198", "37.565345"),
                ("시청역 2호선", "서울 중구 서소문동 90-1", "126.975598", "37.563682"),
                ("시청역 부산1호선", "부산 연제구 연산동 1416-2", "129.076559", "35.179679"),
                ("인천시청역 인천1호선", "인천 남동구 간석동 927", "126.702235", "37.457735"),
            )
        ]

    monkeypatch.setattr(stations, "_kakao", kakao)
    yield queries
    stations._station_rows.cache_clear()
    stations.candidate_areas.cache_clear()


def test_station_disambiguation_and_room_store(tmp_path, map_proxy):
    app = server.App(Store(tmp_path / "stations.sqlite3"), SimpleNamespace(source="kskill"))
    status, result = app.handle("POST", "/api/regions/check", {"region": "시청역"})
    assert status == 200 and result["ok"] is False
    assert result["candidates"] == ["부산광역시 연제구 시청역", "서울특별시 중구 시청역"]
    assert app.check_region("서울특별시 시청역 근처") == {
        "ok": True, "region": "서울특별시 중구 시청역",
    }
    assert app.check_region("서울시 시청역")["region"] == "서울특별시 중구 시청역"
    status, room = app.handle("POST", "/api/rooms", {"region": "서울 중구 시청역", "place_type": "cafe"})
    assert status == 201 and room["region"] == "서울특별시 중구 시청역"
    with pytest.raises(ValueError, match="여러 곳"):
        app.handle("POST", "/api/rooms", {"region": "시청역", "place_type": "cafe"})
    with pytest.raises(ValueError, match="지하철역을 찾지 못했어요"):
        app.check_region("없는테스트역")


def test_station_lookup_error_does_not_fall_back_to_store_names(monkeypatch):
    def failed(*args, **kwargs):
        raise stations.StationLookupError("역 검색이 지연되고 있어요.")

    monkeypatch.setattr(server, "find_stations", failed)
    app = server.App(None, SimpleNamespace(source="kskill"))
    with pytest.raises(ValueError, match="역 검색이 지연"):
        app.check_region("시청역")


def test_station_without_suffix_is_used_after_an_area_lookup_misses(map_proxy, monkeypatch):
    monkeypatch.delenv("KAKAO_REST_API_KEY", raising=False)
    monkeypatch.setattr(server, "_REGION_CACHE", {})
    client = SimpleNamespace(source="kskill", search=lambda _: [])
    app = server.App(None, client)
    assert app.check_region("시청")["candidates"] == [
        "부산광역시 연제구 시청역", "서울특별시 중구 시청역",
    ]
    assert app.check_region("서울 시청 근처") == {
        "ok": True, "region": "서울특별시 중구 시청역",
    }


def test_station_keyboard_typo_offers_only_a_confirmed_station(monkeypatch):
    monkeypatch.delenv("KAKAO_REST_API_KEY", raising=False)
    monkeypatch.setattr(server, "_REGION_CACHE", {})
    station = stations.Station("서울특별시 마포구 광흥창역", 126.93, 37.55,
                               "서울특별시 마포구", ("서울 마포구 창전동",))
    monkeypatch.setattr(server, "find_stations", lambda q: (station,) if q == "광흥창역" else ())
    app = server.App(None, SimpleNamespace(source="kskill", search=lambda _: []))
    assert app.check_region("rhkdgmdckd")["candidates"] == ["광흥창"]
    assert app.check_region("광흥창") == {"ok": True, "region": station.label}
    for typo in ("ghkdgmdckd", "황흥창"):
        result = app.check_region(typo)
        assert result["ok"] is False and result["candidates"] == [station.label]


def test_tm128_matches_reference_point():
    x, y = stations.tm128(126.9764, 37.5645)
    assert x == pytest.approx(309769.44662, abs=0.01)
    assert y == pytest.approx(551859.89116, abs=0.01)


def test_station_recommendation_filters_by_coordinates(map_proxy, monkeypatch):
    monkeypatch.delenv("EATPL_DETAIL_ENABLED", raising=False)
    station = stations.require_station("서울 시청역")
    x, y = stations.tm128(station.longitude, station.latitude)
    coords = [("덕수궁 카페", "서울 중구 태평로2가", str(x + 500), str(y)),
              ("시청역 베이커리", "서울 중구 정동", str(x + 501), str(y)),
              ("좌표 없는 매장", "서울 중구 서소문동", "", "")]

    def place(row):
        name, address, east, north = row
        return map_place({"merNm": name, "merAddr": address, "xaxsVal": east, "yaxsVal": north,
                          "merTpbuzNm": "카페"})

    queries = []

    def search(query, business_type=None):
        queries.append(query)
        return [place(row) for row in coords]

    client = SimpleNamespace(source="kskill", search=search)
    prefs = [{"name": "나", "region": station.label, "place_type": "cafe", "styles": [],
              "budget": None, "atmospheres": [], "allergies": []}]
    result = recommend.recommend(prefs, client, api_key="")
    assert result["status"] == "ok" and result["station_radius_m"] == 500
    assert [(p["name"], p["distance_m"]) for p in result["results"]] == [("덕수궁 카페", 500)]
    assert "서울 중구 태평로2가" in queries
    assert all("시청역" not in query for query in queries)
