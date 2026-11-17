"""Exercise consistent backups and failure safety using disposable databases."""

import os
import sqlite3
import threading
from contextlib import closing

import pytest

from moim.backup import BackupError, backup_database, main
from moim.store import Store


def test_backup_restores_room_and_sequences_without_printing_contents(tmp_path, capsys):
    source, target = tmp_path / "app.sqlite3", tmp_path / "backup.sqlite3"
    store = Store(str(source))
    room = store.create_room("개인 모임")
    store.add_participant(room, {"name": "참여자", "allergies": ["땅콩"]})
    # Legacy sequence data must survive backups even though K-Skill doesn't use it.
    with sqlite3.connect(source) as db:
        db.execute("INSERT INTO trace_sequence VALUES (?, ?, ?)", ("demo", "20261117", 1))
    assert main([str(source), str(target)]) == 0
    captured = capsys.readouterr()
    assert "땅콩" not in captured.out and "demo" not in captured.out
    assert "순번" in captured.out and "복원" in captured.out
    assert Store(str(target)).get_room(room) == store.get_room(room)
    with closing(sqlite3.connect(target)) as db:
        assert db.execute("SELECT sequence FROM trace_sequence").fetchone()[0] == 1
        assert db.execute("PRAGMA quick_check").fetchone() == ("ok",)
    if os.name == "posix":
        assert target.stat().st_mode & 0o777 == 0o600


def test_missing_source_does_not_create_db_or_target(tmp_path):
    source, target = tmp_path / "absent.sqlite3", tmp_path / "backup.sqlite3"
    with pytest.raises(BackupError):
        backup_database(source, target)
    assert not source.exists() and not target.exists()


def test_existing_destination_and_source_are_never_overwritten(tmp_path):
    source, target = tmp_path / "app.sqlite3", tmp_path / "backup.sqlite3"
    store = Store(str(source))
    room = store.create_room("x")
    target.write_bytes(b"keep")
    with pytest.raises(BackupError):
        backup_database(source, target)
    assert target.read_bytes() == b"keep"
    with pytest.raises(BackupError):
        backup_database(source, source)
    assert store.get_room(room)["title"] == "x"


def test_unrelated_database_and_missing_directory_are_rejected(tmp_path):
    source, target = tmp_path / "unrelated.sqlite3", tmp_path / "backup.sqlite3"
    with closing(sqlite3.connect(source)) as db:
        db.execute("CREATE TABLE unrelated (id INTEGER)")
    with pytest.raises(BackupError):
        backup_database(source, target)
    assert not target.exists() and not list(tmp_path.glob(".moim-backup-*"))
    app = tmp_path / "app.sqlite3"
    Store(str(app))
    with pytest.raises(BackupError):
        backup_database(app, tmp_path / "missing" / "backup.sqlite3")
    assert not (tmp_path / "missing").exists()


def test_destination_created_during_backup_is_not_overwritten(tmp_path, monkeypatch):
    source, target = tmp_path / "app.sqlite3", tmp_path / "backup.sqlite3"
    Store(str(source))
    real_link = os.link

    def concurrent_create(temp, destination):
        target.write_bytes(b"another process")
        return real_link(temp, destination)

    monkeypatch.setattr("moim.backup.os.link", concurrent_create)
    with pytest.raises(BackupError):
        backup_database(source, target)
    assert target.read_bytes() == b"another process"
    assert not list(tmp_path.glob(".moim-backup-*"))


def test_snapshot_stays_consistent_during_concurrent_writes(tmp_path):
    source, target = tmp_path / "app.sqlite3", tmp_path / "backup.sqlite3"
    Store(str(source))
    with closing(sqlite3.connect(source)) as db:
        db.execute("CREATE TABLE snapshot_probe (a INTEGER, b INTEGER)")
        db.execute("INSERT INTO snapshot_probe VALUES (0, 0)")
        db.commit()
    running = threading.Event()
    stopped = threading.Event()

    def writer():
        with closing(sqlite3.connect(source, timeout=10)) as db:
            running.set()
            while not stopped.is_set():
                with db:
                    db.execute("UPDATE snapshot_probe SET a=a+1")
                    db.execute("UPDATE snapshot_probe SET b=b+1")

    thread = threading.Thread(target=writer, daemon=True)
    thread.start()
    assert running.wait(5)
    try:
        backup_database(source, target)
    finally:
        stopped.set()
        thread.join(timeout=10)
    assert not thread.is_alive()
    with closing(sqlite3.connect(target)) as db:
        a, b = db.execute("SELECT a, b FROM snapshot_probe").fetchone()
        assert a == b
