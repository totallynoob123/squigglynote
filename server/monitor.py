"""Scheduling, storage and alerts for the Squiggly Note quality monitor."""
from __future__ import annotations

import asyncio
import json
import os
import secrets
import smtplib
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Callable

import httpx

import checks

DATA_DIR = Path(os.getenv("DATA_DIR", Path(__file__).resolve().parent / "data"))
EVIDENCE_DIR = DATA_DIR / "evidence"
SITE_URL = os.getenv("SITE_URL", "https://totallynoob123.github.io/squigglynote/")
INTERVAL = timedelta(hours=float(os.getenv("MONITOR_INTERVAL_HOURS", "2")))
PUBLIC_API_URL = os.getenv("PUBLIC_API_URL", "").rstrip("/")
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", "587"))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASSWORD = os.getenv("SMTP_PASSWORD", "")
KEEP_RUNS = 30

_lock = threading.Lock()


def _read(name: str, default: Any) -> Any:
    try:
        return json.loads((DATA_DIR / name).read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def _write(name: str, value: Any) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    tmp = DATA_DIR / (name + ".tmp")
    tmp.write_text(json.dumps(value, indent=2), encoding="utf-8")
    tmp.replace(DATA_DIR / name)


def admin_key() -> str:
    """Protects the recipient list, which holds private email addresses.
    Generated on first start and kept in data/admin-key.txt."""
    key = os.getenv("MONITOR_ADMIN_KEY", "").strip()
    if key:
        return key
    path = DATA_DIR / "admin-key.txt"
    if not path.exists():
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        path.write_text(secrets.token_urlsafe(18), encoding="utf-8")
    return path.read_text(encoding="utf-8").strip()


def public_api_url() -> str | None:
    """The ngrok address, from PUBLIC_API_URL or ngrok's local inspection API."""
    if PUBLIC_API_URL:
        return PUBLIC_API_URL
    try:
        tunnels = httpx.get("http://127.0.0.1:4040/api/tunnels", timeout=2).json().get("tunnels", [])
    except Exception:  # noqa: BLE001 - ngrok is simply not running
        return None
    urls = [t.get("public_url", "") for t in tunnels if t.get("public_url", "").startswith("https://")]
    return urls[0].rstrip("/") if urls else None


def email_configured() -> bool:
    return bool(SMTP_USER and SMTP_PASSWORD)


# --------------------------------------------------------------------------- runs
class Monitor:
    def __init__(self, local_api: str, speech_wav: Callable[[], bytes]):
        self.local_api = local_api
        self.speech_wav = speech_wav
        self.current: dict | None = None
        self.task: asyncio.Task | None = None
        saved = _read("runs.json", [])
        self.runs: list[dict] = saved if isinstance(saved, list) else []

    @property
    def running(self) -> bool:
        return self.current is not None

    def status(self) -> dict[str, Any]:
        latest = self.current or (self.runs[0] if self.runs else None)
        last_done = next((r for r in self.runs if r.get("finished")), None)
        next_run = None
        if last_done:
            next_run = (datetime.fromisoformat(last_done["finished"]) + INTERVAL).isoformat(timespec="seconds")
        return {
            "running": self.running,
            "run": latest,
            "history": [{k: r.get(k) for k in ("id", "started", "finished", "summary", "site_up", "trigger")}
                        for r in self.runs[:10]],
            "next_run": next_run,
            "interval_hours": INTERVAL.total_seconds() / 3600,
            "site_url": SITE_URL,
            "public_api": public_api_url(),
            "email_configured": email_configured(),
        }

    def start(self, trigger: str) -> bool:
        if self.running:
            return False
        run_id = datetime.now().strftime("%Y%m%d-%H%M%S")
        self.current = {"id": run_id, "trigger": trigger, "started": checks.now(), "finished": None,
                        "site_up": None, "summary": None, "checks": checks.pending_results()}
        self.task = asyncio.get_running_loop().create_task(self._run(run_id))
        return True

    async def _run(self, run_id: str) -> None:
        def progress(results: list[dict]) -> None:
            self.current["checks"] = [dict(r) for r in results]

        run = self.current
        try:
            results = await asyncio.to_thread(
                checks.run_suite, SITE_URL, public_api_url(), self.local_api, EVIDENCE_DIR, run_id,
                self.speech_wav, progress)
            run["checks"] = results
        except Exception as exc:  # noqa: BLE001 - e.g. Chromium missing; shown on the monitor
            for result in run["checks"]:
                if result["status"] in ("PENDING", "RUNNING"):
                    result.update(status=checks.FAIL, message=f"The monitor could not run: {exc}", time=checks.now())
        statuses = [r["status"] for r in run["checks"]]
        run["summary"] = {s: statuses.count(s) for s in (checks.PASS, checks.FAIL, checks.BLOCKED)}
        run["site_up"] = next((r["status"] == checks.PASS or "script" in r["message"]
                               for r in run["checks"] if r["id"] == "availability"), False)
        run["finished"] = checks.now()
        self.runs.insert(0, run)
        del self.runs[KEEP_RUNS:]
        _write("runs.json", self.runs)
        self._prune_evidence()
        self.current = None
        await asyncio.to_thread(send_alert, run)

    def _prune_evidence(self) -> None:
        keep = {r["evidence"] for run in self.runs for r in run["checks"] if r.get("evidence")}
        for file in EVIDENCE_DIR.glob("*.png"):
            if file.name not in keep:
                file.unlink(missing_ok=True)

    async def schedule(self) -> None:
        """Runs every INTERVAL, counted from the end of the previous run."""
        await asyncio.sleep(90)  # give ngrok and Ollama a moment after start-up
        while True:
            last = next((r for r in self.runs if r.get("finished")), None)
            due = datetime.fromisoformat(last["finished"]) + INTERVAL if last else datetime.now(timezone.utc)
            wait = (due - datetime.now(timezone.utc)).total_seconds()
            if wait <= 0 and not self.running:
                self.start("scheduled")
                wait = 60
            await asyncio.sleep(max(30, min(wait, 600)))


# --------------------------------------------------------------------------- email
def send_alert(run: dict, force: bool = False) -> str:
    """Emails the recipients when a run has failures (or always, for a test)."""
    recipients = _read("recipients.json", [])
    failures = [r for r in run["checks"] if r["status"] == checks.FAIL]
    if not recipients or not email_configured() or (not failures and not force):
        return "skipped"
    lines = [f"Squiggly Note monitor run {run['id']} ({run['trigger']})", ""]
    for result in run["checks"]:
        lines.append(f"{result['status']:8} {result['name']}: {result['message']}")
    message = EmailMessage()
    summary = run.get("summary") or {}
    message["Subject"] = (f"Squiggly Note monitor: {summary.get('FAIL', 0)} failing, "
                          f"{summary.get('PASS', 0)} passing")
    message["From"] = os.getenv("SMTP_FROM", SMTP_USER)
    message["To"] = ", ".join(recipients)
    message.set_content("\n".join(lines))
    try:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=30) as smtp:
            smtp.starttls()
            smtp.login(SMTP_USER, SMTP_PASSWORD)
            smtp.send_message(message)
    except Exception as exc:  # noqa: BLE001 - reported to the caller
        print(f"[monitor] email failed: {exc}")
        return f"failed: {exc}"
    return "sent"


# --------------------------------------------------------------------------- recipients
def recipients() -> list[str]:
    return _read("recipients.json", [])


def add_recipient(email: str) -> list[str]:
    with _lock:
        current = recipients()
        if email.lower() not in (e.lower() for e in current):
            current.append(email)
            _write("recipients.json", current)
        return current


def remove_recipient(email: str) -> list[str]:
    with _lock:
        current = [e for e in recipients() if e.lower() != email.lower()]
        _write("recipients.json", current)
        return current


# --------------------------------------------------------------------------- tickets
_ticket_times: dict[str, list[float]] = {}


def tickets() -> list[dict]:
    return _read("tickets.json", [])


def add_ticket(title: str, by: str, client: str) -> dict:
    recent = [t for t in _ticket_times.get(client, []) if time.time() - t < 3600]
    if len(recent) >= 10:
        raise ValueError("Too many tickets from this connection; try again later.")
    _ticket_times[client] = recent + [time.time()]
    with _lock:
        current = tickets()
        ticket = {"id": f"T-{101 + len(current)}", "uid": uuid.uuid4().hex, "title": title,
                  "by": by or "Guest", "status": "Open", "time": checks.now(), "resolved": None}
        current.insert(0, ticket)
        _write("tickets.json", current)
        return ticket


def resolve_ticket(uid: str) -> dict:
    with _lock:
        current = tickets()
        ticket = next((t for t in current if t["uid"] == uid), None)
        if not ticket:
            raise KeyError(uid)
        ticket.update(status="Resolved", resolved=checks.now())
        _write("tickets.json", current)
        return ticket
