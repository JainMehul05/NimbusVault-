@echo off
setlocal DisableDelayedExpansion
title Start NimbusVault
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\launcher.ps1" -Action start
set "NIMBUS_EXIT=%ERRORLEVEL%"
echo.
if not "%NIMBUS_NO_PAUSE%"=="1" pause
exit /b %NIMBUS_EXIT%
