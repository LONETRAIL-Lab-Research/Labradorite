@echo off
setlocal
if not "%~1"=="" goto command
"%~dp0node.exe" "%~dp0cli.mjs" setup
set "setup_status=%errorlevel%"
pause
exit /b %setup_status%
:command
"%~dp0node.exe" "%~dp0cli.mjs" %*
exit /b %errorlevel%
