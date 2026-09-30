# Starts the Squiggly Note server and its ngrok tunnel.
#   .\start.ps1
# Needs: Ollama running with gemma3:12b, the venv from README.md, and ngrok signed in once
# (ngrok config add-authtoken <token>).

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$python = 'T:\squigglynote-venv\Scripts\python.exe'
if (-not (Test-Path $python)) { Write-Error 'The venv is missing - see server\README.md, Setup.'; exit 1 }

# Settings from .env that this script needs too.
$port = '8787'; $domain = ''
if (Test-Path "$here\.env") {
    foreach ($line in Get-Content "$here\.env") {
        if ($line -match '^\s*PORT\s*=\s*(\d+)') { $port = $Matches[1] }
        if ($line -match '^\s*NGROK_DOMAIN\s*=\s*(\S+)') { $domain = $Matches[1] }
    }
}

$env:PLAYWRIGHT_BROWSERS_PATH = 'T:\ms-playwright'
$env:HF_HOME = 'T:\squigglynote-cache\hf'
$env:PYTHONUNBUFFERED = '1'

# ngrok runs in its own window so its status screen stays readable.
& ngrok config check *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host 'ngrok is not signed in. Run this once, with the token from https://dashboard.ngrok.com/get-started/your-authtoken :' -ForegroundColor Yellow
    Write-Host '    ngrok config add-authtoken <your token>' -ForegroundColor Yellow
    Write-Host 'Starting the server without a tunnel.' -ForegroundColor Yellow
} elseif (-not (Get-Process ngrok -ErrorAction SilentlyContinue)) {
    $ngrokArgs = @('http', $port)
    if ($domain) { $ngrokArgs += "--url=$domain" }
    Start-Process ngrok -ArgumentList $ngrokArgs -WindowStyle Minimized
    Start-Sleep -Seconds 3
}

try {
    $tunnel = (Invoke-RestMethod http://127.0.0.1:4040/api/tunnels).tunnels |
        Where-Object { $_.public_url -like 'https://*' } | Select-Object -First 1
    if ($tunnel) {
        Write-Host "`n  Public address: $($tunnel.public_url)" -ForegroundColor Green
        $config = Get-Content "$here\..\js\00-config.js" -Raw
        if ($config -notlike "*$($tunnel.public_url)*") {
            Write-Host "  js\00-config.js points somewhere else - set it to this address and push the site." -ForegroundColor Yellow
        }
    }
} catch {
    Write-Host '  ngrok did not start; see its window for the reason.' -ForegroundColor Yellow
}

Set-Location $here
& $python app.py
