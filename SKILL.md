---
name: wechat-clawbot-push
description: Push task-completion and permission-request notifications from WorkBuddy to the user's WeChat through the ClawBot (iLink) channel. This skill should be used when the user wants WorkBuddy to notify their WeChat, or when setting up, configuring, or debugging the WeChat ClawBot push hooks and the iLink sendmessage API.
agent_created: true
---

# WeChat ClawBot Push

Push notifications from WorkBuddy to the user's WeChat via the ClawBot (iLink) bot channel. The notification arrives as a chat-style message from the bot the user already bound in WeChat (named "clawbot").

## When to Use

- User wants "任务完成" (task done) or "需要确认" (permission required) notifications pushed to WeChat.
- Setting up or fixing the push hooks in `~/.workbuddy/settings.json`.
- Manually sending a WeChat notification from a WorkBuddy task.
- Debugging `ret=-2 prepare failed` / quota / silent failures.

## How to Use

### 1. Manual send

```bash
node <skill>/scripts/wb-push.js --send "标题" "内容"
```

The script needs no bundled secrets. It auto-reads credentials from
`~/.workbuddy/settings.json` → `claw.users.*.channels.weixinClawBot`
(`botToken`, `userId`, `baseUrl`). Override with env vars
`WBPUSH_WX_TOKEN` / `WBPUSH_WX_USER` / `WBPUSH_WX_BASE`.

### 2. Automatic push via hooks

Add to `~/.workbuddy/settings.json`:

```json
{
  "hooks": {
    "PermissionRequest": [
      { "hooks": [ { "type": "command",
          "command": "\"C:/Program Files/nodejs/node.exe\" \"<skill>/scripts/wb-push.js\" --hook PermissionRequest" } ] }
    ],
    "Stop": [
      { "hooks": [ { "type": "command",
          "command": "\"C:/Program Files/nodejs/node.exe\" \"<skill>/scripts/wb-push.js\" --hook Stop" } ] }
    ]
  }
}
```

**CRITICAL — Windows path quoting**: hook commands run through bash, so use
forward slashes + double quotes for paths. Backslash paths (e.g.
`C:\Program Files\nodejs\node.exe`) get mangled by bash and fail silently
with exit code 127 (command not found).

### 3. Notification behavior (configurable in the script)

- `Stop` → sends bare `✅ 任务完成` (no reply content / dir / session id).
  Throttled to at most one push per 5 minutes to protect the iLink quota
  (the ~10-per-session / 7-per-5min limits are shared by all pushes).
- `PermissionRequest` → only pushes for **high-risk** operations (delete /
  destructive commands, system-modification commands, writes to system
  directories). Ordinary reads/writes are skipped silently, and high-risk
  confirmations are **never throttled** (highest priority). Adjust the filter
  in `isHighRisk()` inside the script.
- `Notification` → catches permission-prompt notifications, filtered by the
  same high-risk rules.

### 4. Bulk-delete guard prompts (sandbox layer)

WorkBuddy's "bulk delete" protection prompt (≥50 files in one delete) is
raised at the sandbox layer and fires **no CLI hook at all**. Cover it with
the audit-log daemon:

```bash
node <skill>/scripts/wb-audit-watch.js
```

It scans `~/.workbuddy/audit-log/**/*.jsonl` every 2s for
`file-safety.bulk-delete.needs-approval` events (and any `*.needs-approval`)
and pushes to WeChat via wb-push.js. Details:

- Dedupe key: `commandHash|eventType|timestamp` — spool events have **no id**
  field (ids are added only when merged into the daily log).
- Full-scan (no offsets): spool files are rewritten frequently by the audit
  system, so offset tracking is unreliable. Files are small; a full scan is
  cheap.
- Single-instance lock (`~/.workbuddy/wb-audit-watch.lock`, `pid|version`);
  newer versions take over older ones automatically.
- Auto-start: drop a `.vbs` launcher into the Windows Startup folder that
  runs the script with a hidden window (Task Scheduler / cscript may be
  blocked by security policy).
- State/log: `~/.workbuddy/wb-audit-watch.state.json` /
  `~/.workbuddy/wb-audit-watch.log`.

## Platform Limits (important)

The iLink bot can only push proactively when the user has an active session:
- The user must have sent the bot a message within ~24h.
- Per-session downlink quota is ~10 messages; account rate limit ~7/5 min.
- When exceeded, `sendmessage` returns `{"ret":-2,"errmsg":"prepare failed"}`.
- Recovery: have the user send any message to the WeChat bot, which refreshes
  the quota/session. This limit cannot be bypassed from the script side.

See `references/ilink-protocol.md` for the full protocol and error handling.
