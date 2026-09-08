# Linux：使用 systemd

适合持续运行的 Linux 服务器。以下使用系统级 unit，由管理员安装，以指定普通用户运行。先让该用户完成[前台初始化](README.md#先在前台跑通)，确认他能读取代码、执行 Node，并写入自己的数据目录。

## 安装 unit

将以下内容保存为 `/etc/systemd/system/agent-portal.service`。将 `YOUR_USER`、Node、npm 全局入口和数据路径（查找方式见部署总览）替换为实际值；路径不会展开 `$HOME`，也不会加载交互 shell 的 nvm 设置。

```ini
[Unit]
Description=Agent Portal server
After=network.target
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
User=YOUR_USER
ExecStart=/absolute/path/to/node /absolute/npm/root/agent-portal-server/bin/agent-portal-server.mjs start --data-dir /home/YOUR_USER/.local/share/agent-portal
Restart=on-failure
RestartSec=5
TimeoutStopSec=15
UMask=0077
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

ExecStart 中若路径含空格，分别用双引号包住可执行文件及各参数。停止手工服务后加载配置并启动：

```sh
sudo systemd-analyze verify /etc/systemd/system/agent-portal.service
sudo systemctl daemon-reload
sudo systemctl enable --now agent-portal
```

`enable` 设置开机启动，`--now` 同时立即启动。`Restart=on-failure` 恢复异常退出；主动 systemctl stop 或正常退出不会自动重启。频繁失败达到上限时会停止尝试。

## 查看、重启与停止

```sh
systemctl status agent-portal
sudo journalctl -u agent-portal -n 50 -f
```

按需要单独执行：

| 操作 | 命令 |
|---|---|
| 重启 | `sudo systemctl restart agent-portal` |
| 停止 | `sudo systemctl stop agent-portal` |
| 取消开机启动并停止 | `sudo systemctl disable --now agent-portal` |

修改 unit 后先执行 `sudo systemctl daemon-reload`，再 restart。若触发启动次数限制，修复原因后执行 `sudo systemctl reset-failed agent-portal`，再 start。

删除 unit 前先 disable --now，再移除 unit 文件并 daemon-reload。数据目录不会随 unit 删除。

## 日志与运行身份

日志由系统 journal 管理，其大小和保留期遵循系统 journald 设置。可查看 `journalctl --disk-usage`，由机器管理员按整机需求设置保留上限；不要为了本服务直接清空整机日志。

如果 Node 安装在某个用户的 nvm 目录中，确保 unit 的 User 正是有权访问它的用户。更新 Node 版本、改变全局安装目录或数据路径后，应同步修改 unit。服务只需运行用户对代码的读取权限和对数据目录的写入权限。

参考：[systemd.service](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)、[systemd.unit](https://www.freedesktop.org/software/systemd/man/latest/systemd.unit.html)、[journald.conf](https://www.freedesktop.org/software/systemd/man/latest/journald.conf.html)。
