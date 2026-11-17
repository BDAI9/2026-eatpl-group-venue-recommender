"""명시적 요청이 있을 때만 잇플 직접 API를 한 번 점검한다.

기관명은 환경 변수로만 받으며, 실제 조회 시 실행 중인 앱과 동일한 SQLite
저장소의 거래추적번호 순번을 사용한다. 이 도구는 가상 데이터로 대체하지 않는다.
"""
from __future__ import annotations

import argparse
from contextlib import closing
import os
from pathlib import Path
import sqlite3
import sys

from .eatpl import EatplClient, EatplError
from .store import Store


_AUTH_ERROR = "잇플 인증에 실패했어요. 기관명과 서버 IP 등록을 확인해 주세요."
_TIMEOUT_ERROR = "잇플 응답이 너무 늦어요."


def _existing_trace_database(path: Path) -> bool:
    """Check that the supplied file is an existing app DB, without creating it."""
    if not path.is_file():
        return False
    try:
        # mode=ro is important: a typo must not create a new sequence database.
        with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=ro", uri=True)) as db:
            cols = {row[1] for row in db.execute("PRAGMA table_info(trace_sequence)")}
            return {"institution", "day", "sequence"}.issubset(cols)
    except (OSError, sqlite3.Error, ValueError):
        return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="잇플 직접 API 연결 점검 (기본: 외부 호출 없음)")
    parser.add_argument("--environment", choices=("dev", "prod"), default="dev",
                        help="대상 환경 (기본 dev; prod는 별도 승인 후 명시)")
    parser.add_argument("--db", type=Path, help="앱과 공유하는 기존 SQLite DB 경로")
    parser.add_argument("--location", help="실제 조회에 사용할 지역 또는 주소")
    parser.add_argument("--live", action="store_true", help="실제 잇플 API를 한 번 호출")
    args = parser.parse_args(argv)

    institution = os.environ.get("EATPL_INSTITUTION", "").strip()
    print("점검 환경:", "개발" if args.environment == "dev" else "운영")
    print("기관명 환경 변수:", "설정됨" if institution else "설정 안 됨")
    if not args.live:
        print("외부 호출 없음. 실제 확인은 --live, --location 및 앱과 같은 --db가 필요합니다.")
        return 0
    if not institution:
        print("조회 중단: 기관명 환경 변수를 설정해야 합니다. 가상 데이터로 대체하지 않습니다.")
        return 2
    if not args.location or not args.location.strip() or len(args.location) > 120:
        print("조회 중단: 120자 이내의 조회 지역을 --location으로 지정해 주세요.")
        return 2
    if args.db is None or not _existing_trace_database(args.db):
        print("조회 중단: 앱과 공유하는 기존 SQLite DB를 --db로 지정해 주세요.")
        print("새 DB를 만들면 거래추적번호가 중복될 수 있습니다.")
        return 2
    try:
        store = Store(str(args.db.resolve()))
        client = EatplClient(institution, store.next_trace_number, prod=args.environment == "prod")
        places = client.search(args.location.strip())
    except EatplError as exc:
        # Never echo arbitrary response codes or network exception contents.
        if str(exc) == _AUTH_ERROR:
            print("조회 실패: 기관명과 이 서버의 등록된 공인 출발 IP를 확인해 주세요.")
        elif str(exc) == _TIMEOUT_ERROR:
            print("조회 실패: 잇플 응답 시간이 초과되었습니다.")
        else:
            print("조회 실패: 잇플 연결 또는 응답 상태를 확인해 주세요.")
        return 1
    except (OSError, sqlite3.Error, ValueError):
        print("조회 실패: 공유 DB와 거래추적번호 상태를 확인해 주세요.")
        return 1
    print(f"잇플 조회 성공: {len(places)}건, 상세 링크 {sum(bool(p.get('eatpl_url')) for p in places)}건")
    if not places:
        print("응답은 성공했으나 표시 가능한 가맹점이 없습니다. 조회 지역을 확인해 주세요.")
    if len(places) >= 100:
        print("최대 조회 건수에 도달했을 수 있어 전체 결과가 아닐 수 있습니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
