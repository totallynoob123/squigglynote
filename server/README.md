# Squiggly Note server

Runs on your PC and gives the website its AI features, plus the backend for the
[quality monitor](https://atreyap31-cell.github.io/Squigglynote-tester/). The
site reaches it through an ngrok tunnel.

| Route | What it does | Powered by |
|---|---|---|
| `POST /chat` | SquigglyBot, to-do generation, note-edit proposals | Ollama `gemma3:12b` |
| `POST /rewrite` | Make concise | Ollama `gemma3:12b` |
| `POST /transcribe` | Audio → text (form field `audio`) | faster-whisper `small.en` on the GPU |
| `POST /tts` | Read aloud, in any voice from the app's menu | Kokoro |
| `GET /health` | What is loaded and whether the tunnel is up | |
| `/monitor/...` | Test runs, tickets, email recipients | Playwright + Chromium |

## Everyday use

```powershell
.\start.ps1
```

This opens ngrok in a minimized window, prints the public address, and runs the
server. Keep the window open; closing it stops the AI features and the monitor.
Ollama must be running (it normally starts with Windows).

The first request after a restart is slower while `gemma3:12b` loads into VRAM.

## The monitor

Every two hours, and whenever someone presses **Run test now**, the server opens
the live site in a throwaway headless Chrome profile and checks 15 features end
to end, including chat, read aloud, and transcribing a real spoken recording.
Results, screenshots of failures, tickets and recipients are stored in `data\`.

- **Recipients** are private: the monitor asks for the admin key, which the
  server prints when it starts (it is saved in `data\admin-key.txt`).
- **Email alerts** go out when a run has failures, once `SMTP_USER` and
  `SMTP_PASSWORD` are set in `.env` (see `.env.example`).

## Setup (once)

Everything lives on T: because C: is full.

```powershell
T:\python.exe -m venv T:\squigglynote-venv
$env:TMP = "T:\pip-tmp"; $env:TEMP = "T:\pip-tmp"
T:\squigglynote-venv\Scripts\python.exe -m pip install -r requirements.txt
$env:PLAYWRIGHT_BROWSERS_PATH = "T:\ms-playwright"
T:\squigglynote-venv\Scripts\python.exe -m playwright install chromium

mkdir T:\kokoro
$k = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0"
curl.exe -L "$k/kokoro-v1.0.onnx" -o T:\kokoro\kokoro-v1.0.onnx
curl.exe -L "$k/voices-v1.0.bin" -o T:\kokoro\voices-v1.0.bin

ngrok config add-authtoken <token from https://dashboard.ngrok.com/get-started/your-authtoken>
```

If your ngrok address is not the one in `js\00-config.js`, change it there (and
`DEFAULT_API` in the monitor's `app.js`) and push both sites.

## Security notes

- The server listens on 127.0.0.1 only; the outside world reaches it solely
  through ngrok.
- Browsers may only call it from the two GitHub Pages sites (and localhost);
  change `ALLOWED_ORIGIN_REGEX` in `.env` to allow others.
- Anyone who knows the tunnel address can still send it requests directly, so it
  can use your GPU. Stop `start.ps1` when you don't want it available.
