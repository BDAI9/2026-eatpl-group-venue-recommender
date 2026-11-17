"""Create a consistent snapshot of the room database without overwriting files.

The snapshot contains participant data, edit tokens, and legacy trace sequences.
Restoring it must be deliberate. If a direct API is reintroduced in the future,
an older trace sequence must not be reused without checking its high-water mark.
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import sys
import tempfile
from contextlib import closing
from pathlib import Path


class BackupError(Exception):
    """A safe, user-facing backup failure."""


_TABLES = {"rooms", "participants", "trace_sequence", "estimates"}


def backup_database(source: str | Path, destination: str | Path) -> None:
    """Snapshot an existing room DB and atomically publish a new backup file.

    SQLite's online backup API copies a consistent snapshot while other
    connections may be working. The source is opened read-only and an existing
    destination is never replaced. The temporary file is in the destination
    directory so that a hard link can publish it atomically without overwrites.
    """
    try:
        src = Path(source).expanduser().resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise BackupError("원본 DB를 찾을 수 없습니다. 경로를 확인해 주세요.") from exc
    if not src.is_file():
        raise BackupError("원본 DB 파일을 확인해 주세요.")

    target = Path(destination).expanduser().absolute()
    if os.path.lexists(target):
        raise BackupError("대상 파일이 이미 있습니다. 다른 이름을 지정해 주세요.")
    if not target.parent.is_dir():
        raise BackupError("대상 폴더를 먼저 만들어 주세요.")
    temporary: Path | None = None
    try:
        # mkstemp uses O_EXCL and creates owner-readable/writable files only on
        # POSIX. Windows inherits directory ACLs; the directory must be private.
        fd, temp_name = tempfile.mkstemp(prefix=".moim-backup-", suffix=".tmp", dir=target.parent)
        temporary = Path(temp_name)
        os.close(fd)
        if os.name == "posix":
            os.chmod(temporary, 0o600)
        with closing(sqlite3.connect(src.as_uri() + "?mode=ro", uri=True, timeout=10)) as original:
            tables = {row[0] for row in original.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'")}
            if not _TABLES <= tables:
                raise BackupError("원본이 모임 앱 DB인지 확인해 주세요.")
            with closing(sqlite3.connect(str(temporary), timeout=10)) as snapshot:
                original.backup(snapshot)
                if snapshot.execute("PRAGMA quick_check").fetchone() != ("ok",):
                    raise BackupError("백업 무결성을 확인하지 못했습니다.")
        # Atomic exclusive creation: link never replaces a concurrently created
        # destination. Both files are on the same filesystem by construction.
        os.link(temporary, target)
    except BackupError:
        raise
    except FileExistsError as exc:
        raise BackupError("대상 파일이 이미 있습니다. 다른 이름을 지정해 주세요.") from exc
    except (OSError, sqlite3.Error) as exc:
        raise BackupError("백업에 실패했습니다. DB 상태와 대상 폴더 권한을 확인해 주세요.") from exc
    finally:
        if temporary is not None:
            try:
                temporary.unlink(missing_ok=True)
            except OSError:
                # A failed cleanup leaves only the owner-readable temporary
                # file. It must be handled as sensitively as the database.
                print("임시 백업 파일을 지우지 못했습니다. 백업 폴더의 .moim-backup-* 파일을 확인해 주세요.",
                      file=sys.stderr)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="모임 DB를 새 파일로 일관성 있게 백업합니다.")
    parser.add_argument("source", help="기존 모임 DB 파일")
    parser.add_argument("destination", help="아직 존재하지 않는 백업 파일")
    args = parser.parse_args(argv)
    try:
        backup_database(args.source, args.destination)
    except BackupError as exc:
        parser.exit(1, f"백업 실패: {exc}\n")
    print("백업을 만들었습니다. 참가자 정보가 포함되므로 접근을 제한해 주세요.")
    print("복원은 신중히 진행하세요. 과거 직접 API를 다시 사용할 경우 거래번호 순번을 확인해야 합니다.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
