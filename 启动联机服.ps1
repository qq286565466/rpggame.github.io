# 时空猪 · 服主部署（若被执行策略拦截，请改用 启动联机服.cmd）
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot

Write-Host ''
Write-Host ' 时空猪 · 服主部署'
Write-Host ' --------------------------------'

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host '[错误] 未找到 Node.js。请安装 https://nodejs.org' -ForegroundColor Red
  exit 1
}

# 直接调用 npm.cmd，绕过 npm.ps1
$npmCmd = Join-Path (Split-Path (Get-Command node).Source) 'npm.cmd'
if (Test-Path $npmCmd) {
  & $npmCmd run deploy
} else {
  node .\server\deploy.mjs 4321
}
