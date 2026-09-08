# 05 · 参考 ntfy 后，我们怎样确定协议

[设计目录](README.md) · [可检查的协议文件](../../protocol/README.md)

查阅日期：2026-09-08。源码固定到 ntfy 的 `10cb6506f836dbb00bb77e3b52669f6ace37f555`，本轮重新读取了发布文档、订阅文档、发布请求类型、发布与 SSE 处理代码。没有运行 ntfy，也没有声称完成整个项目的源码审计。

## 最有价值的借鉴：一个稳定身份可以持续更新

ntfy 不只是“每次发一条新消息”。它支持 `sequence_id`：业务方可以向 `/<topic>/<sequence_id>` 连续发布，同一组更新有稳定的 sequence ID，而每次事件仍有自己的 message ID。[发布与更新文档](https://github.com/binwiederhier/ntfy/blob/10cb6506f836dbb00bb77e3b52669f6ace37f555/docs/publish.md#updating--deleting-notifications)

例如它的文档用“下载中 → 50% → 下载完成”解释这个关系。我们的日报正好需要相同的稳定身份：

| 角色 | ntfy 中的表达 | 我们的表达 |
|---|---|---|
| 内容分组 | topic | Topic |
| 连续更新的同一内容 | sequence_id | 独立的 Item ID 或 Notification ID |
| 某一次变化 | message 的独立 ID | Event ID |
| 同一内容的新旧顺序 | 按其消息与客户端机制处理 | 各资源独立的 revision，加服务端日志顺序 |

这是概念对应，不是字段或行为兼容。我们保留独立的当前 Item、Notification 与完整 Event 历史，是为了让小组件查询当前内容、历史页读取过去版本都有直接入口。

## 哪些设计采纳，哪些按自己的需求收敛

| ntfy 的设计或能力 | 我们的决定 | 原因 |
|---|---|---|
| 简单 HTTP 发布，正文或 JSON 都能接入 | 首版保留一种 JSON 写入格式，分别向 Item / Notification 地址 PUT，也可组合提交 | 让字段、替换与重试语义明确；暂不增加大量头字段别名 |
| 自定义 sequence ID 持续更新 | 采用业务方指定独立资源 ID，服务生成 revision 与 Event ID | 业务方不必先取得服务端 ID 才能更新 |
| topic 发布订阅 | 使用 Topic 作为分组、权限与手机订阅单位 | 业务调用方不面对具体手机 |
| `poll=1`、`since` 补取缓存 | 使用快照、分页增量与不透明 cursor | 当前状态与有限历史分开；游标过期明确要求重建 |
| JSON 流、SSE、WebSocket 等订阅形式 | 首版 HTTP JSON 读取 + SSE 变化提示 | 同步规则只有一套，不为每条传输路径复制恢复逻辑 |
| 点击 `click` URI | 可选 `content.link`，首版 HTTP(S) | 保留详情入口，不承担网站职责 |
| 清除、删除通知是不同事件 | 用户清除留在手机本地；分别 DELETE Item 或 Notification，互不影响并保留历史 | 当前没有跨设备已读需求；删除含义明确写进协议 |
| 优先级、动作按钮、定时发送等 | 首版只有 silent / alert 提醒意图与到期时间 | 用户只需数据展示，暂不引入远程业务动作或调度 |
| 可配置消息缓存与保留范围 | 写入确认必须持久化；历史有保留期，当前 Item 独立保留 | 小组件的当前内容不能随着消息缓存到期消失 |
| 服务端消息模板 | 原生客户端的小组件布局模板 | 解决的是不同问题，不能直接复用它的模板语义 |

HTTP GET 只读，不借鉴用 GET 发布、清除或删除的兼容入口。我们也不复制全部认证方式，先用限权 Bearer token。

## 对历史恢复的一个具体改进

固定版本的 ntfy 订阅文档说明，缓存重放有大小上限；截断时返回 `X-Messages-Truncated: 1`。因此不能只看 HTTP 200 就认为历史完整。[缓存与重放限制](https://github.com/binwiederhier/ntfy/blob/10cb6506f836dbb00bb77e3b52669f6ace37f555/docs/subscribe/api.md#replay-limits)

我们把这个问题直接纳入协议：

- 增量按连续顺序分页，`has_more` 明确说明是否还要继续。
- 单轮同步固定高水位，分页期间的新写入留给下一轮。
- 已超出历史保留范围时返回 410，从当前快照恢复，不伪装成完整重放。
- 历史列表与同步进度分开，用户翻页不会改变手机同步游标。

这样即使不再保留一个月前的所有变化，手机仍能重新拿到当前内容。

## 必须区分的两种“模板”

ntfy 的 message templating 使用 Go template，把提交的 JSON 数据转成标题、正文、优先级等消息字段；它主要发生在服务端。[模板文档](https://github.com/binwiederhier/ntfy/blob/10cb6506f836dbb00bb77e3b52669f6ace37f555/docs/publish.md#message-templating)

我们的 Template 保存组件树和数据绑定，由原生客户端解释成小组件布局。模板不执行 Go、JavaScript 或 Kotlin 代码。更新数据、更新模板和升级客户端解释器是三件不同的事。

本轮只正式定义布局、文字、静态图片、进度和间距；动画留在能力扩展中，避免协议写出平台尚未验证的承诺。模板失效时仍有基础摘要和链接。

## 源码入口与本轮观察

| 固定源码 | 本轮用于确认什么 |
|---|---|
| [docs/publish.md](https://github.com/binwiederhier/ntfy/blob/10cb6506f836dbb00bb77e3b52669f6ace37f555/docs/publish.md) | 发布 JSON 到根路径、sequence ID 更新、clear/delete、click、消息模板 |
| [docs/subscribe/api.md](https://github.com/binwiederhier/ntfy/blob/10cb6506f836dbb00bb77e3b52669f6ace37f555/docs/subscribe/api.md) | poll、since、缓存重放限制及事件格式 |
| [server/types.go](https://github.com/binwiederhier/ntfy/blob/10cb6506f836dbb00bb77e3b52669f6ace37f555/server/types.go) | 发布输入字段、分发选项与消息编码职责分开 |
| [server/server.go](https://github.com/binwiederhier/ntfy/blob/10cb6506f836dbb00bb77e3b52669f6ace37f555/server/server.go) | handlePublishInternal、handlePublish、handleSubscribeSSE 的职责；SSE 包含消息内容，与我们的提示流不同 |

这些观察说明哪些机制值得借鉴，不表示我们的协议是 ntfy 的兼容实现。代码、Schema 和接口都由我们独立维护。
