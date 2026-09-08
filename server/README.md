# Agent Portal Server

独立运行的通知和小组件数据服务。需要 **Node.js 22**，自带 SQLite，无需另装数据库。服务在前台运行，进程守护由用户选择 launchd、PM2 或 systemd。

## 安装并启动

当前提供 npm 格式的 `.tgz` 安装包，尚未发布到公共 npm registry。收到安装包后执行：

```sh
npm install -g ./agent-portal-server-0.3.0.tgz
agent-portal-server init
agent-portal-server start
```

默认监听 `http://127.0.0.1:8080`。服务运行期间另开终端演示：

```sh
agent-portal-server demo running
agent-portal-server demo completed
```

演示会创建 demo 主题和模板，再更新小组件条目及独立通知。服务本身只展示数据，不执行 Agent 任务或生成详情网站。

## 配置和数据

查看实际生效的路径、监听地址和端口：

```sh
agent-portal-server config show
```

输出 JSON，不读取或显示令牌。未初始化时也可查看，不会创建数据库；database_exists 仅表示文件存在，不是健康检查。使用独立目录时加同一个 --data-dir。

所有命令默认使用当前用户的 `~/.local/share/agent-portal`（Windows 的 `~` 是用户主目录）。文件不放在 npm 安装目录，卸载或重装包不会删除它们。

| 文件 | 用途 |
|---|---|
| `config.json` | 服务监听地址和端口，无令牌 |
| `portal.sqlite` 及 WAL 文件 | 数据、历史和令牌哈希 |
| `credentials.json` | 初始化产生的 admin、demo writer、demo reader 凭据 |

初始化时可保存监听配置：

```sh
agent-portal-server init --host 127.0.0.1 --port 8081
agent-portal-server start
```

重复 init 会保留数据和令牌，并保存新的监听设置；已撤销的令牌不会恢复。start 上的 `--host`、`--port` 只覆盖本次运行。改变持久配置后需重启服务。启动时数据库不存在会提示先 init。

需要独立数据目录时，所有命令使用相同路径：

```sh
agent-portal-server init --data-dir /absolute/path/to/data
agent-portal-server start --data-dir /absolute/path/to/data
```

配置优先级：命令行参数 > 兼容环境变量 > config.json > 默认值。兼容 `PORTAL_HOST`、`PORTAL_PORT`、`PORTAL_DB`；`--data-dir` 优先于 PORTAL_DB。业务 Agent CLI 的服务地址、Keychain 令牌与这些服务端设置独立。

为手机配置 reader，为业务 Agent 配置 writer；不要把管理员令牌放进普通客户端。credentials.json 是服务端本地初始化凭据，普通 Agent CLI 不会自动读取。默认仅监听本机；其他设备的网络可达性和 HTTPS 入口由部署者配置。

## 管理和运行

```sh
agent-portal-server token create read,write my-topic
agent-portal-server token list
agent-portal-server token revoke TOKEN_ID
```

创建输出包含一次性明文令牌；list 不输出令牌。创建令牌不会自动创建主题，主题由有管理权限的 HTTP 客户端创建。更多命令见 `agent-portal-server --help`。

- Ctrl+C 或 SIGTERM 请求正常停服；开放的 SSE 连接也会关闭。
- 备份或升级前先停服。SQLite 使用 WAL，备份整个数据目录，升级后继续使用同一目录。
- 恢复数据库备份后，在启动前执行 `agent-portal-server rotate-epoch`；普通重启无需执行。
- 数据库迁移后不要直接用旧版程序打开新库；回退应恢复匹配的备份。

自动重启、开机启动和日志轮转见包内的[部署说明](deployment/README.md)。不要同时启动多个管理器或 PM2 cluster。

## 从源码构建与验证

在完整仓库根目录执行：

```sh
npm --prefix server ci
npm run build:server
npm run test:server
npm run test:cli
npm run test:server-package
npm run pack:server
```

pack 自动构建，输出 `agent-portal-server-0.3.0.tgz`。包只携带编译代码、协议 Schema、演示素材和部署说明，不包含运行数据或开发依赖。安装会获取 SQLite、图片处理的原生依赖；预编译包不可用的平台可能需要本地编译工具。

安装包验收覆盖仓库外安装、初始化、模板及演示发布、SSE 停服、强制退出后的数据恢复、卸载重装后数据与凭据保留。目前实测 macOS / Node.js 22，Windows/Linux 尚未实机验证。

## 维护者发布

当前 npm 包名为 `agent-portal-server`。公开发布前需确认 npm 账号对该包名的发布权限及项目许可证；目前未声明开放使用许可（UNLICENSED）。在源码验收和安装包验收通过后，用已登录账号执行：

```sh
npm publish ./agent-portal-server-0.3.0.tgz --access public
```

这一步才会上传公共 registry。本仓库的 build、pack、test 都不会自动发布。
