时空猪 · 服主部署脚本（导出包）

【前提】
1. 已安装 Node.js 18+（https://nodejs.org）
2. 本导出包需放在完整游戏仓库根目录旁使用，或直接在仓库里运行：

   npm run deploy

【仓库内用法（推荐）】
在 rpggame 仓库根目录执行：

   npm run deploy
   # 或
   npm run host
   # 或
   node server/deploy.mjs 4321

【Windows PowerShell 报「禁止运行脚本」】
这是系统拦截了 npm.ps1，不是游戏坏了。任选其一：

   1) 双击仓库根目录「启动联机服.cmd」（或 start-online.cmd）
      窗口会保持打开；端口占用时会显示错误而不是闪退
   2) npm.cmd run deploy
   3) node server\deploy.mjs 4321
   4) 可选：Set-ExecutionPolicy -Scope CurrentUser RemoteSigned

【本包文件】
- deploy.mjs      一键部署入口（探测 IP → 提示端口映射 → 启动服务）
- hostinfo.mjs    局域网/公网 IP 探测与服主卡片文案
- index.mjs       联机服务端（HTTP + WebSocket）
- lobby.mjs       大厅/组队/副本中继
- ws.mjs          WebSocket 帧编解码
- README.md       服务端说明
- 启动服主部署.bat / .sh  快捷启动（需在仓库根目录的上一级相对路径可用时调整）

【服主必须映射】
- 协议：TCP
- 端口：默认 4321（HTTP 与联机 WS 共用，只映射一次）
- 内部 IP：运行 deploy 后终端会打印；也可打开 http://127.0.0.1:4321/host

【发给好友】
- 局域网：页面 http://<局域网IP>:4321 ，联机填 ws://<局域网IP>:4321/ws
- 外网：先做端口转发，再给公网 IP 对应地址
