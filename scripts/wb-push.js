'use strict';
/**
 * WorkBuddy 手机推送脚本（微信 ClawBot / ilinkai）
 *
 * 用法1（hook 模式，被 WorkBuddy settings.json 的 hooks 调用）:
 *   node wb-push.js --hook <EventName>
 *   从 stdin 读取 hook 事件的 JSON payload
 *
 * 用法2（手动模式，任务完成时由智能体调用）:
 *   node wb-push.js --send "<标题>" "<内容>"
 *   内容也支持从 stdin 读取
 *
 * 微信 ClawBot 通道：
 *   凭据自动从 ~/.workbuddy/settings.json 的 claw.users.*.channels.weixinClawBot 读取
 *   （botToken / userId / baseUrl）。也可用环境变量覆盖：
 *   WBPUSH_WX_TOKEN / WBPUSH_WX_USER / WBPUSH_WX_BASE
 *   协议：POST {base}/ilink/bot/sendmessage（与 WorkBuddy 内置 WeixinClawBotClient 一致）
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

// ---------- 凭据 ----------
function loadWeixinCreds() {
  const env = {
    botToken: process.env.WBPUSH_WX_TOKEN || '',
    userId: process.env.WBPUSH_WX_USER || '',
    baseUrl: process.env.WBPUSH_WX_BASE || 'https://ilinkai.weixin.qq.com'
  };
  if (env.botToken && env.userId) return env;
  try {
    const sp = path.join(os.homedir(), '.workbuddy', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(sp, 'utf8'));
    const users = settings.claw && settings.claw.users ? settings.claw.users : {};
    for (const uid of Object.keys(users)) {
      const ch = users[uid] && users[uid].channels ? users[uid].channels.weixinClawBot : null;
      if (ch && ch.enabled && ch.botToken && ch.userId) {
        return {
          botToken: ch.botToken,
          userId: ch.userId,
          baseUrl: (ch.baseUrl || 'https://ilinkai.weixin.qq.com').replace(/\/$/, '')
        };
      }
    }
  } catch (e) { /* 读取失败时仅使用环境变量 */ }
  return env;
}

// ---------- 工具 ----------
function truncate(s, n) {
  s = String(s == null ? '' : s).trim();
  if (!s) return '';
  return s.length > n ? s.slice(0, n) + '…' : s;
}

function readStdin(timeoutMs) {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => { buf += d; });
    process.stdin.on('end', () => resolve(buf));
    process.stdin.on('error', () => resolve(buf));
    setTimeout(() => resolve(buf), timeoutMs);
  });
}

function randomWechatUin() {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), 'utf-8').toString('base64');
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---------- 节流状态（仅限 Stop 完成通知） ----------
// iLink 平台限额：单会话下行配额约 10 条、账号约 7 条/5 分钟。
// 完成通知每回合都推会快速打满配额、饿死「确认请求」推送（2026-08-18 实际发生）。
// 因此 Stop 做 5 分钟节流；PermissionRequest 不节流（优先级最高）。
const STATE_FILE = path.join(os.homedir(), '.workbuddy', 'wb-push.state.json');
const STOP_THROTTLE_MS = 5 * 60 * 1000;

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (e) { return {}; }
}
function saveState(st) {
  try { fs.writeFileSync(STATE_FILE, JSON.stringify(st)); } catch (e) { /* 忽略 */ }
}

// ---------- 高风险过滤（确认通知专用） ----------
// 用户要求（2026-08-17）：确认通知只推「高风险操作」——删除/破坏类命令、
// 系统修改类命令、对系统目录的写入；普通读写/查询不发。
const SYSTEM_DIR_RE = /(^|[\\/'" ])(c:[\\/](windows|program files( \(x86\))?|system32)|[\\/](etc|usr|system|var|boot|bin|sbin|library)[\\/]|~?[\\/]\.ssh[\\/]|boot\.ini)/i;
const DANGER_CMDS = [
  'rm ', 'rm -', 'rmdir', 'del ', 'del/', '/s /q', '/f /q', 'erase', 'format ',
  'shred', 'remove-item', 'delete-item', 'diskpart', 'reg add', 'reg delete',
  'sc delete', 'taskkill', 'shutdown', 'restart-computer', 'stop-computer',
  'format-volume'
];
const WRITE_VERBS = ['cp ', 'copy', 'mv ', 'move', '>', 'tee', 'curl -o', 'wget -o',
  'out-file', 'set-content', 'add-content', 'new-item'];

function isHighRisk(toolName, toolInput) {
  const name = String(toolName || '');
  let inputStr = '';
  try { inputStr = JSON.stringify(toolInput || {}); } catch (e) { inputStr = String(toolInput || ''); }
  const lower = (name + ' ' + inputStr).toLowerCase();

  // 1) 删除/破坏/系统修改类命令
  if (DANGER_CMDS.some((c) => lower.includes(c))) return true;

  // 2) 文件类工具直接写入系统目录
  if (/^(write|edit|notebookedit|create)/i.test(name)) {
    const fp = toolInput && (toolInput.file_path || toolInput.path || toolInput.filePath);
    if (fp && SYSTEM_DIR_RE.test(String(fp))) return true;
  }

  // 3) 命令中「写动词 + 系统目录」组合（如 copy 到 C:/Windows）
  if (WRITE_VERBS.some((v) => lower.includes(v)) && SYSTEM_DIR_RE.test(lower)) return true;

  return false;
}

// ---------- 通道：微信 ClawBot (ilinkai) ----------
async function sendWeixin(text) {
  const creds = loadWeixinCreds();
  if (!creds.botToken || !creds.userId) {
    throw new Error('未找到微信 ClawBot 凭据（settings.json 中无 enabled 的 weixinClawBot 通道）');
  }
  const payload = {
    msg: {
      from_user_id: '',
      to_user_id: creds.userId,
      client_id: 'wbpush-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
      message_type: 2,
      message_state: 2,
      item_list: [{ type: 1, text_item: { text: text } }]
    },
    base_info: { channel_version: 'workbuddy-desktop-1.0.0' }
  };
  const body = JSON.stringify(payload);
  let lastErr = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await fetch(creds.baseUrl + '/ilink/bot/sendmessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        AuthorizationType: 'ilink_bot_token',
        'Content-Length': String(Buffer.byteLength(body, 'utf-8')),
        'X-WECHAT-UIN': randomWechatUin(),
        Authorization: 'Bearer ' + creds.botToken
      },
      body,
      signal: AbortSignal.timeout(15000)
    });
    const respText = await res.text();
    if (!res.ok) throw new Error('微信通道 HTTP ' + res.status + ': ' + respText);
    let json = {};
    try { json = JSON.parse(respText); } catch (e) { /* 非 JSON 响应 */ }
    if (json.ret && json.ret !== 0) {
      lastErr = new Error('微信通道 ret=' + json.ret + ' ' + (json.errmsg || ''));
      if (json.ret === -2 && attempt === 1) {
        // -2 = 限流或配额耗尽，等 4 秒重试一次
        await sleep(4000);
        continue;
      }
      throw lastErr;
    }
    if (json.message_id) return { channel: 'weixin', messageId: String(json.message_id) };
    // 无 message_id 但有响应（例如空对象），也视为已接受
    return { channel: 'weixin' };
  }
  throw lastErr || new Error('微信通道未知错误');
}

// ---------- 主推送：仅微信 ClawBot（2026-08-17 用户要求关闭 Server酱） ----------
async function push(title, desp) {
  const text = title + (desp ? '\n\n' + desp : '');
  const r = await sendWeixin(text);
  console.error('[wb-push] 已通过微信 ClawBot 发送' + (r.messageId ? ' (msg ' + r.messageId + ')' : ''));
  return r;
}

async function main() {
  const mode = process.argv[2];
  const arg1 = process.argv[3] || '';
  const arg2 = process.argv[4] || '';

  if (mode === '--hook') {
    const raw = await readStdin(3000);
    let p = {};
    try { if (raw.trim()) p = JSON.parse(raw); } catch (e) { /* 忽略解析错误 */ }
    const ev = arg1 || 'Unknown';
    let title = 'WorkBuddy 通知';
    let desp = '';
    if (ev === 'PermissionRequest') {
      // 用户要求（2026-08-17）：只推高风险操作，普通读写/查询跳过。
      if (!isHighRisk(p.tool_name, p.tool_input)) {
        console.error('[wb-push] 普通操作跳过确认通知: ' + (p.tool_name || '未知'));
        return;
      }
      title = '⚠️ WorkBuddy 需要你的确认';
      let detail = '';
      try { detail = truncate(JSON.stringify(p.tool_input || {}), 400); } catch (e) { /* 忽略 */ }
      desp = '操作: ' + (p.tool_name || '未知') + '\n' + detail;
    } else if (ev === 'Stop') {
      // 每次对话回合结束自动推送（settings.json hooks.Stop）。
      // 用户要求（2026-08-17）：只显示「✅ 任务完成」，不带回复内容/目录/会话。
      // 2026-08-18 起恢复 5 分钟节流：否则完成通知会打满 iLink 配额，
      // 把「确认请求」推送饿死（用户实测反馈）。
      const msg = String(p.last_assistant_message || '').trim();
      if (!msg) { console.error('[wb-push] Stop 事件无回复内容，跳过'); return; }
      const st = loadState();
      const last = Number(st.lastStopPushAt) || 0;
      if (Date.now() - last < STOP_THROTTLE_MS) {
        console.error('[wb-push] Stop 节流跳过（距上次成功推送不足5分钟）');
        return;
      }
      const r = await push('✅ 任务完成', '');
      if (r && r.channel === 'weixin') {
        st.lastStopPushAt = Date.now();
        saveState(st);
      }
      return;
    } else {
      title = 'WorkBuddy 事件: ' + ev;
      desp = truncate(JSON.stringify(p), 400);
    }
    const sid = p.session_id || '';
    if (sid && ev !== 'Stop') desp += '\n\n会话: ' + sid;
    await push(title, desp);
  } else if (mode === '--send') {
    const title = arg1 || 'WorkBuddy 通知';
    let desp = arg2 || '';
    if (!desp) {
      const raw = await readStdin(1500);
      if (raw.trim()) desp = raw.trim();
    }
    await push(title, truncate(desp, 1500));
    console.log('[wb-push] 已发送: ' + title);
  } else {
    console.error('用法: node wb-push.js --hook <EventName> | --send "<标题>" "<内容>"');
    process.exit(2);
  }
}

main().catch((e) => {
  console.error('[wb-push] 发送失败: ' + e.message);
  process.exit(1);
});
