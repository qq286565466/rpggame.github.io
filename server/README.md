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

### 服主一键部署（推荐）

**Windows（PowerShell 报「禁止运行脚本」时）：**

- 双击仓库根目录的 `启动联机服.cmd`，或
- 在终端执行：`npm.cmd run deploy` / `node server\deploy.mjs 4321`

可选：当前用户放开脚本（仅本机）  
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`

**通用：**

```bash
npm run deploy
# 或
npm run host
```

会自动：

1. 探测局域网 IP / 公网 IP  
2. **打印必须映射的端口与内部 IP**（TCP，默认 `4321`）  
3. 写出 `host-card.txt`  
4. 启动联机服务，并提供服主面板 `http://127.0.0.1:4321/host`

### 仅启动服务（不探测）

```bash
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
| `GET /api/host` | 服主部署信息（需先 `npm run deploy`） |
| `GET /host` | 服主面板：端口映射提醒与可复制地址 |
| `GET /host-card.txt` | 纯文本服主卡片 |

## 端口映射（服主必看）

| 项 | 值 |
| --- | --- |
| 协议 | **TCP** |
| 外部端口 | 与 `PORT` 相同（默认 **4321**） |
| 内部 IP | 运行 `deploy` 时打印的局域网 IP |
| 内部端口 | 同外部端口 |

HTTP 页面与 WebSocket `/ws` **共用该端口**，路由器只需做一条转发。

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
