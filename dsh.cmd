@echo off
rem Portable dsh CLI entry: dsh.cmd --profile headless "your task"
rem Always use the bundled harness home (dsh-home) so profiles, plugins,
rem sessions, and credentials travel with the package.
if not exist "%~dp0dsh-home" mkdir "%~dp0dsh-home"
set "DSH_HOME=%~dp0dsh-home"
cd /d "%~dp0app-npm"
"%~dp0node\bin\node.exe" node_modules\@deepseek-ai\dsh\lib\bin.js %*
