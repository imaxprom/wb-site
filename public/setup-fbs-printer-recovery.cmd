@echo off
setlocal
title MpHub FBS Printer Recovery Setup
set "MPHUB_SCRIPT=%TEMP%\update-fbs-print-agent-windows.ps1"
echo Downloading the MpHub printer recovery update...
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri 'https://hub.imaxprom.site/update-fbs-print-agent-windows.ps1' -OutFile '%MPHUB_SCRIPT%'; & '%MPHUB_SCRIPT%'"
if errorlevel 1 (
  echo.
  echo Update failed. Tell the administrator code PRN-010.
) else (
  echo.
  echo Update completed. The recovery button is ready.
)
echo.
pause
endlocal
