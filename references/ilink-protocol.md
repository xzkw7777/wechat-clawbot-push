# iLink Bot 协议参考（微信 ClawBot 通道）

WorkBuddy 内置的 `WeixinClawBotClient` 通过腾讯 iLink Bot 通道与微信个人号 Bot 通信。
本文档为该协议的精简实现说明，用于推送消息与排障。

## 认证

- Base URL：`https://ilinkai.weixin.qq.com`
- 所有运行时 API 均为 `POST /ilink/bot/<endpoint>`，JSON body（登录相关接口除外）。
- 凭据：`botToken`（扫码登录后下发，形如 `dxxxx@im.bot:xxxx`）、`userId`（形如 `xxxx@im.wechat`）。

## 请求头（缺一不可）

```
Content-Type: application/json
AuthorizationType: ilink_bot_token
Content-Length: <字节数>
X-WECHAT-UIN: <Base64 编码的随机 uint32>
Authorization: Bearer <botToken>
```

`X-WECHAT-UIN` 生成：

```js
const uint32 = crypto.randomBytes(4).readUInt32BE(0);
const uin = Buffer.from(String(uint32), 'utf-8').toString('base64');
```

## 通用 body 包装

每个请求 body 额外附带 `base_info`：

```json
{ "base_info": { "channel_version": "workbuddy-desktop-1.0.0" } }
```

## 端点

### sendmessage（发送文本）

```
POST /ilink/bot/sendmessage
```

```json
{
  "msg": {
    "from_user_id": "",
    "to_user_id": "<userId>",
    "client_id": "wbpush-<ts>-<rand>",
    "message_type": 2,
    "message_state": 2,
    "item_list": [ { "type": 1, "text_item": { "text": "消息内容" } } ]
  },
  "base_info": { "channel_version": "workbuddy-desktop-1.0.0" }
}
```

- `item_list` 的 `type`：`1=文本`、`2=图片`、`4=文件`、`5=视频`。
- 文本可省略 `context_token`（被动回复时必须回传，主动推送可空）。
- 成功：返回 `{}` 或 `{"message_id": <number>}`（`ret` 缺失或为 0 视为成功）。

### getupdates（长轮询收消息，默认超时 35s）

```
POST /ilink/bot/getupdates
```

```json
{ "get_updates_buf": "<游标，首轮传空字符串>" }
```

响应：`{ "ret":0, "msgs":[...], "get_updates_buf":"<新游标>", "longpolling_timeout_ms": 35000 }`。

### getconfig / sendtyping

- `getconfig`：`{ "ilink_user_id":"<userId>", "context_token":"<可选>" }` → 返回账号配置（含 typing_ticket）。
- `sendtyping`：`{ "ilink_user_id", "typing_ticket", "status": 1|2 }`（1=输入中，2=取消）。

## 错误码

| ret | 含义 | 处理 |
|-----|------|------|
| 0 / 缺失 | 成功 | — |
| -2 | 限流 或 配额耗尽 / 会话过期（两者报错相同） | 等 4 秒重试；仍失败则需用户给 bot 发消息刷新 |
| -14 | 会话过期（登录态丢失） | 重新扫码登录 |

## 平台限制（主动推送）

- 只能对「活跃会话」主动推送：用户近 24h 内给 bot 发过消息。
- 单会话 token 下行配额约 **10 条**，超量返回 `ret=-2`。
- 账号级限速约 **7 条 / 5 分钟**（所有客户端共享）。
- 用户给 bot 发任意消息即刷新配额 / 活跃状态。

> 注：`ret=-2` 无法区分「限流」与「配额耗尽」，两者表现一致。
> 这些限制是平台级规则，无法从客户端脚本侧绕过。

### ⚠️ 会话不活跃时的「静默不投递」

会话不活跃（用户近 24h 未给 bot 发消息）时，`sendmessage` **可能仍返回
`message_id`（不报错）**，但消息不会真正投递到用户微信——这是最坑的一点：
无法从返回值判断是否送达。

对 `wb-push.js` 的影响：脚本会把这种「假成功」当作成功并写入
`~/.workbuddy/wb-push.state.json` 的 `lastStopPushAt`，导致后续 `Stop` 推送被
5 分钟节流跳过，表现为「手动 `--send` 能收到，但『任务完成』收不到」。

处理步骤：

1. 让用户给微信 clawbot 发任意消息，激活会话；
2. 清空节流状态：把 `~/.workbuddy/wb-push.state.json` 内容写为 `{}`。

> 提示：若 `getconfig` 返回 `{"ret":-4,"errmsg":"GetTypingTicket rpc failed"}`，
> 通常也指向会话不活跃，而非登录态丢失（登录态丢失是 `ret=-14`）。

## 安全提示

- 不要在仓库中提交 `botToken` / `userId`。本 skill 的脚本运行时从
  `~/.workbuddy/settings.json` 或环境变量读取凭据。
- 同一 botToken 不要被多个长轮询实例同时占用，否则消息可能被抢走。
