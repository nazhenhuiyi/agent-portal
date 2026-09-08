# Agent Portal CLI

通过 HTTP 发布手机通知和小组件内容。需要 Node.js 22+、已运行的服务、已创建的主题及该主题的令牌。

## 开始使用

在仓库根目录安装：

```sh
npm --prefix packages/cli ci
npm install --global ./packages/cli
```

配置服务地址和令牌，然后发布第一条通知：

```sh
agent-portal config set --server http://127.0.0.1:8080 --token-file /absolute/path/to/writer.token
agent-portal notify demo daily-report --title '日报已完成' --key daily-report-run-001
```

把地址、令牌文件和 `demo` 换成自己的配置。文件只包含令牌文本；导入后存入系统凭据库，不再依赖源文件。新操作换一个 `--key`，重试沿用原键。

不做全局安装时，把本文的 `agent-portal` 换成 `node packages/cli/bin/agent-portal.mjs`（在仓库根目录执行）。CLI 不需要构建，也不读取服务端数据库。

## 选择发布方式

通知和小组件条目拥有独立的内容、链接和版本；更新一方不影响另一方。用户在手机上添加小组件并选择条目。

| 需要展示什么 | 命令 |
|---|---|
| 简短提醒 | `agent-portal notify TOPIC ID --title TEXT --key KEY` |
| 小组件内容 | `agent-portal item put TOPIC ID --file item.json --key KEY` |
| 同时更新两者，整体成功或回滚 | `agent-portal publish TOPIC --file publication.json --key KEY` |

`TOPIC` 是主题，`ID` 标识通知或条目，`KEY` 标识本次操作。更新同一内容保持 ID 不变。以下 JSON 先保存为对应文件。

**只更新小组件**，保存为 `item.json`：

```json
{"content":{"title":"Agent 总览","body":"12 项任务，3 项运行中","data":{"progress":0.75},"link":{"type":"url","url":"https://agent.example/overview"}}}
```

```sh
agent-portal item put demo agent-overview --file item.json --key overview-run-001
```

**同时发布**，保存为 `publication.json`：

```json
{
  "item": {"id":"agent-overview","content":{"title":"Agent 总览","body":"12 项任务已完成","data":{"progress":1}}},
  "notification": {"id":"daily-report","content":{"title":"日报已完成","link":{"type":"url","url":"https://agent.example/report"}}}
}
```

```sh
agent-portal publish demo --file publication.json --key report-run-002
```

`--file -` 可从 stdin 读取请求体。`put` 替换整份内容，需带上要保留的字段；组合发布省略一方即保持该方不变。详情链接由业务方提供。

通知可加 `--body`、`--link`，标题/正文上限为 120/500 字符。默认 alert；`--mode silent` 只刷新手机上已有通知。`--ttl` 默认 600 秒，控制提醒有效期，不控制数据保留期。

小组件在 content 中加 `"template":{"id":"report-card","version":1}` 引用已上传模板，由模板解释 data；没有模板只显示标题和正文。

## 配置与凭据

日常调用使用已保存配置。缺少地址或令牌时会提示补齐，不默认连接 localhost。

| 操作 | 命令 |
|---|---|
| 查看已保存设置，不显示令牌 | `agent-portal config show` |
| 替换当前服务的令牌 | `agent-portal config set --token-file FILE` |
| 切换服务并配置新令牌 | `agent-portal config set --server URL --token-file FILE` |
| 删除本地配置及对应凭据 | `agent-portal config clear` |

首次配置必须提供地址，可稍后补令牌。只改变地址会清除旧凭据。clear 不撤销服务端令牌。配置操作请串行执行。

`~/.config/agent-portal/config.json` 只保存地址和凭据引用。show 中 configured 表示有地址，has_token 表示有凭据引用；不检查连通性或凭据有效性。

令牌通过 `@napi-rs/keyring` 存入 macOS Keychain、Windows Credential Manager 或 Linux Secret Service。Linux 会在 Secret Service 不可用时退回内核 keyring；跨重启保存需要可用、已解锁的 Secret Service。Agent 需能访问同一用户的凭据库；失败会报错，不退回明文配置。目前仅实测 macOS。

特殊情况才需指定选项，放在子命令之后：

- 独立配置：`agent-portal config set --config FILE --server URL --token-file TOKEN_FILE`，后续每次调用也带 `--config FILE`。
- 临时连接：`agent-portal topics --server URL --token-file FILE`，不修改保存的配置；不同地址不复用旧令牌。
- stdin 导入令牌：`agent-portal config set --token-file -`；普通联网命令的 `--token-file` 只接受文件。

CLI 不读取 PORTAL 连接环境变量。服务初始化、令牌签发及撤销仍由服务端管理命令负责。

## 查询、清除与权限

```sh
agent-portal notification get demo daily-report
agent-portal item get demo agent-overview
agent-portal history demo --notification daily-report --limit 20
agent-portal notification clear demo daily-report --key clear-run-001
agent-portal item delete demo agent-overview --key delete-run-001
```

clear 移除通知，delete 移除条目，历史按服务保留期保留。查询需要 read，发布/更新/清除需要对应主题的 write；只写令牌可直接发布，无需查询验证。主题管理及模板/素材上传需要 admin；capabilities 只要求有效令牌。

history 把 `data.next_before` 传给 `--before` 翻页，null 表示结束。sync 获取快照后，用 `data.next_cursor` 作为 `--cursor` 获取增量，按 `has_more` 取齐。HTTP 410 时，sync 重取快照，history 去掉 `--before` 重查。CLI 不保存游标或保持后台连接。

完整命令及参数见 `agent-portal --help`。素材下载要求 `--output FILE`，已存在的文件不会被覆盖。

## 结果与重试

除帮助外，成功在 stdout 输出 JSON（ok、data，HTTP 命令另含 status）；失败在 stderr 输出 JSON（error.code、error.message，HTTP 错误另含 error.http_status）。版本及幂等键在有值时返回。

| 退出码 | 含义与处理 |
|---|---|
| 0 | 命令成功；发布成功表示服务端已保存，不保证手机已收到 |
| 1 | HTTP 错误；401/403 检查令牌与权限，409/412 检查幂等键或版本冲突 |
| 2 | 参数、配置或文件错误；按提示修正 |
| 3 | 网络或响应错误；写入可能已成功，重试须保持原操作不变 |

通知、条目写入和组合发布必须带 --key。CLI 不自动重试；重试保持键、目标、令牌身份、正文和版本条件不变。幂等记录默认保留 24 小时，过期后不要盲目重试。

可选 `--if-revision 0` 表示仅创建，正数表示匹配版本；删除不接受 0。组合发布在各资源对象内写 `if_revision`。无条件时写入最新内容。

请求超时默认 10 秒，可传 `--timeout 30000`；不跟随 HTTP 重定向。Android 当前仅在 App 前台同步。

## Skill、分发与验证

配套 [skill](skills/agent-portal/SKILL.md) 已链接到仓库 `.agents/skills/agent-portal`。其他环境复制整个 skill 目录，并另行安装和配置 CLI。

尚未发布到 npm。分发时运行 `npm pack ./packages/cli`，再在目标电脑执行 `npm install --global <生成的.tgz文件>`；包内含 CLI 和 skill，不需要服务端源码。

仓库根目录执行 `npm run test:cli` 验证临时服务上的功能；`npm --prefix packages/cli run test:keychain` 用临时配置验证真实凭据库并清理测试凭据。测试不使用日常配置。
