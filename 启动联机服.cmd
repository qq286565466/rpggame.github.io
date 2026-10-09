@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  时空猪 · 服主部署（Windows）
echo  --------------------------------
echo  若 PowerShell 报「禁止运行脚本」，请用本文件，或改用：
echo    npm.cmd run deploy
echo    node server\deploy.mjs 4321
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 Node.js。请先安装：https://nodejs.org
  echo 安装后重新打开此窗口再试。
  pause
  exit /b 1
)

REM 优先走 npm.cmd，避免 PowerShell 的 npm.ps1 被执行策略拦截
where npm.cmd >nul 2>&1
if not errorlevel 1 (
  call npm.cmd run deploy
) else (
  node server\deploy.mjs 4321
)

echo.
pause
