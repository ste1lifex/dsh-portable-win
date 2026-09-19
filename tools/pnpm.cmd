@echo off
setlocal
"%~dp0..\node\bin\node.exe" "%~dp0..\node\node_modules\pnpm\bin\pnpm.mjs" %*
exit /b %ERRORLEVEL%
