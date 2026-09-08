# Agent Portal

自行实现的轻量数据展示系统：TypeScript / Fastify / SQLite 服务端，Kotlin 原生 Android 客户端。App 只有设置和历史，小组件呈现当前内容，通知提醒重要变化。

首版在 App 前台同步；离开 App 后保留已有内容。没有后台常驻服务、厂商推送、网站托管或业务执行功能。

## 本地运行

需要 Node.js 22、Java 17、Android SDK 35；Android App 支持 Android 12 / API 31 及以上。

在仓库根目录执行：

```sh
npm --prefix server ci
npm --prefix protocol ci --ignore-scripts
npm run setup:local
npm run dev:server
```

服务默认监听 `127.0.0.1:8080`。另开终端发布演示：

```sh
npm run demo -- running
npm run demo -- completed
npm run demo -- notification
npm run demo -- clear-notification
npm run demo -- delete
```

演示会创建主题和模板。running 只更新展示条目 `demo/demo-report`；completed 原子更新条目并发布独立通知 `daily-completed`；notification / clear-notification 只发布或清除通知；delete 只删除展示条目。初始化与演示分别可重复运行；每次演示发布是新操作，真正网络重试须沿用同一个幂等键。

SQLite 和凭据保存在 `.local/`，已忽略 Git。初始化产生管理员、demo 写入者和 demo 读取者三种令牌，查看 `.local/credentials.json` 的 `reader.token` 配置手机；不要把管理员令牌填进客户端。

## 给 Agent 调用

使用独立的 HTTP CLI，通过系统凭据库保存令牌，不接触数据库：

```sh
npm --prefix packages/cli ci
npm install --global ./packages/cli
agent-portal config set --server URL --token-file FILE
```

配置一次服务地址和对应主题的限权令牌，之后直接使用 notify、item put 或 publish 分别发布通知、小组件内容或两者。缺少配置时会提示补齐。通知、条目写入和组合发布必须使用显式 --key；新操作用新键，重试沿用原键。

安装与例子见 [CLI 使用说明](packages/cli/README.md)。配套 [Agent Portal skill](packages/cli/skills/agent-portal/SKILL.md) 已通过仓库的 `.agents/skills/agent-portal` 链接提供给 Agent；可随 CLI 分发给其他环境。

## 安装 Android

用 Android Studio 打开 `clients/android`，或确保 `ANDROID_HOME` 指向本机 SDK 后执行：

```sh
npm run build:android
adb install -r clients/android/app/build/outputs/apk/debug/app-debug.apk
```

打开 App 的“设置”，填写服务地址和读取令牌，选择订阅主题：

- Android 模拟器访问本机服务：`http://10.0.2.2:8080`。
- debug 包允许本地 HTTP；release 配置禁止明文 HTTP。
- 真机的网络访问和后台兼容性未在这轮验证，不要把模拟器地址用于真机。

先发布 `running` 并打开 App 同步，然后在桌面长按空白处添加 Agent Portal 小组件，选择演示条目。回到 App，发布 `completed`：历史记录条目和通知各自的变化；通知显示简短提醒，小组件显示更丰富的总览。回到桌面即可查看。通知和小组件使用 `https://example.com/report` 与 `/overview` 两个不同入口，点击只检查跳转，不验证网站内容。

## 功能检查

```sh
npm run check:protocol
npm run build:server
npm run test:server
npm run test:cli
npm run test:server-package
npm run test:android
```

Android 检查需要启动本机服务、运行一次 `demo running`，并连接一个 API 35 模拟器。多设备时设置 `ANDROID_SERIAL`。脚本自动构建和安装测试 APK，在独立的 integration 主题验证通知、同步、游标恢复、小组件与删除，再恢复 demo 连接；测试凭据在结束时撤销。不做性能测试。

App 的读取令牌由 Android Keystore 保护，数据库和网络缓存均留在应用私有目录。移除订阅或发现权限撤销时清除对应内容；网络中断保留缓存。

## 安装服务端 npm 包

已有可独立安装的 `agent-portal-server-0.3.0.tgz` 包，尚未上传公共 npm registry。收到包后：

```sh
npm install -g ./agent-portal-server-0.3.0.tgz
agent-portal-server init
agent-portal-server start
```

默认数据保存在用户的 `~/.local/share/agent-portal`，监听设置由 init 保存。继续使用本仓库已有数据时，init 和 start 均加 `--data-dir /absolute/path/to/repo/.local`；根目录的 setup:local、dev:server、demo 脚本仍使用仓库 `.local`。

安装、配置与打包见 [服务端包说明](server/README.md)。自动重启或登录/开机启动由用户选择 [launchd、PM2 或 systemd](docs/deployment/README.md)，项目不内置进程守护或服务安装命令。

## 配置与管理

服务支持环境变量 `PORTAL_DB`、`PORTAL_HOST`、`PORTAL_PORT`；演示脚本支持 `PORTAL_BASE_URL`。默认只监听本机，不部署公网服务。

```sh
npm --prefix server run cli -- --data-dir ../.local token create read demo
npm --prefix server run cli -- --data-dir ../.local token create write demo
npm --prefix server run cli -- --data-dir ../.local token list
npm --prefix server run cli -- --data-dir ../.local token revoke <令牌ID>
```

令牌创建命令仅在创建时输出明文。数据库从备份恢复后，启动服务前执行 `npm --prefix server run cli -- --data-dir ../.local rotate-epoch`，使旧客户端从快照恢复；普通重启不需要执行。

服务端生产构建可用 `npm run build:server` 后运行 `npm --prefix server start -- --data-dir ../.local`。客户端与服务端接口遵循 [协议文件](protocol/README.md)，HTTP 调用格式见 [日报示例](examples/protocol/README.md)。

## 协议升级

v0.2 将通知与展示条目拆开；原 Item 请求中的 notify 字段不再接受。请使用独立 notifications 接口或 publish 组合接口，见 [三种发布示例](examples/protocol/README.md)。通知不再创建小组件候选条目，删除一方不影响另一方。

服务端和 Room 自动迁移首轮数据，保留展示条目及小组件绑定，重建同步进度而不补弹旧提醒。需要同时更新客户端与服务端；迁移细节见 [行为约定](protocol/semantics.md)。
