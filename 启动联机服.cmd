@echo off
setlocal EnableExtensions
cd /d "%~dp0"

REM Double-click: keep console open even if script errors mid-way
if /I not "%~1"=="--sticky" (
  cmd /k call "%~f0" --sticky %*
  exit /b
)

chcp 65001 >nul
title 时空猪 · 联机服务端
echo.
echo  时空猪 · 服主部署（Windows）
echo  --------------------------------
echo  本窗口请保持打开；关掉即停止联机服。
echo  SakuraFrp：先开 TCP 隧道，本地 127.0.0.1:4321
echo  示例：启动联机服.cmd http://xxx.sakurafrp.com:端口
echo  也可双击 start-online.cmd（英文文件名）
echo  说明见 server\FRP.md
echo.

where node >nul 2>&1
if errorlevel 1 goto :no_node

if not exist "server\deploy.mjs" (
  echo [错误] 找不到 server\deploy.mjs
  echo 请把本脚本放在游戏仓库根目录再双击。
  echo 当前目录: %CD%
  echo.
  pause
  exit /b 1
)

REM %1 is --sticky; %2 optional public URL or --public=...
set "EXTRA="
if not "%~2"=="" set "EXTRA=%~2"
if "%EXTRA%"=="" if not "%PUBLIC_URL%"=="" set "EXTRA=--public=%PUBLIC_URL%"

echo 正在启动…（直接 node，不经过 npm）
echo.

if "%EXTRA%"=="" (
  node server\deploy.mjs 4321
) else (
  echo %EXTRA% | findstr /I /B /C:"--public=" >nul
  if not errorlevel 1 (
    echo 使用穿透参数: %EXTRA%
    node server\deploy.mjs %EXTRA%
  ) else (
    echo 使用穿透地址: %EXTRA%
    node server\deploy.mjs --public=%EXTRA%
  )
)

set "ERR=%ERRORLEVEL%"
echo.
if not "%ERR%"=="0" (
  echo [错误] 服务端已退出，代码 %ERR%
  echo 常见原因：
  echo   1^) 端口 4321 已被占用 — 关掉旧的黑窗口，或: node server\deploy.mjs 4322
  echo   2^) 未安装 Node.js / 太旧 — https://nodejs.org
  echo   3^) 不在完整仓库根目录运行
) else (
  echo 服务端已正常结束。
)
echo.
pause
exit /b %ERR%

:no_node
echo [错误] 未找到 Node.js。请先安装：https://nodejs.org
echo 安装后重新打开此窗口再试。
echo.
pause
exit /b 1
