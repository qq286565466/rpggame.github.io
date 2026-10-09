@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo  时空猪 · 服主部署（Windows）
echo  --------------------------------
echo  SakuraFrp：先开 TCP 隧道，本地 127.0.0.1:4321
echo  然后可用（把地址换成你的访问地址）：
echo    node server\deploy.mjs --public=http://xxx.sakurafrp.com:端口
echo  说明见 server\FRP.md
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [错误] 未找到 Node.js。请先安装：https://nodejs.org
  echo 安装后重新打开此窗口再试。
  pause
  exit /b 1
)

if not "%PUBLIC_URL%"=="" (
  echo 使用 PUBLIC_URL=%PUBLIC_URL%
  node server\deploy.mjs --public=%PUBLIC_URL%
) else if not "%~1"=="" (
  echo 使用穿透地址 %~1
  node server\deploy.mjs --public=%~1
) else (
  where npm.cmd >nul 2>&1
  if not errorlevel 1 (
    call npm.cmd run deploy
  ) else (
    node server\deploy.mjs 4321
  )
)

echo.
pause
