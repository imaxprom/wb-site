param(
  [string]$ServerUrl = "https://hub.imaxprom.site",
  [string]$RequestUri = ""
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ServerUrl = $ServerUrl.TrimEnd("/")
$appDir = Join-Path $env:LOCALAPPDATA "MpHub\FbsPrintAgent"
$configPath = Join-Path $appDir "config.json"
$agentPath = Join-Path $appDir "fbs-print-agent-windows.ps1"
$launcherPath = Join-Path $appDir "run-agent.ps1"
$repairPath = Join-Path $appDir "repair-fbs-print-agent-windows.ps1"
$logPath = Join-Path $appDir "repair.log"
$taskName = "MpHub FBS Print Agent"

function Test-IsAdministrator {
  $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object System.Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([System.Security.Principal.WindowsBuiltInRole]::Administrator)
}

# Clearing a retained Windows spooler job may require restarting the Spooler.
# Elevate only for the explicit jam-recovery flow; normal agent startup remains
# silent and never shows a UAC prompt.
if ($RequestUri -match "PRN-(011|012|013)" -and -not (Test-IsAdministrator)) {
  $powershell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  $scriptPath = [string]$MyInvocation.MyCommand.Path
  $arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" -ServerUrl `"$ServerUrl`" -RequestUri `"$RequestUri`""
  try {
    Start-Process -FilePath $powershell -Verb RunAs -ArgumentList $arguments | Out-Null
    exit 0
  } catch {
    Write-Host "Administrator permission was not granted. Code PRN-013." -ForegroundColor Red
    Read-Host "Press Enter to close"
    exit 1
  }
}

function Write-RecoveryLog {
  param([string]$Message)
  $stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Add-Content -LiteralPath $logPath -Value "$stamp $Message" -Encoding UTF8
}

function Send-RecoveryStatus {
  param([object]$Config, [string]$Status, [string]$Message)
  foreach ($connection in @($Config.Connections)) {
    $token = [string]$connection.Token
    if ([string]::IsNullOrWhiteSpace($token)) { continue }
    $url = if ([string]::IsNullOrWhiteSpace([string]$connection.ServerUrl)) { $ServerUrl } else { ([string]$connection.ServerUrl).TrimEnd("/") }
    try {
      Invoke-RestMethod -Method Post -Uri "$url/api/fbs/print-agent" `
        -Headers @{ Authorization = "Bearer $token" } `
        -ContentType "application/json; charset=utf-8" `
        -Body (@{ action = "heartbeat"; printerName = [string]$Config.PrinterName; status = $Status; error = $Message } | ConvertTo-Json -Compress) | Out-Null
    } catch {}
  }
}

function Register-RecoveryTools {
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
}

try {
  New-Item -ItemType Directory -Path $appDir -Force | Out-Null
  Write-RecoveryLog "Recovery started"
  if (-not (Test-Path -LiteralPath $configPath)) { throw "PRN-001: print-agent is not installed" }
  $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
  if (-not [string]::IsNullOrWhiteSpace([string]$config.ServerUrl)) { $ServerUrl = ([string]$config.ServerUrl).TrimEnd("/") }
  Send-RecoveryStatus -Config $config -Status "repairing" -Message "Automatic printer recovery started"

  $spooler = Get-Service -Name Spooler -ErrorAction Stop
  if ($spooler.Status -ne "Running") {
    Start-Service -Name Spooler
    $spooler.WaitForStatus("Running", [TimeSpan]::FromSeconds(20))
    Write-RecoveryLog "Windows Print Spooler started"
  }

  $printerName = [string]$config.PrinterName
  if ([string]::IsNullOrWhiteSpace($printerName)) {
    $zebra = @(Get-Printer | Where-Object { $_.Name -match "ZT220" })
    if ($zebra.Count -ne 1) { throw "PRN-003: Windows cannot identify one Zebra ZT220" }
    $printerName = [string]$zebra[0].Name
    $config.PrinterName = $printerName
    $config | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $configPath -Encoding UTF8
  }
  $printer = Get-Printer -Name $printerName -ErrorAction Stop
  # A retained document never disappears from Get-PrintJob and used to leave
  # the server queue uncertain after an otherwise successful print. Disable
  # Windows' "Keep printed documents" option permanently for the Zebra queue.
  if ([bool]$printer.KeepPrintedJobs) {
    Set-Printer -Name $printerName -KeepPrintedJobs $false -ErrorAction Stop
    Write-RecoveryLog "Disabled KeepPrintedJobs for $printerName"
    $printer = Get-Printer -Name $printerName -ErrorAction Stop
  }
  Write-RecoveryLog "Printer found: $($printer.Name), status: $($printer.PrinterStatus)"

  # A jammed Windows spooler document can survive the browser, the print-agent
  # and even a workstation reboot. Remove only MpHub documents; never touch
  # labels or documents created by other programs.
  $mphubJobs = @(Get-PrintJob -PrinterName $printerName -ErrorAction Stop | Where-Object {
    [string]$_.DocumentName -like "MpHub-*"
  })
  foreach ($printJob in $mphubJobs) {
    try {
      Remove-PrintJob -PrinterName $printerName -ID ([int]$printJob.ID) -ErrorAction Stop
      Write-RecoveryLog "Removed stale MpHub spool job $($printJob.ID): $($printJob.DocumentName)"
    } catch {
      Write-RecoveryLog "Could not remove MpHub spool job $($printJob.ID): $($_.Exception.Message)"
    }
  }
  if ($mphubJobs.Count -gt 0) { Start-Sleep -Seconds 2 }
  $remainingMpHubJobs = @(Get-PrintJob -PrinterName $printerName -ErrorAction Stop | Where-Object {
    [string]$_.DocumentName -like "MpHub-*"
  })
  if ($remainingMpHubJobs.Count -gt 0) {
    Write-RecoveryLog "Restarting Windows Print Spooler for $($remainingMpHubJobs.Count) retained MpHub job(s)"
    Restart-Service -Name Spooler -Force -ErrorAction Stop
    (Get-Service -Name Spooler -ErrorAction Stop).WaitForStatus("Running", [TimeSpan]::FromSeconds(20))
    Start-Sleep -Seconds 2
    foreach ($printJob in @(Get-PrintJob -PrinterName $printerName -ErrorAction Stop | Where-Object { [string]$_.DocumentName -like "MpHub-*" })) {
      Remove-PrintJob -PrinterName $printerName -ID ([int]$printJob.ID) -ErrorAction Stop
      Write-RecoveryLog "Removed retained MpHub spool job $($printJob.ID) after Spooler restart"
    }
    Start-Sleep -Seconds 2
    $remainingMpHubJobs = @(Get-PrintJob -PrinterName $printerName -ErrorAction Stop | Where-Object {
      [string]$_.DocumentName -like "MpHub-*"
    })
    if ($remainingMpHubJobs.Count -gt 0) {
      # Last safe level: stop Spooler and remove only SPL/SHD files whose
      # numeric file name matches the exact MpHub job IDs captured above.
      # Never clear the whole PRINTERS folder: it may contain other programs'
      # documents.
      $stuckJobIds = @($remainingMpHubJobs | ForEach-Object { [int]$_.ID })
      $spoolPath = Join-Path $env:SystemRoot "System32\spool\PRINTERS"
      Write-RecoveryLog "Stopping Spooler for exact MpHub file cleanup: $($stuckJobIds -join ',')"
      Stop-Service -Name Spooler -Force -ErrorAction Stop
      (Get-Service -Name Spooler -ErrorAction Stop).WaitForStatus("Stopped", [TimeSpan]::FromSeconds(20))
      try {
        foreach ($spoolFile in @(Get-ChildItem -LiteralPath $spoolPath -File -ErrorAction Stop)) {
          $spoolJobId = 0
          if ([int]::TryParse([string]$spoolFile.BaseName, [ref]$spoolJobId) -and $stuckJobIds -contains $spoolJobId) {
            Remove-Item -LiteralPath $spoolFile.FullName -Force -ErrorAction Stop
            Write-RecoveryLog "Removed exact MpHub spool file $($spoolFile.Name)"
          }
        }
      } finally {
        Start-Service -Name Spooler -ErrorAction Stop
        (Get-Service -Name Spooler -ErrorAction Stop).WaitForStatus("Running", [TimeSpan]::FromSeconds(20))
      }
      Start-Sleep -Seconds 3
      $remainingMpHubJobs = @(Get-PrintJob -PrinterName $printerName -ErrorAction Stop | Where-Object {
        [string]$_.DocumentName -like "MpHub-*"
      })
      if ($remainingMpHubJobs.Count -gt 0) {
        throw "PRN-012: Windows retained the exact MpHub print job after protected spool cleanup"
      }
    }
  }

  $temporaryAgent = "$agentPath.download"
  Invoke-WebRequest -UseBasicParsing -Uri "$ServerUrl/fbs-print-agent-windows.ps1" -OutFile $temporaryAgent
  Move-Item -LiteralPath $temporaryAgent -Destination $agentPath -Force

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

  $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
  if ($null -eq $task) {
    $identity = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
    $actionArgs = "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$launcherPath`""
    $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $actionArgs
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity
    $trigger.Delay = "PT15S"
    $settings = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description "MpHub resilient silent FBS printing for Zebra" -Force | Out-Null
    $task = Get-ScheduledTask -TaskName $taskName
  }
  $restartRequested = $RequestUri -match "PRN-(002|005|007|009|011|012)"
  if ($task.State -eq "Running" -and $restartRequested) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      $_.ProcessId -ne $PID -and [string]$_.CommandLine -match 'MpHub\\FbsPrintAgent\\(run-agent|fbs-print-agent-windows)\.ps1'
    } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
    Start-ScheduledTask -TaskName $taskName
    Write-RecoveryLog "Agent task restarted for $RequestUri"
  } elseif ($task.State -ne "Running") {
    Start-ScheduledTask -TaskName $taskName
  }

  Invoke-WebRequest -UseBasicParsing -Uri "$ServerUrl/repair-fbs-print-agent-windows.ps1" -OutFile "$repairPath.download"
  Move-Item -LiteralPath "$repairPath.download" -Destination $repairPath -Force
  Register-RecoveryTools
  Send-RecoveryStatus -Config $config -Status "queue_ready" -Message "Windows MpHub print queue cleared"
  Write-RecoveryLog "Recovery completed; task started"

  Write-Host ""
  Write-Host "Printer recovery completed." -ForegroundColor Green
  Write-Host "Return to the FBS page and click 'Check again'."
  Write-Host "Log: $logPath"
} catch {
  $message = $_.Exception.Message
  Write-RecoveryLog "Recovery failed: $message"
  if ($null -ne $config) { Send-RecoveryStatus -Config $config -Status "recovery_error" -Message $message }
  Write-Host ""
  Write-Host "Could not recover printing." -ForegroundColor Red
  Write-Host $message -ForegroundColor Red
  Write-Host "Tell the administrator this error code."
  Write-Host "Log: $logPath"
}

Write-Host ""
Read-Host "Press Enter to close"
