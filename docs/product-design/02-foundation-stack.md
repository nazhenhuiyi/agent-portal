# 02 · 底座技术选型

[设计目录](README.md) · 下一篇：[数据结构](03-data-model.md)

状态：**推荐方案 v0.1，供讨论，尚未实现**。日期：2026-09-08。用户已确认自行实现、原生 Android 优先，并表示更熟悉 TypeScript / Node.js；服务端据此选择 TypeScript / Node.js，其余具体技术选择是建议。

## 推荐组合

**服务端用 TypeScript / Node.js + SQLite，Android 用 Kotlin，通信采用 HTTP JSON + SSE。** 普通 App 页面使用 Jetpack Compose，小组件先使用传统 RemoteViews。全部代码放在同一仓库，各端独立构建。

| 部分 | 推荐 | 为什么适合当前产品 |
|---|---|---|
| 服务端 | TypeScript strict 模式，Node.js LTS，Fastify | 使用用户熟悉的语言；Fastify 提供路由和请求校验，产品逻辑仍是我们自己的小模块 |
| 服务端数据库 | SQLite，WAL 模式，显式 SQL 与版本化迁移 | 当前是个人或小范围部署，需要持久化，但不需要额外数据库服务 |
| 数据库访问 | `better-sqlite3`，参数化 SQL | 事务边界直接可见，不为少量表引入完整 ORM |
| Android | Kotlin + Android Framework / Jetpack | 各系统能力直接使用原生接口 |
| App 页面 | Jetpack Compose | 只做设置、配置和历史记录，保持页面数量和状态管理简单 |
| 桌面小组件 | RemoteViews + AppWidgetProvider | 明确控制系统支持的布局与组件；模板解释器由我们维护 |
| 手机本地数据 | Room；DataStore 保存偏好设置 | 展示数据、同步位置进入数据库；小量设置单独保存 |
| 手机网络与序列化 | OkHttp + kotlinx.serialization | HTTP、SSE 和 JSON 不必各引入一套网络框架 |
| 延后同步 | WorkManager | 承担系统允许时的恢复工作，不用它承诺固定时刻或实时刷新 |
| 协议 | REST / JSON，另设 SSE 变化提示 | 写入、查询和补取有明确结果；持续连接仅负责尽快提示变化 |
| 协议文档 | OpenAPI 3.1 + JSON Schema Draft 2020-12 | [契约文件](../../protocol/README.md) 已建立，字段、接口和示例可本地检查 |

实现已锁定依赖版本，具体版本以各工程的 package.json、Gradle 配置和锁文件为准。`better-sqlite3` 包含原生扩展，需验证选定 Node LTS 和部署系统的构建兼容性。Android 最低系统版本留到构建验证时确定。

服务端用 npm 和锁文件管理依赖、`tsc` 构建；普通模块测试优先用 Node 自带测试运行器，HTTP 行为用 Fastify 的请求注入测试。共享协议以 JSON Schema 为准，TypeScript 与 Kotlin 各自映射类型，不要求手机端共享 JavaScript 代码。

## 服务端保持一个程序

服务进程内部划分四个职责：

1. **HTTP 接口**：认证、参数校验、发布和读取。
2. **数据处理**：同一份内容的更新、版本检查、历史与幂等处理。
3. **存储**：SQLite 事务、查询和迁移。
4. **分发**：SSE 连接，以及以后接入的手机推送适配器。

它们是程序内模块，不拆成四个服务。首版不用 Redis、独立消息队列或微服务。

一次发布必须在一个数据库事务里写入当前内容、变化记录和幂等结果。事务提交后才回复成功，再提示在线客户端同步。这样服务重启后，已确认保存的数据仍然可查询。

SSE 提示丢失可以通过补取恢复。如果将来启用 FCM 或厂商推送，需要在同一事务中额外写入待投递记录，由后台工作循环重试；不依赖“事务成功后恰好发了一次请求”。待投递记录可以放在 SQLite 中，不因此引入外部队列。

SQLite 先约束为单实例服务、本机持久化磁盘。`better-sqlite3` 的操作是同步的，会占用 Node 事件循环，因此事务与单次查询必须短小，历史按页读取，清理按小批执行；事务内部不能等待网络或其他异步操作。持续连接不占用长期数据库事务。若实测数据库操作阻塞连接处理，再将存储放入专用 Worker；不一开始引入线程通信层。若未来确有多实例写入需求，再根据负载迁移数据库。

## 手机取得数据与显示数据分开

客户端内部建议分成：

| 部分 | 职责 |
|---|---|
| 同步模块 | 按订阅主题补取数据；在一个本地事务中保存内容和同步游标 |
| 展示模块 | 把本地数据与模板转换成小组件；用基础字段创建系统通知 |
| App 页面 | 设置连接与展示偏好，浏览历史记录，处理跳转 |

App 打开时主动同步，并可保持 SSE。收到变化提示后调用同一个同步模块。通知和小组件各自提交更新，不把“数据存好了”当作“系统已经显示了”。

App 关闭后，小组件仍可显示已提交的内容；这不等于同步代码持续运行。WorkManager 用来安排补同步，不能当作每分钟轮询器。

### 首条接收路径怎么选

建议先实现 **HTTP 补取 + App 前台 SSE**，用于验证协议和数据展示。随后在目标手机验证直接订阅的后台模式：用户启用持续接收后，由符合系统要求的前台服务维持连接，并显示相应常驻通知。是否适用要核对目标 Android 版本的服务类型、启动与运行限制。

因此，前台 SSE 是确定可开始实现的基础路径；锁屏后台及时接收仍是首个产品闭环必须完成的实机验证，不能因为前台跑通就宣布完成。

FCM、厂商推送之后通过适配器接入。业务发布接口不携带 FCM token、厂商消息体或某台手机地址。现阶段不假定已有 Google 服务或厂商推送接入条件，也不声称 SSE 就解决了所有后台问题。

推送载荷将来可以是变化提示，也可以附带足够显示基础通知的内容。具体选择取决于通道能力；无论哪一种，HTTP 同步仍负责恢复完整状态和历史。

## 为什么先用 RemoteViews

App 内的 Compose 和桌面小组件是两种不同的呈现环境。App 页面使用 Compose，不要求小组件也使用同一套 UI 技术。

我们需要一个小而明确的原生模板解释器。先用 RemoteViews 对接基础布局、文字、图片、进度和点击行为，能直接对应已研究的能力。以后若 Glance 的实现更合适，可以替换展示模块，不改变业务发布协议。

小猫吐彩虹之类的动画作为展示能力单独验证。传统 ViewFlipper 帧切换只是候选实现，尚未实测；不把任意 GIF、Lottie 或 Compose 动画当作小组件天然支持的能力。

## 仓库组织建议

```text
server/
  src/http/            # Fastify 路由与认证
  src/content/         # 发布、版本与历史
  src/storage/         # SQLite 查询和事务
  src/delivery/        # SSE，后续推送适配器
  src/cli/             # 初始化、令牌管理
  migrations/          # 按版本执行的 SQL 迁移
clients/android/       # Kotlin 原生工程
protocol/              # 后续 OpenAPI 与 JSON Schema
examples/              # 可复制的业务接入示例
docs/                  # 设计与领域知识
```

`protocol/` 和 `examples/protocol/` 包含契约与示例；服务端与 Android 工程已有首轮实现，运行与安装方式见仓库 README。首版只部署一套私有服务，使用有权限范围的访问令牌；不加入账号注册、组织或计费体系。

## 选型依据与尚未验证的部分

- [ntfy 实现案例](../push-notifications/06-ntfy-case-study.md)：借鉴 HTTP 发布、订阅和恢复思路，自行实现。
- [Node.js](https://nodejs.org/en/about)、[Fastify](https://fastify.dev/docs/latest/)、[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)、[SQLite WAL](https://www.sqlite.org/wal.html)：服务与存储基础。
- [Android 应用架构](https://developer.android.com/topic/architecture)、[Room](https://developer.android.com/training/data-storage/room)、[DataStore](https://developer.android.com/topic/libraries/architecture/datastore)：原生客户端分工与存储。
- [后台机制](../push-notifications/02-connections-and-background.md)、[小组件与动画](../android-system-capabilities/04-app-widgets.md)：展示与运行约束。

本轮是技术设计，没有做耗电、吞吐或设备送达测试。选择 Fastify、SQLite 和 RemoteViews 是针对当前规模与可维护性目标的建议，不是性能测试结论。
