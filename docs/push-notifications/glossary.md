# 推送通知术语表

[学习目录](README.md)

本表提供概念级解释。相似词在不同平台可能有不同字段和保证，具体 API 语义以[官方资料](references.md)为准。

## 消息与产品语义

| 术语 | 中文解释 | 不应混淆的概念 |
|---|---|---|
| Message | 描述事件、状态或指令的数据 | 系统通知卡片 |
| Push | 主动传递消息的方式 | 用户一定看见提醒 |
| Notification | 系统呈现给用户的提醒 | 永久业务记录 |
| Local notification | 根据本地已知信息触发的通知 | App 自己必须持续运行计时 |
| Remote notification | 由远端事件经网络触发的通知 | 无限后台执行授权 |
| Payload | 一次请求或推送携带的数据内容 | 完整业务文件或数据库 |
| Event | 已经发生的一次业务事实 | 最新状态 |
| State | 某个对象当前的状态 | 所有历史事件 |

## 连接与执行

| 术语 | 中文解释 | 不应混淆的概念 |
|---|---|---|
| Polling | 定期请求新数据 | 服务端主动送达 |
| Long polling | 请求保持到有数据或超时，再次请求 | 永久双向连接 |
| SSE | HTTP 服务器事件流 | 后台执行权限 |
| WebSocket | 支持持续双向通信的连接机制 | 系统推送权限 |
| NDJSON | 每行一个 JSON 对象的编码形式 | 一个完整 JSON 数组 |
| MQTT | 发布/订阅消息协议 | 移动系统后台豁免 |
| Foreground service | Android 用户可感知的持续任务执行机制 | App 页面必须在前台；永久保活保证 |
| Doze | Android 设备空闲省电机制 | 单纯关闭屏幕 |
| App Standby | Android 对较少使用 App 的活动限制 | 整机 Doze 的同义词 |
| Cold start | App 从未运行的进程状态启动 | 从后台恢复已有页面 |
| Force stop | Android 用户在系统中明确强行停止应用 | 系统回收进程或所有设备上的划掉任务 |

## 平台与寻址

| 术语 | 中文解释 | 不应混淆的概念 |
|---|---|---|
| FCM | Firebase Cloud Messaging，Google 的消息服务 | 所有 Android 都自带的系统能力 |
| APNs | Apple Push Notification service | FCM 的别名 |
| OEM push | 厂商提供的推送能力 | 一个跨厂商统一 API |
| Push gateway | 统一接受请求并适配或转发的通知网关 | 能绕过底层系统规则的服务 |
| Device token | APNs 中关联 App 与设备的投递标识 | 登录凭证、手机号、手机 IP |
| Registration token | FCM 常见的应用实例投递标识 | 永久不变的账号身份 |
| FID | Firebase Installation ID；本轮官方文档也将其用于新的注册模型说明 | APNs token 或业务用户 ID |
| Provider credentials | 服务端向平台证明发送权限的凭证 | 接收实例的投递地址 |

## 四种经常撞名的“主题/频道”

| 名称 | 作用 |
|---|---|
| ntfy topic | 某个 ntfy 服务上的发布/订阅主题 |
| FCM topic | FCM 管理的一组订阅应用实例 |
| APNs `apns-topic` | 通常是 App Bundle ID/应用标识；特定推送类型有不同规则 |
| Android Notification Channel | 由系统与用户管理声音、重要程度等展示行为的通知分类 |

## 可靠性与交互

| 术语 | 中文解释 | 不应混淆的概念 |
|---|---|---|
| TTL | 消息允许继续尝试投递的存活时间 | 承诺送达时间、历史保存时间 |
| Retention | 服务端保存可查询记录的期限 | 推送 TTL |
| Collapse | 按平台规则替换某些待投递旧消息 | 所有事件都被完整存档；UI 分组 |
| Deduplication | 对重复身份的消息去重 | 删除不同业务事件 |
| Idempotency | 同一操作重试不重复产生业务效果 | 所有平台天然提供精确一次投递 |
| Backoff | 失败后逐步延长重试间隔 | 高频立即重试 |
| Jitter | 为重试间隔加入随机变化，减少集中重试 | 随意丢弃消息 |
| Cursor | 恢复或分页时的服务端位置标识 | 永不过期的数据保证 |
| Receipt | 某个环节的回执 | 自动等同于用户已读 |
| Deep link | 指向具体内容或功能的入口 | 可以打开任意私有页面 |
| App Links | Android 通过网站与 App 关联验证的 HTTPS 深链接机制 | 所有 HTTPS 都强制打开 App |
| URI scheme | URI 的协议前缀，可由应用注册处理 | 域名归属验证 |
| PendingIntent | Android 交给系统在以后执行的预定义动作凭据 | 后台任意代码执行权限 |
| Back stack | 返回导航所依据的页面或任务栈 | 固定总是回首页 |
