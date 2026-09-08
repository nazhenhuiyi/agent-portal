# macOS：使用 launchd

个人电脑推荐 LaunchAgent：由当前用户管理，登录时启动，退出后自动重启。先完成[前台初始化](README.md#先在前台跑通)。以下操作只管理你自己的用户服务，不需要 sudo。

## 保存配置

创建日志和 LaunchAgent 目录：

```sh
mkdir -p "$HOME/Library/Logs/AgentPortal"
mkdir -p "$HOME/Library/LaunchAgents"
command -v node
npm root -g
```

将下面内容保存到 `~/Library/LaunchAgents/dev.agentportal.server.plist`。替换所有 `/Users/YOU`、Node 路径和 npm 全局入口路径（见部署总览）；路径中的空格可直接保留，XML 中的 `&` 则需写成 `&amp;`。plist 不会展开 `~`、`$HOME` 或 shell 命令。

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>dev.agentportal.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/absolute/path/to/node</string>
    <string>/absolute/npm/root/agent-portal-server/bin/agent-portal-server.mjs</string>
    <string>start</string>
    <string>--data-dir</string>
    <string>/Users/YOU/.local/share/agent-portal</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>/Users/YOU/Library/Logs/AgentPortal/server.log</string>
  <key>StandardErrorPath</key><string>/Users/YOU/Library/Logs/AgentPortal/error.log</string>
</dict>
</plist>
```

`KeepAlive` 让退出的进程重新启动；`ThrottleInterval` 限制启动频率，不代表会自动修复故障。启动前先停止手工运行的服务，避免占用同一端口。

## 启动与日常操作

检查 plist 语法，然后加载：

```sh
plutil -lint "$HOME/Library/LaunchAgents/dev.agentportal.server.plist"
launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/dev.agentportal.server.plist"
```

查看状态和日志：

```sh
launchctl print "gui/$(id -u)/dev.agentportal.server"
tail -n 50 -f "$HOME/Library/Logs/AgentPortal/error.log"
```

正常启动信息在同目录的 `server.log`。plist 留在 LaunchAgents 目录，后续登录会自动加载。

停止：

```sh
launchctl bootout "gui/$(id -u)" "$HOME/Library/LaunchAgents/dev.agentportal.server.plist"
```

重启或修改配置后，依次执行 bootout 和 bootstrap。不要只杀 Node 进程作为停服方式，KeepAlive 会重新启动它。bootout 只停止当前加载；要永久取消自动启动，在卸载后移除该 plist，数据库保留。

## 运行边界

- LaunchAgent 随用户会话运行：注销后停止，睡眠期间不可持续提供服务。无需登录就要启动的机器可另选 LaunchDaemon，但要自行配置运行身份与权限。
- 服务端不会自动读取 Agent CLI 的 Keychain 令牌；服务端令牌记录在自己的 SQLite 中。
- launchd 的输出文件不会自动轮转。用外部日志工具管理；最简单的手工方式是 bootout 后归档/清理日志，再 bootstrap。仅重命名正在写入的文件不会让进程自动切换到新日志。

参考：[Apple：Creating Launch Daemons and Agents](https://developer.apple.com/library/archive/documentation/MacOSX/Conceptual/BPSystemStartup/Chapters/CreatingLaunchdJobs.html)，以及本机 `man launchd.plist`、`launchctl help`。
