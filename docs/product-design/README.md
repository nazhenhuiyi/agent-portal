# 产品设计

[全部文档](../README.md)

我们要做一套包含服务端与原生客户端的数据展示系统。业务方通过简单的服务接口提交数据，我们通过小组件、通知和历史记录呈现。Agent 的状态与关键任务是首个使用场景。

App 内部只保留必要的设置、配置与历史数据。业务网站的生成、托管和可用性不属于本产品职责；我们只按配置发起链接跳转。

实现路线已确认：借鉴 ntfy 的设计，自行实现服务端与原生客户端；不依赖 ntfy 服务，也不以 fork 改造作为路线。重点是让产品代码保持可理解、可维护，只实现我们需要的能力。

用户更熟悉 TypeScript / Node.js，服务端据此展开。当前底座为 **TypeScript / Node.js + Fastify + SQLite，Android 使用 Kotlin，HTTP JSON + SSE 通信**。

这里记录产品决策；平台知识仍放在 [Android 系统能力](../android-system-capabilities/README.md) 和 [推送通知](../push-notifications/README.md) 两个独立目录。

## 当前设计文档

| 文档 | 解决的问题 |
|---|---|
| [01 · 产品目标与边界](01-product-boundaries.md) | 我们负责什么，App 内保留什么？ |
| [02 · 底座技术选型](02-foundation-stack.md) | 服务端和 Android 用什么技术，为什么这样选？ |
| [03 · 数据结构](03-data-model.md) | 主题、当前条目、变化记录和模板怎样关联？ |
| [04 · API](04-api.md) | 业务方怎样发布，手机怎样查询、订阅和恢复？ |
| [05 · ntfy 协议对照](05-ntfy-protocol-decisions.md) | 更新、清除、历史和模板各借鉴什么，哪里不同？ |
| [06 · 模板契约](06-template-contract.md) | 组件、数据绑定、尺寸和能力回退怎样约定？ |
| [协议文件](../../protocol/README.md) | OpenAPI、JSON Schema 和本地检查入口 |
| [日报请求示例](../../examples/protocol/README.md) | 从生成中、完成到历史和删除的完整请求 |

服务端与原生 Android 首轮实现已完成，运行方式见 [仓库说明](../../README.md)。v0.2 将通知与小组件展示条目分开，支持独立发布和原子组合发布。03–04 篇与当前契约一致。

已验证前台同步、模板小组件、通知、历史及断线恢复。后台推送、动画和 iOS 留待后续；不安排性能测试。
