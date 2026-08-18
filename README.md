# WeChat ClawBot Push (WorkBuddy Skill)

> 让 WorkBuddy 的任务进展，直达你的微信 📱

一个轻量级 WorkBuddy skill：当任务完成、或遇到需要你亲自确认的操作时，
通过你微信里的 ClawBot 机器人实时推送**聊天式通知**——不用守在电脑前，
打开手机微信就能掌握进度。

**核心特性**

- ✅ **任务完成提醒**：每次对话回合结束，自动推送「✅ 任务完成」
- ⚠️ **确认请求提醒**：只对高风险操作推送（删除/危险命令/写入系统目录），
  普通读写查询静默过滤，不刷屏
- 🛡️ **批量删除防护提醒**：WorkBuddy 的「批量删除确认」弹窗走沙箱层、不经过 hook，
  用配套的审计日志守护进程（`scripts/wb-audit-watch.js`）同样推送到微信
- 🔒 **零密钥入仓**：脚本运行时自动读取本机 WorkBuddy 配置（或环境变量），
  仓库内不含任何 token，可放心公开
- 📚 **完整协议文档**：附 iLink 协议参考与排障手册（错误码、平台限额、常见坑）

**工作原理**

WorkBuddy 系统 hook（`Stop` / `PermissionRequest`）→ `wb-push.js` →
iLink Bot API → 你的微信 ClawBot。

```text
任务结束 ──→ 系统 hook ──→ wb-push.js ──→ ilinkai.weixin.qq.com ──→ 微信 clawbot
                              │                                        │
                              └────────── 「✅ 任务完成」 ────────────────┘
```

---

## 快速开始

让 WorkBuddy 在「任务完成」或「需要你确认」时，通过微信里的 ClawBot 机器人
给你发聊天式通知。

## 前置条件

1. 已在 WorkBuddy 里绑定微信 ClawBot 通道（微信里能看到名为 clawbot 的机器人，
   且 `~/.workbuddy/settings.json` 中存在 `claw.users.*.channels.weixinClawBot` 配置）。
2. 电脑上装有 Node.js（本脚本使用原生 `fetch`，需 Node 18+）。

## 安装（作为 WorkBuddy skill）

把本目录放到 `~/.workbuddy/skills/wechat-clawbot-push/`。

## 手动发送一条测试

```bash
node scripts/wb-push.js --send "测试标题" "测试内容"
```

## 配置自动推送（hooks）

编辑 `~/.workbuddy/settings.json`，加入：

```json
{
  "hooks": {
    "PermissionRequest": [
      { "hooks": [ { "type": "command",
          "command": "\"C:/Program Files/nodejs/node.exe\" \"C:/Users/<你>/.workbuddy/skills/wechat-clawbot-push/scripts/wb-push.js\" --hook PermissionRequest" } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command",
          "command": "\"C:/Program Files/nodejs/node.exe\" \"C:/Users/<你>/.workbuddy/skills/wechat-clawbot-push/scripts/wb-push.js\" --hook Stop" } ] }
    ]
  }
}
```

> ⚠️ Windows 上 hook 命令由 bash 执行，路径必须用「正斜杠 + 双引号」，
> 否则反斜杠会被 bash 当转义符吃掉，导致 exit 127 静默失败。

## 通知行为

- `Stop`（任务完成）：每次对话回合结束推送一条 `✅ 任务完成`（无正文）。
- `PermissionRequest`（需要确认）：只对高风险操作推送
  （删除/危险命令、系统修改、写入系统目录），普通操作静默跳过。
  可在 `scripts/wb-push.js` 的 `isHighRisk()` 中调整过滤规则。

## 排障

| 现象 | 原因 / 处理 |
|------|-------------|
| 完全收不到 | 检查 hook 路径是否用了正斜杠；确认 `settings.json` 里有 clawbot 凭据 |
| `ret=-2 prepare failed` | 主动推送配额用尽或会话过期 → 让用户给微信 clawbot 发任意消息刷新 |
| 发了几条后突然断 | 账号限速约 7 条/5 分钟，单会话配额约 10 条，稍等或刷新会话 |
| 手动 `--send` 能收到，但「任务完成」收不到 | 会话不活跃时 `sendmessage` 仍返回 `message_id`（不报错）但消息**不投递**；脚本会误记 `lastStopPushAt`，导致后续 Stop 被 5 分钟节流跳过。处理：① 让用户给微信 clawbot 发任意消息激活会话；② 清空 `~/.workbuddy/wb-push.state.json`（内容写 `{}`）解除节流 |

详见 `references/ilink-protocol.md`。

## License

MIT
