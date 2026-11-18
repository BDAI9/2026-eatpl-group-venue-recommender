"""Room size is enforced against real participants, including concurrent joins."""

from concurrent.futures import ThreadPoolExecutor
import sqlite3
import threading

import pytest

from moim.backup import backup_database
from moim.store import Store


def test_separate_store_instances_cannot_overfill_room(tmp_path):
    path = str(tmp_path / "rooms.sqlite3")
    owner = Store(path)
    room = owner.create_room("두 명 모임", 2)
    stores = [Store(path) for _ in range(8)]
    start = threading.Barrier(len(stores))

    def join(index):
        start.wait(timeout=5)
        try:
            stores[index].add_participant(room, {"name": f"test-{index}"})
            return True
        except ValueError as exc:
            assert "정원 2명" in str(exc)
            return False

    with ThreadPoolExecutor(max_workers=len(stores)) as pool:
        joined = list(pool.map(join, range(len(stores))))
    assert sum(joined) == 2
    assert len(owner.get_room(room)["participants"]) == 2


def test_legacy_room_retains_thirty_person_limit_and_is_independent(tmp_path):
    store = Store(str(tmp_path / "rooms.sqlite3"))
    legacy = store.create_room("기존 모임")
    other = store.create_room("다른 모임", 2)
    identities = [store.add_participant(legacy, {"name": str(i)}) for i in range(30)]
    assert store.get_room(legacy)["target_size"] is None
    with pytest.raises(ValueError, match="정원 30명"):
        store.add_participant(legacy, {"name": "31"})
    store.add_participant(other, {"name": "separate"})
    assert len(store.get_room(other)["participants"]) == 1
    assert store.delete_participant(legacy, *identities[0])
    store.add_participant(legacy, {"name": "replacement"})
    assert len(store.get_room(legacy)["participants"]) == 30


def test_database_backup_contains_room_target(tmp_path):
    source = tmp_path / "rooms.sqlite3"
    backup = tmp_path / "backup.sqlite3"
    store = Store(str(source))
    room = store.create_room("모임", 4)
    backup_database(source, backup)
    with sqlite3.connect(backup) as db:
        assert db.execute("SELECT target_size FROM room_settings WHERE room_id = ?", (room,)).fetchone() == (4,)
