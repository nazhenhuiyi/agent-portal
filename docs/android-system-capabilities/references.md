# 官方资料索引

[学习目录](README.md)

以下资料均在 **2026-09-08** 访问并阅读了与正文或接口查阅页结论相关的段落。A 编号用于本手册，与推送手册的 S 编号分开。API 参考页包含较多继承方法，查阅时优先定位这里列出的类成员。较细的技术说明集中在[原生接口查阅页](native-api-notes.md)。

正文中的日程、播放与打车流程是教学示例；系统机制以官方资料为依据，产品组合建议属于分析。官方 API 的存在不能代替实机兼容性结论。

按问题查证：Launcher 看 [A01](#a01)–[A03](#a03) 与 [A17](#a17)，小组件看 [A04](#a04)–[A08](#a08)，壁纸看 [A09](#a09)–[A11](#a11)，锁屏卡片看 [A15](#a15) 与 [A21](#a21)–[A24](#a24)。厂商支持证据集中在 [A18](#a18)–[A20](#a20)。

## 桌面与宿主

<a id="a01"></a>
### A01 · RoleManager

[Android API：RoleManager](https://developer.android.com/reference/android/app/role/RoleManager)

重点：`ROLE_HOME`、`isRoleAvailable()`、`isRoleHeld()`、`createRequestRoleIntent()`。支持本手册关于 Home 角色、API 29 起的角色请求与用户选择流程的说明。角色不能被解释为获得全部系统权限。

<a id="a02"></a>
### A02 · LauncherApps

[Android API：LauncherApps](https://developer.android.com/reference/android/content/pm/LauncherApps)

重点：`getActivityList()`、`startMainActivity()`、`getProfiles()` 和 `LauncherApps.Callback`，以及具体方法的用户、资料与访问条件。支持启动入口查询、启动、变更监听和多资料边界的解释。

<a id="a03"></a>
### A03 · Build an app widget host

[Android 指南：构建小组件宿主](https://developer.android.com/develop/ui/views/appwidgets/host)

重点：`AppWidgetHost`、`AppWidgetHostView`、实例 ID、绑定授权、配置 Activity 与 options bundle。支持“提供小组件”和“承载小组件”是关系两端的解释。默认 Home 角色不是一般宿主概念的定义；宿主也可以是其他应用或系统界面。

## 小组件与 Glance

<a id="a04"></a>
### A04 · App widgets overview

[Android 指南：小组件概览](https://developer.android.com/develop/ui/views/appwidgets/overview)

重点：信息、集合、控制等类型，桌面摆放、尺寸与交互特点。用于解释卡片适合哪些用户需求。

<a id="a05"></a>
### A05 · Create a simple widget

[Android 指南：创建小组件](https://developer.android.com/develop/ui/views/appwidgets)

重点：提供者及其元数据、XML 布局、RemoteViews 支持的界面范围、状态交互。页面部分内容链接到 Compose 风格的文档；第四章保留的是两种编写方式共同依赖的系统机制。

<a id="a06"></a>
### A06 · Advanced app widget updates

[Android 指南：优化小组件更新](https://developer.android.com/develop/ui/views/appwidgets/advanced)

重点：完整与部分更新、周期更新、用户交互触发、广播处理时间。`updatePeriodMillis` 不支持小于 30 分钟的周期，`0` 关闭周期请求；该限制不是所有事件更新的最小间隔。

<a id="a07"></a>
### A07 · Jetpack Glance

[Android 指南：Jetpack Glance](https://developer.android.com/develop/ui/compose/glance)

重点：基于 Compose Runtime 的 Kotlin API，以及不能直接与普通 Compose UI 组件混用的说明。支持 Glance 属于原生 Android 路径、但不等于直接嵌入普通 Compose 页面的解释。

<a id="a08"></a>
### A08 · Manage and update GlanceAppWidget

[Android 指南：Glance 状态与更新](https://developer.android.com/develop/ui/compose/glance/glance-app-widget)

重点：小组件应是被动的；业务状态与小组件状态；宿主位于不同进程；App 负责触发内容更新。该指南描述的常见 Glance 路径转为 RemoteViews；新版指南的 Remote Compose 特性见 [A27](#a27)，不能把前者当作所有版本和功能的唯一实现。

## 动态壁纸

<a id="a09"></a>
### A09 · WallpaperService

[Android API：WallpaperService](https://developer.android.com/reference/android/service/wallpaper/WallpaperService)

重点：服务 intent、壁纸元数据、服务声明上的 `BIND_WALLPAPER` 要求与 `onCreateEngine()`。官方明确说明正在使用和预览可以产生多个 Engine。第三章讲解基础生命周期，不依赖较新重载来承诺最低兼容版本。

<a id="a10"></a>
### A10 · WallpaperService.Engine

[Android API：WallpaperService.Engine](https://developer.android.com/reference/android/service/wallpaper/WallpaperService.Engine)

重点：`onVisibilityChanged()`、Surface 回调、`onDestroy()`、触摸开关与回调、`onOffsetsChanged()`。官方强调仅在可见时使用必要 CPU 资源。`getWallpaperFlags()`、`onWallpaperFlagsChanged()` 从 API 34 提供，不能在旧版本无条件调用。

<a id="a11"></a>
### A11 · WallpaperManager

[Android API：WallpaperManager](https://developer.android.com/reference/android/app/WallpaperManager)

重点：静态壁纸写入接口、`ACTION_CHANGE_LIVE_WALLPAPER`、`EXTRA_LIVE_WALLPAPER_COMPONENT`、`FLAG_SYSTEM` 与 `FLAG_LOCK`。动态壁纸预览 intent 让用户确认切换；位置标志不等于各设备都有相同选择器和组合能力。

## 更新调度、扩展入口与版本差异

<a id="a12"></a>
### A12 · Create shortcuts

[Android 指南：创建快捷方式](https://developer.android.com/develop/ui/compose/system/shortcuts/creating-shortcuts)

重点：静态、动态与固定快捷方式的使用场景。原 Views 路径在本次访问时重定向到此地址。接口查阅页只介绍与桌面、小组件的关系，未完整调研发布数量限制和各版本更新策略。

<a id="a13"></a>
### A13 · Define work requests

[Android 指南：定义 WorkManager 任务](https://developer.android.com/develop/background-work/background-tasks/persistent/getting-started/define-work)

重点：一次性与周期请求、约束、重试和灵活时间窗口。周期任务最小重复间隔为 15 分钟，实际执行取决于约束和系统优化；不能当成准点定时器。

<a id="a14"></a>
### A14 · Package visibility filtering on Android

[Android 指南：包可见性](https://developer.android.com/training/package-visibility)

重点：面向 Android 11 及以上目标版本的应用信息查询过滤、`queries` 声明及广泛查询权限的边界。它与 LauncherApps 的具体角色和资料条件需要结合阅读，不能简单说所有查询都完全相同。

<a id="a15"></a>
### A15 · Widgets on lock screen: FAQ

[Android Developers Blog：锁屏小组件 FAQ](https://android-developers.googleblog.com/2025/03/widgets-on-lock-screen-faq.html)

发表于 **2025-03-06**。说明 Pixel Tablet 的锁屏小组件、Android 16 QPR1 相关 AOSP 推广计划、OEM 集成与启动 Activity 时的认证问题。

这是带有时间背景的发布说明，不是截至本次调研所有设备的支持矩阵。正文据此承认锁屏宿主方向，并将当前目标手机的支持情况保留为待验证问题。

<a id="a16"></a>
### A16 · Create custom Quick Settings tiles

[Android 指南：快捷设置磁贴](https://developer.android.com/develop/ui/views/quicksettings-tiles)

重点：`TileService`、磁贴适合频繁短操作、用户添加后才进入面板，以及不宜当纯信息展示或普通启动入口的建议。本轮只完成概念定位。

<a id="a17"></a>
### A17 · Intent

[Android API：Intent](https://developer.android.com/reference/android/content/Intent)

重点：`ACTION_MAIN`、`CATEGORY_HOME`、`CATEGORY_DEFAULT` 与 `CATEGORY_LAUNCHER`。用于区分 Home 候选入口和在应用列表显示的启动入口。

<a id="device-support"></a>
## 国产设备上的桌面设置

下面三条证据的力度不同：A18 直接说明第三方桌面的设置路径；A19 只说明指定平板的默认桌面设置；A20 是通知问题排查中的相关线索。它们不构成对三个品牌全部设备的支持承诺。

<a id="a18"></a>
### A18 · vivo：如何将第三方桌面 App 设置为默认桌面

[vivo 官方帮助条目](https://www.vivo.com.cn/service/questions/all?categoryId=156&questionId=636)

已读取官方网页正文，步骤为：在“安全与隐私 → 更多安全设置 → 更换系统桌面”中允许更换，同时关闭“点击主屏键锁定系统桌面”；然后在“应用与权限 → 权限管理 → 权限 → 默认应用设置 → 桌面”中选择第三方桌面 App。

这提供了国产手机存在官方更换路径的具体证据。页面正文未列出完整机型和系统版本，不能据此保证所有 vivo 或 iQOO 设备均有同名选项。本次通过官方公开网页正文核对，未操作手机设置。

<a id="a19"></a>
### A19 · 小米：REDMI Pad SE 8.7 默认桌面设置

[小米全球支持站：How to set the default Home screen on the REDMI Pad SE 8.7?](https://www.mi.com/global/support/faq/details/KA-491764/)

官方给出 `Settings → Home screen → Default launcher` 的选择步骤。该证据覆盖页面所述平板，不能扩大到所有小米手机、国行系统，或第三方桌面与系统手势的兼容性。

<a id="a20"></a>
### A20 · 华为：锁屏不显示消息内容的排查

[华为官网：华为手机/平板锁屏时不显示消息内容](https://consumer.huawei.com/cn/support/content/zh-cn00445086/)

正文的“检查是否使用了第三方桌面软件”一节提及“默认应用 → 桌面”，并明确写明“HarmonyOS 5及以上版本不涉及，请跳过此步骤”。

这是版本需要分别判断的证据，不是某个版本一律允许或一律禁止更换桌面的完整说明。不能仅凭这篇排查文章得出全品牌的支持结论。

## 锁屏通知、媒体控制与实时任务

<a id="a21"></a>
### A21 · 创建通知与锁屏可见性

[Android：Create a notification](https://developer.android.com/develop/ui/compose/notifications/create-notification)

本次访问原 Views 通知指南时重定向到此页面。重点阅读 `Set lock screen visibility`、更新已有通知及紧急消息章节。支持普通通知可以在锁屏显示、披露程度可配置且用户保留最终控制权的解释。全屏 Intent 用于特定紧急场景，不能由该例子推导普通 App 有任意唤醒并覆盖锁屏的权限。

<a id="a22"></a>
### A22 · Media3 后台播放与媒体会话

[Android：Background playback with a MediaSessionService](https://developer.android.com/media/media3/session/background-playback)

重点：播放器与 MediaSession 放在服务中、外部客户端通过会话控制、自动媒体通知及其生命周期。用于区分真实的播放状态与控制接入，以及普通通知中的文字按钮。

<a id="a23"></a>
### A23 · Android Live Updates

[Android：Live Updates](https://developer.android.com/develop/ui/views/notifications/live-update)

[Framework：Notification.Builder](https://developer.android.com/reference/android/app/Notification.Builder#setRequestPromotedOngoing(boolean))

指南说明 Live Updates 是更突出展示的通知，可出现于锁屏、通知列表和状态栏。重点阅读构造条件、用途要求、用户控制，以及 OEM 可以增加资格条件的说明。推荐场景是用户参与、正在进行且需要持续关注的活动。

构造条件包括进行中标志、标题、受支持样式、突出展示请求和非运行时 Manifest 权限；不支持自定义 RemoteViews。当前指南列出的新样式不表示旧版本全部支持，本文未据此作全版本保证。

API 版本必须逐项核对：本次 Framework 参考将 `setRequestPromotedOngoing()` 标为 **version 36.1**，`setShortCriticalText()` 标为 **API 36**。正文解释用途与机制关系，接口页保留具体版本区别。

<a id="a24"></a>
### A24 · Apple Live Activities

[Apple：Displaying live data with Live Activities](https://developer.apple.com/documentation/activitykit/displaying-live-data-with-live-activities)

通过 Apple 官方文档 JSON 读取正文。重点：ActivityKit 管理活动生命周期，WidgetKit 与 SwiftUI 定义界面；Live Activity 不等同普通 Widget；内容可由 App 或 ActivityKit 推送更新，活动自身不能直接联网。本文只作概念对照，未做 iOS 实现或源码验证。

## 小组件动画与新的绘制路径

<a id="a25"></a>
### A25 · RemoteViews API

[Android：RemoteViews](https://developer.android.com/reference/android/widget/RemoteViews)

已核对支持的传统布局与控件，以及 `setChronometer()`、`setChronometerCountDown()`、`setProgressBar()` 等方法。支持清单包括 ViewFlipper、AdapterViewFlipper、Chronometer、TextClock 和 ProgressBar，说明小组件并非只能展示静态内容。

同时核对到 API 35 的 `RemoteViews(DrawInstructions)` 构造路径，它以可由宿主解释的绘制指令替代 XML，并有混用与嵌套限制。本手册尚未完整研究这条绘制路径，不据此保证任意动画框架可用于小组件。

<a id="a26"></a>
### A26 · ViewFlipper API

[Android：ViewFlipper](https://developer.android.com/reference/android/widget/ViewFlipper)

说明子 View 之间的动画切换、定时轮换，以及 XML 的 `autoStart`、`flipInterval`、`inAnimation`、`outAnimation`。结合 A25 确认传统 RemoteViews 的有限轮播方向；尚未在目标 Launcher 上验证具体动画和生命周期表现。

<a id="a27"></a>
### A27 · Glance UI 与 Snap Scrolling

[Android：Build UI with Glance](https://developer.android.com/develop/ui/compose/glance/build-ui)

在 **2026-09-08** 访问的指南中，Snap Scrolling 明确使用 Remote Compose，要求 Glance 1.3.0-alpha02 或更高、compileSdk 37 或更高，运行支持为 Android 17 或更高。指南提供 `VerticalScrollMode.SnapScrollMatchHeight` 与旧系统 Normal 分支。

这是一项带版本条件的已记录能力，不是所有 Glance 动画或所有当前手机的支持保证。依赖含 alpha 版本，实际实现前仍应核对选定版本。

## 还缺哪些证据

当前资料足以建立系统职责与 API 关系，并确认部分厂商文档中的桌面设置路径，尚不足以判断用户目标手机上的耗电、刷新延迟、锁屏表现或第三方桌面兼容性。也尚未比较开源项目的工程质量与维护状况。后续应先确定具体机型和问题，再选择资料或实机实验，记录到[学习记录](learning-notes.md)。

锁屏卡片部分尚未完成各厂商实况、画报、主题内容入口的开放程度比较。锁屏内容轮换是识别方向，不是已确认第三方可接入的能力承诺。
