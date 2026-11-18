"""Third-party proxy adapter tests; no live endpoint or credentials used."""
import io
import json
from urllib import error
from urllib.parse import parse_qs, urlsplit
from wsgiref.util import setup_testing_defaults

import pytest

from moim import eatpl
from moim.store import Store
from moim.wsgi import create_app


class FakeOpener:
    def __init__(self, payload):
        self.payload = payload
        self.request = None

    def open(self, req, timeout):
        self.request = req
        if isinstance(self.payload, Exception):
            raise self.payload
        raw = self.payload if isinstance(self.payload, bytes) else json.dumps(self.payload).encode("utf-8")
        return io.BytesIO(raw)


def response(items):
    return {"items": items, "upstream": {"status_code": 200, "provider": "bccard-eatpl"}}


def test_get_request_and_detail_url_filter(monkeypatch):
    row = {"merNm": "가게", "merAddr": "서울 마포구", "merTpbuzNm": "카페",
           "merUrl": "https://web.paybooc.ai/mer/web/profile/abc"}
    opener = FakeOpener(response([row, {**row, "merUrl": "https://evil.invalid/x"}]))
    monkeypatch.setattr(eatpl.request, "build_opener", lambda *_: opener)
    places = eatpl.KSkillClient().search("서울 마포구", "카페")
    assert len(places) == 1 and places[0]["eatpl_url"] == row["merUrl"]
    assert places[0]["category"] == "cafe"
    assert opener.request.get_method() == "GET"
    assert parse_qs(urlsplit(opener.request.full_url).query) == {
        "location": ["서울 마포구"], "merTpbuzNm": ["카페"]}


@pytest.mark.parametrize(("raw", "expected"), [
    (0, 0), (0.04, 0.04), (100, 100), (-0.01, None), (100.01, None),
    (True, None), ("1", None), (None, None), (float("inf"), None), (float("nan"), None), (10 ** 400, None),
])
def test_region_sales_percentile_only_accepts_finite_numbers_in_range(raw, expected):
    place = eatpl.map_place({"merNm": "가게", "merAddr": "서울 마포구", "ccgSaleRnk": raw})
    assert place["region_sales_rank"] == expected


def test_customer_flags_preserve_only_booleans_and_keep_unknown_distinct():
    place = eatpl.map_place({"merNm": "가게", "merAddr": "서울 마포구",
                             "loclPrsnPpltYn": True, "frnrVsitYn": False, "empyVsitYn": "Y"})
    assert place["local_customer"] is True
    assert place["foreign_customer"] is False
    assert place["group_customer"] is None
    missing = eatpl.map_place({"merNm": "가게", "merAddr": "서울 마포구",
                               "loclPrsnPpltYn": 1, "frnrVsitYn": 0})
    assert missing["local_customer"] is None
    assert missing["foreign_customer"] is None
    assert missing["group_customer"] is None


@pytest.mark.parametrize("body", [
    {}, {"items": []}, {"items": [], "upstream": {"status_code": 500, "provider": "bccard-eatpl"}},
    {"items": [], "upstream": {"status_code": 200, "provider": "unknown"}}, b"not json",
])
def test_invalid_or_unverified_responses_fail_closed(monkeypatch, body):
    monkeypatch.setattr(eatpl.request, "build_opener", lambda *_: FakeOpener(body))
    with pytest.raises(eatpl.EatplError):
        eatpl.KSkillClient().search("홍대")


def test_empty_is_valid_and_network_failure_is_not_empty(monkeypatch):
    monkeypatch.setattr(eatpl.request, "build_opener", lambda *_: FakeOpener(response([])))
    assert eatpl.KSkillClient().search("홍대") == []
    monkeypatch.setattr(eatpl.request, "build_opener", lambda *_: FakeOpener(error.URLError("offline")))
    with pytest.raises(eatpl.EatplError, match="연결하지 못했어요"):
        eatpl.KSkillClient().search("홍대")


def test_explicit_source_selection_and_wsgi(monkeypatch, tmp_path):
    path = str(tmp_path / "test.sqlite3")
    store = Store(path)
    monkeypatch.setenv("EATPL_SOURCE", "kskill")
    assert eatpl.make_client(store).source == "kskill"
    monkeypatch.setenv("MOIM_ALLOWED_HOST", "example.com")
    monkeypatch.setenv("MOIM_DB_PATH", path)
    app = create_app()
    environ = {}
    setup_testing_defaults(environ)
    environ.update(REQUEST_METHOD="GET", PATH_INFO="/api/options", HTTP_HOST="example.com")
    seen = {}
    body = b"".join(app(environ, lambda status, headers: seen.update(status=status)))
    assert seen["status"].startswith("200 ")
    assert json.loads(body)["data_source"] == "kskill"
    monkeypatch.setenv("EATPL_SOURCE", "sample")
    with pytest.raises(RuntimeError, match="K-Skill"):
        create_app()
    monkeypatch.setenv("EATPL_SOURCE", "wrong")
    with pytest.raises(ValueError, match="원천"):
        eatpl.make_client(store)


def test_live_bar_search_uses_provider_categories_and_deduplicates():
    class FakeClient:
        source = "kskill"

        def __init__(self):
            self.calls = []

        def search(self, location, business_type):
            self.calls.append((location, business_type))
            shared = {"id": "same", "category": "bar"}
            wrong_category = {"id": "food", "category": "restaurant"}
            return [shared, wrong_category]

    client = FakeClient()
    assert eatpl.search_places(client, "홍대", "bar") == [{"id": "same", "category": "bar"}]
    assert client.calls == [("홍대", "주점"), ("홍대", "칵테일바")]


def test_cafe_search_uses_specific_category():
    class FakeClient:
        source = "kskill"

        def search(self, location, business_type):
            assert (location, business_type) == ("성수", "카페")
            return [{"id": "cafe", "category": "cafe"}]

    assert len(eatpl.search_places(FakeClient(), "성수", "cafe")) == 1


def test_restaurant_search_filters_out_other_categories():
    class FakeClient:
        source = "kskill"

        def search(self, location, business_type):
            assert (location, business_type) == ("성수", None)
            return [{"id": "food", "category": "restaurant"}, {"id": "bar", "category": "bar"}]

    assert eatpl.search_places(FakeClient(), "성수", "restaurant") == [{"id": "food", "category": "restaurant"}]
