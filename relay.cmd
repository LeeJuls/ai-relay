@echo off
setlocal
if exist "%~dp0runtime\node.exe" (
  "%~dp0runtime\node.exe" "%~dp0bin\relay.mjs" %*
) else (
  node "%~dp0bin\relay.mjs" %*
)
exit /b %errorlevel%
