# 官方文档与源码索引

[学习目录](README.md)

整理与查阅日期：**2026-09-08**。

平台文档用于判断操作系统和服务的能力边界；ntfy 文档与源码用于说明该产品的具体实现。官方网页会更新，涉及版本、默认值和接入政策时需重新核验。

ntfy 源码链接固定到本轮查询时的 main 提交。网页文档可能与发布版本存在差异，正式开发应选择并记录实际部署或构建版本。这里没有做手机送达率实测，也没有逐家审计厂商接入要求。

## ntfy

<a id="s01"></a>
### S01 · 发布 API、点击目标与认证

- [发布文档](https://docs.ntfy.sh/publish/)
- [JSON 发布](https://docs.ntfy.sh/publish/#publish-as-json)
- [Click action](https://docs.ntfy.sh/publish/#click-action)
- [连续更新、清除与删除（固定版本）](https://github.com/binwiederhier/ntfy/blob/10cb6506f836dbb00bb77e3b52669f6ace37f555/docs/publish.md#updating--deleting-notifications)
- [服务端消息模板（固定版本）](https://github.com/binwiederhier/ntfy/blob/10cb6506f836dbb00bb77e3b52669f6ace37f555/docs/publish.md#message-templating)
- [固定版本文档源文件](https://github.com/binwiederhier/ntfy/blob/10cb6506f836dbb00bb77e3b52669f6ace37f555/docs/publish.md)

用于核对发布路径、字段、点击 URI、动作按钮和认证能力。JSON 发布应指向根路径。

<a id="s02"></a>
### S02 · 订阅、缓存恢复与重放限制

- [订阅 API](https://docs.ntfy.sh/subscribe/api/)
- [固定版本文档源文件](https://github.com/binwiederhier/ntfy/blob/10cb6506f836dbb00bb77e3b52669f6ace37f555/docs/subscribe/api.md)

用于核对 JSON 流、SSE、WebSocket、`since`、`poll=1` 与缓存重放限制。

<a id="s03"></a>
### S03 · Android 即时接收

- [Instant delivery](https://docs.ntfy.sh/subscribe/phone/#instant-delivery)
- [固定版本文档源文件](https://github.com/binwiederhier/ntfy/blob/10cb6506f836dbb00bb77e3b52669f6ace37f555/docs/subscribe/phone.md)

用于核对 Play/F-Droid 差异、自建服务接收方式和前台服务。文档中对 FCM 质量的主观评价不作为本手册的性能结论；送达表现需要实测。

<a id="s04"></a>
### S04 · 服务端配置、缓存、权限与移动推送

- [消息缓存](https://docs.ntfy.sh/config/#message-cache)
- [访问控制](https://docs.ntfy.sh/config/#access-control)
- [Firebase 配置](https://docs.ntfy.sh/config/#firebase-fcm)
- [iOS 即时通知](https://docs.ntfy.sh/config/#ios-instant-notifications)
- [固定版本配置文档](https://github.com/binwiederhier/ntfy/blob/10cb6506f836dbb00bb77e3b52669f6ace37f555/docs/config.md)

默认缓存为内存 12 小时；官方自建 iOS 路径通过上游发送 poll request。实际托管配置可能不同。

<a id="s05"></a>
### S05 · ntfy 服务端源码基线

- 仓库：[binwiederhier/ntfy](https://github.com/binwiederhier/ntfy)
- 提交：[10cb6506f836dbb00bb77e3b52669f6ace37f555](https://github.com/binwiederhier/ntfy/tree/10cb6506f836dbb00bb77e3b52669f6ace37f555)
- 提交时间：2026-08-27 20:16:48 UTC。
- [Apache 2.0 LICENSE](https://github.com/binwiederhier/ntfy/blob/10cb6506f836dbb00bb77e3b52669f6ace37f555/LICENSE)

固定版本用于日后重读同一组文档与源码，不代表选定生产版本。

<a id="s06"></a>
### S06 · ntfy Android 源码基线

- 仓库：[binwiederhier/ntfy-android](https://github.com/binwiederhier/ntfy-android)
- 提交：[51730a0f06cebfad59f1b7bc0cb6d5c47082b032](https://github.com/binwiederhier/ntfy-android/tree/51730a0f06cebfad59f1b7bc0cb6d5c47082b032)
- 提交时间：2026-07-09 20:45:41 UTC。
- [构建与原生依赖](https://github.com/binwiederhier/ntfy-android/blob/51730a0f06cebfad59f1b7bc0cb6d5c47082b032/app/build.gradle)
- [前台订阅服务 SubscriberService](https://github.com/binwiederhier/ntfy-android/blob/51730a0f06cebfad59f1b7bc0cb6d5c47082b032/app/src/main/java/io/heckel/ntfy/service/SubscriberService.kt)
- [FCM 主题订阅 FirebaseMessenger](https://github.com/binwiederhier/ntfy-android/blob/51730a0f06cebfad59f1b7bc0cb6d5c47082b032/app/src/play/java/io/heckel/ntfy/firebase/FirebaseMessenger.kt)
- [FCM 数据处理 FirebaseService](https://github.com/binwiederhier/ntfy-android/blob/51730a0f06cebfad59f1b7bc0cb6d5c47082b032/app/src/play/java/io/heckel/ntfy/firebase/FirebaseService.kt)
- [通知展示与点击 NotificationService](https://github.com/binwiederhier/ntfy-android/blob/51730a0f06cebfad59f1b7bc0cb6d5c47082b032/app/src/main/java/io/heckel/ntfy/msg/NotificationService.kt)
- [README 与许可证说明](https://github.com/binwiederhier/ntfy-android/blob/51730a0f06cebfad59f1b7bc0cb6d5c47082b032/README.md)

关键观察来自这些源码入口。当前 Android 客户端是 Kotlin 原生实现，主要 UI 依赖为 Views/AndroidX，而非将 Compose 作为事实前提。

## Firebase Cloud Messaging

<a id="s07"></a>
### S07 · FCM 架构

[FCM architectural overview](https://firebase.google.com/docs/cloud-messaging/fcm-architecture)

说明发送环境、FCM 后端、平台传输层和客户端 SDK 的职责；Apple 路径仍使用 APNs。

<a id="s08"></a>
### S08 · FCM 消息类型与 payload

[Message types](https://firebase.google.com/docs/cloud-messaging/customize-messages/set-message-type)

说明 notification、data、前后台行为与消息大小。其他平台的分类不应直接照搬。

<a id="s09"></a>
### S09 · Android FCM 优先级与处理

[Set and manage Android message priority](https://firebase.google.com/docs/cloud-messaging/android/message-priority)

用于理解优先级、有限处理时间、降级和 Google Play 服务代理展示对统计的影响。

<a id="s10"></a>
### S10 · 消息存活时间与投递语义

[Set the lifespan of a message](https://firebase.google.com/docs/cloud-messaging/customize-messages/setting-message-lifespan)

说明接受请求与设备送达不同，离线存储、TTL 和折叠会影响消息生命周期。

<a id="s11"></a>
### S11 · 注册标识生命周期

[Manage registrations / registration tokens](https://firebase.google.com/docs/cloud-messaging/manage-tokens)

用于理解注册记录的更新、过期和清理。本轮查阅的文档包含 FID 注册模型与传统 token 并行支持的变化；真正接入时应核对所用 SDK 与发送 API，避免仅按旧示例确定字段。

## Apple

<a id="s12"></a>
### S12 · 注册 APNs

[Registering your app with APNs](https://developer.apple.com/documentation/usernotifications/registering-your-app-with-apns)

说明应用能力配置、device token、上报业务服务器以及标识更新。

<a id="s13"></a>
### S13 · 静默后台通知

[Pushing background updates to your app](https://developer.apple.com/documentation/usernotifications/pushing-background-updates-to-your-app)

说明静默后台通知不保证送达，可能限流或延迟，处理时间有限。它不是普通 App 永久保活机制。

<a id="s14"></a>
### S14 · APNs 请求与投递规则

[Sending notification requests to APNs](https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns)

用于核对认证、设备标识、payload、过期、优先级和 best-effort 语义。APNs 的离线存储行为不应被解释成完整事件队列。

## Android

<a id="s15"></a>
### S15 · Doze 与 App Standby

[Optimize for Doze and App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby)

说明空闲时网络和任务限制，及 FCM 与省电机制的关系。

<a id="s16"></a>
### S16 · 前台服务

[Foreground services overview](https://developer.android.com/develop/background-work/services/fgs)

说明用户可感知任务、常驻通知，以及后台启动、类型和时长等限制的官方入口。

<a id="s17"></a>
### S17 · Notification Channel

[Create and manage notification channels](https://developer.android.com/develop/ui/views/notifications/channels)

用于区分通知分类、重要程度、用户控制与服务器消息优先级。

<a id="s18"></a>
### S18 · 通知权限

[Notification runtime permission](https://developer.android.com/develop/ui/views/notifications/notification-permission)

说明 Android 13 及以上的运行时通知权限、请求时机和不同安装/升级情形。

<a id="s19"></a>
### S19 · App Links 与深链接

[Android App Links](https://developer.android.com/training/app-links)

用于理解 HTTPS 关联验证、外部链接与 App 的关系。

<a id="s21"></a>
### S21 · 通知点击与返回栈

[Start an Activity from a notification](https://developer.android.com/develop/ui/views/notifications/navigation)

说明 PendingIntent、Activity 入口和合理返回栈。

## 厂商推送

<a id="s20"></a>
### S20 · 华为 Push Kit

[HUAWEI Push Kit](https://developer.huawei.com/consumer/en/hms/huawei-pushkit/)

作为厂商推送的官方实例，介绍消息推送、通知样式、回执和深链接等能力。产品页的即时性描述不等于对所有设备状态的技术送达保证。具体接入要求需进入对应平台和版本的开发文档继续查证。

## 后续如何维护资料

1. 更新会变化的事实时，记录日期、平台/SDK 或项目版本。
2. 业务设计建议标为建议，不伪装成平台要求。
3. 送达效果引用实测时，附上设备状态、网络与权限条件。
4. 发现旧资料与新资料不同，保留变化原因，不把过去的验证结果直接扩展到新版本。
