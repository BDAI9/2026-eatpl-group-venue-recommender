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


@pytest.fixture
def wsgi(tmp_path):
    return validator(create_wsgi_app(App(Store(str(tmp_path / "test.sqlite3")), SampleClient()), "demo.example.com"))


def call(app, path, method="GET", data=None, *, host="demo.example.com", origin=None,
         content_type="application/json", content_length=None):
    environ = {}
    setup_testing_defaults(environ)
    raw = b"" if data is None else data if isinstance(data, bytes) else json.dumps(data).encode()
    environ.update(REQUEST_METHOD=method, PATH_INFO=path, QUERY_STRING="", HTTP_HOST=host,
                   CONTENT_TYPE=content_type, CONTENT_LENGTH=str(len(raw)) if content_length is None else content_length,
                   **{"wsgi.input": io.BytesIO(raw), "wsgi.errors": io.StringIO()})
    if origin is not None:
        environ["HTTP_ORIGIN"] = origin
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


def test_invalid_bodies_are_rejected(wsgi):
    assert call(wsgi, "/api/rooms", "POST", b"{bad")["status"] == 400
    assert call(wsgi, "/api/rooms", "POST", {}, content_type="text/plain")["status"] == 415
    assert call(wsgi, "/api/rooms", "POST", b"", content_length=str(MAX_BODY + 1))["status"] == 413
    assert call(wsgi, "/api/rooms", "POST", b"{}", content_length="3")["status"] == 400
    assert call(wsgi, "/api/rooms", "PATCH", {})["status"] == 405


def test_deployment_factory_fails_closed(monkeypatch, tmp_path):
    monkeypatch.setenv("MOIM_ALLOWED_HOST", "demo.example.com")
    monkeypatch.setenv("EATPL_ENV", "dev")
    monkeypatch.setenv("MOIM_DB_PATH", str(tmp_path / "test.sqlite3"))
    monkeypatch.delenv("EATPL_INSTITUTION", raising=False)
    with pytest.raises(RuntimeError, match="EATPL_INSTITUTION"):
        create_app()
    monkeypatch.setenv("EATPL_INSTITUTION", "test-institution")
    monkeypatch.setenv("EATPL_ENV", "unexpected")
    with pytest.raises(RuntimeError, match="EATPL_ENV"):
        create_app()
    monkeypatch.setenv("EATPL_ENV", "dev")
    monkeypatch.setenv("MOIM_DB_PATH", "relative.sqlite3")
    with pytest.raises(RuntimeError, match="MOIM_DB_PATH"):
        create_app()
    monkeypatch.setenv("MOIM_DB_PATH", str(tmp_path / "test.sqlite3"))
    with pytest.raises(RuntimeError, match="existing initialized database"):
        create_app()
    assert not (tmp_path / "test.sqlite3").exists()
    initialize_new_database(str(tmp_path / "test.sqlite3"))
    response = call(validator(create_app()), "/api/options")
    assert json.loads(response["body"])["data_source"] == "eatpl"


def test_deployment_refuses_incomplete_database_and_initializer_never_overwrites(monkeypatch, tmp_path):
    monkeypatch.setenv("MOIM_ALLOWED_HOST", "demo.example.com")
    monkeypatch.setenv("EATPL_ENV", "dev")
    monkeypatch.setenv("EATPL_INSTITUTION", "test-institution")
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
    monkeypatch.setenv("EATPL_ENV", "dev")
    monkeypatch.setenv("EATPL_INSTITUTION", "test-institution")
    path = tmp_path / "state.sqlite3"
    monkeypatch.setenv("MOIM_DB_PATH", str(path))
    path.write_bytes(b"not sqlite")
    with pytest.raises(RuntimeError, match="cannot be validated"):
        create_app()
    assert path.read_bytes() == b"not sqlite"


@pytest.mark.parametrize("host", ["", "https://demo.example.com", "*.example.com", "a.example.com/path"])
def test_factory_rejects_unsafe_hosts(monkeypatch, tmp_path, host):
    monkeypatch.setenv("MOIM_ALLOWED_HOST", host)
    monkeypatch.setenv("EATPL_ENV", "dev")
    monkeypatch.setenv("EATPL_INSTITUTION", "test-institution")
    monkeypatch.setenv("MOIM_DB_PATH", str(tmp_path / "test.sqlite3"))
    with pytest.raises(ValueError, match="MOIM_ALLOWED_HOST"):
        create_app()
