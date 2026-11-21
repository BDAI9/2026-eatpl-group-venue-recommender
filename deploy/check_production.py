"""Read-only preflight for the BDAI9 production frontend and API.

Never creates rooms, writes participant information, or prints credentials.
Run locally or in CI:
    python deploy/check_production.py
"""
from __future__ import annotations

import json
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

API = "https://jj-moim.amazonlightsail.com"
FRONTEND = "https://jj2ya.vercel.app"
TIMEOUT = 9


def fetch(path: str, *, method: str = "GET", headers: dict | None = None):
    req = Request(API + path, method=method, headers=headers or {})
    try:
        with urlopen(req, timeout=TIMEOUT) as res:
            content = res.read(256_000)
            return res.status, dict(res.headers), content
    except HTTPError as exc:
        return exc.code, dict(exc.headers), b""


def main() -> int:
    problems = []
    try:
        status, _, body = fetch("/healthz")
        health = json.loads(body) if status == 200 else {}
        if status == 200 and health.get("status") == "ok":
            print("PASS backend /healthz")
        else:
            problems.append(f"backend /healthz: HTTP {status} or invalid status")
    except (URLError, TimeoutError, ValueError, OSError) as exc:
        problems.append(f"backend /healthz: {type(exc).__name__}")

    try:
        status, _, body = fetch("/api/options")
        options = json.loads(body) if status == 200 else {}
        # Never print response body: the public Kakao JavaScript key may be present.
        if status == 200 and options.get("data_source") == "kskill":
            print("PASS backend /api/options (K-Skill)")
        else:
            problems.append(f"backend /api/options: HTTP {status} or non-K-Skill mode")
    except (URLError, TimeoutError, ValueError, OSError) as exc:
        problems.append(f"backend /api/options: {type(exc).__name__}")

    try:
        status, headers, _ = fetch(
            "/api/rooms",
            method="OPTIONS",
            headers={
                "Origin": FRONTEND,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        allow_origin = next(
            (v for k, v in headers.items() if k.lower() == "access-control-allow-origin"), None
        )
        if status == 204 and allow_origin == FRONTEND:
            print("PASS CORS preflight for Vercel -> Lightsail")
        else:
            problems.append(f"CORS preflight: HTTP {status}, origin {'allowed' if allow_origin == FRONTEND else 'not allowed'}")
    except (URLError, TimeoutError, OSError) as exc:
        problems.append(f"CORS preflight: {type(exc).__name__}")

    try:
        req = Request(FRONTEND + "/", headers={"Accept": "text/html"})
        with urlopen(req, timeout=TIMEOUT) as res:
            if res.status == 200 and "text/html" in res.headers.get("Content-Type", ""):
                print("PASS Vercel frontend HTML")
            else:
                problems.append(f"Vercel frontend HTML: HTTP {res.status}")
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        problems.append(f"Vercel frontend HTML: {type(exc).__name__}")

    for problem in problems:
        print("FAIL " + problem)
    if problems:
        print(f"Production read-only preflight: {len(problems)} issue(s); deployment NOT verified")
        return 1
    print("Production read-only preflight: 4 checks passed")
    print("NOTE: does not validate create/join/share, real merchant details, or server commit")
    return 0


if __name__ == "__main__":
    sys.exit(main())
