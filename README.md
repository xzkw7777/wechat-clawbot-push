# WeChat ClawBot Push (WorkBuddy Skill)

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

详见 `references/ilink-protocol.md`。

## License

MIT
