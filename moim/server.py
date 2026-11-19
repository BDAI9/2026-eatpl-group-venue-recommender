"""모임 장소 추천 서버.  실행: python -m moim  (같은 와이파이 공유: python -m moim --lan)

표준 라이브러리만 사용한다. 설정은 환경 변수 또는 저장소 루트의 .env 파일에서 읽는다.
"""

from __future__ import annotations

import argparse
import json
import os
import time
import re
import socket
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from . import options
from .eatpl import EatplError, make_client
from .recommend import recommend, summarize
from .store import Store

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
MAX_BODY = 16_384
STATIC = {
    "/": ("index.html", "text/html"),
    "/static/v2.css": ("v2.css", "text/css"),
    "/static/v2-landing.js": ("v2-landing.js", "text/javascript"),
    "/static/v2.js": ("v2.js", "text/javascript"),
    "/static/og.png": ("og.png", "image/png"),  # 카카오톡 등 링크 미리보기 썸네일
    "/static/icon.png": ("icon.png", "image/png"),
}
ROOM_RE = re.compile(r"^/api/rooms/([A-Za-z0-9_-]{4,20})(/participants(?:/([A-Za-z0-9_-]{4,20}))?|/recommend)?$")


def load_dotenv(path: Path = ROOT / ".env") -> None:
    """간단한 .env 읽기: KEY=VALUE 줄만. 이미 설정된 환경 변수는 덮어쓰지 않는다."""
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def _public(room: dict) -> dict:
    # region·place_type: 방장이 고정한 값 (예전 방은 None). 방장 토큰은 절대 내보내지 않는다.
    return {"id": room["id"], "title": room["title"], "target_size": room["target_size"],
            "region": room.get("region"), "place_type": room.get("place_type"),
            "participants": room["participants"], "summary": summarize(room["participants"])}


def _with_room_fixed(room: dict, payload):
    """방장이 지역·업종을 정한 방이면 참여자 입력의 지역·업종을 방 값으로 맞춘다 (참여자가 바꿀 수 없음)."""
    if not isinstance(payload, dict):
        return payload
    payload = dict(payload)
    if room.get("region"):
        payload["region"] = room["region"]
    if room.get("place_type"):
        payload["place_type"] = room["place_type"]
    return payload


class App:
    def __init__(self, store: Store, client=None):
        self.store = store
        self.client = client or make_client(store)

    def handle(self, method: str, path: str, body):
        if method == "GET" and path == "/api/options":
            return 200, {**options.catalog(), "data_source": self.client.source}
        if method == "POST" and path == "/api/regions/check":
            return 200, self.check_region(body.get("region") if isinstance(body, dict) else None)
        if method == "POST" and path == "/api/rooms":
            if not isinstance(body, dict) or set(body) - {"title", "target_size", "region", "place_type"}:
                raise ValueError("입력 형식이 올바르지 않아요.")
            title = (body.get("title") or "").strip() or "우리 모임"
            if len(title) > 40:
                raise ValueError("모임 이름은 40자 이내로 입력해 주세요.")
            target_size = body.get("target_size")
            region = options.check_region_text(body["region"]) if body.get("region") is not None else None
            place_type = body.get("place_type")
            if place_type is not None and place_type not in options.PLACE_TYPES:
                raise ValueError("카페·식당·술집 중 하나를 골라 주세요.")
            room_id, host_token = self.store.create_hosted_room(title, target_size, region=region, place_type=place_type)
            return 201, {"id": room_id, "target_size": target_size, "region": region, "place_type": place_type,
                         "host_token": host_token}

        m = ROOM_RE.match(path)
        if not m:
            return 404, {"message": "요청 경로를 찾을 수 없어요."}
        room_id, sub, pid = m.group(1), m.group(2), m.group(3)
        room = self.store.get_room(room_id)
        if room is None:
            return 404, {"message": "모임을 찾을 수 없어요. 링크를 확인해 주세요."}

        if sub is None and method == "GET":
            return 200, _public(room)
        if sub is None and method == "DELETE":  # 방장만: 방과 모든 응답을 지운다
            token = body.get("host_token") if isinstance(body, dict) else None
            if not isinstance(token, str) or not self.store.delete_room(room_id, token):
                return 403, {"message": "방장만 모임을 초기화할 수 있어요."}
            return 200, {"ok": True}
        if sub == "/participants" and method == "POST":
            data = options.validate_preference(_with_room_fixed(room, body))
            new_id, token = self.store.add_participant(room_id, data)
            return 201, {"id": new_id, "token": token}
        if pid and method in ("PUT", "DELETE"):
            token = body.get("token") if isinstance(body, dict) else None
            if not isinstance(token, str):
                return 403, {"message": "수정 권한이 없어요."}
            if method == "DELETE":
                ok = self.store.delete_participant(room_id, pid, token)
            else:
                data = options.validate_preference(_with_room_fixed(room, {k: v for k, v in body.items() if k != "token"}))
                ok = self.store.update_participant(room_id, pid, token, data)
            return (200, {"ok": True}) if ok else (403, {"message": "수정 권한이 없어요."})
        if sub == "/recommend" and method == "POST":
            body = body if isinstance(body, dict) else {}
            # 방장이 정한 지역·업종이 있으면 그 값으로만 추천한다
            region = room.get("region") or body.get("region")
            place_type = room.get("place_type") or body.get("place_type")
            if region is not None and (not isinstance(region, str) or len(region) > options.MAX_CUSTOM):
                raise ValueError("지역을 확인해 주세요.")
            return 200, recommend(room["participants"], self.client, self.store,
                                  region=region, place_type=place_type, background=True)
        return 405, {"message": "지원하지 않는 요청이에요."}


_REGION_CACHE: dict = {}


def _check_region(self, value) -> dict:
    """형식 검사 후 실제로 가게가 검색되는 지역인지 확인한다 (결과는 프로세스 안에 잠시 저장)."""
    region = options.check_region_text(value)
    if region in options.REGIONS:
        return {"ok": True, "region": region}
    cached = _REGION_CACHE.get(region)
    if cached and time.time() - cached[1] < 3600:
        found = cached[0]
    else:
        try:
            found = len(self.client.search(region)) > 0
        except EatplError:
            # 검색 서비스 장애로 막지는 않는다 (결과 화면에서 다시 안내)
            return {"ok": True, "region": region, "warning": "지역 확인을 하지 못했어요. 그대로 진행할게요."}
        _REGION_CACHE[region] = (found, time.time())
    if not found:
        raise ValueError(f"'{region}'에서 가게를 찾지 못했어요. 동·역 이름으로 입력해 주세요. 예: 성수동, 강남역")
    return {"ok": True, "region": region}


App.check_region = _check_region


def make_handler(app: App):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):  # 터미널에 개인 입력이 남지 않게
            pass

        def _send(self, status, content: bytes, ctype: str):
            self.send_response(status)
            self.send_header("Content-Type", ctype + "; charset=utf-8")
            self.send_header("Content-Length", str(len(content)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
            self.end_headers()
            self.wfile.write(content)

        def _json(self, status, value):
            self._send(status, json.dumps(value, ensure_ascii=False).encode("utf-8"), "application/json")

        def do_GET(self):
            path = urlsplit(self.path).path
            if path.startswith("/r/"):
                path = "/room"
            if path == "/room":
                return self._send(200, (WEB / "room.html").read_bytes(), "text/html")
            if path in STATIC:
                name, ctype = STATIC[path]
                return self._send(200, (WEB / name).read_bytes(), ctype)
            self._dispatch("GET", path, None)

        def _with_body(self, method):
            if self.headers.get_content_type() != "application/json":
                return self._json(415, {"message": "JSON 요청이 필요해요."})
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if size > MAX_BODY:
                    return self._json(413, {"message": "입력이 너무 커요."})
                body = json.loads(self.rfile.read(size)) if size else {}
            except (ValueError, UnicodeDecodeError):
                return self._json(400, {"message": "요청을 읽지 못했어요."})
            self._dispatch(method, urlsplit(self.path).path, body)

        def do_POST(self):
            self._with_body("POST")

        def do_PUT(self):
            self._with_body("PUT")

        def do_DELETE(self):
            self._with_body("DELETE")

        def _dispatch(self, method, path, body):
            try:
                status, value = app.handle(method, path, body)
            except ValueError as e:
                status, value = 400, {"message": str(e)}
            except Exception:
                status, value = 500, {"message": "서버 오류가 났어요. 잠시 후 다시 시도해 주세요."}
            self._json(status, value)

    return Handler


def lan_ip() -> str | None:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))
            return s.getsockname()[0]
    except OSError:
        return None


def main() -> None:
    parser = argparse.ArgumentParser(description="모임 장소 추천 서버")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--lan", action="store_true", help="같은 와이파이의 다른 기기에서도 접속 허용")
    parser.add_argument("--db", default=str(ROOT / "moim.sqlite3"))
    args = parser.parse_args()
    load_dotenv()
    app = App(Store(args.db))
    host = "0.0.0.0" if args.lan else "127.0.0.1"
    server = ThreadingHTTPServer((host, args.port), make_handler(app))
    data_label = {"kskill": "K-Skill 프록시", "sample": "샘플(가상 가게)"}
    print(f"데이터: {data_label.get(app.client.source, '알 수 없음')}"
          f" · AI 추정: {'켜짐' if os.getenv('OPENROUTER_API_KEY') else '꺼짐(키 없음)'}")
    print(f"이 컴퓨터에서 열기: http://127.0.0.1:{args.port}/")
    if args.lan and lan_ip():
        print(f"같은 와이파이의 친구들은: http://{lan_ip()}:{args.port}/")
    print("끄려면 Ctrl+C")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
