# API：分别发布，也能一次提交

[设计目录](README.md) · [完整 OpenAPI](../../protocol/openapi.yaml) · [可运行示例](../../examples/protocol/README.md)

v0.2 已实现。业务方只对接我们的服务；不需要指定手机、Android 控件或推送厂商。

| 操作 | 路径 | 权限 |
|---|---|---|
| 创建/替换展示条目 | `PUT /v1/topics/{topic}/items/{item}` | 主题 write |
| 读取/删除展示条目 | 同路径 GET / DELETE | read / write |
| 创建/替换通知 | `PUT /v1/topics/{topic}/notifications/{notification}` | 主题 write |
| 读取/清除通知 | 同路径 GET / DELETE | read / write |
| 原子发布条目、通知或两者 | `POST /v1/topics/{topic}/publish` | 主题 write |
| 快照或增量 | `GET /v1/topics/{topic}/sync` | 主题 read |
| 变化提示 | `GET /v1/topics/{topic}/stream` | 主题 read |
| 历史 | `GET /v1/topics/{topic}/history` | 主题 read |

只发通知时：

```json
{
  "content": {
    "title": "备份失败",
    "body": "请查看任务日志。",
    "link": {"type": "url", "url": "https://agent.example/logs"}
  }
}
```

通知默认 alert，TTL 默认 600 秒。请求无需 data 或 template，也不会创建展示条目。

同时发布两者时：

```json
{
  "item": {
    "id": "agent-overview",
    "content": {
      "title": "Agent 总览",
      "body": "今日 12 个任务已完成",
      "data": {"completed": 12, "progress": 1},
      "link": {"type": "url", "url": "https://agent.example/overview"}
    }
  },
  "notification": {
    "id": "daily-report-ready",
    "content": {
      "title": "日报已完成",
      "link": {"type": "url", "url": "https://agent.example/report"}
    }
  }
}
```

组合请求至少包含一部分；省略的部分不变。全部在一个事务中提交，返回各自的资源和版本。这里的两个 ID 无需相同，也不会建立自动联动关系。

所有资源写入要求 Idempotency-Key。同一逻辑请求重试使用原键，不新增版本；同一键换请求返回 409。单资源写入支持 If-Match 强版本条件，错误版本为 412。组合请求不接受请求级条件头，每部分可用 if_revision：0 表示要求不存在，正整数要求匹配版本。

客户端无 cursor 时取得包含两类当前资源的快照，不补弹旧通知；随后读取增量。SSE 只提示“有变化，请同步”，不是正文投递。增量连续分页，游标过期返回 410 后重新取快照。历史使用独立分页游标，可按 item_id 或 notification_id 筛选，读取不触发提醒。

管理接口保留主题 PUT、模板版本 PUT/GET、素材 PUT/GET；另有主题列表和 capabilities，总计 17 个操作。模板及主题写入需要 admin。错误体、限制、默认值和全部路径以 OpenAPI / Schema 为准，跨字段规则见 [semantics.md](../../protocol/semantics.md)。
