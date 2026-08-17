param(
  [string]$ServerUrl = $env:MPHUB_URL,
  [string]$Token = $env:MPHUB_PRINT_TOKEN,
  [string]$PrinterName = $env:MPHUB_PRINTER,
  [string]$ConfigPath = ""
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$AgentConnections = @()
$SeenTokens = @{}

function Add-AgentConnection {
  param([string]$ConnectionToken, [string]$ConnectionServerUrl, [string]$OrganizationId = "")
  if ([string]::IsNullOrWhiteSpace($ConnectionToken) -or $SeenTokens.ContainsKey($ConnectionToken)) { return }
  if ([string]::IsNullOrWhiteSpace($ConnectionServerUrl)) { $ConnectionServerUrl = "https://hub.imaxprom.site" }
  $SeenTokens[$ConnectionToken] = $true
  $script:AgentConnections += [PSCustomObject]@{
    Token = $ConnectionToken
    ServerUrl = $ConnectionServerUrl.TrimEnd("/")
    OrganizationId = $OrganizationId
  }
}

if (-not [string]::IsNullOrWhiteSpace($ConfigPath)) {
  if (-not (Test-Path -LiteralPath $ConfigPath)) { throw "Print-agent config was not found: $ConfigPath" }
  $config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  if (-not [string]::IsNullOrWhiteSpace([string]$config.ServerUrl)) { $ServerUrl = [string]$config.ServerUrl }
  if ([string]::IsNullOrWhiteSpace($PrinterName) -and -not [string]::IsNullOrWhiteSpace([string]$config.PrinterName)) {
    $PrinterName = [string]$config.PrinterName
  }
  foreach ($connection in @($config.Connections)) {
    Add-AgentConnection -ConnectionToken ([string]$connection.Token) -ConnectionServerUrl $(if ([string]::IsNullOrWhiteSpace([string]$connection.ServerUrl)) { $ServerUrl } else { [string]$connection.ServerUrl }) -OrganizationId ([string]$connection.OrganizationId)
  }
  # Backward compatibility with the original single-token config.json.
  Add-AgentConnection -ConnectionToken ([string]$config.Token) -ConnectionServerUrl $ServerUrl
}

Add-AgentConnection -ConnectionToken $Token -ConnectionServerUrl $ServerUrl
if ($AgentConnections.Count -eq 0) { throw "At least one MpHub print-agent token is required" }

$singleInstanceMutex = New-Object System.Threading.Mutex($false, "Local\MpHubFbsPrintAgent")
if (-not $singleInstanceMutex.WaitOne(0, $false)) {
  Write-Host "Another MpHub FBS print-agent process is already running."
  exit 0
}

if ([string]::IsNullOrWhiteSpace($PrinterName)) {
  $zebra = @(Get-Printer | Where-Object { $_.Name -match "ZT220" })
  if ($zebra.Count -eq 0) {
    $available = (Get-Printer | Select-Object -ExpandProperty Name) -join "; "
    throw "Zebra ZT220 was not found. Available printers: $available"
  }
  if ($zebra.Count -gt 1) {
    $available = ($zebra | Select-Object -ExpandProperty Name) -join "; "
    throw "More than one ZT220 was found. Pass -PrinterName. Available printers: $available"
  }
  $PrinterName = $zebra[0].Name
}

$printer = Get-Printer -Name $PrinterName -ErrorAction Stop
Write-Host "MpHub FBS print-agent"
Write-Host "Printer: $($printer.Name)"
Write-Host "Server: $ServerUrl"

Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class MpHubRawPrinter {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public class DOC_INFO_1 {
    [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
    [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
    [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
  }

  [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern bool OpenPrinter(string printerName, out IntPtr printer, IntPtr defaults);
  [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true)]
  private static extern bool ClosePrinter(IntPtr printer);
  [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", SetLastError = true, CharSet = CharSet.Unicode)]
  private static extern int StartDocPrinter(IntPtr printer, int level, [In] DOC_INFO_1 info);
  [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
  private static extern bool EndDocPrinter(IntPtr printer);
  [DllImport("winspool.drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
  private static extern bool StartPagePrinter(IntPtr printer);
  [DllImport("winspool.drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
  private static extern bool EndPagePrinter(IntPtr printer);
  [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true)]
  private static extern bool WritePrinter(IntPtr printer, byte[] bytes, int count, out int written);

  private static void LastError(string operation) {
    throw new Win32Exception(Marshal.GetLastWin32Error(), operation);
  }

  public static int Send(string printerName, string documentName, byte[] bytes) {
    IntPtr printer;
    if (!OpenPrinter(printerName, out printer, IntPtr.Zero)) LastError("OpenPrinter");
    int jobId = 0;
    bool documentStarted = false;
    bool pageStarted = false;
    try {
      var info = new DOC_INFO_1 { pDocName = documentName, pOutputFile = null, pDataType = "RAW" };
      jobId = StartDocPrinter(printer, 1, info);
      if (jobId == 0) LastError("StartDocPrinter");
      documentStarted = true;
      if (!StartPagePrinter(printer)) LastError("StartPagePrinter");
      pageStarted = true;
      int written;
      if (!WritePrinter(printer, bytes, bytes.Length, out written)) LastError("WritePrinter");
      if (written != bytes.Length) throw new InvalidOperationException("The printer did not accept all ZPL bytes");
      if (!EndPagePrinter(printer)) LastError("EndPagePrinter");
      pageStarted = false;
      if (!EndDocPrinter(printer)) LastError("EndDocPrinter");
      documentStarted = false;
      return jobId;
    } finally {
      if (pageStarted) EndPagePrinter(printer);
      if (documentStarted) EndDocPrinter(printer);
      ClosePrinter(printer);
    }
  }
}
"@

function Invoke-AgentApi {
  param([PSCustomObject]$Connection, [string]$Action, [hashtable]$Data = @{})
  $body = @{ action = $Action; printerName = $PrinterName }
  foreach ($key in $Data.Keys) { $body[$key] = $Data[$key] }
  return Invoke-RestMethod -Method Post -Uri "$($Connection.ServerUrl)/api/fbs/print-agent" `
    -Headers @{ Authorization = "Bearer $($Connection.Token)" } `
    -ContentType "application/json; charset=utf-8" `
    -Body ($body | ConvertTo-Json -Compress)
}

function Send-PngToPrinter {
  param([string]$FilePath, [string]$DocumentName)
  Add-Type -AssemblyName System.Drawing
  $image = [System.Drawing.Image]::FromFile($FilePath)
  $document = New-Object System.Drawing.Printing.PrintDocument
  try {
    $document.PrinterSettings.PrinterName = $PrinterName
    if (-not $document.PrinterSettings.IsValid) { throw "Windows cannot access printer $PrinterName" }
    $document.DocumentName = $DocumentName
    $document.PrintController = New-Object System.Drawing.Printing.StandardPrintController
    $document.OriginAtMargins = $false
    $document.DefaultPageSettings.Margins = New-Object -TypeName System.Drawing.Printing.Margins -ArgumentList 0, 0, 0, 0
    $document.DefaultPageSettings.PaperSize = New-Object -TypeName System.Drawing.Printing.PaperSize -ArgumentList "WB 58x40", 228, 157
    $handler = [System.Drawing.Printing.PrintPageEventHandler]{
      param($sender, $eventArgs)
      $eventArgs.Graphics.DrawImage($image, 0, 0, $eventArgs.PageBounds.Width, $eventArgs.PageBounds.Height)
      $eventArgs.HasMorePages = $false
    }
    $document.add_PrintPage($handler)
    $document.Print()
  } finally {
    if ($null -ne $handler) { $document.remove_PrintPage($handler) }
    $document.Dispose()
    $image.Dispose()
  }
  return 0
}

function Wait-PrintJob {
  param([PSCustomObject]$Connection, [int]$JobId, [string]$DocumentName)
  Start-Sleep -Milliseconds 250
  $missingPolls = 0
  $startedAt = Get-Date
  while ($true) {
    $jobs = @(Get-PrintJob -PrinterName $PrinterName -ErrorAction Stop)
    if ($JobId -gt 0) {
      $job = $jobs | Where-Object { $_.ID -eq $JobId } | Select-Object -First 1
    } else {
      $job = $jobs | Where-Object { $_.DocumentName -eq $DocumentName } | Select-Object -First 1
    }
    if ($null -eq $job) {
      $missingPolls += 1
      if ($missingPolls -ge 2) { return }
      Start-Sleep -Milliseconds 400
      continue
    }
    $missingPolls = 0
    $status = [string]$job.JobStatus
    # "Deleting" is the normal transient state while Windows removes a
    # successfully spooled document. Only an actually cancelled/deleted job is
    # an error; otherwise wait for the job to disappear from the queue.
    if ($status -match "Deleted|Cancelled|Canceled") {
      throw "The Windows print job was cancelled: $status"
    }
    if ($status -match "Error|Offline|PaperOut|UserIntervention|Blocked") {
      try { Invoke-AgentApi $Connection "heartbeat" @{ status = "printer_attention"; error = "Zebra: $status" } | Out-Null } catch {}
      Write-Warning "Zebra requires attention: $status"
    } else {
      try { Invoke-AgentApi $Connection "heartbeat" @{ status = "printing"; error = "" } | Out-Null } catch {}
    }
    if (((Get-Date) - $startedAt).TotalSeconds -ge 25) {
      # Windows may retain a jammed label and print it unexpectedly after a
      # reboot. Remove only this MpHub document, pause the server queue and ask
      # the operator whether the physical label actually came out.
      try {
        Remove-PrintJob -PrinterName $PrinterName -ID ([int]$job.ID) -ErrorAction Stop
      } catch {
        Write-Warning "Could not remove stalled Windows print job $($job.ID): $($_.Exception.Message)"
      }
      try { Invoke-AgentApi $Connection "heartbeat" @{ status = "printer_attention"; error = "Zebra did not finish the label within 25 seconds" } | Out-Null } catch {}
      throw "Zebra did not finish the label within 25 seconds. Confirm whether the physical label was printed."
    }
    # Poll the Windows spooler twice per second so the next label starts with
    # a short, predictable gap while printer/error control remains enabled.
    Start-Sleep -Milliseconds 500
  }
}

foreach ($connection in $AgentConnections) {
  try {
    Invoke-AgentApi $connection "heartbeat" @{ status = "online"; error = "" } | Out-Null
    $label = if ([string]::IsNullOrWhiteSpace([string]$connection.OrganizationId)) { "configured account" } else { "organization $($connection.OrganizationId)" }
    Write-Host "Agent connected: $label"
  } catch {
    Write-Warning "Could not connect one configured account: $($_.Exception.Message)"
  }
}
Write-Host "Waiting for jobs from $($AgentConnections.Count) account(s)..."

while ($true) {
  $printedInCycle = $false
  foreach ($connection in $AgentConnections) {
    $item = $null
    try {
      $response = Invoke-AgentApi $connection "claim"
      $item = $response.item
    } catch {
      Write-Warning "Account connection unavailable: $($_.Exception.Message)"
      continue
    }
    if ($null -eq $item) { continue }
    $printedInCycle = $true

    $documentName = "MpHub-$($item.job_id)-$($item.position)"
    $format = [string]$item.sticker_format
    if ([string]::IsNullOrWhiteSpace($format)) { $format = "png" }
    $extension = if ($format -like "zpl*") { ".zpl" } else { ".png" }
    $filePath = Join-Path ([IO.Path]::GetTempPath()) ("mphub-" + [guid]::NewGuid().ToString("N") + $extension)
    $physicalPrintCompleted = $false

    try {
      $stickerPayload = [string]$item.sticker_file
      if (($format -like "zpl*") -and ($stickerPayload.TrimStart().StartsWith("^XA") -or $stickerPayload.TrimStart().StartsWith("~DG"))) {
        # Compatibility with queues created before the server normalized every
        # sticker payload to Base64.
        $bytes = [Text.Encoding]::UTF8.GetBytes($stickerPayload)
      } else {
        $bytes = [Convert]::FromBase64String($stickerPayload)
      }
      [IO.File]::WriteAllBytes($filePath, $bytes)
      if ($format -like "zpl*") {
        $jobId = [MpHubRawPrinter]::Send($PrinterName, $documentName, $bytes)
      } else {
        $jobId = Send-PngToPrinter $filePath $documentName
      }
      Wait-PrintJob $connection $jobId $documentName
      $physicalPrintCompleted = $true
      $confirmationAttempt = 0
      while ($true) {
        try {
          Invoke-AgentApi $connection "complete" @{ jobId = [string]$item.job_id; position = [int]$item.position } | Out-Null
          break
        } catch {
          $confirmationAttempt += 1
          if ($confirmationAttempt -ge 10) { throw }
          Write-Warning "Label printed; retrying server confirmation ($confirmationAttempt/10): $($_.Exception.Message)"
          try { Invoke-AgentApi $connection "heartbeat" @{ status = "printing"; error = "Waiting for print confirmation" } | Out-Null } catch {}
          Start-Sleep -Seconds 2
        }
      }
      Write-Host "Printed $($item.position)/$($item.total_count)"
    } catch {
      $message = if ($physicalPrintCompleted) { "Label was printed, but server confirmation failed: $($_.Exception.Message)" } else { $_.Exception.Message }
      try { Invoke-AgentApi $connection "pause" @{ jobId = [string]$item.job_id; position = [int]$item.position; error = $message } | Out-Null } catch {}
      Write-Error "Printing paused: $message" -ErrorAction Continue
      Start-Sleep -Seconds 5
    } finally {
      Remove-Item -LiteralPath $filePath -Force -ErrorAction SilentlyContinue
    }
  }
  if (-not $printedInCycle) { Start-Sleep -Seconds 2 }
}
