param(
  [string]$ServerUrl = "https://hub.imaxprom.site"
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ServerUrl = $ServerUrl.TrimEnd("/")
$appDir = Join-Path $env:LOCALAPPDATA "MpHub\FbsPrintAgent"
$agentPath = Join-Path $appDir "fbs-print-agent-windows.ps1"
$configPath = Join-Path $appDir "config.json"
$launcherPath = Join-Path $appDir "run-agent.ps1"
$repairPath = Join-Path $appDir "repair-fbs-print-agent-windows.ps1"
$logPath = Join-Path $appDir "agent.log"
$taskName = "MpHub FBS Print Agent"

if (-not (Test-Path -LiteralPath $configPath)) {
  throw "Print-agent config was not found. Run the full MpHub installer first."
}

$config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
$connectionTokens = @($config.Connections | ForEach-Object { [string]$_.Token } | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$legacyToken = [string]$config.Token
if ($connectionTokens.Count -eq 0 -and [string]::IsNullOrWhiteSpace($legacyToken)) {
  throw "Print-agent token is missing. Run the full MpHub installer first."
}
if (-not [string]::IsNullOrWhiteSpace([string]$config.ServerUrl)) {
  $ServerUrl = ([string]$config.ServerUrl).TrimEnd("/")
}

New-Item -ItemType Directory -Path $appDir -Force | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri "$ServerUrl/fbs-print-agent-windows.ps1" -OutFile $agentPath
Invoke-WebRequest -UseBasicParsing -Uri "$ServerUrl/repair-fbs-print-agent-windows.ps1" -OutFile $repairPath

@'
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$log = Join-Path $root "agent.log"
while ($true) {
  try {
    & (Join-Path $root "fbs-print-agent-windows.ps1") -ConfigPath (Join-Path $root "config.json") *>> $log
  } catch {
    $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -LiteralPath $log -Value "$stamp Supervisor restart: $($_.Exception.Message)"
  }
  Start-Sleep -Seconds 10
}
'@ | Set-Content -LiteralPath $launcherPath -Encoding ASCII

$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$actionArgs = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPath`""
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArgs
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
$trigger.Delay = "PT15S"
$settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue | Stop-ScheduledTask -ErrorAction SilentlyContinue
Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
  $_.ProcessId -ne $PID -and [string]$_.CommandLine -match 'MpHub\\FbsPrintAgent\\(run-agent|fbs-print-agent-windows)\.ps1'
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "MpHub resilient silent FBS printing for Zebra" -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

$protocolRoot = "HKCU:\Software\Classes\mphub-print"
New-Item -Path $protocolRoot -Force | Out-Null
Set-Item -Path $protocolRoot -Value "URL:MpHub printer recovery"
New-ItemProperty -Path $protocolRoot -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
$commandKey = Join-Path $protocolRoot "shell\open\command"
New-Item -Path $commandKey -Force | Out-Null
$powershell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
Set-Item -Path $commandKey -Value "`"$powershell`" -NoProfile -ExecutionPolicy Bypass -File `"$repairPath`" -RequestUri `"%1`""
$desktop = [Environment]::GetFolderPath("Desktop")
if (-not [string]::IsNullOrWhiteSpace($desktop)) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut((Join-Path $desktop "FBS Printer Recovery.lnk"))
  $shortcut.TargetPath = $powershell
  $shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$repairPath`" -RequestUri `"mphub-print://repair?code=PRN-002`""
  $shortcut.WorkingDirectory = $appDir
  $shortcut.Save()
}

Start-Sleep -Seconds 5
$task = Get-ScheduledTask -TaskName $taskName
Write-Host "MpHub print-agent updated and started."
Write-Host "Task state: $($task.State)"
Write-Host "The agent will retry every 10 seconds until Zebra and the network are ready."
Write-Host "Log: $logPath"
Write-Host "Recovery shortcut: Desktop\FBS Printer Recovery"
