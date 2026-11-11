# Starts the Squiggly Note server, its ngrok tunnel, and Ollama if it isn't running.
#   .\start.ps1               in this window, with output on screen
#   .\start.ps1 -Background   hidden, logging to data\server.log (used at Windows sign-in)
# Needs: the venv from README.md, and ngrok signed in once (ngrok config add-authtoken <token>).
param([switch]$Background)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = 'T:\squigglynote-venv\Scripts\python.exe'
$log = "$here\data\server.log"
New-Item -ItemType Directory -Force "$here\data" | Out-Null

function Say($text, $color = 'Gray') {
    if ($Background) { Add-Content $log "$(Get-Date -Format s)  $text" } else { Write-Host $text -ForegroundColor $color }
}

if (-not (Test-Path $python)) { Say 'The venv is missing - see server\README.md, Setup.' Red; exit 1 }

# Settings from .env that this script needs too.
$port = '8787'; $domain = ''
if (Test-Path "$here\.env") {
    foreach ($line in Get-Content "$here\.env") {
        if ($line -match '^\s*PORT\s*=\s*(\d+)') { $port = $Matches[1] }
        if ($line -match '^\s*NGROK_DOMAIN\s*=\s*(\S+)') { $domain = $Matches[1] }
    }
}

# Already running (for example, started by hand before the sign-in task fired)?
try { Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 3 | Out-Null; Say "The server is already running on port $port."; exit 0 } catch {}

# Ollama answers SquigglyBot; it does not always come back after a restart.
try { Invoke-RestMethod http://127.0.0.1:11434/api/tags -TimeoutSec 3 | Out-Null } catch {
    $ollama = "$env:LOCALAPPDATA\Programs\Ollama\ollama app.exe"
    if (Test-Path $ollama) {
        Say 'Starting Ollama...'
        Start-Process $ollama
        foreach ($i in 1..60) {
            try { Invoke-RestMethod http://127.0.0.1:11434/api/tags -TimeoutSec 2 | Out-Null; break } catch { Start-Sleep 1 }
        }
    } else {
        Say 'Ollama is not installed where expected; SquigglyBot will not answer until it runs.' Yellow
    }
}

$env:PLAYWRIGHT_BROWSERS_PATH = 'T:\ms-playwright'
$env:HF_HOME = 'T:\squigglynote-cache\hf'
$env:PYTHONUNBUFFERED = '1'

& ngrok config check *> $null
if ($LASTEXITCODE -ne 0) {
    Say 'ngrok is not signed in. Run once: ngrok config add-authtoken <token from https://dashboard.ngrok.com/get-started/your-authtoken>' Yellow
    Say 'Starting the server without a tunnel.' Yellow
} elseif (-not (Get-Process ngrok -ErrorAction SilentlyContinue)) {
    $ngrokArgs = @('http', $port, '--log=stdout')
    if ($domain) { $ngrokArgs += "--url=$domain" }
    # Hidden at sign-in; otherwise its own minimized window keeps its status screen readable.
    $style = if ($Background) { 'Hidden' } else { 'Minimized' }
    Start-Process ngrok -ArgumentList $ngrokArgs -WindowStyle $style
}

# ngrok can take a while when the network is still coming up after boot.
$tunnel = $null
foreach ($i in 1..30) {
    try {
        $tunnel = (Invoke-RestMethod http://127.0.0.1:4040/api/tunnels -TimeoutSec 2).tunnels |
            Where-Object { $_.public_url -like 'https://*' } | Select-Object -First 1
    } catch {}
    if ($tunnel) { break }
    Start-Sleep 2
}
if ($tunnel) {
    Say "Public address: $($tunnel.public_url)" Green
    if ((Get-Content "$here\..\js\00-config.js" -Raw) -notlike "*$($tunnel.public_url)*") {
        Say 'js\00-config.js points somewhere else - set it to this address and push the site.' Yellow
    }
} else {
    Say 'ngrok did not start a tunnel; the site cannot reach this server until it does.' Yellow
}

Set-Location $here
if ($Background) {
    Say 'Starting the server.'
    # cmd does the redirection: PowerShell 5.1 turns a program's stderr (where uvicorn logs) into errors.
    cmd /c "`"$python`" app.py >> `"$log`" 2>&1"
} else {
    & $python app.py
}
