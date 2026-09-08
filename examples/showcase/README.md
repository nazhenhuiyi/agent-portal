# 三个可以放到桌面上的场景

这些是贴近真实用途的示例任务数据，不代表 Agent 实际执行过任务。它们共享“场景示例”主题，内容独立于协议验收样本。

| 场景 | 小组件留在桌面上的内容 | 需要打扰用户的通知 |
| --- | --- | --- |
| 晨间阅读 | 一个主题、三篇资料、预计阅读时间 | 今天的阅读已准备好 |
| 夜间代码巡检 | 正在检查的代码路径、模块进度 | 进行中不发通知 |
| 旅途相册归档 | 归档照片、相册数量、尚待确认的日期 | 只有需要人确认时才提醒 |

启动本地服务后运行：

```sh
npm run demo -- showcase
# 使用安装后的服务包：
agent-portal-server demo showcase --data-dir /absolute/path/to/data
```

打开 App 同步，在桌面添加小组件并选择相应条目。建议用 4 × 3 查看阅读清单与归档摘要；缩小后使用精简模板。该命令使用初始化时的本地凭据，上传三个模板，更新三个固定条目，并发出两条独立通知。重复运行会产生新的演示历史，不清理已有内容。

`publications.json` 是标准发布请求数组；其余三个 JSON 是原生模板 v1，无客户端场景专用代码。可将其中一条请求交给 Agent Portal CLI 发布，改写自己的标题、数据和详情链接。模板已发布版本不可变，修改布局时应使用新的版本号。

阅读链接指向公开的 ntfy 文档；代码巡检与相册链接使用 `example.com` 占位地址，替换为业务方自己的页面即可。这个示例不生成网站、不运行巡检或备份，也不检查业务页面可用性。

阅读场景引用的资料：[ntfy 移动端订阅](https://docs.ntfy.sh/subscribe/phone/)、[Android 后台执行限制](https://developer.android.com/about/versions/oreo/background)、[Android 小组件概览](https://developer.android.com/develop/ui/views/appwidgets/overview)。模板整卡只使用一个详情入口；示例选择从 ntfy 文档开始。
