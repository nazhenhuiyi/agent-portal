# 原生接口查阅页

[学习目录](README.md)

这页用于把正文中已经理解的行为对应到实现接口。按当前研究的问题跳到相应小节即可：

- [开发 Launcher](#launcher)
- [提供动态壁纸](#wallpaper)
- [提供小组件](#widgets)
- [安排后台更新](#background)
- [接入锁屏上的不同能力](#lock-screen)

以下是查阅笔记，不是可直接照做的完整工程教程。开始实现时，还要选定目标设备、系统版本和依赖版本。

## 先认识接口页里的几个词

| 词 | 在这套文档里是什么意思 |
|---|---|
| Android Framework | Android 系统提供的基础能力和接口，例如 Activity、通知、壁纸服务 |
| Android Jetpack | 帮助开发 Android App 的官方库，例如 Media3、Glance、WorkManager；仍需遵守系统规则 |
| Activity | 承载 App 用户界面的组件，例如设置页或会议详情入口 |
| Service | 不直接提供页面的组件，可通过特定方式被启动或绑定；其名称不意味着永久运行 |
| 进程 | App 执行代码、存放临时内存状态的运行环境；系统可以回收它 |
| 生命周期与回调 | 系统在创建、更新、隐藏、销毁等时机调用 App 代码，让 App 响应这些变化 |
| Intent / PendingIntent | Intent 描述要执行的动作；PendingIntent 让系统或其他程序以后按授予的范围执行已登记动作，例如通知点击 |
| API 级别 / AndroidX 版本 | 前者描述系统接口的版本，后者描述 App 使用的库版本；升级库不自动让旧系统获得新显示能力 |

例如：你用 Activity 显示壁纸设置页，用 WallpaperService 提供系统可连接的壁纸入口。它们是同一个 App 的不同组件，不是两个必须分别安装的 App。组件的作用与进程是否仍在运行，也需要分开判断。

<a id="launcher"></a>
## Launcher：让自己的程序成为主屏幕

正文入口：[Launcher 能改什么，国产手机能不能换](02-launcher.md)。

| 已经理解的行为 | 原生接口 | 为什么需要它 |
|---|---|---|
| 声明“我可以作为主屏幕” | Home Activity 的 Intent filter：`ACTION_MAIN`、`CATEGORY_HOME`、`CATEGORY_DEFAULT` | 让系统识别 Home 候选入口 |
| 请求用户选择默认桌面 | `RoleManager.ROLE_HOME`、`createRequestRoleIntent()` | 通过系统流程请求角色；不能静默自授 |
| 找到可启动的应用入口 | `LauncherApps.getActivityList()` | 得到指定用户或资料下允许访问的启动入口 |
| 点击图标启动应用 | `LauncherApps.startMainActivity()` | 请求系统打开具体组件 |
| 应用安装、卸载后更新列表 | `LauncherApps.Callback` | 避免桌面入口列表一直停留在旧状态 |

`RoleManager` 从 API 29 提供；调用前要检查版本、`isRoleAvailable()` 和 `isRoleHeld()`。Home 角色与在应用列表中显示图标的 `CATEGORY_LAUNCHER` 不是同一个概念。[A01](references.md#a01)、[A02](references.md#a02)、[A17](references.md#a17)

包名标识应用包，组件名标识具体入口；用户或工作资料也是启动目标的一部分。`LauncherApps` 的资料访问条件要按具体方法核对。普通 `PackageManager` 查询还涉及包可见性规则，不能假设能无条件取得所有包和所有用户的信息。[A14](references.md#a14)

### 如果自己的桌面要承载其他 App 的小组件

这时桌面实现的是宿主一端。通过 `AppWidgetHost` 分配实例 ID，使用 `bindAppWidgetIdIfAllowed()` 检查能否绑定；必要时走系统绑定授权及提供者配置流程，再创建 `AppWidgetHostView` 承载内容。

宿主保存摆放位置等状态，并向提供者传递尺寸等 options。需要管理更新监听、实例删除和配置取消等过程。实现了一个小组件提供者，并不意味着这些宿主工作已经完成。[A03](references.md#a03)

<a id="wallpaper"></a>
## 动态壁纸：声明入口与管理绘制

正文入口：[动态壁纸是怎样动起来的](03-live-wallpapers.md)。

| 已经理解的行为 | 原生接口 | 为什么需要它 |
|---|---|---|
| 声明一种动态壁纸 | `WallpaperService` 与壁纸元数据 | 给系统提供可绑定的服务入口 |
| 为一次显示建立绘制对象 | `WallpaperService.Engine`、`onCreateEngine()` | 管理这一实例的显示状态与绘制资源 |
| 请求系统预览指定壁纸 | `ACTION_CHANGE_LIVE_WALLPAPER` 与 `EXTRA_LIVE_WALLPAPER_COMPONENT` | 让用户预览并确认使用 |
| 得知可见性变化 | `onVisibilityChanged()` | 不可见时停止不必要的持续绘制 |
| 管理绘制区域 | `onSurfaceCreated()`、`onSurfaceChanged()`、`onSurfaceDestroyed()` | 使用当前有效表面，处理尺寸变化，停止访问已销毁表面 |

服务声明需要要求 `android.permission.BIND_WALLPAPER`，它是限制谁能绑定服务的权限条件，不是弹窗向用户索取的普通运行时权限。[A09](references.md#a09)

**服务、引擎与表面分别是什么：** 服务是系统连接的入口；引擎是管理一次壁纸显示的对象；Surface 是提交画面的绘制表面。Canvas、OpenGL ES 等原生绘制方案可用于相应表面，视频方案还需要处理媒体输出与表面的衔接。

预览与正在使用的壁纸可能同时产生不同 Engine。主题配置可以共享，但每个引擎的表面、尺寸、可见性和资源不能假设只有全局一份。配置和业务状态应可恢复，不能只靠进程内变量。[A09](references.md#a09)

回调有主线程要求；耗时计算不能阻塞它。可见且表面有效时才按画面需要安排绘制，表面或引擎销毁时停止相关工作并释放资源。无需变化的画面不必维持连续高帧率。[A10](references.md#a10)

触摸需要相应启用，收到的事件也受宿主影响；偏移回调取决于宿主对壁纸偏移的设置。`getWallpaperFlags()` 与 `onWallpaperFlagsChanged()` 从 API 34 提供，配合主屏幕、锁屏标志理解位置。它们不保证各厂商提供相同的壁纸选择组合。[A10](references.md#a10)、[A11](references.md#a11)

<a id="widgets"></a>
## 小组件：生成内容并交给宿主

正文入口：[小组件为什么能留在桌面上](04-app-widgets.md)。

| 已经理解的行为 | 原生接口 | 为什么需要它 |
|---|---|---|
| 声明小组件及接收生命周期事件 | `AppWidgetProvider`、提供者元数据 | 让系统发现小组件并在相关事件中调用 App |
| 描述交给桌面的界面 | `RemoteViews` | 跨进程交付支持的布局与更新操作 |
| 用 Kotlin 声明卡片内容 | Jetpack Glance | 使用 Compose 风格的专用组件；常见路径生成 RemoteViews，部分新能力采用 Remote Compose |
| 提交新内容 | `AppWidgetManager.updateAppWidget()` 或 Glance 的 `update()` 等 | 数据变化后，明确请求更新对应实例 |
| 区分摆在桌面的两张卡片 | `appWidgetId`；Glance 使用相应 `GlanceId` | 分别管理账号、筛选条件等实例配置 |
| 点击打开或执行动作 | `PendingIntent` 或 Glance 动作 API | 将允许的操作登记给系统执行 |

Glance 是原生 Android 技术，建立在 Compose Runtime 上，但不直接兼容普通 Compose UI 组件。传统 XML RemoteViews 路径使用受支持的 View，不能嵌入任意自定义 View；较新绘制路径也不等于直接运行一个普通 Compose 页面。[A05](references.md#a05)、[A07](references.md#a07)、[A27](references.md#a27)

### 动画与宿主自行更新

传统 RemoteViews 支持 `TextClock`、`Chronometer`、`ProgressBar`、`ViewFlipper`、`AdapterViewFlipper` 等控件。`setChronometer()` 和 `setChronometerCountDown()` 可配置计时；`setProgressBar()` 可配置确定或不确定进度。这些控件在宿主中工作的机制，与 App 周期提交内容不同。[A25](references.md#a25)

`ViewFlipper` 可通过 XML 的 `autoStart`、`flipInterval`、`inAnimation`、`outAnimation` 表达有限的自动轮换与进出动画。不要从它支持这些属性推导成所有 View 动画方法都能远程调用。实际启动、可见性、重建后的表现仍要按宿主验证。[A26](references.md#a26)

新 Glance 指南的 Snap Scrolling 使用 Remote Compose，并要求 Android 17 / API 37、compileSdk 37+、Glance 1.3.0-alpha02+，通过 `VerticalScrollMode.SnapScrollMatchHeight` 配置；旧系统使用 Normal 等适用降级方式。这里涉及 alpha 依赖，接入前应核对所选版本。文档中的这一能力不证明 GIF、Lottie 或任意 Compose Animation API 都可直接使用。[A27](references.md#a27)

Remote Compose 与普通 Jetpack Compose UI 不能混为一谈。Framework 还提供 `RemoteViews.DrawInstructions` 绘制指令路径，因此“RemoteViews 永远只能是 XML”或“所有 Glance 内容永远都是传统 View”也不准确。本手册目前只确认上述动画与滚动能力，没有对新绘制体系作完整调研。[A25](references.md#a25)

### 两个容易误读的更新周期

| 机制 | 规则 | 不应得出的结论 |
|---|---|---|
| `updatePeriodMillis` | 周期不支持小于 30 分钟；`0` 可关闭该周期更新 | 所有事件触发的更新也必须间隔 30 分钟 |
| WorkManager 周期任务 | 最小重复间隔 15 分钟，实际时间受约束与系统优化影响 | 每过 15 分钟就保证联网并刷新成功 |

用户操作或 App 已获准处理消息时，可以请求及时更新。广播接收器不适合执行长任务，应把需要持续处理的工作交给适当的后台机制。系统支持的时间显示控件自行变化，也不等于 App 获得了每秒执行任意代码的能力。[A06](references.md#a06)、[A08](references.md#a08)、[A13](references.md#a13)

### 尺寸、状态与显示位置

业务数据与实例配置要分别保存。宿主传来的尺寸决定内容如何适配，删除实例时应清理其配置。已提交界面可以保留，进程内的临时状态则随时可能丢失。[A03](references.md#a03)、[A08](references.md#a08)

官方已介绍锁屏小组件及 AOSP 方向；2025 年发布说明不能作为所有当前手机都已支持的证据。目标手机的锁屏入口、点击认证及适合显示的信息，需要另外确认。[A15](references.md#a15)

<a id="background"></a>
## 多个界面共享数据时的后台边界

正文入口：[它们怎样与推送通知一起工作](05-data-and-lifecycle.md)。

WorkManager 负责安排任务，可以用于允许延后的同步及随后的界面更新。它不提供桌面界面，也不保证推送实时送达。一次更新要区分获得执行机会、取得数据、保存数据和提交界面更新几个步骤。[A13](references.md#a13)

Activity 离开前台、进程被系统回收、从最近任务划掉、用户强行停止应用是不同情况。系统保留既有小组件内容，不代表强行停止后仍保证后台收消息或刷新。更多解释见[手机后台机制](../push-notifications/02-connections-and-background.md)。

多个显示入口不必同时更新。可以按业务需要记录数据版本和更新时间，分别观察通知、小组件和壁纸的更新结果；具体持久化、重试与协议设计尚未确定。

<a id="lock-screen"></a>
## 锁屏卡片：按实际功能选接口

正文入口：[锁屏上的卡片分别是什么能力](06-lock-screen-cards.md)。

| 功能 | Android 原生能力 | 关键交接 |
|---|---|---|
| 锁屏消息提醒 | Notification、Notification Channel | App 提交通知，系统和用户设置决定锁屏展示 |
| 播放控制 | MediaSession；Media3 的 MediaSessionService 和媒体通知 | 提供媒体元数据、播放状态与操作，接受控制命令 |
| 突出显示当前任务 | Live Updates / promoted ongoing notifications | 按要求构建通知并请求突出展示，系统判定是否允许 |
| 用户放置的小组件 | App Widget；适用时可用 Glance | App 提供内容，锁屏宿主承载，具体设备须支持 |
| 厂商内置信息、画报或主题区域 | 对应厂商公开方案，若有 | 未确认存在跨厂商通用接入接口 |

### 通知的锁屏可见性

`setVisibility()` 使用 `Notification.VISIBILITY_PUBLIC`、`VISIBILITY_PRIVATE`、`VISIBILITY_SECRET` 表达锁屏披露程度；`setPublicVersion()` 可以提供隐藏细节后的替代通知内容。它们仍受用户和系统设置影响。发布普通通知还需按适用版本处理通知权限和渠道设置，详见[通知展示章节](../push-notifications/05-notification-and-navigation.md)。[A21](references.md#a21)

锁屏可见性不等于点亮屏幕。全屏 Intent 对应来电、响铃闹钟等紧急场景，并有版本和授权条件，不能把它当一般锁屏卡片入口。

### 媒体通知与系统媒体控制

Media3 的 `MediaSessionService` 可以自动生成并随播放状态更新媒体通知。播放器、会话与服务需要实现各自生命周期，后台播放还涉及对应的前台服务声明。系统媒体控制、耳机等可通过会话发出命令；系统界面并不是任意由 App 绘制的播放器页面。[A22](references.md#a22)

### Live Updates 的请求与实际展示

普通通知可通过相同的通知身份提交更新；更新内容不要求先设置进行中标志。进行中状态、是否请求突出展示、是否实际获准突出展示，是不同条件。[A21](references.md#a21)

当前官方文档要求适用的标准通知样式、标题、进行中标志、突出展示请求，以及 Manifest 中的 `POST_PROMOTED_NOTIFICATIONS` 非运行时权限；不接受自定义 `RemoteViews` 内容作为这类突出通知。它仍属于通知机制，普通通知权限与用户设置也需处理。[A23](references.md#a23)

请求可通过相关 extra 或 AndroidX 的 `NotificationCompat.Builder.setRequestPromotedOngoing()` 表达。**不要把所有方法都笼统标成 API 36：** 本次 Framework 参考页将同名 `Notification.Builder.setRequestPromotedOngoing()` 标为 **version 36.1**。接入时应逐项核对 Framework 小版本与 AndroidX 依赖版本，Compat 不保证旧系统拥有相同的显示能力。

`hasPromotableCharacteristics()` 用于判断通知特征，`canPostPromotedNotifications()` 涉及 App 当前可用资格，`FLAG_PROMOTED_ONGOING` 反映是否被突出展示。满足构造条件和请求成功，不等于一定得到某种锁屏卡片外观；厂商可以增加条件，用户也可以降级或移除显示。

### 与苹果的概念对照

苹果 Live Activities 使用 ActivityKit 请求、更新和结束活动，在 WidgetKit 扩展中以 SwiftUI 定义呈现。它借用 WidgetKit 能力，但官方明确说明它不等同于普通 Widget。活动界面自身不直接联网；更新可来自 App 的 ActivityKit 调用或相应推送。[A24](references.md#a24)

这一对照只帮助认识能力，不表示两端 API、数据限制或生命周期相同。

## 后续入口的定位

`App Shortcuts` 提供进入某个功能的快捷入口：静态适合固定动作，动态可随 App 内容变化，固定快捷方式由用户保留到支持的桌面上。它的核心是进入目标，不是提供一块持续显示摘要的区域。[A12](references.md#a12)

`TileService` 提供快捷设置面板中的磁贴，适合频繁的短操作。用户添加后它才进入面板；官方不建议把它当纯信息展示区或普通 App 启动按钮。本轮只定位该能力，完整接入另行研究。[A16](references.md#a16)
