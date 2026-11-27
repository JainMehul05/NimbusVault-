@echo off
setlocal DisableDelayedExpansion
title Start NimbusVault AWS
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launcher.ps1" -Action aws-start
set "NIMBUS_EXIT=%ERRORLEVEL%"
echo.
if not "%NIMBUS_NO_PAUSE%"=="1" pause
exit /b %NIMBUS_EXIT%
