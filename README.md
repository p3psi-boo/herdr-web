# herdr-web

herdr 的 Web 网关：一个 Bun 进程同时提供 Web UI 和浏览器 ⇄ herdr 的 WebSocket 桥。默认只监听 `127.0.0.1:7317`。

主要能力：

- 多设备切换：本地 herdr，或经 SSH ControlMaster 连接的远程主机
- 浏览器内终端：基于 ghostty-web，支持滚轮、Shift 加方向键或 PageUp/PageDown 滚动，以及 `Cmd+F` 页内搜索
- 通知中心：agent 从 working 转入 blocked、done 或 idle 时自动产生条目；外部程序也可通过 HTTP 接口写入

打包只走 Docker：编译产物是带 Bun 运行时的单二进制，运行时镜像另有 `openssh-client`。SSH 认证使用宿主机的 ssh-agent，密钥文件不进镜像。

## 使用

首次启动会在日志里打印完整的登录 URL（含可用的 token）和登录密码：

```
herdr-web listening on http://127.0.0.1:7317/?token=…
login password: …
```

打开该 URL 即处于登录状态；也可以访问根路径，用密码登录。密码登录产生的 session 保存在内存中，进程重启后失效，需要重新登录；启动 URL 里的 token 则始终可用。

日常操作集中在左侧栏：

- 「New Terminal」在当前设备新建工作区；「Spaces」「Agents」列表用于切换窗格
- 底部的设备菜单负责添加、切换、移除 SSH 设备；设备列表持久化到 `~/.config/herdr-web/devices.json`
- 「Notifications」查看通知；点击带窗格信息的通知会跳转到对应终端

### HTTP 接口

除页面外提供以下接口。除 `/api/login` 外均要求 token，三种传递方式等效：query 参数 `?token=`、请求头 `Authorization: Bearer <token>`、请求体字段 `token`。

| 方法 | 路径 | 说明 |
|---|---|---|
| `POST /api/login` | | 用 `{"password":"…"}` 换取 session token |
| `POST /api/check` | | 校验 token 是否有效，有效返回 204 |
| `POST /api/notify` | | 写入一条通知并广播给所有已连接的浏览器 |
| `GET /api/notifications` | | 返回当前通知箱 `{notifications, unread}` |

写入通知时 `title` 必填，缺省返回 400；`kind` 可选 `blocked/done/idle/custom`，`sound` 可选 `none/done/request`，其余字段留空按未知处理。示例：

```bash
curl -X POST http://127.0.0.1:7317/api/notify \
  -H "authorization: Bearer $TOKEN" \
  -H "content-type: application/json" \
  -d '{"title":"code review","body":"等待确认","paneId":"w1:p1"}'
```

## 部署

### Docker

```bash
docker build -t herdr-web .
```

运行时镜像是 `debian:bookworm-slim`，安装了 `openssh-client` 和 `ca-certificates`；应用本体是单个二进制 `/usr/local/bin/herdr-web`。

容器内的 `ssh` 以 `BatchMode=yes` 运行，不会交互询问密码或密钥口令，因此认证必须依赖注入的 ssh-agent。典型运行命令：

```bash
docker run -d --name herdr-web \
  -p 127.0.0.1:7317:7317 \
  -e HERDR_WEB_HOST=0.0.0.0 \
  -e HERDR_WEB_PASSWORD=... \
  -e HERDR_WEB_TOKEN=... \
  -v ~/.ssh:/root/.ssh:ro \
  -v /run/host-services/ssh-auth.sock:/ssh-agent \
  -e SSH_AUTH_SOCK=/ssh-agent \
  -v ~/.config/herdr-web:/root/.config/herdr-web \
  herdr-web
```

`HERDR_WEB_HOST=0.0.0.0` 只是容器内绑定；端口映射仍是 `127.0.0.1:7317`，宿主机侧保持 loopback。

### macOS（OrbStack / Docker Desktop）上的约束

- 不要 bind-mount macOS 的 `$SSH_AUTH_SOCK`：该路径经过 virtiofs 后只剩 inode，结果是 `Connection refused`。应使用 OrbStack / Docker Desktop 注入的 `/run/host-services/ssh-auth.sock`，它对接宿主机 agent（rbw、1Password、`ssh-agent` 都可以）。这是客户端侧复用 agent，不是 `ForwardAgent` 把钥匙转到远端。
- `~/.ssh` 只需提供 `config`、`known_hosts` 以及 `Include` 指向的 `~/.ssh/` 下文件。容器内 `HOME` 是 `/root`，所以 `Include ~/.ssh/config.d/*` 仍然有效；但 `IdentityFile` 写成 `/Users/…` 这种宿主机绝对路径会失效。
- 出于同样的 virtiofs 原因，也不要 bind-mount `~/.config/herdr/herdr.sock`。

综合以上：容器内只使用 SSH 设备；需要 Local 设备时，改在宿主机上运行（见下）。

### 确认 agent 可用

```bash
docker exec -e SSH_AUTH_SOCK=/ssh-agent herdr-web ssh-add -l
docker exec -e SSH_AUTH_SOCK=/ssh-agent herdr-web \
  ssh -o BatchMode=yes -o ConnectTimeout=8 <host> true
```

第一条应列出与宿主机 `ssh-add -l` 相同的钥匙；第二条应在远端 sshd 正常且 `known_hosts` 已有该主机的前提下免密通过。

### 在宿主机运行

需要安装 [Bun](https://bun.sh) 和本机 herdr：

```bash
bun install --frozen-lockfile
bun run start
```

配置和登录密码都在 `~/.config/herdr-web/`：`devices.json` 是设备列表，`config.json` 存放生成的登录密码。

### 环境变量

| 变量 | 默认 | 作用 |
|---|---|---|
| `HERDR_WEB_HOST` | `127.0.0.1` | 监听地址。容器内设为 `0.0.0.0` |
| `HERDR_WEB_PORT` | `7317` | 监听端口 |
| `HERDR_WEB_PASSWORD` | 首次运行写入 `~/.config/herdr-web/config.json` | Web 登录密码 |
| `HERDR_WEB_TOKEN` | 随机 UUID | 启动日志里 `?token=` 的值，进程存活期间始终有效 |
| `HERDR_SOCKET_PATH` | `~/.config/herdr/herdr.sock` | 本地 herdr API socket（容器内 Local 设备不可用，见上） |
| `SSH_AUTH_SOCK` | （进程环境） | ssh 客户端连接 agent 的 unix socket |

## 开发

前置条件：本机安装 [Bun](https://bun.sh) 和 herdr。

```bash
bun install --frozen-lockfile
bun run dev   # 开发模式，文件变更自动重启
```

常用校验命令：

| 命令 | 作用 |
|---|---|
| `bun run check` | TypeScript 类型检查（`tsc --noEmit`） |
| `bun test` | 单元测试：store 选区逻辑、命令会话路由、通知规则、SSH 配置解析、终端参数拼装 |
| `bun run test:ws` | 对运行中的网关做 WebSocket 冒烟测试 |

代码分为三部分：`src/server` 是 Bun 服务端（鉴权、设备与会话管理、SSH 隧道、herdr 客户端），`src/web` 是 React UI，`src/shared` 定义两端共用的协议类型。
