"""SQLite 저장소: 모임방, 참여자와 AI 추정 캐시."""

from __future__ import annotations

import json
import secrets
import sqlite3
import threading
import time
from contextlib import contextmanager

from .options import MAX_PARTICIPANTS

_SCHEMA = """
CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at REAL NOT NULL);
-- Keep optional settings separate so older databases and older app versions
-- continue to read the original rooms table without destructive migration.
CREATE TABLE IF NOT EXISTS room_settings (
    room_id TEXT PRIMARY KEY, target_size INTEGER NOT NULL CHECK (target_size BETWEEN 2 AND 30));
-- 방장이 정한 지역·업종과 방장 권한 토큰 (방 초기화용). 예전 방에는 행이 없을 수 있다.
CREATE TABLE IF NOT EXISTS room_meta (
    room_id TEXT PRIMARY KEY, region TEXT, place_type TEXT, host_token TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL, token TEXT NOT NULL,
    data TEXT NOT NULL, updated_at REAL NOT NULL);
CREATE INDEX IF NOT EXISTS participants_room ON participants(room_id);
CREATE TABLE IF NOT EXISTS trace_sequence (
    institution TEXT NOT NULL, day TEXT NOT NULL, sequence INTEGER NOT NULL,
    PRIMARY KEY (institution, day));
CREATE TABLE IF NOT EXISTS estimates (
    place_id TEXT NOT NULL, allergens TEXT NOT NULL, data TEXT NOT NULL, created_at REAL NOT NULL,
    PRIMARY KEY (place_id, allergens));
"""


class RoomNotFound(ValueError):
    """The room no longer exists when a participant tries to join."""


class Store:
    def __init__(self, path: str = "moim.sqlite3"):
        self.path = path
        self._lock = threading.Lock()
        with self._db() as db:
            db.executescript(_SCHEMA)

    @contextmanager
    def _db(self):
        db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        try:
            yield db
        finally:
            db.close()

    # ---- 방 ----
    def create_room(self, title: str, target_size: int | None = None) -> str:
        return self._create_room(title, target_size)

    def _create_room(self, title: str, target_size: int | None, *, host_token: str | None = None,
                     region: str | None = None, place_type: str | None = None) -> str:
        if target_size is not None and (type(target_size) is not int or not 2 <= target_size <= MAX_PARTICIPANTS):
            raise ValueError(f"모임 인원은 2명부터 {MAX_PARTICIPANTS}명까지 선택해 주세요.")
        room_id = secrets.token_urlsafe(6)
        with self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                db.execute("INSERT INTO rooms (id, title, created_at) VALUES (?, ?, ?)", (room_id, title, time.time()))
                if target_size is not None:
                    db.execute("INSERT INTO room_settings (room_id, target_size) VALUES (?, ?)", (room_id, target_size))
                if host_token is not None:
                    db.execute("INSERT INTO room_meta (room_id, region, place_type, host_token) VALUES (?, ?, ?, ?)",
                               (room_id, region, place_type, host_token))
                db.execute("COMMIT")
            except BaseException:
                db.execute("ROLLBACK")
                raise
        return room_id

    def create_hosted_room(self, title: str, target_size: int | None = None, *,
                           region: str | None = None, place_type: str | None = None) -> tuple[str, str]:
        """방장이 지역·업종을 정해 만든 방. (방 id, 방장 토큰)을 돌려준다."""
        host_token = secrets.token_urlsafe(16)
        room_id = self._create_room(title, target_size, host_token=host_token, region=region, place_type=place_type)
        return room_id, host_token

    def delete_room(self, room_id: str, host_token: str) -> bool:
        """방장 토큰이 맞으면 방과 참여자 응답을 모두 지운다."""
        with self._lock, self._db() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                ok = db.execute("SELECT 1 FROM room_meta WHERE room_id = ? AND host_token = ?",
                                (room_id, host_token)).fetchone()
                if ok:
                    for table, col in (("participants", "room_id"), ("room_settings", "room_id"),
                                       ("room_meta", "room_id"), ("rooms", "id")):
                        db.execute(f"DELETE FROM {table} WHERE {col} = ?", (room_id,))
                db.execute("COMMIT")
            except BaseException:
                db.execute("ROLLBACK")
                raise
        return bool(ok)

    def get_room(self, room_id: str):
        with self._db() as db:
            row = db.execute("SELECT r.id, r.title, s.target_size, m.region, m.place_type FROM rooms r "
                             "LEFT JOIN room_settings s ON s.room_id = r.id "
                             "LEFT JOIN room_meta m ON m.room_id = r.id WHERE r.id = ?", (room_id,)).fetchone()
            if not row:
                return None
            people = db.execute(
                "SELECT id, data FROM participants WHERE room_id = ? ORDER BY updated_at", (room_id,)).fetchall()
        return {"id": row[0], "title": row[1], "target_size": row[2], "region": row[3], "place_type": row[4],
                "participants": [dict(json.loads(d), id=pid) for pid, d in people]}

    # ---- 참여자 ----
    def add_participant(self, room_id: str, data: dict) -> tuple[str, str]:
        with self._lock, self._db() as db:
            # SQLite's write transaction also serializes separate Store
            # instances, so two simultaneous joins cannot exceed capacity.
            db.execute("BEGIN IMMEDIATE")
            try:
                if db.execute("SELECT 1 FROM rooms WHERE id = ?", (room_id,)).fetchone() is None:
                    raise RoomNotFound("모임을 찾을 수 없어요. 링크를 확인해 주세요.")
                setting = db.execute("SELECT target_size FROM room_settings WHERE room_id = ?", (room_id,)).fetchone()
                limit = setting[0] if setting else MAX_PARTICIPANTS
                count = db.execute("SELECT COUNT(*) FROM participants WHERE room_id = ?", (room_id,)).fetchone()[0]
                if count >= limit:
                    raise ValueError(f"이 모임은 정원 {limit}명을 모두 채웠어요.")
                pid, token = secrets.token_urlsafe(6), secrets.token_urlsafe(16)
                db.execute("INSERT INTO participants VALUES (?, ?, ?, ?, ?)",
                           (pid, room_id, token, json.dumps(data, ensure_ascii=False), time.time()))
                db.execute("COMMIT")
            except BaseException:
                db.execute("ROLLBACK")
                raise
        return pid, token

    def update_participant(self, room_id: str, pid: str, token: str, data: dict) -> bool:
        with self._db() as db:
            cur = db.execute(
                "UPDATE participants SET data = ?, updated_at = ? WHERE id = ? AND room_id = ? AND token = ?",
                (json.dumps(data, ensure_ascii=False), time.time(), pid, room_id, token))
        return cur.rowcount == 1

    def delete_participant(self, room_id: str, pid: str, token: str) -> bool:
        with self._db() as db:
            cur = db.execute("DELETE FROM participants WHERE id = ? AND room_id = ? AND token = ?",
                             (pid, room_id, token))
        return cur.rowcount == 1

    # ---- AI 추정 캐시 ----
    def get_estimates(self, place_ids: list[str], allergens: list[str]) -> dict:
        key = json.dumps(sorted(allergens), ensure_ascii=False)
        out = {}
        with self._db() as db:
            for pid in place_ids:
                row = db.execute("SELECT data FROM estimates WHERE place_id = ? AND allergens = ?",
                                 (pid, key)).fetchone()
                if row:
                    out[pid] = json.loads(row[0])
        return out

    def save_estimates(self, estimates: dict, allergens: list[str]) -> None:
        key = json.dumps(sorted(allergens), ensure_ascii=False)
        with self._db() as db:
            for pid, data in estimates.items():
                db.execute("INSERT OR REPLACE INTO estimates VALUES (?, ?, ?, ?)",
                           (pid, key, json.dumps(data, ensure_ascii=False), time.time()))
