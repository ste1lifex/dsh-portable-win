@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-dsh.ps1" %*
if errorlevel 1 pause
