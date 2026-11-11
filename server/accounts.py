"""Accounts and sync storage for Squiggly Note.

People sign in with an email and password, or with Google. Each signed-in
browser gets a random session token; only its SHA-256 is stored, so a copy of
the database does not let anyone sign in.

Synced data is one JSON document per person per collection (notes, to-dos,
chats, settings), each with a version number. A browser must say which version
its change is based on; if another device saved first, it gets the newer copy
back, merges, and tries again, so two devices never silently overwrite each
other. Recordings are files on disk with their details in the database.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any

import httpx

DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).resolve().parent / "data"))
DB_PATH = DATA_DIR / "accounts.db"
AUDIO_DIR = DATA_DIR / "audio"
# The OAuth client the site's "Continue with Google" button uses.
GOOGLE_CLIENT_ID = os.getenv(
    "GOOGLE_CLIENT_ID", "52788138271-h7kenp1gibepd167jcrdodntk7tjrmvp.apps.googleusercontent.com")
COLLECTIONS = {"notes", "todos", "chats", "prefs"}
MAX_DOC_BYTES = 5_000_000
MAX_AUDIO_BYTES = 100_000_000
SESSION_SECONDS = 90 * 24 * 3600
EMAIL = re.compile(r"[^\s@]+@[^\s@]+\.[^\s@]+")
AUDIO_ID = re.compile(r"[A-Za-z0-9-]{1,64}")

_write_lock = threading.Lock()


class AccountError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


# --------------------------------------------------------------------------- database
def _db() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    return db


def init() -> None:
    with _write_lock, _db() as db:
        db.execute("PRAGMA journal_mode=WAL")
        db.executescript("""
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '',
                password TEXT, google_sub TEXT UNIQUE, created INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, created INTEGER NOT NULL,
                last_used INTEGER NOT NULL);
            CREATE TABLE IF NOT EXISTS docs (
                user_id TEXT NOT NULL, collection TEXT NOT NULL, version INTEGER NOT NULL,
                data TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY (user_id, collection));
            CREATE TABLE IF NOT EXISTS audio (
                user_id TEXT NOT NULL, id TEXT NOT NULL, name TEXT NOT NULL, file_name TEXT NOT NULL,
                created INTEGER NOT NULL, updated INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0,
                size INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (user_id, id));
        """)


def _public(user: sqlite3.Row) -> dict[str, Any]:
    return {"id": user["id"], "email": user["email"], "name": user["name"],
            "google": bool(user["google_sub"]), "password": bool(user["password"])}


# --------------------------------------------------------------------------- passwords
def _hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=2 ** 14, r=8, p=1, dklen=32)
    return "scrypt$" + base64.b64encode(salt).decode() + "$" + base64.b64encode(digest).decode()


def _check_password(password: str, stored: str | None) -> bool:
    # Hash something even for unknown emails, so timing does not reveal which emails exist.
    stored = stored or "scrypt$" + base64.b64encode(b"0" * 16).decode() + "$"
    _, salt, digest = stored.split("$")
    actual = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt), n=2 ** 14, r=8, p=1, dklen=32)
    return bool(digest) and hmac.compare_digest(actual, base64.b64decode(digest))


_failures: dict[str, list[float]] = {}


def _throttle(*keys: str) -> None:
    now = time.time()
    for key in keys:
        recent = [t for t in _failures.get(key, []) if now - t < 900]
        _failures[key] = recent
        if len(recent) >= 10:
            raise AccountError(429, "Too many sign-in attempts. Wait 15 minutes and try again.")


def _failed(*keys: str) -> None:
    for key in keys:
        _failures.setdefault(key, []).append(time.time())


# --------------------------------------------------------------------------- sessions
def _new_session(db: sqlite3.Connection, user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    now = int(time.time())
    db.execute("INSERT INTO sessions VALUES (?, ?, ?, ?)",
               (hashlib.sha256(token.encode()).hexdigest(), user_id, now, now))
    return token


def session_user(token: str) -> dict[str, Any] | None:
    if not token:
        return None
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    now = int(time.time())
    with _db() as db:
        row = db.execute("SELECT users.*, sessions.last_used FROM sessions JOIN users ON users.id = sessions.user_id "
                         "WHERE token_hash = ?", (token_hash,)).fetchone()
        if not row:
            return None
        if now - row["last_used"] > SESSION_SECONDS:
            db.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
            return None
        if now - row["last_used"] > 3600:
            db.execute("UPDATE sessions SET last_used = ? WHERE token_hash = ?", (now, token_hash))
        return _public(row)


def logout(token: str) -> None:
    with _db() as db:
        db.execute("DELETE FROM sessions WHERE token_hash = ?", (hashlib.sha256(token.encode()).hexdigest(),))


# --------------------------------------------------------------------------- sign up / sign in
def _clean_email(email: str) -> str:
    email = (email or "").strip().lower()
    if not EMAIL.fullmatch(email) or len(email) > 254:
        raise AccountError(400, "Enter a valid email address.")
    return email


def register(email: str, password: str, name: str, client: str) -> tuple[str, dict]:
    email = _clean_email(email)
    if not 8 <= len(password or "") <= 200:
        raise AccountError(400, "Use a password of at least 8 characters.")
    _throttle("ip:" + client)
    with _write_lock, _db() as db:
        if db.execute("SELECT 1 FROM users WHERE email = ?", (email,)).fetchone():
            _failed("ip:" + client)
            raise AccountError(409, "An account with this email already exists. Sign in instead.")
        user_id = secrets.token_hex(12)
        db.execute("INSERT INTO users (id, email, name, password, created) VALUES (?, ?, ?, ?, ?)",
                   (user_id, email, (name or "").strip()[:60], _hash_password(password), int(time.time())))
        token = _new_session(db, user_id)
        return token, _public(db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())


def login(email: str, password: str, client: str) -> tuple[str, dict]:
    email = _clean_email(email)
    _throttle("ip:" + client, "email:" + email)
    with _write_lock, _db() as db:
        user = db.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
        if not _check_password(password or "", user["password"] if user else None):
            _failed("ip:" + client, "email:" + email)
            if user and not user["password"]:
                raise AccountError(401, "This account uses Google sign-in. Use the Google button.")
            raise AccountError(401, "That email and password don't match an account.")
        return _new_session(db, user["id"]), _public(user)


def google_login(credential: str) -> tuple[str, dict]:
    """Checks the ID token with Google, then signs in (or creates) the matching account."""
    try:
        info = httpx.get("https://oauth2.googleapis.com/tokeninfo", params={"id_token": credential},
                         timeout=15).json()
    except Exception as exc:  # noqa: BLE001
        raise AccountError(502, f"Could not reach Google to check the sign-in: {exc}") from exc
    if (info.get("aud") != GOOGLE_CLIENT_ID or info.get("iss") not in ("accounts.google.com", "https://accounts.google.com")
            or int(info.get("exp", 0)) < time.time() or str(info.get("email_verified")).lower() != "true"):
        raise AccountError(401, "Google did not confirm this sign-in.")
    email, sub = _clean_email(info.get("email", "")), info["sub"]
    with _write_lock, _db() as db:
        user = db.execute("SELECT * FROM users WHERE google_sub = ? OR email = ? ORDER BY google_sub IS NULL",
                          (sub, email)).fetchone()
        if user is None:
            user_id = secrets.token_hex(12)
            db.execute("INSERT INTO users (id, email, name, google_sub, created) VALUES (?, ?, ?, ?, ?)",
                       (user_id, email, (info.get("name") or "")[:60], sub, int(time.time())))
        else:
            user_id = user["id"]
            # Google has verified this email, so it may be linked to an existing password account.
            db.execute("UPDATE users SET google_sub = ? WHERE id = ?", (sub, user_id))
        token = _new_session(db, user_id)
        return token, _public(db.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone())


def delete_user(user_id: str) -> None:
    with _write_lock, _db() as db:
        for table in ("sessions", "docs", "audio"):
            db.execute(f"DELETE FROM {table} WHERE user_id = ?", (user_id,))
        db.execute("DELETE FROM users WHERE id = ?", (user_id,))
    shutil.rmtree(AUDIO_DIR / user_id, ignore_errors=True)


# --------------------------------------------------------------------------- synced documents
def get_docs(user_id: str) -> dict[str, Any]:
    with _db() as db:
        rows = db.execute("SELECT collection, version, data FROM docs WHERE user_id = ?", (user_id,)).fetchall()
    docs = {name: {"version": 0, "data": None} for name in COLLECTIONS}
    for row in rows:
        docs[row["collection"]] = {"version": row["version"], "data": json.loads(row["data"])}
    return docs


def put_doc(user_id: str, collection: str, base_version: int, data: Any) -> dict[str, Any]:
    """Saves the document if nobody else saved since base_version. Returns
    {"ok": True, "version"} or {"ok": False, "version", "data"} with the newer copy."""
    if collection not in COLLECTIONS:
        raise AccountError(404, "Unknown collection.")
    encoded = json.dumps(data, separators=(",", ":"))
    if len(encoded) > MAX_DOC_BYTES:
        raise AccountError(413, "This is too large to sync (5 MB limit).")
    with _write_lock, _db() as db:
        row = db.execute("SELECT version, data FROM docs WHERE user_id = ? AND collection = ?",
                         (user_id, collection)).fetchone()
        current = row["version"] if row else 0
        if current != base_version:
            return {"ok": False, "version": current, "data": json.loads(row["data"]) if row else None}
        db.execute("INSERT OR REPLACE INTO docs VALUES (?, ?, ?, ?, ?)",
                   (user_id, collection, current + 1, encoded, int(time.time())))
        return {"ok": True, "version": current + 1}


# --------------------------------------------------------------------------- recordings
def _audio_row(row: sqlite3.Row) -> dict[str, Any]:
    return {"id": row["id"], "name": row["name"], "fileName": row["file_name"], "created": row["created"],
            "updated": row["updated"], "deleted": bool(row["deleted"]), "size": row["size"]}


def audio_list(user_id: str) -> list[dict[str, Any]]:
    with _db() as db:
        rows = db.execute("SELECT * FROM audio WHERE user_id = ? ORDER BY created DESC", (user_id,)).fetchall()
    return [_audio_row(r) for r in rows]


def _audio_path(user_id: str, audio_id: str) -> Path:
    if not AUDIO_ID.fullmatch(audio_id):
        raise AccountError(400, "Bad recording id.")
    return AUDIO_DIR / user_id / f"{audio_id}.audio"


def audio_put(user_id: str, audio_id: str, meta: dict[str, Any], content: bytes | None) -> dict[str, Any]:
    path = _audio_path(user_id, audio_id)
    name = str(meta.get("name") or "Recording")[:120]
    now = int(time.time() * 1000)
    with _write_lock, _db() as db:
        row = db.execute("SELECT * FROM audio WHERE user_id = ? AND id = ?", (user_id, audio_id)).fetchone()
        file_name = meta.get("fileName") or (row["file_name"] if row else name + ".wav")
        file_name = re.sub(r"[\\/:*?\"<>|]", "-", str(file_name))[:140]
        if row and row["deleted"]:
            raise AccountError(410, "This recording was deleted on another device.")
        if content is None and not row:
            raise AccountError(400, "Send the audio file the first time a recording is uploaded.")
        size = row["size"] if row else 0
        if content is not None:
            if len(content) > MAX_AUDIO_BYTES:
                raise AccountError(413, "Recordings can be at most 100 MB.")
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
            size = len(content)
        created = int(meta.get("created") or (row["created"] if row else now))
        db.execute("INSERT OR REPLACE INTO audio VALUES (?, ?, ?, ?, ?, ?, 0, ?)",
                   (user_id, audio_id, name, file_name, created, now, size))
        return _audio_row(db.execute("SELECT * FROM audio WHERE user_id = ? AND id = ?",
                                     (user_id, audio_id)).fetchone())


def audio_file(user_id: str, audio_id: str) -> Path:
    path = _audio_path(user_id, audio_id)
    if not path.exists():
        raise AccountError(404, "No such recording.")
    return path


def audio_delete(user_id: str, audio_id: str) -> None:
    """Keeps a tombstone so other devices learn to delete their copy too."""
    path = _audio_path(user_id, audio_id)
    now = int(time.time() * 1000)
    with _write_lock, _db() as db:
        db.execute("INSERT INTO audio (user_id, id, name, file_name, created, updated, deleted, size) "
                   "VALUES (?, ?, '', '', ?, ?, 1, 0) ON CONFLICT (user_id, id) DO UPDATE SET "
                   "deleted = 1, updated = excluded.updated, size = 0", (user_id, audio_id, now, now))
    path.unlink(missing_ok=True)
