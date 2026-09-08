# 三种发布方式

通知负责简短提醒；Item 是供用户绑定到小组件的持续展示内容。它们独立拥有 ID、正文、链接和版本，不要求一一配套。所有请求均使用主题写入令牌；路径、字段和错误码见 [OpenAPI](../../protocol/openapi.yaml)。

| 需求 | 请求 | 示例 |
|---|---|---|
| 只发通知 | `PUT /v1/topics/research/notifications/backup-failed` | [notification-only.json](notification-only.json) |
| 只更新小组件内容 | `PUT /v1/topics/research/items/daily-2026-09-08` | [publish-running.json](publish-running.json) |
| 同时发布两者 | `POST /v1/topics/research/publish` | [publication-combined.json](publication-combined.json) |

通知只接受标题、简短正文和可选链接。展示条目可以额外包含 data 与 template，供原生小组件显示进度、统计和摘要。**只发通知不会产生小组件候选条目；更新条目不会改变通知。**

组合请求的 item 和 notification 各有 id。遗漏一方表示不修改它；两者可以使用完全不同的内容与链接。服务在一个事务中提交，任一部分失败则全部回滚。每部分可带 if_revision：0 要求不存在，正数匹配版本，省略表示无条件替换。

每次逻辑写入提供新的 `Idempotency-Key`；网络重试必须沿用原键和原请求。重复请求不新增版本或事件。单资源 PUT 可用 `If-Match: "1"` 或 `If-None-Match: *`。

直接运行本地演示：

```sh
npm run demo -- running
npm run demo -- completed
npm run demo -- notification
npm run demo -- clear-notification
npm run demo -- delete
```

running 只更新 `demo/demo-report`。completed 同时更新这个条目，并向独立的 `daily-completed` 通知发布简短提醒。notification 只替换通知；clear-notification 只清除通知；delete 只移除展示条目。App 前台时同步，回到桌面查看已更新的小组件。

完整 HTTP 顺序见 [daily-report.http](daily-report.http)：创建主题与模板 → 生成中 → 首次快照 → 组合发布完成 → 增量同步 → 历史 → 分别删除。文件使用 research 主题，需要自行创建对应权限令牌。固定幂等键供单次演练与重试；开始新一轮演练时更换键。

快照同时返回 items 和 notifications，首次同步不补弹已有通知。增量日志混合两类资源事件，客户端分别应用。历史可用 item_id 或 notification_id 筛选，不能同时指定。清除通知与删除条目都保留历史。

JSON 中的固定日期、UUID、example 游标是协议检查数据。真实时刻与游标由服务返回，不要把示例游标用于请求。首次设置、权限、前台限制见 [运行说明](../../README.md)。
