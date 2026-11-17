"""WSGI adapter checks; no network or actual Eatpl credentials are used."""
import io
import json
import sqlite3
from wsgiref.util import setup_testing_defaults
from wsgiref.validate import validator

import pytest

from moim.eatpl import SampleClient
from moim.init_db import initialize_new_database
from moim.server import App, MAX_BODY
from moim.store import Store
from moim.wsgi import create_app, create_wsgi_app


@pytest.fixture(autouse=True)
def clear_external_source(monkeypatch):
    monkeypatch.delenv("EATPL_SOURCE", raising=False)
    monkeypatch.delenv("MOIM_ALLOWED_API_ORIGINS", raising=False)


@pytest.fixture
def wsgi(tmp_path):
    return validator(create_wsgi_app(App(Store(str(tmp_path / "test.sqlite3")), SampleClient()), "demo.example.com"))


def call(app, path, method="GET", data=None, *, host="demo.example.com", origin=None,
         content_type="application/json", content_length=None, preflight_method=None, preflight_headers=None):
    environ = {}
    setup_testing_defaults(environ)
    raw = b"" if data is None else data if isinstance(data, bytes) else json.dumps(data).encode()
    environ.update(REQUEST_METHOD=method, PATH_INFO=path, QUERY_STRING="", HTTP_HOST=host,
                   CONTENT_TYPE=content_type, CONTENT_LENGTH=str(len(raw)) if content_length is None else content_length,
                   **{"wsgi.input": io.BytesIO(raw), "wsgi.errors": io.StringIO()})
    if origin is not None:
        environ["HTTP_ORIGIN"] = origin
    if preflight_method is not None:
        environ["HTTP_ACCESS_CONTROL_REQUEST_METHOD"] = preflight_method
    if preflight_headers is not None:
        environ["HTTP_ACCESS_CONTROL_REQUEST_HEADERS"] = preflight_headers
    seen = {}

    def start_response(status, headers, exc_info=None):
        seen["status"] = int(status.split(" ", 1)[0])
        seen["headers"] = dict(headers)

    result = app(environ, start_response)
    try:
        seen["body"] = b"".join(result)
    finally:
        if hasattr(result, "close"):
            result.close()
    return seen


def test_room_flow_and_protected_token(wsgi):
    made = call(wsgi, "/api/rooms", "POST", {"title": "team"}, origin="https://demo.example.com")
    assert made["status"] == 201
    room = json.loads(made["body"])["id"]
    participant = call(wsgi, f"/api/rooms/{room}/participants", "POST", {
        "name": "A", "region": "홍대", "place_type": "cafe", "styles": [],
        "atmospheres": [], "allergies": [], "budget": None})
    assert participant["status"] == 201
    token = json.loads(participant["body"])["token"]
    fetched = call(wsgi, f"/api/rooms/{room}")
    assert fetched["status"] == 200 and token.encode() not in fetched["body"]
    assert json.loads(fetched["body"])["summary"]["count"] == 1
    assert fetched["headers"]["Referrer-Policy"] == "strict-origin-when-cross-origin"
    assert call(wsgi, f"/r/{room}")["status"] == 200


def test_landing_uses_live_room_flow_without_mock_assets(wsgi):
    landing = call(wsgi, "/")
    assert landing["status"] == 200
    assert b'/static/live-start.js' in landing["body"]
    assert b'/frontend/js/app.js' not in landing["body"]
    script = call(wsgi, "/static/live-start.js")
    assert script["status"] == 200
    assert b'/api/rooms' in script["body"]
    for path in ("/static/landing.css", "/static/landing-view.js"):
        assert call(wsgi, path)["status"] == 200
    # Prototype scripts with mock votes and links are not served.
    for path in ("/frontend/js/app.js", "/frontend/js/api.js", "/frontend/js/views.js"):
        assert call(wsgi, path)["status"] == 404


def test_health_is_liveness_only(wsgi):
    response = call(wsgi, "/healthz")
    assert response["status"] == 200
    assert json.loads(response["body"]) == {"status": "ok"}
    assert call(wsgi, "/api/options")["status"] == 200


@pytest.mark.parametrize("host", ["other.example.com", "demo.example.com.attacker.invalid", "demo.example.com:80"])
def test_host_must_match(wsgi, host):
    assert call(wsgi, "/api/options", host=host)["status"] == 400


@pytest.mark.parametrize("origin", ["http://demo.example.com", "https://evil.example", "null"])
def test_cross_origin_mutations_rejected(wsgi, origin):
    assert call(wsgi, "/api/rooms", "POST", {}, origin=origin)["status"] == 403


@pytest.fixture
def cors_wsgi(tmp_path):
    app = App(Store(str(tmp_path / "cors.sqlite3")), SampleClient())
    return validator(create_wsgi_app(app, "demo.example.com",
                                     allowed_api_origins="https://jj2ya.vercel.app"))


def test_cors_is_disabled_by_default(wsgi):
    origin = "https://jj2ya.vercel.app"
    response = call(wsgi, "/api/rooms", "POST", {}, origin=origin)
    assert response["status"] == 403 and "Access-Control-Allow-Origin" not in response["headers"]
    response = call(wsgi, "/api/rooms", "OPTIONS", origin=origin, preflight_method="POST")
    assert response["status"] == 405 and "Access-Control-Allow-Origin" not in response["headers"]


def test_cors_allows_only_explicit_api_origin_and_never_exposes_credentials(cors_wsgi):
    origin = "https://jj2ya.vercel.app"
    preflight = call(cors_wsgi, "/api/rooms", "OPTIONS", origin=origin,
                     preflight_method="POST", preflight_headers="content-type")
    assert preflight["status"] == 204 and preflight["body"] == b""
    assert preflight["headers"]["Access-Control-Allow-Origin"] == origin
    assert preflight["headers"]["Access-Control-Allow-Methods"] == "POST"
    assert preflight["headers"]["Access-Control-Allow-Headers"] == "Content-Type"
    assert "Origin" in preflight["headers"]["Vary"]
    assert "Access-Control-Allow-Credentials" not in preflight["headers"]
    made = call(cors_wsgi, "/api/rooms", "POST", {"title": "test"}, origin=origin)
    assert made["status"] == 201 and made["headers"]["Access-Control-Allow-Origin"] == origin
    assert "Access-Control-Allow-Credentials" not in made["headers"]
    room = json.loads(made["body"])["id"]
    participant = call(cors_wsgi, f"/api/rooms/{room}/participants", "POST", {
        "name": "test", "region": "홍대", "place_type": "cafe", "styles": [],
        "atmospheres": [], "allergies": [], "budget": None}, origin=origin)
    identity = json.loads(participant["body"])
    token = identity["token"]
    fetched = call(cors_wsgi, f"/api/rooms/{room}", origin=origin)
    assert fetched["status"] == 200 and fetched["headers"]["Access-Control-Allow-Origin"] == origin
    assert token.encode() not in fetched["body"]
    updated = call(cors_wsgi, f"/api/rooms/{room}/participants/{identity['id']}", "PUT", {
        "name": "updated", "region": "홍대", "place_type": "cafe", "styles": [],
        "atmospheres": [], "allergies": [], "budget": None, "token": token}, origin=origin)
    assert updated["status"] == 200 and token.encode() not in updated["body"]
    static = call(cors_wsgi, "/", origin=origin)
    assert static["status"] == 200 and "Access-Control-Allow-Origin" not in static["headers"]
    other = call(cors_wsgi, f"/api/rooms/{room}", origin="https://attacker.invalid")
    assert "Access-Control-Allow-Origin" not in other["headers"]
    invalid = call(cors_wsgi, "/api/rooms", "POST", {}, origin=origin, content_type="text/plain")
    assert invalid["status"] == 415 and invalid["headers"]["Access-Control-Allow-Origin"] == origin
    assert call(cors_wsgi, "/api/options", host="attacker.invalid", origin=origin)["status"] == 400


@pytest.mark.parametrize(("path", "method"), [
    ("/api/options", "GET"), ("/api/rooms/abcd", "GET"),
    ("/api/rooms/abcd/participants", "POST"), ("/api/rooms/abcd/participants/efgh", "PUT"),
    ("/api/rooms/abcd/participants/efgh", "DELETE"), ("/api/rooms/abcd/recommend", "POST"),
])
def test_preflight_permits_only_the_route_actual_method(cors_wsgi, path, method):
    response = call(cors_wsgi, path, "OPTIONS", origin="https://jj2ya.vercel.app",
                    preflight_method=method, preflight_headers="content-type")
    assert response["status"] == 204
    assert method in response["headers"]["Access-Control-Allow-Methods"]


@pytest.mark.parametrize("origin", ["https://jj2ya.vercel.app.evil.test", "http://jj2ya.vercel.app",
                                   "https://jj2ya.vercel.app:443", "https://jj2ya.vercel.app/", "null"])
def test_cors_rejects_lookalike_origins(cors_wsgi, origin):
    response = call(cors_wsgi, "/api/rooms", "POST", {}, origin=origin)
    assert response["status"] == 403 and "Access-Control-Allow-Origin" not in response["headers"]


@pytest.mark.parametrize(("path", "requested", "headers"), [
    ("/", "POST", "content-type"), ("/api/missing", "POST", "content-type"),
    ("/api/rooms", "DELETE", "content-type"), ("/api/rooms", "POST", "authorization"),
    ("/api/rooms", "POST", "content-type,x-secret"), ("/api/rooms", "POST", "content-type,"),
])
def test_preflight_rejects_other_paths_methods_and_headers(cors_wsgi, path, requested, headers):
    response = call(cors_wsgi, path, "OPTIONS", origin="https://jj2ya.vercel.app",
                    preflight_method=requested, preflight_headers=headers)
    assert response["status"] == 403 and "Access-Control-Allow-Origin" not in response["headers"]


@pytest.mark.parametrize("value", ["*", "https://*.vercel.app", "http://jj2ya.vercel.app",
                                  "https://jj2ya.vercel.app:443", "https://jj2ya.vercel.app/",
                                  "https://user@jj2ya.vercel.app", "https://jj2ya.vercel.app?x=1",
                                  "https://jj2ya.vercel.app,", "https://-bad.vercel.app"])
def test_cors_configuration_rejects_unsafe_origins(tmp_path, value):
    app = App(Store(str(tmp_path / "invalid.sqlite3")), SampleClient())
    with pytest.raises(ValueError, match="MOIM_ALLOWED_API_ORIGINS"):
        create_wsgi_app(app, "demo.example.com", allowed_api_origins=value)


def test_factory_reads_explicit_api_origin(monkeypatch, tmp_path):
    monkeypatch.setenv("MOIM_ALLOWED_HOST", "demo.example.com")
    monkeypatch.setenv("MOIM_ALLOWED_API_ORIGINS", "https://jj2ya.vercel.app")
    monkeypatch.setenv("EATPL_SOURCE", "kskill")
    path = tmp_path / "state.sqlite3"
    initialize_new_database(str(path))
    monkeypatch.setenv("MOIM_DB_PATH", str(path))
    response = call(validator(create_app()), "/api/options", origin="https://jj2ya.vercel.app")
    assert response["status"] == 200
    assert response["headers"]["Access-Control-Allow-Origin"] == "https://jj2ya.vercel.app"


def test_factory_rejects_invalid_api_origin_before_opening_database(monkeypatch, tmp_path):
    monkeypatch.setenv("MOIM_ALLOWED_HOST", "demo.example.com")
    monkeypatch.setenv("MOIM_ALLOWED_API_ORIGINS", "*")
    monkeypatch.setenv("EATPL_SOURCE", "kskill")
    path = tmp_path / "missing.sqlite3"
    monkeypatch.setenv("MOIM_DB_PATH", str(path))
    with pytest.raises(ValueError, match="MOIM_ALLOWED_API_ORIGINS"):
        create_app()
    assert not path.exists()


def test_multiple_explicit_origins_are_still_exact(tmp_path):
    app = App(Store(str(tmp_path / "multiple.sqlite3")), SampleClient())
    wrapped = validator(create_wsgi_app(app, "demo.example.com", allowed_api_origins=
                                       "https://first.example.com, https://second.example.com"))
    for origin in ("https://first.example.com", "https://second.example.com"):
        response = call(wrapped, "/api/options", origin=origin)
        assert response["headers"]["Access-Control-Allow-Origin"] == origin
    lookalike = call(wrapped, "/api/options", origin="https://third.example.com")
    assert "Access-Control-Allow-Origin" not in lookalike["headers"]


def test_invalid_bodies_are_rejected(wsgi):
    assert call(wsgi, "/api/rooms", "POST", b"{bad")["status"] == 400
    assert call(wsgi, "/api/rooms", "POST", {}, content_type="text/plain")["status"] == 415
    assert call(wsgi, "/api/rooms", "POST", b"", content_length=str(MAX_BODY + 1))["status"] == 413
    assert call(wsgi, "/api/rooms", "POST", b"{}", content_length="3")["status"] == 400
    assert call(wsgi, "/api/rooms", "PATCH", {})["status"] == 405


def test_deployment_factory_fails_closed(monkeypatch, tmp_path):
    monkeypatch.setenv("MOIM_ALLOWED_HOST", "demo.example.com")
    monkeypatch.setenv("MOIM_DB_PATH", str(tmp_path / "test.sqlite3"))
    for source in ("", "direct", "sample", "auto"):
        monkeypatch.setenv("EATPL_SOURCE", source)
        with pytest.raises(RuntimeError, match="K-Skill"):
            create_app()
    monkeypatch.setenv("EATPL_SOURCE", "kskill")
    monkeypatch.setenv("MOIM_DB_PATH", "relative.sqlite3")
    with pytest.raises(RuntimeError, match="MOIM_DB_PATH"):
        create_app()
    monkeypatch.setenv("MOIM_DB_PATH", str(tmp_path / "test.sqlite3"))
    with pytest.raises(RuntimeError, match="existing initialized database"):
        create_app()
    assert not (tmp_path / "test.sqlite3").exists()
    initialize_new_database(str(tmp_path / "test.sqlite3"))
    response = call(validator(create_app()), "/api/options")
    assert json.loads(response["body"])["data_source"] == "kskill"


def test_deployment_refuses_incomplete_database_and_initializer_never_overwrites(monkeypatch, tmp_path):
    monkeypatch.setenv("MOIM_ALLOWED_HOST", "demo.example.com")
    monkeypatch.setenv("EATPL_SOURCE", "kskill")
    path = tmp_path / "state.sqlite3"
    monkeypatch.setenv("MOIM_DB_PATH", str(path))
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE rooms (id TEXT PRIMARY KEY)")
    with pytest.raises(RuntimeError, match="schema is incomplete"):
        create_app()
    before = path.read_bytes()
    with pytest.raises(FileExistsError):
        initialize_new_database(str(path))
    assert path.read_bytes() == before


def test_invalid_database_is_not_reinitialized(monkeypatch, tmp_path):
    monkeypatch.setenv("MOIM_ALLOWED_HOST", "demo.example.com")
    monkeypatch.setenv("EATPL_SOURCE", "kskill")
    path = tmp_path / "state.sqlite3"
    monkeypatch.setenv("MOIM_DB_PATH", str(path))
    path.write_bytes(b"not sqlite")
    with pytest.raises(RuntimeError, match="cannot be validated"):
        create_app()
    assert path.read_bytes() == b"not sqlite"


@pytest.mark.parametrize("host", ["", "https://demo.example.com", "*.example.com", "a.example.com/path"])
def test_factory_rejects_unsafe_hosts(monkeypatch, tmp_path, host):
    monkeypatch.setenv("MOIM_ALLOWED_HOST", host)
    monkeypatch.setenv("EATPL_SOURCE", "kskill")
    monkeypatch.setenv("MOIM_DB_PATH", str(tmp_path / "test.sqlite3"))
    with pytest.raises(ValueError, match="MOIM_ALLOWED_HOST"):
        create_app()
