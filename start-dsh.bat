@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-dsh.ps1" %*
if errorlevel 1 (
  echo.
  pause
)
