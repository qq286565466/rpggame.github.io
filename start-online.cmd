@echo off
REM ASCII alias — same as 启动联机服.cmd
setlocal EnableExtensions
cd /d "%~dp0"
if exist "%~dp0启动联机服.cmd" (
  call "%~dp0启动联机服.cmd" %*
  exit /b %ERRORLEVEL%
)
echo [ERROR] 启动联机服.cmd missing next to start-online.cmd
pause
exit /b 1
