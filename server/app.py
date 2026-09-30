"""Squiggly Note server.

Runs on your PC behind an ngrok tunnel and gives the website its AI features
and the quality monitor its backend:

    POST /chat          {message, notes?, history?}  -> {response}     (Ollama)
    POST /rewrite       {text}                       -> {content}      (Ollama)
    POST /transcribe    multipart "audio" or "file"  -> {text}         (Whisper)
    POST /tts           {text, voice?}               -> audio/wav      (Kokoro)
    GET  /voices, /health
    /monitor/...        test runs, tickets and alert recipients

Start everything with start.ps1.
"""
from __future__ import annotations

import os
import shutil
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
load_dotenv(HERE / ".env")
# Model downloads are hundreds of MB; keep them off the (full) system drive.
os.environ.setdefault("HF_HOME", r"T:\squigglynote-cache\hf")
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

import asyncio  # noqa: E402
import re  # noqa: E402
from datetime import datetime, timezone  # noqa: E402

import httpx  # noqa: E402
from fastapi import FastAPI, File, HTTPException, Request, Response, UploadFile  # noqa: E402
from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from fastapi.responses import FileResponse, JSONResponse  # noqa: E402
from pydantic import BaseModel  # noqa: E402

import ai  # noqa: E402
import checks  # noqa: E402
import monitor  # noqa: E402

PORT = int(os.getenv("PORT", "8787"))
# Only the two GitHub Pages sites (and local copies while developing) may call this from a browser.
ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGIN_REGEX",
    r"https://(totallynoob123|atreyap31-cell)\.github\.io|http://(localhost|127\.0\.0\.1)(:\d+)?",
)

_speech_cache: bytes | None = None


def speech_wav() -> bytes:
    """The spoken WAV the monitor imports and then expects to be transcribed."""
    global _speech_cache
    if _speech_cache is None:
        _speech_cache = ai.speak(checks.SPEECH, "af_heart")
    return _speech_cache


watcher = monitor.Monitor(f"http://127.0.0.1:{PORT}", speech_wav)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    schedule = asyncio.create_task(watcher.schedule())
    print(f"\n  Squiggly server on http://127.0.0.1:{PORT}")
    print(f"  Monitor admin key (for the Recipients tab): {monitor.admin_key()}\n")
    yield
    schedule.cancel()


app = FastAPI(title="Squiggly Note server", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["*"],
)
http = httpx.AsyncClient()


@app.exception_handler(HTTPException)
async def http_error(_request, exc: HTTPException):
    # The site shows `detail` in its error messages.
    return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})


@app.get("/")
async def index():
    return {"name": "Squiggly Note server", "health": "/health", "monitor": "/monitor/status"}


@app.get("/health")
async def health():
    return {
        "ok": True,
        "ollama": await ai.ollama_status(http),
        "whisper": ai.whisper_status(),
        "kokoro": ai.kokoro_status(),
        "public_api": monitor.public_api_url(),
    }


# --------------------------------------------------------------------------- AI
@app.post("/chat")
async def chat(request: Request):
    payload = await request.json()
    try:
        messages = ai.chat_messages(payload if isinstance(payload, dict) else {})
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    try:
        reply = await ai.ollama_chat(http, messages, float(payload.get("temperature", 0.6)))
    except httpx.RequestError as exc:
        raise HTTPException(503, f"Ollama is not running: {exc}") from exc
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"response": reply, "text": reply, "answer": reply}


class RewriteIn(BaseModel):
    text: str


@app.post("/rewrite")
async def rewrite(body: RewriteIn):
    text = ai.plain_text(body.text)
    if not text:
        raise HTTPException(400, "text is empty")
    try:
        result = await ai.ollama_chat(http, [{"role": "system", "content": ai.REWRITE_SYSTEM},
                                             {"role": "user", "content": text}], 0.3)
    except httpx.RequestError as exc:
        raise HTTPException(503, f"Ollama is not running: {exc}") from exc
    except RuntimeError as exc:
        raise HTTPException(502, str(exc)) from exc
    return {"content": result, "text": result}


@app.post("/transcribe")
async def transcribe(audio: UploadFile | None = File(default=None), file: UploadFile | None = File(default=None)):
    upload = audio or file
    if upload is None:
        raise HTTPException(400, "send the recording in a form field named 'audio'")
    suffix = Path(upload.filename or "audio.wav").suffix or ".wav"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        shutil.copyfileobj(upload.file, tmp)
    try:
        return await asyncio.to_thread(ai.transcribe, tmp.name)
    except Exception as exc:  # noqa: BLE001 - surfaced to the site's status line
        raise HTTPException(500, f"transcription failed: {exc}") from exc
    finally:
        os.unlink(tmp.name)


class SpeakIn(BaseModel):
    text: str
    voice: str | None = None
    speed: float = 1.0


@app.post("/tts")
async def tts(body: SpeakIn):
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "text is empty")
    if len(text) > 8000:
        raise HTTPException(413, "text is too long to read aloud (8000 characters max)")
    try:
        wav = await asyncio.to_thread(ai.speak, text, body.voice, body.speed)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(500, f"text to speech failed: {exc}") from exc
    return Response(wav, media_type="audio/wav", headers={"Cache-Control": "no-store"})


@app.get("/voices")
async def voices():
    return {"voices": await asyncio.to_thread(ai.voices), "default": ai.DEFAULT_VOICE}


# --------------------------------------------------------------------------- monitor
def require_admin(request: Request) -> None:
    if request.headers.get("x-admin-key", "") != monitor.admin_key():
        raise HTTPException(401, "admin key required")


def client_id(request: Request) -> str:
    return request.headers.get("x-forwarded-for", request.client.host if request.client else "?").split(",")[0]


@app.get("/monitor/status")
async def monitor_status():
    return watcher.status()


@app.post("/monitor/run")
async def monitor_run():
    last = watcher.runs[0] if watcher.runs else None
    if last and last.get("trigger") == "manual" and not watcher.running:
        since = (datetime.now(timezone.utc) - datetime.fromisoformat(last["finished"])).total_seconds()
        if since < 60:
            raise HTTPException(429, "A test just finished; wait a minute before running another.")
    started = watcher.start("manual")
    return {"started": started, **watcher.status()}


@app.get("/monitor/evidence/{name}")
async def monitor_evidence(name: str):
    if not re.fullmatch(r"[\w.-]+\.png", name):
        raise HTTPException(404, "not found")
    path = monitor.EVIDENCE_DIR / name
    if not path.exists():
        raise HTTPException(404, "not found")
    return FileResponse(path, media_type="image/png")


@app.get("/monitor/tickets")
async def list_tickets():
    return {"tickets": monitor.tickets()}


class TicketIn(BaseModel):
    title: str
    by: str = ""


@app.post("/monitor/tickets")
async def create_ticket(body: TicketIn, request: Request):
    title, by = body.title.strip(), body.by.strip()
    if not 3 <= len(title) <= 200 or len(by) > 60:
        raise HTTPException(400, "The title must be 3-200 characters and the name at most 60.")
    try:
        return monitor.add_ticket(title, by, client_id(request))
    except ValueError as exc:
        raise HTTPException(429, str(exc)) from exc


@app.post("/monitor/tickets/{uid}/resolve")
async def resolve_ticket(uid: str):
    try:
        return monitor.resolve_ticket(uid)
    except KeyError as exc:
        raise HTTPException(404, "no such ticket") from exc


class RecipientIn(BaseModel):
    email: str


@app.get("/monitor/recipients")
async def list_recipients(request: Request):
    require_admin(request)
    return {"recipients": monitor.recipients(), "email_configured": monitor.email_configured()}


@app.post("/monitor/recipients")
async def add_recipient(body: RecipientIn, request: Request):
    require_admin(request)
    email = body.email.strip()
    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email) or len(email) > 254:
        raise HTTPException(400, "That is not a valid email address.")
    return {"recipients": monitor.add_recipient(email)}


@app.delete("/monitor/recipients/{email}")
async def remove_recipient(email: str, request: Request):
    require_admin(request)
    return {"recipients": monitor.remove_recipient(email)}


@app.post("/monitor/test-email")
async def test_email(request: Request):
    require_admin(request)
    if not watcher.runs:
        raise HTTPException(400, "Run a test first so there is something to send.")
    result = await asyncio.to_thread(monitor.send_alert, watcher.runs[0], True)
    return {"result": result}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=PORT)
