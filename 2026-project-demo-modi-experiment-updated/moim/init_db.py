"""Explicitly initialize one brand-new persistent database; never overwrite."""
from __future__ import annotations

import argparse
import os
from pathlib import Path

from .store import Store


def initialize_new_database(path: str) -> None:
    target = Path(path)
    if not target.is_absolute():
        raise ValueError("database path must be absolute")
    # O_EXCL is essential: this operation is not an upgrade or restoration.
    descriptor = os.open(target, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(descriptor)
    Store(str(target))


def main() -> None:
    parser = argparse.ArgumentParser(description="Initialize only a brand-new Moim database")
    parser.add_argument("--path", required=True, help="absolute path to a new database file")
    parser.add_argument("--confirm-first-deployment", action="store_true", required=True,
                        help="confirm no earlier deployment or sequence needs to be restored")
    args = parser.parse_args()
    try:
        initialize_new_database(args.path)
    except (OSError, ValueError) as exc:
        parser.error(str(exc))
    print("New database initialized. Do not use this command to restore an earlier deployment.")


if __name__ == "__main__":
    main()
