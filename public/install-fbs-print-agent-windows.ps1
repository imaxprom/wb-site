param(
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$ServerUrl = "https://hub.imaxprom.site",
  [string]$PrinterName = ""
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

New-Item -ItemType Directory -Path $appDir -Force | Out-Null
Invoke-WebRequest -UseBasicParsing -Uri "$ServerUrl/fbs-print-agent-windows.ps1" -OutFile $agentPath
Invoke-WebRequest -UseBasicParsing -Uri "$ServerUrl/repair-fbs-print-agent-windows.ps1" -OutFile $repairPath

$connections = @()
function Add-Or-ReplaceConnection {
  param([string]$ConnectionToken, [string]$ConnectionServerUrl)
  if ([string]::IsNullOrWhiteSpace($ConnectionToken)) { return }
  $organizationId = ""
  if ($ConnectionToken -match '^mphub-print-(\d+)-[a-f0-9]{64}$') { $organizationId = $Matches[1] }
  if (-not [string]::IsNullOrWhiteSpace($organizationId)) {
    $script:connections = @($script:connections | Where-Object { [string]$_.OrganizationId -ne $organizationId })
  } else {
    $script:connections = @($script:connections | Where-Object { [string]$_.Token -ne $ConnectionToken })
  }
  $script:connections += [PSCustomObject]@{
    OrganizationId = $organizationId
    ServerUrl = $ConnectionServerUrl.TrimEnd("/")
    Token = $ConnectionToken
  }
}

if (Test-Path -LiteralPath $configPath) {
  try {
    $previous = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
    if ([string]::IsNullOrWhiteSpace($PrinterName) -and -not [string]::IsNullOrWhiteSpace([string]$previous.PrinterName)) {
      $PrinterName = [string]$previous.PrinterName
    }
    foreach ($connection in @($previous.Connections)) {
      $connectionServerUrl = if ([string]::IsNullOrWhiteSpace([string]$connection.ServerUrl)) { $ServerUrl } else { [string]$connection.ServerUrl }
      Add-Or-ReplaceConnection -ConnectionToken ([string]$connection.Token) -ConnectionServerUrl $connectionServerUrl
    }
    # Migrate the original one-token configuration without losing it.
    if (-not [string]::IsNullOrWhiteSpace([string]$previous.Token)) {
      $previousServerUrl = if ([string]::IsNullOrWhiteSpace([string]$previous.ServerUrl)) { $ServerUrl } else { [string]$previous.ServerUrl }
      Add-Or-ReplaceConnection -ConnectionToken ([string]$previous.Token) -ConnectionServerUrl $previousServerUrl
    }
  } catch {
    throw "Existing print-agent config is invalid and was not changed: $($_.Exception.Message)"
  }
}

Add-Or-ReplaceConnection -ConnectionToken $Token -ConnectionServerUrl $ServerUrl
@{
  SchemaVersion = 2
  ServerUrl = $ServerUrl
  PrinterName = $PrinterName
  Connections = @($connections)
} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding UTF8

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
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "MpHub silent FBS printing for Zebra" -Force | Out-Null
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
Write-Host "MpHub print-agent installed and started."
Write-Host "Connected legal entities: $($connections.Count)"
Write-Host "Task state: $($task.State)"
Write-Host "Log: $logPath"
Write-Host "Recovery shortcut: Desktop\FBS Printer Recovery"
