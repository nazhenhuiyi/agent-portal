# 协议 v0.2

本目录是可检查的**设计契约**。首轮服务端与 Android 实现的运行方式见 [仓库说明](../README.md)；ntfy 仅作为设计参考。

先读 [日报完整示例](../examples/protocol/README.md)，再查字段或规则：

| 文件 | 用途 |
|---|---|
| [openapi.yaml](openapi.yaml) | 17 个操作的路径、参数、权限、请求与响应 |
| [core.schema.json](schemas/core.schema.json) | 发布、条目、变化、同步、历史等数据类型 |
| [template.schema.json](schemas/template.schema.json) | 原生小组件基础布局模板 |
| [semantics.md](semantics.md) | Schema 无法表达的事务、重试、同步和展示规则 |
| [模板说明](../docs/product-design/06-template-contract.md) | 组件、绑定、尺寸和能力回退 |
| [ntfy 对照记录](../docs/product-design/05-ntfy-protocol-decisions.md) | 查阅证据、采用的思路以及差异 |

数据结构以 Schema 为准，HTTP 接口以 OpenAPI 为准，跨字段与生命周期行为以 semantics.md 为准。文档示例来自同一组 fixture；三者修改时需要一起检查。

## 本地检查

在仓库根目录执行：

```sh
npm --prefix protocol ci --ignore-scripts
npm --prefix protocol run check
```

检查包括 OpenAPI 的合法性与引用、所有 Schema 编译、示例字段、跨字段一致性和错误输入拒绝。它不启动服务器、不发送请求、不显示手机通知，也不进行性能测试。

依赖均为协议检查的开发依赖，不代表服务端运行时需要引入这些工具。锁文件用于复现检查环境。服务端使用 Draft 2020-12 的 Ajv 校验器对接这些 Schema，明确关闭类型转换和未知字段移除。

## 当前版本包含与不包含什么

通知与小组件展示条目独立，支持只发通知、只更新展示条目，以及一次请求原子提交两者。已定义主题、整份条目更新、历史、增量同步、变化提示、不可变模板与静态素材接口。App 内部仍只有必要的配置和历史展示。

当前没有设备推送登记、业务执行动作、跨设备已读同步或网站服务接口。模板 v1 定义静态布局和数据绑定；动画需要经过 Android 能力验证后，增加明确的模板能力和版本，不能提前宣称任意动画可用。

所有 `example-…` 游标和示例凭据都是占位符。真实游标只由服务返回，客户端不能拼装，也不能把示例游标用于实际请求。
