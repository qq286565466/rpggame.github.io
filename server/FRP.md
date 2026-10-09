# SakuraFrp / frp 开服说明

远程好友连不上，常见原因不是游戏坏了，而是**地址发错**或**隧道类型不对**。

## 正确流程

1. 本机启动游戏服务（先能本机打开 `http://127.0.0.1:4321`）。
2. 在 SakuraFrp 创建隧道：
   - **类型：TCP**（推荐；HTTP/HTTPS 隧道需确认支持 WebSocket 升级）
   - **本地 IP：`127.0.0.1`**
   - **本地端口：`4321`**（与 `PORT` 一致）
3. 启动隧道，复制「访问地址」，例如 `abc.sakurafrp.com:23456`。
4. 用穿透地址重新部署：

```bat
node server\deploy.mjs --public=http://abc.sakurafrp.com:23456
```

或 PowerShell：

```powershell
$env:PUBLIC_URL="http://abc.sakurafrp.com:23456"
npm.cmd run deploy
```

5. 把下面任一方式发给好友：
   - **页面**：`http://abc.sakurafrp.com:23456`
   - **联机栏**：`ws://abc.sakurafrp.com:23456/ws`
   - **一键链接**（部署后在 `/host` 面板复制）：会自动带上 `?ws=`

## 好友侧

1. 用浏览器打开服主给的**穿透页面地址**（不要用服主电脑的 `127.0.0.1`）。
2. 登录进藏身处 → 点「联机」。
3. 联机地址应已是 `ws://…/ws`；若空白，手动粘贴服主给的联机地址 →「接入大厅」。

若穿透域名是 **https**，联机必须是 **wss://…/ws**（部署时 `PUBLIC_URL` 写成 `https://…` 即可自动生成）。

## 常见错误

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 好友连不上 | 仍打开 127.0.0.1 / 局域网 IP | 改用穿透访问地址 |
| 网页能开但联机失败 | 联机栏仍是 ws://127.0.0.1 | 填 `ws://穿透地址/ws` 或用一键链接 |
| 隧道已开仍失败 | 用了不支持 WS 的 HTTP 隧道 | 改 TCP 隧道 |
| 本地端口不一致 | FRP 本地端口不是 4321 | 与 `deploy` 的 PORT 对齐 |
| https 页面 + ws:// | 浏览器混合内容拦截 | PUBLIC_URL 用 https，联机用 wss |

## 自检

- 服主本机：`http://127.0.0.1:4321/api/health` 返回 ok  
- 外网：`http://穿透地址/api/health` 也应返回 ok  
- 服主面板：`http://127.0.0.1:4321/host` 应显示已配置的穿透地址  
