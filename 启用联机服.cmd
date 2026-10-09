@echo off
REM 兼容「启用联机服.cmd」误记文件名
setlocal EnableExtensions
cd /d "%~dp0"
call "%~dp0启动联机服.cmd" %*
exit /b %ERRORLEVEL%
