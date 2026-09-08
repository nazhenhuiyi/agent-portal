# 06 · 模板 v1：可组合的原生展示

[设计目录](README.md) · [模板 Schema](../../protocol/schemas/template.schema.json) · [完整示例](../../examples/protocol/template.json)

这版模板解决一个具体问题：业务方换数据或组合布局时，不必为每一种业务开发新的 Android 页面。它是协议草案，尚未实现原生解释器。

## 内容与布局怎样相遇

业务方发布 `content.title`、`content.body`、`content.data`，并引用 `report-card@1`。手机读取这个版本的模板，把其中的绑定替换为当前数据，再提交小组件视图。

模板中的一个文字节点可以是：

```json
{"type":"text","text":{"bind":"/data/count","fallback":"—"},"style":"caption"}
```

若 `content.data.count` 是 12，就显示 `12`。没有这个值就显示 `—`。模板不判断“日报完成”的业务含义，也不抓取详情网站。

固定文字则写成：

```json
{"type":"text","text":{"value":"今日汇总"},"style":"title"}
```

`value` 与 `bind` 二选一。绑定使用 JSON Pointer，根节点是 content；`~0` 表示 `~`、`~1` 表示 `/`。不支持表达式、函数、脚本或隐式网络请求。解析只能访问 JSON 自身属性，不遍历原型或调用对象成员。

## 首版六类组件

| 组件 | 关键字段 | 展示行为 |
|---|---|---|
| `column` | children、gap_dp | 子组件从上到下排列 |
| `row` | children、gap_dp | 子组件从左到右排列，按可用宽度等分 |
| `text` | text、style、max_lines | 文字或绑定值，超出行数截断 |
| `image` | asset_id、width_dp、height_dp、fit | 已上传的静态图片，contain / cover |
| `progress` | value | 0–1 的进度值，绑定值超出范围时限制到这个区间 |
| `spacer` | size_dp | 在父布局排列方向留出间距 |

style 只有 title、body、caption 三档，具体字号、颜色和深浅色适配由原生端定义，不从服务端下发任意样式代码。column 的子节点占满可用宽度、按内容决定高度；row 子节点等分可用宽度。图片在自己的约束范围内缩小以适应空间，不要求小组件溢出边界。

text 接受字符串、布尔值和有限数值；数值使用普通十进制文字，布尔值为 `true` / `false`，业务需要本地化文字时直接提供字符串。数组、对象、null 或缺失值采用 fallback。progress 只接受数值，字符串 `"0.5"` 不自动转换；类型不符使用 fallback，默认 0。

每棵布局树最多 32 个节点、深度最多 4（根节点深度 1），一个容器最多 12 个直接子节点。模板总大小最多 64 KiB；这些约束让解释器保持有限、可预测，不构建完整的远程 UI 编程语言。

## 尺寸与回退

`widget` 是默认布局；可以另配 `compact_widget`。首版建议按桌面提供的当前可用尺寸选择：宽度小于 180 dp 或高度小于 110 dp 时使用 compact_widget；否则用 widget。缺少 compact_widget 时尝试默认布局。

如果模板在当前尺寸下无法合理容纳，使用内置标题摘要卡片，文字按空间截断。尺寸阈值是本版的统一选择规则，解释器实现时需要功能验证；调整规则需记录解释器行为变化。不同桌面的尺寸回调仍由 Android 适配层处理。

模板中的 image 只能引用 `asset_ids` 中声明的哈希。`asset_ids` 必须恰好包含两棵布局树引用的素材集合，不允许隐藏的下载依赖。素材缺失时可使用占位图；模板缺失、结构不合法或不支持所需能力时整体退回基础摘要卡片。

卡片整体点击使用 Item 的 link。没有 link 时打开 App 内对应条目的历史入口。首版没有组件内的业务操作按钮。

## 模板版本和能力

| 字段 | 用途 |
|---|---|
| `id` + `version` | 指定不可变的模板资源；相同版本不能覆盖 |
| `renderer_version` | 指定解释器语义，本版为 1 |
| `requires` | 声明模板实际用到的能力 |

能力从两棵树的组件推导：始终包含 `layout.basic`，出现 text 增加 `text.bind`，出现 image 增加 `image.static`，出现 progress 增加 `progress.bind`。声明集合必须与推导结果一致，由服务端检查。

手机缺少任何所需能力时整体回退，不在同一模板里猜测替代语义。读取时发现新字段或更高解释器版本，可以继续展示基础 content，不让解析失败阻断数据同步。

小猫吐彩虹需要额外的帧动画能力，目前不在 v1 组件清单中。完成原生能力验证后再为动画节点定义帧、节奏与静态回退，并扩展 Schema 和能力声明。不断更新 data 驱动状态变化是当前协议支持的动态展示；持续播放动画是另一项展示能力。

通知使用独立 Notification 的 title、body、link；小组件使用 Item 的模板与 data，两者不必有任何相同内容。App 历史按事件类型读取对应资源的标题与正文，不执行小组件布局树。
