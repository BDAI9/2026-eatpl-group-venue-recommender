"""Production-server adapter for the existing room application.

Run this factory behind a TLS reverse proxy, with one Gunicorn worker.  This
does not by itself make the application safe for public use; see the deployment
checklist. Unlike the local demonstration server, it refuses sample data and
requires an allowed live source and persistent-database configuration.
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
from http import HTTPStatus
from pathlib import Path
from urllib.parse import urlsplit

from .server import App, MAX_BODY, STATIC, WEB
from .store import Store


def _hostname(value: str) -> str:
    """Accept one DNS host, not a URL, wildcard, port, or a list of hosts."""
    value = value.strip().lower()
    if (len(value) > 253 or not re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", value)
            or ".." in value):
        raise ValueError("MOIM_ALLOWED_HOST must be a single hostname")
    return value


def _matches_authority(authority: str, host: str) -> bool:
    # Browser Host may include the default HTTPS port. A proxy must preserve
    # the original Host, rather than forward an arbitrary client header.
    return authority.lower() in (host, host + ":443")


def create_wsgi_app(app: App, allowed_host: str):
    allowed_host = _hostname(allowed_host)

    def application(environ, start_response):
        def respond(status: int, body: bytes, content_type: str):
            headers = [("Content-Type", content_type + "; charset=utf-8"),
                       ("Content-Length", str(len(body))), ("Cache-Control", "no-store"),
                       ("X-Content-Type-Options", "nosniff"),
                       ("Referrer-Policy", "strict-origin-when-cross-origin")]
            start_response(f"{status} {HTTPStatus(status).phrase}", headers)
            return [body]

        def respond_json(status: int, body):
            return respond(status, json.dumps(body, ensure_ascii=False).encode("utf-8"), "application/json")

        if not _matches_authority(environ.get("HTTP_HOST", ""), allowed_host):
            return respond_json(400, {"message": "허용되지 않은 호스트입니다."})
        method = environ.get("REQUEST_METHOD", "GET").upper()
        path = environ.get("PATH_INFO", "")
        if method in ("POST", "PUT", "DELETE"):
            origin = environ.get("HTTP_ORIGIN")
            if origin:
                try:
                    parsed = urlsplit(origin)
                    valid_origin = (parsed.scheme == "https" and
                                    _matches_authority(parsed.netloc, allowed_host) and
                                    not parsed.path and not parsed.query and not parsed.fragment)
                except ValueError:
                    valid_origin = False
                if not valid_origin:
                    return respond_json(403, {"message": "허용되지 않은 요청입니다."})
        if method == "GET":
            if path == "/healthz":
                # No external calls, credentials, or participant data.
                return respond_json(200, {"status": "ok"})
            if path.startswith("/r/"):
                path = "/room"
            if path == "/room" or path in STATIC:
                name, content_type = ("room.html", "text/html") if path == "/room" else STATIC[path]
                try:
                    return respond(200, (WEB / name).read_bytes(), content_type)
                except OSError:
                    return respond_json(503, {"message": "화면을 불러오지 못했어요."})
            body = None
        elif method in ("POST", "PUT", "DELETE"):
            if environ.get("CONTENT_TYPE", "").split(";", 1)[0].strip().lower() != "application/json":
                return respond_json(415, {"message": "JSON 요청이 필요해요."})
            raw_size = environ.get("CONTENT_LENGTH", "")
            if not raw_size or not raw_size.isascii() or not raw_size.isdecimal() or len(raw_size) > 10:
                return respond_json(400, {"message": "요청을 읽지 못했어요."})
            size = int(raw_size)
            if size > MAX_BODY:
                return respond_json(413, {"message": "입력이 너무 커요."})
            try:
                raw = environ["wsgi.input"].read(size)
                if len(raw) != size:
                    raise ValueError("truncated body")
                body = json.loads(raw) if raw else {}
            except (ValueError, UnicodeDecodeError):
                return respond_json(400, {"message": "요청을 읽지 못했어요."})
        else:
            return respond_json(405, {"message": "지원하지 않는 요청이에요."})
        try:
            status, result = app.handle(method, path, body)
        except ValueError as exc:
            status, result = 400, {"message": str(exc)}
        except Exception:
            status, result = 500, {"message": "서버 오류가 났어요. 잠시 후 다시 시도해 주세요."}
        return respond_json(status, result)

    return application


def _validate_existing_database(db_path: str) -> None:
    """Read-only validation so missing state never silently resets sequences."""
    path = Path(db_path)
    if not path.is_file():
        raise RuntimeError("MOIM_DB_PATH must be an existing initialized database")
    required = {
        "rooms": {"id", "title", "created_at"},
        "participants": {"id", "room_id", "token", "data", "updated_at"},
        "trace_sequence": {"institution", "day", "sequence"},
        "estimates": {"place_id", "allergens", "data", "created_at"},
    }
    try:
        with sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True) as connection:
            if connection.execute("PRAGMA quick_check").fetchone() != ("ok",):
                raise RuntimeError("MOIM_DB_PATH database integrity check failed")
            tables = {r[0] for r in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
            if not required.keys() <= tables:
                raise RuntimeError("MOIM_DB_PATH database schema is incomplete")
            for table, columns in required.items():
                available = {r[1] for r in connection.execute(f"PRAGMA table_info({table})")}
                if not columns <= available:
                    raise RuntimeError("MOIM_DB_PATH database schema is incomplete")
    except sqlite3.Error as exc:
        raise RuntimeError("MOIM_DB_PATH database cannot be validated") from exc


def create_app():
    """Fail closed when public deployment config is missing or ambiguous."""
    host = _hostname(os.environ.get("MOIM_ALLOWED_HOST", ""))
    source = os.environ.get("EATPL_SOURCE", "").strip().lower()
    if source != "kskill":
        raise RuntimeError("deployment server requires explicit K-Skill mode")
    db_path = os.environ.get("MOIM_DB_PATH", "").strip()
    if not db_path or not Path(db_path).is_absolute():
        raise RuntimeError("MOIM_DB_PATH must be an absolute persistent file path")
    _validate_existing_database(db_path)
    app = App(Store(db_path))
    if app.client.source != "kskill":
        raise RuntimeError("deployment server requires actual K-Skill mode")
    return create_wsgi_app(app, host)
