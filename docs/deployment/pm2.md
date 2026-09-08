# 使用 PM2

适合希望统一用 Node.js 工具管理进程的用户。先完成[前台初始化](README.md#先在前台跑通)。macOS/Linux 可按下方示例操作；Windows 的开机启动需另行选择系统任务或服务工具，不套用 `pm2 startup`。

## 保存配置并启动

```sh
npm install -g pm2
command -v node
npm root -g
```

在自己的运维目录保存 `ecosystem.config.cjs`，替换路径。扩展名用 `.cjs`，避免与项目的 ESM 设置冲突。macOS 将 `/home/YOU` 换成实际用户目录。

```js
module.exports = {
  apps: [{
    name: "agent-portal",
    script: "/absolute/npm/root/agent-portal-server/bin/agent-portal-server.mjs",
    args: ["start", "--data-dir", "/home/YOU/.local/share/agent-portal"],
    interpreter: "/absolute/path/to/node",
    exec_mode: "fork",
    instances: 1,
    autorestart: true,
    watch: false,
    restart_delay: 5000,
    min_uptime: "10s",
    max_restarts: 10,
    kill_timeout: 15000,
    time: true,
    env: {
      NODE_ENV: "production"
    }
  }]
};
```

停止此前的手工服务，再执行：

```sh
pm2 start /absolute/path/to/ecosystem.config.cjs
pm2 status
pm2 logs agent-portal --lines 50
```

启动后若连续短时间失败，PM2 会停止尝试并标记 errored，需要查看日志后修复。保持 fork 单实例；开发时的 watch 模式不用于部署。

## 重启和自动启动

| 操作 | 命令 |
|---|---|
| 重启 | `pm2 restart agent-portal` |
| 停止 | `pm2 stop agent-portal` |

修改配置文件后执行：

```sh
pm2 restart /absolute/path/to/ecosystem.config.cjs --update-env
```

要在机器重启后恢复进程，macOS/Linux 执行：

```sh
pm2 startup
```

按 PM2 输出执行适用于该系统的安装命令，再保存需要恢复的进程列表：

```sh
pm2 save
```

所有 PM2 日常操作使用同一系统用户；仅在 startup 明确输出要求时使用 sudo。macOS 的生成方式可能依赖用户登录，并不等同于无需登录的 LaunchDaemon。Node 路径改变后，按 PM2 文档重新生成启动配置。

移除服务时执行 `pm2 delete agent-portal`，再执行 `pm2 save` 更新启动列表；若列表为空而 PM2 拒绝保存，确认确实要清空后用 `pm2 save --force`。不需要 PM2 自动启动时再按 `pm2 unstartup` 的提示移除；注意该操作影响同一用户的其他 PM2 服务。

## 日志保留

日志默认在 PM2 用户目录下（通常为 `~/.pm2/logs`）。可使用外部 `pm2-logrotate` 模块限制大小和保留数量：

```sh
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
pm2 set pm2-logrotate:compress true
```

这些设置会影响此 PM2 实例管理的日志。PM2 和日志模块是用户选择的运维依赖，不是 Agent Portal 的运行依赖。

参考：[PM2 进程配置](https://pm2.keymetrics.io/docs/usage/application-declaration/)、[启动恢复](https://pm2.keymetrics.io/docs/usage/startup/)、[日志](https://pm2.keymetrics.io/docs/usage/log-management/)。
