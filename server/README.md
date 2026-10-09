# 时空猪 · 联机服务端

零依赖 Node.js 服务：同时提供游戏静态站与 WebSocket 大厅。

## 职责

| 能力 | 说明 |
| --- | --- |
| 大厅现身 | 藏身处同步其他旅人位置 |
| 组队 | 创建 / 邀请 / 接受（最多 4 人） |
| 副本中继 | 房主权威：转发输入与快照；服务端不跑战斗 |
| 单刷 | 未组队时联机进本等同单人 |

## 启动

```bash
# 仓库根目录
npm run online
# 或
node server/index.mjs 4321

# 环境变量
PORT=4321 HOST=0.0.0.0 MAX_PEERS=64 node server/index.mjs
```

浏览器打开 `http://127.0.0.1:4321`，点「联机」接入。

## HTTP API

| 路径 | 说明 |
| --- | --- |
| `GET /api/health` | 存活探测 |
| `GET /api/status` | 在线人数、房间、版本、uptime |
| `GET /api/online` | 同 status（兼容旧客户端） |
| `GET /api/rooms` | 当前队伍列表 |

## WebSocket ` /ws `

客户端协议摘要（JSON 文本帧）：

- `hello` → `welcome`：接入并拿到 `id` 与同伴列表
- `hub_pos`：藏身处位置广播
- `char_sync`：同步角色压缩包（进本用）
- `party_create` / `party_invite` / `party_accept` / `party_leave`
- `dungeon_start` / `dungeon_input` / `dungeon_snap` / `dungeon_end`
- `ping` → `pong`：应用层心跳

## 部署到公网

GitHub Pages 只能托管静态站，**不能**跑本服务。需要一台能跑 Node 的机器（VPS / 云主机）：

```bash
git clone <repo> && cd rpggame.github.io
npm run build          # 可选：刷新 dist
PORT=80 node server/index.mjs
```

玩家在联机面板把地址改成：

```
ws://你的域名或IP:端口/ws
```

若前置 HTTPS 反代，使用 `wss://`。Nginx 示例：

```nginx
location /ws {
  proxy_pass http://127.0.0.1:4321;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
}
location / {
  proxy_pass http://127.0.0.1:4321;
}
```

## 架构

```
浏览器 A / B  ──WebSocket──►  本服务（大厅 + 中继）
                │
                ├─ 藏身处：广播 hub_pos
                ├─ 组队：维护 party
                └─ 副本：房主跑 sim，快照/输入经服务转发
```
