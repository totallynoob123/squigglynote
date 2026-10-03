# Starts the Squiggly server (and ngrok, and Ollama) automatically when you sign in to Windows.
#   .\install-autostart.ps1              set it up
#   .\install-autostart.ps1 -Uninstall   remove it
param([switch]$Uninstall)

$name = 'Squiggly Note server'
if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Removed '$name'; it will no longer start at sign-in."
    exit 0
}

$script = Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) 'start.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`" -Background"
# The delay lets Wi-Fi connect before ngrok tries to reach its servers.
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$trigger.Delay = 'PT30S'
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings `
    -Principal $principal -Description 'Squiggly Note AI server, ngrok tunnel and Ollama' -Force | Out-Null
Write-Host "Installed '$name': it starts 30 seconds after you sign in to Windows."
Write-Host "Its log is in $(Split-Path -Parent $script)\data\server.log"
