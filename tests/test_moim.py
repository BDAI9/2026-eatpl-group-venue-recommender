"""모임 장소 추천 테스트. 실제 잇플·OpenRouter는 호출하지 않는다. 실행: python -m pytest -q"""

import json
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib import request as urlreq

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from moim import eatpl, estimate, options  # noqa: E402
from moim.recommend import recommend, summarize  # noqa: E402
from moim.server import App, make_handler  # noqa: E402
from moim.store import Store  # noqa: E402


@pytest.fixture(autouse=True)
def clean_env(monkeypatch):
    for k in ("OPENROUTER_API_KEY", "OPENROUTER_MODEL", "EATPL_INSTITUTION", "EATPL_ENV", "EATPL_SOURCE"):
        monkeypatch.delenv(k, raising=False)


@pytest.fixture(autouse=True)
def clean_jobs():
    from moim import recommend as rec_mod
    rec_mod._jobs.clear()
    yield
    for job in list(rec_mod._jobs.values()):
        job["thread"].join(5)
    rec_mod._jobs.clear()


@pytest.fixture
def store(tmp_path):
    return Store(str(tmp_path / "t.sqlite3"))


def person(name, **kw):
    base = {"name": name, "region": "홍대", "place_type": "restaurant", "styles": [], "budget": None,
            "atmospheres": [], "allergies": []}
    base.update(kw)
    return options.validate_preference(base)


# ---------------------------------------------------------------- 입력 검증
def test_validate_rejects_style_of_other_type():
    with pytest.raises(ValueError):
        person("a", place_type="cafe", styles=["일식"])


def test_validate_limits_atmospheres_and_unknown_fields():
    with pytest.raises(ValueError):
        person("a", atmospheres=options.ATMOSPHERES[:4])
    with pytest.raises(ValueError):
        options.validate_preference({**person("a"), "hack": 1})


def test_custom_region_and_other_allergy_allowed():
    p = person("a", region="망원", allergy_other="키위")
    assert p["region"] == "망원" and p["allergy_other"] == "키위"


# ---------------------------------------------------------------- 집계
def test_votes_pick_region_and_type():
    s = summarize([person("a"), person("b", region="성수", place_type="bar"), person("c", place_type="cafe"),
                   person("d")])
    assert s["region"] == "홍대" and s["place_type"] == "restaurant"
    assert s["allergies"] == {}


def test_allergies_collected_with_names():
    s = summarize([person("a", allergies=["땅콩"]), person("b", allergies=["땅콩"], allergy_other="키위")])
    assert s["allergies"] == {"땅콩": ["a", "b"], "키위": ["b"]}


# ---------------------------------------------------------------- 추천 (샘플 + 규칙)
def test_allergy_high_risk_excluded_and_popular_style_first(store):
    people = [person("윤아", styles=["일식", "한식"], allergies=["갑각류(새우·게)"]),
              person("민수", styles=["한식"]), person("지영", styles=["중식"])]
    out = recommend(people, eatpl.SampleClient(), store)
    names = [r["name"] for r in out["results"]]
    excluded = [x["name"] for x in out["excluded"]]
    assert out["status"] == "ok" and out["source"] == "sample"
    assert any("횟집" in n for n in excluded) and any("초밥" in n for n in excluded)
    assert not any("횟집" in n or "초밥" in n for n in names)
    assert "한식" in names[0] or "백반" in names[0]  # 2명이 원한 한식이 1위
    assert "3명 중 2명이 원하는 한식" in out["results"][0]["reasons"]


def test_override_region_and_type(store):
    out = recommend([person("a")], eatpl.SampleClient(), store, region="성수", place_type="cafe")
    assert out["region"] == "성수" and out["place_type"] == "cafe"
    assert out["results"] and all(r["category"] == "cafe" for r in out["results"])


def test_empty_region(store):
    out = recommend([person("a", region="제주")], eatpl.SampleClient(), store)
    assert out["status"] == "empty"


def test_no_participants(store):
    with pytest.raises(ValueError):
        recommend([], eatpl.SampleClient(), store)


# ---------------------------------------------------------------- AI 추정 (가짜 OpenRouter)
def fake_ai(monkeypatch, responder):
    calls = []

    def post(api_key, model, messages, timeout=30):
        calls.append(model)
        return responder(model, json.loads(messages[1]["content"]))

    monkeypatch.setattr(estimate, "_post", post)
    return calls


def test_ai_estimates_drive_budget_and_atmosphere(monkeypatch, store):
    def responder(model, user):
        items = []
        for p in user["가게"]:
            cheap = "분식" in p["이름"]
            items.append({"id": p["id"], "price_band": 1 if cheap else 4,
                          "atmospheres": ["활기찬"] if cheap else ["조용한"], "styles": []})
        return json.dumps({"places": items}, ensure_ascii=False)

    fake_ai(monkeypatch, responder)
    people = [person("a", budget=1, atmospheres=["활기찬"]), person("b", budget=1, atmospheres=["활기찬"])]
    out = recommend(people, eatpl.SampleClient(), store, api_key="test")
    top = out["results"][0]
    assert "분식" in top["name"]
    assert top["estimate"]["source"] == "ai"
    assert any("예산 맞는 사람 2/2" in r for r in top["reasons"])


def test_ai_cannot_lower_rule_allergy_risk(monkeypatch, store):
    def responder(model, user):
        return json.dumps({"places": [{"id": p["id"], "allergy_risk": {"생선": "low"}} for p in user["가게"]]})

    fake_ai(monkeypatch, responder)
    out = recommend([person("a", allergies=["생선"])], eatpl.SampleClient(), store, api_key="test")
    assert any("횟집" in x["name"] for x in out["excluded"])  # 규칙의 high가 AI의 low보다 우선



def test_ai_request_omits_participant_allergies_and_names(monkeypatch):
    captured = []

    def post(api_key, model, messages, timeout=30):
        captured.extend(messages)
        return json.dumps({"places": [{"id": "place-1", "price_band": 2}]})

    monkeypatch.setattr(estimate, "_post", post)
    estimate.ai_estimate([{"id": "place-1", "name": "테스트 가게", "business_type": "일반한식"}],
                         "restaurant", ["희귀 개인 알레르기"], "test")
    sent = json.dumps(captured, ensure_ascii=False)
    assert "희귀 개인 알레르기" not in sent
    assert "알레르기" not in sent


def test_cached_ai_low_does_not_hide_unknown_allergy(store):
    place = {"id": "unknown-risk", "name": "테스트 가게", "business_type": "정보없음", "category": "restaurant"}
    allergens = ["땅콩"]
    store.save_estimates({place["id"]: {"price_band": 2, "atmospheres": [], "styles": [],
                                       "allergy_risk": {"땅콩": "low"}, "source": "ai"}}, allergens)
    estimates, _ = estimate.estimate_places([place], "restaurant", allergens, store=store, api_key="")
    assert estimates[place["id"]]["allergy_risk"]["땅콩"] == "unknown"
    from moim.recommend import score_place
    score = score_place(place, estimates[place["id"]], [], "restaurant", {"땅콩": ["참여자"]})
    assert any("알레르기 정보 없음" in caution for caution in score["cautions"])

def test_ai_falls_back_through_models_then_rules(monkeypatch, store):
    from urllib import error
    monkeypatch.setenv("OPENROUTER_MODEL", "busy:free,broken:free")

    def responder(model, user):
        if model == "busy:free":
            raise error.HTTPError("u", 429, "busy", {}, None)
        return "모르겠어요"

    calls = fake_ai(monkeypatch, responder)
    out = recommend([person("a")], eatpl.SampleClient(), store, api_key="test")
    assert calls[:2] == ["busy:free", "broken:free"]
    assert out["status"] == "ok" and out["warnings"] and "AI 추정에 실패" in out["warnings"][0]
    assert out["results"][0]["estimate"]["source"] == "rule"


def test_ai_results_cached(monkeypatch, store):
    def responder(model, user):
        return json.dumps({"places": [{"id": p["id"], "price_band": 2} for p in user["가게"]]})

    calls = fake_ai(monkeypatch, responder)
    recommend([person("a")], eatpl.SampleClient(), store, api_key="test")
    n = len(calls)
    recommend([person("b")], eatpl.SampleClient(), store, api_key="test")
    assert len(calls) == n  # 두 번째는 캐시 사용


def test_ai_invalid_values_dropped():
    c = estimate._clean_ai({"price_band": 9, "atmospheres": ["없는분위기", "조용한"], "styles": ["일식", "x"],
                            "allergy_risk": {"땅콩": "maybe"}}, "restaurant", ["땅콩"])
    assert c["price_band"] is None and c["atmospheres"] == ["조용한"] and c["styles"] == ["일식"]
    assert c["allergy_risk"] == {"땅콩": "unknown"}


# ---------------------------------------------------------------- 잇플 클라이언트 (가짜 서버)
class FakeEatpl(BaseHTTPRequestHandler):
    received = []
    reply = None

    def log_message(self, *a):
        pass

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        FakeEatpl.received.append(body)
        status, payload = FakeEatpl.reply
        raw = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)


@pytest.fixture
def fake_eatpl(monkeypatch):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), FakeEatpl)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    monkeypatch.setattr(eatpl, "DEV_URL", f"http://127.0.0.1:{srv.server_port}/api/mer")
    FakeEatpl.received = []
    yield FakeEatpl
    srv.shutdown()


def test_eatpl_request_and_mapping(fake_eatpl, store):
    url = "https://web.paybooc.ai/mer/web/profile/abc123"
    fake_eatpl.reply = (200, {"rspCode": "00000", "data": [
        {"merNm": "실제 카페", "merAddr": "서울 마포구", "merUrl": url, "merTpbuzNm": "카페", "allSaleRnk": 3},
        {"merNm": "나쁜 링크", "merAddr": "서울", "merUrl": "https://evil.example/x", "merTpbuzNm": "카페"},
        {"merNm": "", "merAddr": "x"}]})
    client = eatpl.EatplClient("BDAI", store.next_trace_number)
    places = client.search("홍대", "카페")
    sent = fake_eatpl.received[0]
    assert sent["instNm"] == "BDAI" and sent["location"] == "홍대" and sent["merTpbuzNm"] == "카페"
    assert sent["trnsTrceNo"].startswith("BDAI") and len(sent["trnsTrceNo"]) == 4 + 18
    assert [p["name"] for p in places] == ["실제 카페", "나쁜 링크"]
    assert places[0]["eatpl_url"] == url and places[1]["eatpl_url"] is None
    client.search("홍대")
    assert fake_eatpl.received[1]["trnsTrceNo"] != sent["trnsTrceNo"]  # 순번 증가


@pytest.mark.parametrize("reply, msg", [
    ((403, {}), "IP 등록"), ((500, {}), "HTTP 500"), ((200, {"rspCode": "E001"}), "E001")])
def test_eatpl_errors(fake_eatpl, store, reply, msg):
    fake_eatpl.reply = reply
    with pytest.raises(eatpl.EatplError, match=msg):
        eatpl.EatplClient("BDAI", store.next_trace_number).search("홍대")


def test_recommend_reports_eatpl_error(fake_eatpl, store):
    fake_eatpl.reply = (403, {})
    out = recommend([person("a")], eatpl.EatplClient("BDAI", store.next_trace_number), store)
    assert out["status"] == "error" and "IP" in out["message"]


def test_make_client_uses_env(monkeypatch, store):
    assert eatpl.make_client(store).source == "sample"
    monkeypatch.setenv("EATPL_INSTITUTION", "BDAI")
    assert eatpl.make_client(store).source == "eatpl"


# ---------------------------------------------------------------- HTTP 서버 전체 흐름
@pytest.fixture
def server(store):
    srv = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(App(store, eatpl.SampleClient())))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_port}"
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


def test_http_room_flow(server):
    status, room = call(server, "/api/rooms", "POST", {"title": "테스트"})
    assert status == 201
    rid = room["id"]
    s, me = call(server, f"/api/rooms/{rid}/participants", "POST",
                 {"name": "윤아", "region": "성수", "place_type": "cafe", "styles": ["디저트·케이크"],
                  "budget": 2, "atmospheres": [], "allergies": []})
    assert s == 201 and me["token"]
    s, got = call(server, f"/api/rooms/{rid}")
    assert s == 200 and got["summary"]["count"] == 1 and "token" not in json.dumps(got)
    # 다른 사람 토큰으로 수정 불가
    s, _ = call(server, f"/api/rooms/{rid}/participants/{me['id']}", "PUT",
                {"token": "wrong", "name": "x", "region": "홍대", "place_type": "bar"})
    assert s == 403
    s, _ = call(server, f"/api/rooms/{rid}/participants/{me['id']}", "PUT",
                {"token": me["token"], "name": "윤아", "region": "성수", "place_type": "bar", "styles": ["이자카야"]})
    assert s == 200
    s, rec = call(server, f"/api/rooms/{rid}/recommend", "POST", {})
    assert s == 200 and rec["place_type"] == "bar" and rec["results"]
    s, _ = call(server, f"/api/rooms/{rid}/participants/{me['id']}", "DELETE", {"token": me["token"]})
    assert s == 200 and call(server, f"/api/rooms/{rid}")[1]["summary"]["count"] == 0


def test_http_errors(server):
    assert call(server, "/api/rooms/nope1234")[0] == 404
    rid = call(server, "/api/rooms", "POST", {})[1]["id"]
    s, err = call(server, f"/api/rooms/{rid}/participants", "POST", {"name": "a", "region": "홍대", "place_type": "pub"})
    assert s == 400 and "하나" in err["message"]
    s, err = call(server, f"/api/rooms/{rid}/recommend", "POST", {})
    assert s == 400 and "참여" in err["message"]
    with urlreq.urlopen(server + f"/r/{rid}") as r:
        assert r.status == 200 and "모임 장소" in r.read().decode()


# ---------------------------------------------------------------- 규칙 보강 (2차)
class ManyClient:
    """후보가 많은 상황: 식당 50곳 + 횟집 1곳."""
    source = "sample"

    def search(self, location, business_type=None):
        rows = [{"merNm": f"한식당 {i}", "merAddr": f"서울 {location} {i}", "merTpbuzNm": "일반한식", "allSaleRnk": i}
                for i in range(50)]
        rows.append({"merNm": "바다 횟집", "merAddr": f"서울 {location} 99", "merTpbuzNm": "일식회집"})
        return [eatpl.map_place(r, is_sample=True) for r in rows]


def test_one_person_counted_once_across_styles():
    from moim.recommend import score_place
    est = {"price_band": None, "atmospheres": [], "styles": ["한식", "일식"], "allergy_risk": {}, "source": "ai"}
    s = score_place({}, est, [person("a", styles=["한식", "일식"])], "restaurant", {})
    assert s["score"] == 3 and len(s["reasons"]) == 2


def test_cafe_style_from_name_without_ai(store):
    people = [person("a", place_type="cafe", styles=["디저트·케이크"]), person("b", place_type="cafe", styles=["디저트·케이크"])]
    out = recommend(people, eatpl.SampleClient(), store, place_type="cafe", api_key="")
    assert "디저트" in out["results"][0]["name"]
    assert "2명 중 2명이 원하는 디저트·케이크" in out["results"][0]["reasons"]


@pytest.mark.parametrize("name, btype, allergen", [
    ("새우튀김 우동", "국수/면/만두", "갑각류(새우·게)"), ("메밀소바", "일반한식", "메밀"),
    ("땅콩 디저트", "카페", "땅콩"), ("치즈 돈가스", "일반한식", "우유·유제품"), ("옛날 통닭", "일반한식", "닭고기")])
def test_name_ingredient_marks_high_risk(name, btype, allergen):
    assert estimate.rule_estimate({"name": name, "business_type": btype}, [allergen])["allergy_risk"][allergen] == "high"


def test_ai_called_at_most_once_and_skips_rule_excluded(monkeypatch, store):
    seen = []

    def responder(model, user):
        seen.append([p["이름"] for p in user["가게"]])
        return json.dumps({"places": [{"id": p["id"], "price_band": 2} for p in user["가게"]]})

    calls = fake_ai(monkeypatch, responder)
    out = recommend([person("a", allergies=["생선"])], ManyClient(), store, api_key="test")
    from moim.recommend import AI_LIMIT
    assert len(calls) == 1 and len(seen[0]) == AI_LIMIT == 12  # 51곳 중 상위 12곳만, 요청 1번
    assert "바다 횟집" not in seen[0]  # 규칙상 이미 제외된 곳은 AI에 보내지 않음
    assert any(x["name"] == "바다 횟집" for x in out["excluded"])
    assert out["results"][0]["estimate"]["source"] == "ai"


def test_cached_ai_estimate_still_gets_new_rule_risk(store):
    place = eatpl.map_place({"merNm": "새우 전문점", "merAddr": "서울 홍대", "merTpbuzNm": "일반한식"}, is_sample=True)
    allergens = ["갑각류(새우·게)"]
    store.save_estimates({place["id"]: {"price_band": 2, "atmospheres": [], "styles": [],
                                        "allergy_risk": {"갑각류(새우·게)": "low"}, "source": "ai"}}, allergens)
    est, _ = estimate.estimate_places([place], "restaurant", allergens, store=store, api_key="")
    assert est[place["id"]]["allergy_risk"]["갑각류(새우·게)"] == "high"
    assert est[place["id"]]["price_band"] == 2


# ---------------------------------------------------------------- 실측 반영: 업종 규칙 · 백그라운드 AI
class BarClient:
    source = "sample"

    def search(self, location, business_type=None):
        rows = [{"merNm": "홍대 호프집", "merAddr": f"서울 {location} 1", "merTpbuzNm": "호프"},
                {"merNm": "홍대 이자카야", "merAddr": f"서울 {location} 2", "merTpbuzNm": "이자카야"},
                {"merNm": "홍대 와인바", "merAddr": f"서울 {location} 3", "merTpbuzNm": "바(bar)"}]
        return [eatpl.map_place(r, is_sample=True) for r in rows]


def test_bar_type_rules_without_ai(store):
    # 실측: AI가 '홍대 호프집'+밀을 unknown으로 답함 → 업종 규칙이 잡아야 한다
    people = [person("a", place_type="bar", allergies=["밀·글루텐"]), person("b", place_type="bar", allergies=["대두"])]
    out = recommend(people, BarClient(), store, api_key="")
    assert [x["name"] for x in out["excluded"]] == ["홍대 호프집"]
    izakaya = next(r for r in out["results"] if r["name"] == "홍대 이자카야")
    assert any("대두" in c for c in izakaya["cautions"]) and any("밀" in c for c in izakaya["cautions"])


def _slow_ai(monkeypatch, gate, fail=False):
    def responder(model, user):
        gate.wait(5)
        if fail:
            raise ValueError("bad")
        return json.dumps({"places": [{"id": p["id"], "price_band": 1, "atmospheres": ["조용한"]} for p in user["가게"]]})
    return fake_ai(monkeypatch, responder)


def test_background_returns_rules_first_then_ai(monkeypatch, store):
    import threading
    from moim import recommend as rec_mod
    gate = threading.Event()
    calls = _slow_ai(monkeypatch, gate)
    people = [person("a", budget=1, atmospheres=["조용한"])]
    first = recommend(people, ManyClient(), store, api_key="k", background=True)
    assert first["ai_pending"] and first["results"][0]["estimate"]["source"] == "rule"
    again = recommend(people, ManyClient(), store, api_key="k", background=True)  # 화면이 다시 물어봐도
    assert again["ai_pending"] and len(rec_mod._jobs) == 1  # 작업은 하나만
    gate.set()
    next(iter(rec_mod._jobs.values()))["thread"].join(5)
    done = recommend(people, ManyClient(), store, api_key="k", background=True)
    assert not done["ai_pending"] and done["results"][0]["estimate"]["source"] == "ai"
    assert "분위기 '조용한' 원하는 사람 1명" in done["results"][0]["reasons"]
    assert len(calls) == 1  # 모델 1번 호출 = 요청 1번
    recommend(people, ManyClient(), store, api_key="k", background=True)
    assert len(rec_mod._jobs) == 1 and len(calls) == 1  # 끝난 뒤 다시 물어도 다음 20곳을 보내지 않음


def test_background_failure_warns_and_does_not_retry_soon(monkeypatch, store):
    import threading
    from moim import recommend as rec_mod
    gate = threading.Event(); gate.set()
    calls = _slow_ai(monkeypatch, gate, fail=True)
    monkeypatch.setenv("OPENROUTER_MODEL", "m1:free")
    people = [person("a")]
    recommend(people, ManyClient(), store, api_key="k", background=True)
    next(iter(rec_mod._jobs.values()))["thread"].join(5)
    out = recommend(people, ManyClient(), store, api_key="k", background=True)
    assert not out["ai_pending"] and any("AI 추정에 실패" in w for w in out["warnings"])
    recommend(people, ManyClient(), store, api_key="k", background=True)
    assert len(calls) == 1  # 실패 직후에는 다시 부르지 않음 (무료 한도 보호)
    assert out["results"]  # 규칙만으로도 추천은 나온다


def test_background_without_key_is_just_rules(store):
    out = recommend([person("a")], ManyClient(), store, api_key="", background=True)
    assert not out["ai_pending"] and out["results"]


def test_server_recommend_does_not_wait_for_ai(monkeypatch, server):
    import threading
    gate = threading.Event()
    _slow_ai(monkeypatch, gate)
    monkeypatch.setenv("OPENROUTER_API_KEY", "k")
    base = server
    room = call(base, "/api/rooms", "POST", {"title": "t"})[1]
    call(base, f"/api/rooms/{room['id']}/participants", "POST",
         {"name": "가", "region": "홍대", "place_type": "restaurant", "styles": [], "budget": 2,
          "atmospheres": [], "allergies": []})
    status, body = call(base, f"/api/rooms/{room['id']}/recommend", "POST", {})
    assert status == 200 and body["ai_pending"] is True  # AI가 끝나기 전에 응답
    gate.set()


# ---------------------------------------------------------------- 진단 스크립트
def test_diagnose_runs_end_to_end(monkeypatch, tmp_path, fake_eatpl):
    from moim import diagnose

    url = "https://web.paybooc.ai/mer/web/profile/x1"
    fake_eatpl.reply = (200, {"rspCode": "00000", "data": [
        {"merNm": "홍대 이자카야 하루", "merAddr": "서울 마포구 홍대", "merUrl": url, "merTpbuzNm": "이자카야", "allSaleRnk": 12},
        {"merNm": "홍대 딸기 케이크", "merAddr": "서울 마포구 홍대", "merUrl": url + "2", "merTpbuzNm": "카페", "allSaleRnk": 5},
        {"merNm": "홍대 우동집", "merAddr": "서울 마포구 홍대", "merUrl": url + "3", "merTpbuzNm": "국수/면/만두"}]})

    def responder(model, user):
        return json.dumps({"places": [{"id": p["id"], "price_band": 2, "atmospheres": ["조용한"]} for p in user["가게"]]})

    fake_ai(monkeypatch, responder)
    monkeypatch.setattr(diagnose, "ROOT", tmp_path)
    monkeypatch.setenv("EATPL_INSTITUTION", "BDAI")
    monkeypatch.setenv("OPENROUTER_API_KEY", "sk-or-test-secret")
    monkeypatch.setenv("OPENROUTER_MODEL", "m1:free")
    monkeypatch.setattr(sys, "argv", ["diagnose", "--regions", "홍대"])
    diagnose.main()
    rep = json.loads((tmp_path / "diagnose_report.json").read_text(encoding="utf-8"))
    md = (tmp_path / "diagnose_report.md").read_text(encoding="utf-8")
    assert rep["ai"][0]["status"] == "ok" and rep["ai"][0]["ids_returned"] == "5/5"
    # 홍대: 원래 이름 + 실제 주소 2곳 × (전체·카페) + 술집 업종 4개
    assert all(r["status"] == "ok" for r in rep["eatpl"]) and len(rep["eatpl"]) == 3 * 2 + 4
    assert [r["location"] for r in rep["eatpl"][:3:2]] == ["홍대", "서울 마포구 서교동"]
    assert rep["eatpl"][0]["detail_url_ok"] == 3 and rep["eatpl"][0]["allSaleRnk"]["min"] == 5
    assert {g["status"] for g in rep["recommend"]} <= {"ok", "empty"}
    assert "sk-or-test-secret" not in md + json.dumps(rep) and "BDAI" not in md  # 키·기관명이 보고서에 없음
    bar = rep["recommend"][2]
    assert bar["top"][0]["name"] == "홍대 이자카야 하루" and bar["top"][0]["has_eatpl_link"]
    assert "2명 중 2명이 원하는 이자카야" in bar["top"][0]["reasons"] or "3명 중 2명이 원하는 이자카야" in bar["top"][0]["reasons"]


# ---------------------------------------------------------------- 실데이터(K-Skill, 2026-11-17)에서 찾은 문제
@pytest.mark.parametrize("name, btype, want", [
    ("메가엠지씨커피 홍대패션거리점", "고기구이", "cafe"),      # 업종 표기 오류: 커피 체인이 '고기구이'
    ("(주)코너펍(Corner Pub Co.)", "백반/한정식", "bar"),       # 펍이 '백반/한정식'
    ("오늘술집주다방(홍대점)", "카페", "bar"),
    ("이십오(25)", "유흥주점", "unknown"),                     # 모임 장소로 추천하지 않음
    ("주식회사 인클원", "주류판매점", "unknown"),
    ("푸주옥", "기타한식", "restaurant"),                      # 예전 표에 없던 업종
    ("(주)라트라팡테 아오이토리", "백반/한정식", "restaurant"),
    ("나루토", "기타일식", "restaurant"),
    ("아임도넛 홍대점", "빵/도넛", "cafe"),
    ("왕령관네 탕후루", "아이스크림/요거트/빙수", "cafe"),
    ("파스타리코", "이탈리아음식", "restaurant"),
])
def test_category_from_real_rows(name, btype, want):
    assert eatpl.category_of(btype, name) == want


class RealClient:
    """K-Skill처럼 주소 글자로 찾는 가짜 클라이언트. 받은 검색어를 기록한다."""
    source = "kskill"

    def __init__(self, fail=()):
        self.calls, self.fail = [], set(fail)

    def search(self, location, business_type=None):
        self.calls.append((location, business_type))
        if (location, business_type) in self.fail:
            raise eatpl.EatplError("검색 실패")
        rows = {
            ("서울 마포구 서교동", "카페"): [("서교 커피", "카페", "서울 마포구 와우산로 1 (서교동)"),
                                         ("여수 카페", "카페", "전남 여수시 서교동 1")],
            ("서울 마포구 서교동", "빵/도넛"): [("홍대 도넛", "빵/도넛", "서울 마포구 양화로 2 (서교동)")],
            ("서울 마포구 동교동", "카페"): [("서교 커피", "카페", "서울 마포구 와우산로 1 (서교동)"),
                                         ("동교 카페", "카페", "서울 마포구 동교로 3 (동교동)")],
        }.get((location, business_type), [])
        return [eatpl.map_place({"merNm": n, "merTpbuzNm": t, "merAddr": a,
                                 "merUrl": "https://web.paybooc.ai/mer/web/profile/" + n.replace(" ", "")})
                for n, t, a in rows]


def test_region_uses_real_addresses_and_cafe_subtypes():
    from moim.recommend import search_region
    client = RealClient()
    places = search_region(client, "홍대", "cafe")
    assert ("홍대", "카페") not in client.calls and ("서울 마포구 서교동", "카페") in client.calls
    assert ("서울 마포구 서교동", "빵/도넛") in client.calls  # 베이커리·디저트 업종도 검색
    assert [p["name"] for p in places] == ["서교 커피", "홍대 도넛", "동교 카페"]  # 중복·서울 밖 제외


def test_region_custom_name_and_sample_unchanged(store):
    from moim.recommend import search_region
    client = RealClient()
    search_region(client, "망원동", "restaurant")
    assert client.calls == [("망원동", None)]  # 목록에 없는 지역은 입력 그대로
    out = recommend([person("a")], eatpl.SampleClient(), store, api_key="")
    assert out["status"] == "ok" and out["results"]  # 샘플은 지역 이름 그대로 검색


def test_region_second_address_failure_is_skipped_but_first_is_reported(store):
    from moim.recommend import search_region
    ok = search_region(RealClient(fail={("서울 마포구 동교동", "카페")}), "홍대", "cafe")
    assert [p["name"] for p in ok] == ["서교 커피", "홍대 도넛"]
    out = recommend([person("a", place_type="cafe")], RealClient(fail={("서울 마포구 서교동", "카페")}), store, api_key="")
    assert out["status"] == "error"


@pytest.mark.parametrize("btype, allergen, excluded", [
    ("횟집", "생선", True), ("빵/도넛", "밀·글루텐", True), ("아이스크림/요거트/빙수", "우유·유제품", True),
    ("기타일식", "대두", False), ("백반/한정식", "대두", False),
])
def test_new_business_type_allergy_rules(btype, allergen, excluded):
    place = {"id": "x", "name": "가게", "business_type": btype, "category": eatpl.category_of(btype)}
    risk = estimate.rule_estimate(place, [allergen])["allergy_risk"][allergen]
    assert (risk == "high") == excluded and risk != "unknown"


def test_new_business_type_styles():
    for btype, style in [("백반/한정식", "한식"), ("기타일식", "일식"), ("횟집", "일식"), ("기타중식", "중식"),
                         ("빵/도넛", "베이커리")]:
        place = {"id": "x", "name": "가게", "business_type": btype, "category": eatpl.category_of(btype)}
        assert style in estimate.rule_estimate(place, [])["styles"], btype


@pytest.mark.parametrize("raw, shown", [
    ("주식회사 어썸레드", "어썸레드"), ("(주)라트라팡테 아오이토리", "라트라팡테 아오이토리"),
    ("산리오러버스클럽/(주)제이콥에프앤비", "산리오러버스클럽"), ("㈜홍대베이크", "홍대베이크"),
    ("카페 드 원피스", "카페 드 원피스"), ("주식회사", "주식회사"),
])
def test_clean_name(raw, shown):
    assert eatpl.clean_name(raw) == shown


def test_region_searches_run_in_parallel():
    import threading, time
    from moim.recommend import search_region

    class Slow(RealClient):
        def __init__(self):
            super().__init__(); self.active = self.peak = 0; self.lock = threading.Lock()

        def search(self, location, business_type=None):
            with self.lock:
                self.active += 1; self.peak = max(self.peak, self.active)
            time.sleep(0.2)
            try:
                return super().search(location, business_type)
            finally:
                with self.lock:
                    self.active -= 1

    c = Slow(); t0 = time.perf_counter()
    places = search_region(c, "홍대", "cafe")
    assert len(c.calls) == 10 and c.peak > 1 and time.perf_counter() - t0 < 1.5  # 차례로면 2초
    assert [p["name"] for p in places] == ["서교 커피", "홍대 도넛", "동교 카페"]  # 순서는 그대로
