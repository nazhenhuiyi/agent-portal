# 部署与持续运行

服务端负责处理请求和保存数据；**自动重启、开机启动和日志保留由外部工具负责**。按运行环境选择一种方式即可，项目不提供 `service install` 等守护命令。

本文使用已实现的 `agent-portal-server` 命令。当前提供 `.tgz` 安装包，尚未上传公共 npm registry；安装方式见下文。

## 选哪一种

| 场景 | 建议 | 自动恢复与边界 |
|---|---|---|
| 临时试用、调试 | 直接运行 | 退出后手动启动 |
| macOS 个人电脑 | [launchd LaunchAgent](macos-launchd.md) | 登录后启动，进程退出后重启；注销后停止 |
| 希望用熟悉的 Node.js 工具管理 | [PM2](pm2.md) | 进程退出后重启；登录/开机恢复需额外配置 |
| Linux 常开服务器 | [systemd](linux-systemd.md) | 开机启动，异常退出后重启 |

同一套服务只选一个管理器，保持单进程运行，不启用 PM2 cluster。以上方式处理的是进程退出，不能保证发现进程卡死，也不能让睡眠或关机的电脑继续提供服务。

## 先在前台跑通

需要 Node.js 22。用自己的系统用户安装收到的包：

```sh
npm install -g ./agent-portal-server-0.3.0.tgz
agent-portal-server init
agent-portal-server start
```

看到监听地址后服务已启动。用 Ctrl+C 停止，再交给选定的进程管理器。从源码制作包时，在仓库根目录执行 `npm --prefix server ci` 和 `npm run pack:server`；安装后不再依赖源码仓库。

本文统一使用默认数据目录，避免与安装目录混在一起：

| 内容 | 位置 |
|---|---|
| 数据库和初始化凭据 | `~/.local/share/agent-portal/` 中的 portal.sqlite、credentials.json |
| 保存的监听设置 | 同目录的 config.json |
| 服务代码 | npm 安装目录，升级可替换 |

已有源码版 `.local` 数据时，先停止旧服务并备份，给新命令加 `--data-dir /absolute/path/to/repo/.local` 即可继续使用。init 可为该目录补上配置文件而保留原令牌；不要在新目录初始化空数据库代替迁移。数据目录可由用户自行移动，但所有命令和管理器必须使用同一位置。

## 配置一次，交给管理器启动

初始化时保存监听配置，之后 start 直接读取：

```sh
agent-portal-server init --host 127.0.0.1 --port 8080
agent-portal-server start
```

首次 init 创建凭据；重复执行保留数据和令牌。start 上的 `--host`、`--port` 只覆盖本次运行。自定义数据目录用 `--data-dir DIR`，之后每次调用均带上它。

旧的 `PORTAL_HOST`、`PORTAL_PORT`、`PORTAL_DB` 环境变量仍兼容。优先级为命令行 > 环境变量 > 保存的配置 > 默认值；--data-dir 优先于 PORTAL_DB。业务 Agent CLI 的 `config set` 是另一份连接配置，与服务端独立。

为管理器查找绝对路径：

```sh
command -v node
npm root -g
```

服务入口在第二条命令输出目录下的 `agent-portal-server/bin/agent-portal-server.mjs`。下文直接用 Node 执行该入口并传入 start，避免依赖交互 shell、nvm 初始化和 PATH。升级 Node 后若全局安装目录改变，需要在新环境安装包，并更新管理器路径。

默认只允许本机连接。手机或其他机器访问时，用户需自行配置可达网络、监听地址及 HTTPS 入口；`0.0.0.0` 只是监听所有 IPv4 接口，不是客户端地址，也不会自动提供 HTTPS。正式 Android 包要求 HTTPS，debug 包才允许本地 HTTP。

## 判断服务是否可用

先运行 `agent-portal-server config show` 核对实际的数据目录和监听设置（自定义目录需带 --data-dir），再看管理器状态和日志，确认没有反复启动、端口占用或数据库访问错误。需要检查 HTTP 路径时，使用已配置好的 Agent CLI：

```sh
agent-portal capabilities
```

它要求有效令牌，成功说明服务能响应并验证身份。当前没有独立 `/health` 接口；此命令也不证明发布链路或手机接收正常。外部监控可以定期检查并告警，是否在无响应时重启由部署者决定。

## 升级、备份与排错

- **备份**：先通过选定管理器停止服务，再备份整个数据目录。SQLite 使用 WAL，运行中不要只复制主数据库文件。凭据文件也需妥善保管。
- **升级**：停止服务、备份数据、用 `npm install -g <新版.tgz>` 安装，然后使用同一数据目录启动。普通升级和重启不需要再次 init。
- **恢复备份**：停止服务并恢复数据后，先运行下方命令使旧客户端重新同步，再由管理器启动服务。数据库迁移后不要直接用旧版本程序打开新数据库。
- **持续失败**：检查绝对路径、文件权限、端口及 Node 版本。自动重启无法修复错误配置；先停止重启循环，再排查原因。
- **日志**：配置轮转或保留上限。launchd/PM2 输出文件与 systemd journal 的管理方式不同，见对应文档。

恢复备份后执行（自定义目录时带上 --data-dir）：

```sh
agent-portal-server rotate-epoch
```

这些部署方式不会改变 Android 当前仅前台同步的限制。要让服务全天可用，应选择持续供电、联网且不会睡眠的运行环境。
