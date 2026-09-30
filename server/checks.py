"""Browser tests the monitor runs against the live Squiggly Note site.

Every run drives a fresh headless Chromium profile, so the notes, tasks and
recordings it creates vanish with the profile and never touch a real user's
data. Checks that need the AI server are reported BLOCKED rather than FAIL
when the server or tunnel is down, because the site itself is not at fault.
"""
from __future__ import annotations

import re
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

import httpx

PASS, FAIL, BLOCKED = "PASS", "FAIL", "BLOCKED"
WORKSPACE = "squiggly-workspace-v4-guest"
AI_TIMEOUT = 180_000  # gemma3:12b can take a while to load into VRAM on the first request
SPEECH = "Squiggly Note monitor test. The quick brown fox jumps over the lazy dog."
ERROR_REPLY = re.compile(r"HTTP \d{3}|failed to fetch|load failed|networkerror|add an api tunnel|^error", re.I)


class Failed(Exception):
    """The feature did not behave as expected."""


class Blocked(Exception):
    """Something the feature depends on (server, tunnel, model) is unavailable."""


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Suite:
    def __init__(self, page, site_url: str, public_api: str | None, local_api: str,
                 evidence_dir: Path, run_id: str, speech_wav: Callable[[], bytes]):
        self.page = page
        self.site_url = site_url
        self.public_api = public_api
        self.local_api = local_api
        self.evidence_dir = evidence_dir
        self.run_id = run_id
        self.speech_wav = speech_wav
        self.page_errors: list[str] = []
        self.site_up = False
        self.server_ok = False
        self.tunnel_error = ""
        page.on("pageerror", lambda error: self.page_errors.append(str(error)))

    # ------------------------------------------------------------------ helpers
    def open_site(self) -> None:
        self.page.goto(self.site_url, wait_until="load")
        # The OpenRouter set-up dialog opens 250 ms after load for anyone without a key.
        try:
            self.page.wait_for_selector("#openrouterDialog[open]", timeout=3000)
            self.page.click("#skipOpenrouter")
        except Exception:  # noqa: BLE001 - the dialog is optional
            pass

    def reset_ui(self) -> None:
        self.page.evaluate("""() => {
            document.querySelectorAll('dialog[open]').forEach(d => d.close());
            const panel = document.querySelector('#notesChatPanel');
            if (panel) { panel.hidden = true; panel.classList.remove('chat-panel-fullscreen'); }
        }""")

    def to_notes(self) -> None:
        self.reset_ui()
        if not self.page.is_visible("#app"):
            if self.page.is_visible("#todoOpenNotes"):
                self.page.click("#todoOpenNotes")
            else:
                self.page.click("#openApp")
        self.page.click('.pane-tab[data-pane="notes"]')

    def workspace(self) -> dict:
        return self.page.evaluate("k => JSON.parse(localStorage.getItem(k) || 'null')", WORKSPACE) or {}

    def active_note(self) -> dict:
        data = self.workspace()
        return next((n for n in data.get("notes", []) if n["id"] == data.get("activeId")), {})

    def new_note(self, body: str = "") -> None:
        self.to_notes()
        self.page.click("#newNote")
        if body:
            self.page.click("#editor")
            self.page.keyboard.type(body)

    def delete_active_note(self) -> None:
        self.page.click("#deleteNote")
        self.page.wait_for_selector("#confirmDialog[open]")
        self.page.click("#confirmAction")

    def import_file(self, choice: str, name: str, mime: str, data: bytes) -> None:
        self.page.click(".notes-actions button:text-is('Import')")
        self.page.wait_for_selector("#importDialog[open]")
        with self.page.expect_file_chooser() as chooser:
            self.page.click(choice)
        chooser.value.set_files({"name": name, "mimeType": mime, "buffer": data})

    def wait_text(self, selector: str, pattern: str, timeout: int = 20_000) -> str:
        """Waits until the element's text matches the regex, and returns the text."""
        self.page.wait_for_function(
            "([s, p]) => new RegExp(p, 'i').test(document.querySelector(s)?.textContent || '')",
            arg=[selector, pattern], timeout=timeout)
        return self.page.text_content(selector) or ""

    def require_server(self) -> None:
        if not self.server_ok:
            raise Blocked("Needs the Squiggly server and its ngrok tunnel, which were not reachable.")

    # ------------------------------------------------------------------ checks
    def check_availability(self) -> str:
        started = time.time()
        response = httpx.get(self.site_url, timeout=20, follow_redirects=True)
        if response.status_code != 200:
            raise Failed(f"The site returned HTTP {response.status_code}.")
        self.site_up = True
        origin = re.match(r"https?://[^/]+", self.site_url).group(0)
        broken: list[str] = []
        self.page.on("response", lambda r: broken.append(f"{r.status} {r.url}")
                     if r.status >= 400 and r.url.startswith(origin) and not r.url.endswith("favicon.ico") else None)
        self.open_site()
        if not self.page.is_visible("#openApp"):
            raise Failed("The page loaded but the main controls did not appear.")
        if broken:
            raise Failed("Some site files failed to load: " + "; ".join(broken[:3]))
        if self.page_errors:
            raise Failed("The page loaded but a script crashed: " + self.page_errors[0][:200])
        return f"Loaded in {time.time() - started:.1f}s with no script errors."

    def check_notes(self) -> str:
        stamp = datetime.now().strftime("%H%M%S")
        title = f"Monitor note {stamp}"
        self.new_note("Temporary monitor note body")
        self.page.fill("#title", title)
        note = self.active_note()
        if note.get("title") != title or "Temporary monitor note body" not in note.get("body", ""):
            raise Failed("A new note's title and body were not saved.")
        self.page.fill("#title", title + " renamed")
        if self.active_note().get("title") != title + " renamed":
            raise Failed("Renaming the note was not saved.")
        self.delete_active_note()
        if any(n.get("title", "").startswith(title) for n in self.workspace().get("notes", [])):
            raise Failed("Deleting the note did not remove it.")
        return "Created, edited, renamed and deleted a temporary note."

    def check_formatting(self) -> str:
        self.new_note("format check")
        editor = self.page.locator("#editor")
        applied = []
        for title, tags in [("Bold", ("<b>", "<strong")), ("Italic", ("<i>", "<em")), ("Underline", ("<u>",))]:
            editor.click()
            self.page.keyboard.press("Control+A")
            self.page.click(f'[aria-label="Text formatting"] button[title="{title}"]')
            if not any(tag in editor.inner_html() for tag in tags):
                raise Failed(f"{title} did not change the text.")
            applied.append(title)
        for title, tag in [("Heading", "<h2"), ("Quote", "<blockquote"), ("Bulleted list", "<ul")]:
            editor.click()
            self.page.click(f'[aria-label="Text formatting"] button[title="{title}"]')
            if tag not in editor.inner_html():
                raise Failed(f"{title} did not change the text.")
            applied.append(title)
            if title != "Bulleted list":
                self.page.click(f'[aria-label="Text formatting"] button[title="{title}"]')  # toggle back off
        if "<b>" not in self.active_note().get("body", "") and "<strong" not in self.active_note().get("body", ""):
            raise Failed("Formatting showed in the editor but was not saved to the note.")
        self.delete_active_note()
        return "Applied " + ", ".join(applied).lower() + " and saved them."

    def check_themes(self) -> str:
        self.to_notes()
        self.page.click("#workspaceSettings")
        self.page.wait_for_selector("#settingsDialog[open]")
        steps = [('[data-key="theme"][data-value="dark"]', "dark"),
                 ('[data-key="background"][data-value="clean"]', "clean"),
                 ('[data-key="font"][data-value="sans"]', "sans"),
                 ('[data-key="size"][data-value="large"]', "large"),
                 ('[data-dyslexic="on"]', "dyslexic")]
        for selector, body_class in steps:
            self.page.click(selector)
            if body_class not in (self.page.get_attribute("body", "class") or ""):
                raise Failed(f"The {body_class} setting did not apply.")
        for selector in ['[data-key="theme"][data-value="light"]', '[data-key="background"][data-value="warm"]',
                         '[data-key="font"][data-value="serif"]', '[data-key="size"][data-value="regular"]',
                         '[data-dyslexic="off"]']:
            self.page.click(selector)
        leftover = {"dark", "clean", "sans", "large", "dyslexic"} & set((self.page.get_attribute("body", "class") or "").split())
        if leftover:
            raise Failed("Resetting settings left " + ", ".join(sorted(leftover)) + " applied.")
        self.page.click("#closeSettings")
        return "Theme, background, font, text size and dyslexic font all applied and reset."

    def check_todo(self) -> str:
        self.to_notes()
        self.page.click("#openTodoFromNotes")
        self.page.wait_for_selector("#todoPage.visible")
        before = self.page.locator(".todo-item").count()
        self.page.fill("#todoNewItem", "Monitor task")
        self.page.click("#addTodoItem")
        rows = self.page.locator(".todo-item")
        if rows.count() != before + 1 or rows.last.locator('input[type="text"]').input_value() != "Monitor task":
            raise Failed("Adding a task did not show it in the list.")
        rows.last.locator('input[type="checkbox"]').check()
        if "done" not in (self.page.locator(".todo-item").last.get_attribute("class") or ""):
            raise Failed("Completing a task did not mark it done.")
        self.page.locator(".todo-item").last.locator("button", has_text="Remove").click()
        if self.page.locator(".todo-item").count() != before:
            raise Failed("Removing a task did not delete it.")
        self.page.click("#todoOpenNotes")
        return "Added, completed and removed a task."

    def check_import_export(self) -> str:
        self.to_notes()
        self.import_file("#importNotesChoice", "monitor-import.txt", "text/plain", b"Imported by the monitor")
        self.page.wait_for_function(
            "k => (JSON.parse(localStorage.getItem(k) || '{}').notes || []).some(n => n.title === 'monitor-import')",
            arg=WORKSPACE)
        if self.active_note().get("title") != "monitor-import":
            raise Failed("The imported note did not open.")
        self.page.click("#exportNote")
        self.page.wait_for_selector("#confirmDialog[open]")
        with self.page.expect_download() as download:
            self.page.click("#confirmAction")
        name = download.value.suggested_filename
        content = Path(download.value.path()).read_text(encoding="utf-8", errors="replace")
        if not name.endswith(".txt") or "Imported by the monitor" not in content:
            raise Failed(f"The exported file ({name}) did not contain the note.")
        self.delete_active_note()
        return f"Imported a .txt note and exported it as {name}."

    def check_history(self) -> str:
        self.new_note("First version")
        self.page.wait_for_timeout(5500)
        self.page.keyboard.type(" and a second edit")
        self.page.wait_for_timeout(5500)
        self.page.click("#openVersionHistory")
        self.page.wait_for_selector("#versionHistoryDialog[open]")
        versions = self.page.locator("#versionHistoryList article").count()
        if not versions:
            raise Failed("No versions were saved after editing.")
        self.page.locator("#versionHistoryList article button", has_text="Preview").last.click()
        self.page.wait_for_selector("#historyPreview[open]")
        self.page.click("#restoreHistoryPreview")
        self.wait_text("#saveState", "Previous version restored")
        self.reset_ui()
        self.delete_active_note()
        return f"Saved {versions} version(s), previewed one and restored it."

    def check_chat_ui(self) -> str:
        self.to_notes()
        self.page.click("#openChatFromNotes")
        if self.page.is_hidden("#notesChatPanel"):
            raise Failed("The chat panel did not open.")
        tabs = self.page.locator(".chat-session-tab").count()
        self.page.click(".chat-session-new")
        if self.page.locator(".chat-session-tab").count() != tabs + 1:
            raise Failed("The + button did not start a new chat.")
        self.page.click("#panelFullscreen")
        if "chat-panel-fullscreen" not in (self.page.get_attribute("#notesChatPanel", "class") or ""):
            raise Failed("Fullscreen did not expand the chat panel.")
        self.page.click("#panelFullscreen")
        if "chat-panel-fullscreen" in (self.page.get_attribute("#notesChatPanel", "class") or ""):
            raise Failed("Exiting fullscreen did not restore the chat panel.")
        self.page.locator(".squigglybot-handle button", has_text="Close").click()
        if not self.page.is_hidden("#notesChatPanel"):
            raise Failed("The chat panel did not close.")
        return "Opened chat, started a new conversation, toggled fullscreen and closed it."

    def check_server(self) -> str:
        local = httpx.get(self.local_api + "/health", timeout=10).json()
        if not local["ollama"]["reachable"]:
            raise Failed("Ollama is not running on the server PC.")
        if not local["ollama"]["installed"]:
            raise Failed(f"The Ollama model {local['ollama']['model']} is not installed.")
        if not self.public_api:
            raise Failed("The ngrok tunnel is not running, so the site cannot reach the server.")
        site_api = self.page.evaluate("window.SQUIGGLY_API || ''")
        self.server_ok = True
        if site_api and site_api.rstrip("/") != self.public_api.rstrip("/"):
            raise Failed(f"The site points at {site_api}, but the tunnel is {self.public_api}. "
                         "Update js/00-config.js.")
        if self.tunnel_error:
            # ngrok says the tunnel is up, but this PC cannot reach it; the browser
            # checks after this one talk to the server directly instead.
            raise Blocked(f"ngrok reports {self.public_api} online, but this PC's network cannot reach it "
                          f"({self.tunnel_error}). People on other networks are unaffected; the AI checks "
                          "below use the server directly.")
        return f"Tunnel {self.public_api} reaches the server; Ollama {local['ollama']['model']} is ready."

    def check_chat_ai(self) -> str:
        self.require_server()
        self.to_notes()
        self.page.click("#openChatFromNotes")
        self.page.fill("#notesChatInput", "Reply with just the word pong.")
        self.page.click("#notesChatSend")
        self.page.wait_for_function("""() => {
            const bubbles = document.querySelectorAll('#notesChatMessages > div');
            const last = bubbles[bubbles.length - 1];
            return last && !/^Thinking/.test(last.textContent);
        }""", timeout=AI_TIMEOUT)
        reply = self.page.locator("#notesChatMessages > div").last.text_content().strip()
        self.reset_ui()
        if ERROR_REPLY.search(reply):
            raise Failed("SquigglyBot answered with an error: " + reply[:200])
        return "SquigglyBot replied: " + reply[:120]

    def check_rewrite_ai(self) -> str:
        self.require_server()
        original = ("This is honestly a really very long sentence that could quite easily be made "
                    "a whole lot shorter than it currently is right now.")
        self.new_note(original)
        self.page.click("#concise")
        self.page.wait_for_selector("#rewriteDialog[open]")
        self.page.click("#sendRewrite")
        status = self.wait_text("#rewriteStatus", r"^(Done|Error)", timeout=AI_TIMEOUT)
        if status.startswith("Error"):
            raise Failed("Make concise failed: " + status[:200])
        rewritten = self.page.inner_text("#editor").strip()
        self.reset_ui()
        self.delete_active_note()
        if not rewritten or rewritten == original:
            raise Failed("Make concise finished but the note text did not change.")
        return f"Shortened {len(original)} characters to {len(rewritten)}."

    def check_todo_ai(self) -> str:
        self.require_server()
        self.to_notes()
        self.page.click("#openTodoFromNotes")
        before = self.page.locator(".todo-item").count()
        self.page.fill("#todoSource", "I need to buy milk, call mom tonight, and finish my history essay.")
        self.page.click("#todoConcise")
        status = self.wait_text("#todoStatus", r"added|error", timeout=AI_TIMEOUT)
        added = self.page.locator(".todo-item").count() - before
        self.page.click("#todoOpenNotes")
        if "error" in status.lower() or added < 1:
            raise Failed("Turning text into tasks failed: " + status[:200])
        return f"Turned a sentence into {added} task bullet(s)."

    def check_tts(self) -> str:
        self.require_server()
        self.new_note("Hello from the Squiggly Note monitor.")
        self.page.click("#openTts")
        self.page.select_option("#ttsVoice", "bf_emma")
        self.page.click("#generateTts")
        status = self.wait_text("#ttsStatus", r"finished|error|http|failed|add ", timeout=AI_TIMEOUT)
        if "finished" not in status.lower():
            raise Failed("Read aloud failed: " + status[:200])
        duration = self.page.evaluate("document.querySelector('#ttsPlayer').duration || 0")
        self.reset_ui()
        self.delete_active_note()
        return f"Generated {duration:.1f}s of speech in the bf_emma voice and played it."

    def check_audio_library(self) -> str:
        self.to_notes()
        self.page.click("#transcribe")  # microphone; Chromium supplies a fake input device
        self.page.wait_for_timeout(1500)
        self.page.click("#transcribe")
        self.wait_text("#status", "WAV recording saved|unavailable|error")
        if "saved" not in (self.page.text_content("#status") or ""):
            raise Failed("Recording from the microphone failed: " + (self.page.text_content("#status") or ""))
        self.import_file("#importAudioChoice", "monitor-speech.wav", "audio/wav", self.speech_wav())
        self.page.wait_for_selector("#feedbackDialog[open]")
        message = self.page.text_content("#feedbackMessage") or ""
        self.page.click("#closeFeedback")
        if "added to Audio" not in message:
            raise Failed("Importing a WAV file failed: " + message)
        self.page.click('.pane-tab[data-pane="audio"]')
        self.page.wait_for_function("document.querySelectorAll('.audio-library-row audio').length >= 2")
        duration = self.page.evaluate("""async () => {
            const row = [...document.querySelectorAll('.audio-library-row')]
                .find(r => r.textContent.includes('monitor-speech'));
            const audio = row?.querySelector('audio');
            if (!audio) return 0;
            if (!audio.duration) await new Promise(r => { audio.onloadedmetadata = r; audio.load(); setTimeout(r, 3000); });
            return audio.duration || 0;
        }""")
        if not duration:
            raise Failed("The imported recording is listed but cannot be played.")
        return f"Recorded from the microphone, imported a WAV and played it back ({duration:.1f}s)."

    def check_transcription(self) -> str:
        self.require_server()
        if self.page.locator(".audio-library-row", has_text="monitor-speech").count() == 0:
            raise Blocked("The audio library check did not import the test recording.")
        self.reset_ui()
        self.page.click('.pane-tab[data-pane="audio"]')
        self.page.locator(".audio-library-row .tab", has_text="monitor-speech").first.click()
        self.page.locator(".notes-actions button", has_text="Transcribe selected").click()
        status = self.wait_text("#status", r"^(Done|Error)", timeout=AI_TIMEOUT)
        if status.startswith("Error"):
            raise Failed("Transcription failed: " + status[:200])
        body = re.sub(r"[^a-z ]", "", self.active_note().get("body", "").lower())
        if "quick brown fox" not in body:
            raise Failed("Transcription finished but the text did not match the recording.")
        return "Transcribed the spoken test recording into the note correctly."


# (id, name, what it covers, method)
CHECKS = [
    ("availability", "Website availability", "Homepage loads, every script runs", "check_availability"),
    ("notes", "Notes", "Create, edit, rename and delete a note", "check_notes"),
    ("formatting", "Rich-text formatting", "Bold, italic, underline, headings, quotes, lists", "check_formatting"),
    ("themes", "Themes and settings", "Theme, background, font, size, dyslexic font", "check_themes"),
    ("todo", "To-do lists", "Add, complete and remove tasks", "check_todo"),
    ("import-export", "Import and export", "Import a .txt note and export it", "check_import_export"),
    ("history", "Edit history", "Versions are saved, previewed and restored", "check_history"),
    ("chat-ui", "Chat and fullscreen", "Chat panel, new chat, fullscreen, close", "check_chat_ui"),
    ("server", "AI server and tunnel", "Ollama, the server and the ngrok tunnel are reachable", "check_server"),
    ("chat-ai", "SquigglyBot", "A chat message gets an answer from gemma3", "check_chat_ai"),
    ("rewrite-ai", "Make concise", "The rewrite dialog shortens a note", "check_rewrite_ai"),
    ("todo-ai", "To-do from text", "SquigglyBot turns text into task bullets", "check_todo_ai"),
    ("tts", "Read aloud", "Kokoro text to speech generates and plays audio", "check_tts"),
    ("audio", "Audio recording and library", "Record from a microphone, import a WAV, play it", "check_audio_library"),
    ("transcribe", "Audio transcription", "Whisper transcribes a recording into a note", "check_transcription"),
]


def tunnel_problem(public_api: str | None) -> str:
    """Empty if the public tunnel answers from here, otherwise why not."""
    if not public_api:
        return ""
    try:
        response = httpx.get(public_api + "/health", timeout=15, headers={"ngrok-skip-browser-warning": "true"})
        response.raise_for_status()
        response.json()
        return ""
    except httpx.ConnectError as exc:
        if "WRONG_VERSION_NUMBER" in str(exc):
            return "a web filter is intercepting ngrok"
        return str(exc)[:150]
    except Exception as exc:  # noqa: BLE001
        return str(exc)[:150]


def pending_results() -> list[dict]:
    return [{"id": cid, "name": name, "detail": detail, "status": "PENDING", "message": "",
             "time": None, "duration": None, "evidence": None} for cid, name, detail, _ in CHECKS]


def run_suite(site_url: str, public_api: str | None, local_api: str, evidence_dir: Path, run_id: str,
              speech_wav: Callable[[], bytes], on_progress: Callable[[list[dict]], None]) -> list[dict]:
    """Blocking; runs in a worker thread so Playwright gets its own event loop."""
    from playwright.sync_api import sync_playwright

    results = pending_results()
    evidence_dir.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True, args=[
            "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream",
            "--autoplay-policy=no-user-gesture-required"])
        context = browser.new_context(accept_downloads=True, viewport={"width": 1280, "height": 900})
        context.set_default_timeout(20_000)
        page = context.new_page()
        suite = Suite(page, site_url, public_api, local_api, evidence_dir, run_id, speech_wav)
        suite.tunnel_error = tunnel_problem(public_api)
        if public_api and suite.tunnel_error:
            # The tunnel only forwards to this server anyway, so send the test browser's
            # requests to it directly; the site and server still get tested end to end.
            def to_local(route):
                url = local_api + route.request.url[len(public_api):]
                route.fulfill(response=route.fetch(url=url))

            context.route(public_api + "/**", to_local)
        for result, (_, _, _, method) in zip(results, CHECKS):
            result["status"] = "RUNNING"
            on_progress(results)
            started = time.time()
            try:
                if method != "check_availability" and not suite.site_up:
                    raise Blocked("The website did not load.")
                result["message"] = getattr(suite, method)()
                result["status"] = PASS
            except Blocked as exc:
                result["status"], result["message"] = BLOCKED, str(exc)
            except Exception as exc:  # noqa: BLE001 - every failure becomes a result
                result["status"] = FAIL
                result["message"] = str(exc).splitlines()[0][:300] if str(exc) else type(exc).__name__
                if not isinstance(exc, Failed):
                    traceback.print_exc()
            if result["status"] != PASS and suite.site_up:
                name = f"{run_id}-{result['id']}.png"
                try:
                    page.screenshot(path=str(evidence_dir / name))
                    result["evidence"] = name
                except Exception:  # noqa: BLE001 - evidence is best effort
                    pass
                # Start the next check from a clean page rather than a half-finished dialog.
                try:
                    suite.open_site()
                except Exception:  # noqa: BLE001
                    pass
            result["time"] = now()
            result["duration"] = round(time.time() - started, 1)
            on_progress(results)
        browser.close()
    return results
