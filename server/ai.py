"""The AI half of the server: chat and rewrites through Ollama, speech to text
through faster-whisper, and text to speech through Kokoro."""
from __future__ import annotations

import glob
import html
import io
import os
import re
import threading
from pathlib import Path
from typing import Any


def _register_cuda_dlls() -> int:
    """On Windows the CUDA runtime ships inside the nvidia-* pip wheels rather
    than on PATH, so CTranslate2 cannot find cublas/cudnn unless their bin
    directories are registered before it is imported."""
    try:
        import nvidia
    except ImportError:
        return 0
    dirs = {os.path.dirname(p) for root in getattr(nvidia, "__path__", [])
            for p in glob.glob(os.path.join(root, "**", "bin", "*.dll"), recursive=True)}
    for d in dirs:
        try:
            os.add_dll_directory(d)
        except (OSError, AttributeError):
            pass
    if dirs:
        os.environ["PATH"] = os.pathsep.join(sorted(dirs)) + os.pathsep + os.environ.get("PATH", "")
    return len(dirs)


CUDA_DLL_DIRS = _register_cuda_dlls()

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434").rstrip("/")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "gemma3:12b")
WHISPER_MODEL = os.getenv("WHISPER_MODEL", "small.en")
WHISPER_DEVICE = os.getenv("WHISPER_DEVICE", "auto")  # auto | cuda | cpu
KOKORO_DIR = Path(os.getenv("KOKORO_DIR", r"T:\kokoro"))
DEFAULT_VOICE = os.getenv("KOKORO_VOICE", "af_heart")

CHAT_SYSTEM = (
    "You are SquigglyBot, a concise and helpful writing companion inside the Squiggly Note app. "
    "Answer the user's question directly. Use their notes as context when they are relevant, "
    "and follow any output format the user asks for exactly."
)
REWRITE_SYSTEM = (
    "Rewrite the user's text to be concise while preserving its meaning. "
    "Return only the revised text, with no preamble."
)


# --------------------------------------------------------------------------- Ollama
def plain_text(value: str) -> str:
    """Note bodies are stored as editor HTML; the model reads them better as text."""
    text = re.sub(r"<br\s*/?>|</(p|div|h\d|li|blockquote)>", "\n", str(value or ""), flags=re.I)
    text = html.unescape(re.sub(r"<[^>]+>", "", text))
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def notes_context(notes: Any) -> str:
    """The app sends notes as a string, or as a list of {title, body}."""
    if not notes:
        return ""
    if isinstance(notes, str):
        return plain_text(notes)[:20000]
    parts = []
    for note in notes if isinstance(notes, list) else [notes]:
        if isinstance(note, dict):
            parts.append(f"# {note.get('title') or 'Untitled note'}\n{plain_text(note.get('body', ''))}")
        else:
            parts.append(plain_text(str(note)))
    return "\n\n".join(parts)[:20000]


def chat_messages(payload: dict[str, Any]) -> list[dict[str, str]]:
    """Builds an Ollama conversation from any of the request shapes the app sends."""
    system = CHAT_SYSTEM
    context = notes_context(payload.get("notes"))
    if context:
        system += "\n\nThe user's active note:\n" + context
    messages = [{"role": "system", "content": system}]

    history = payload.get("history") or payload.get("messages")
    if isinstance(history, list) and history:
        # The chat panel sends the whole conversation, ending with the new question.
        for item in history[-24:]:
            if not isinstance(item, dict):
                continue
            role = "assistant" if item.get("role") == "assistant" else "user"
            content = str(item.get("text") or item.get("content") or "").strip()
            if content:
                messages.append({"role": role, "content": content})
        if messages[-1]["role"] == "user":
            return messages

    message = str(payload.get("message") or payload.get("text") or "").strip()
    if not message:
        raise ValueError("message is empty")
    messages.append({"role": "user", "content": message})
    return messages


async def ollama_chat(client, messages: list[dict[str, str]], temperature: float = 0.6) -> str:
    response = await client.post(
        f"{OLLAMA_URL}/api/chat",
        json={
            "model": OLLAMA_MODEL,
            "messages": messages,
            "stream": False,
            "keep_alive": "30m",
            "options": {"temperature": temperature},
        },
        timeout=300,
    )
    if response.status_code != 200:
        raise RuntimeError(f"Ollama returned HTTP {response.status_code}: {response.text[:200]}")
    content = (response.json().get("message") or {}).get("content", "").strip()
    if not content:
        raise RuntimeError("Ollama returned an empty reply")
    return content


async def ollama_status(client) -> dict[str, Any]:
    try:
        tags = (await client.get(f"{OLLAMA_URL}/api/tags", timeout=5)).json()
    except Exception as exc:  # noqa: BLE001 - reported to the caller as-is
        return {"reachable": False, "model": OLLAMA_MODEL, "error": str(exc)}
    names = [m.get("name") for m in tags.get("models", [])]
    return {"reachable": True, "model": OLLAMA_MODEL, "installed": OLLAMA_MODEL in names}


# --------------------------------------------------------------------------- Whisper
_whisper = None
_whisper_device = "not loaded"
_whisper_lock = threading.Lock()


def _load_whisper():
    global _whisper, _whisper_device
    from faster_whisper import WhisperModel

    attempts = [("cpu", "int8")]
    if WHISPER_DEVICE != "cpu":
        attempts.insert(0, ("cuda", "float16"))
    for device, compute in attempts:
        try:
            _whisper = WhisperModel(WHISPER_MODEL, device=device, compute_type=compute)
            _whisper_device = f"{device}/{compute}"
            print(f"[whisper] {WHISPER_MODEL} on {_whisper_device}")
            return _whisper
        except Exception as exc:  # noqa: BLE001 - try the next device
            print(f"[whisper] {device} failed: {exc}")
    raise RuntimeError("Whisper could not be loaded on any device")


def transcribe(path: str) -> dict[str, Any]:
    """Blocking; call from a worker thread. PyAV inside faster-whisper decodes
    WAV and the browser's WebM recordings alike, so no ffmpeg is needed."""
    with _whisper_lock:
        model = _whisper or _load_whisper()
        segments, info = model.transcribe(path, beam_size=5, vad_filter=True)
        text = " ".join(s.text.strip() for s in segments).strip()
    return {"text": text, "seconds": round(float(info.duration or 0), 2), "device": _whisper_device}


def whisper_status() -> dict[str, Any]:
    return {"model": WHISPER_MODEL, "device": _whisper_device}


# --------------------------------------------------------------------------- Kokoro
_kokoro = None
_kokoro_lock = threading.Lock()


def _load_kokoro():
    global _kokoro
    from kokoro_onnx import Kokoro

    model, voices = KOKORO_DIR / "kokoro-v1.0.onnx", KOKORO_DIR / "voices-v1.0.bin"
    if not model.exists() or not voices.exists():
        raise RuntimeError(f"Kokoro model files are missing from {KOKORO_DIR}")
    _kokoro = Kokoro(str(model), str(voices))
    print(f"[kokoro] loaded {len(_kokoro.get_voices())} voices")
    return _kokoro


def voices() -> list[str]:
    try:
        with _kokoro_lock:
            return sorted((_kokoro or _load_kokoro()).get_voices())
    except Exception:  # noqa: BLE001 - no voices is a valid answer
        return []


def speak(text: str, voice: str | None = None, speed: float = 1.0) -> bytes:
    """Blocking; returns a WAV file. The app's voice menu lists Kokoro voice
    ids (af_heart, bm_george, ...); an unknown id falls back to the default."""
    import soundfile

    with _kokoro_lock:
        kokoro = _kokoro or _load_kokoro()
        available = kokoro.get_voices()
        name = voice if voice in available else DEFAULT_VOICE
        # British voices start with "b" (bf_, bm_); everything else is American English.
        lang = "en-gb" if name.startswith("b") else "en-us"
        samples, rate = kokoro.create(text, voice=name, speed=min(max(speed, 0.5), 2.0), lang=lang)
    buffer = io.BytesIO()
    soundfile.write(buffer, samples, rate, format="WAV", subtype="PCM_16")
    return buffer.getvalue()


def kokoro_status() -> dict[str, Any]:
    return {"loaded": _kokoro is not None, "model_dir": str(KOKORO_DIR),
            "files_present": (KOKORO_DIR / "kokoro-v1.0.onnx").exists()}
