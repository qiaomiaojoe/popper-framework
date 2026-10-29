'use strict';
// 企业微信智能机器人（内容 1.3.14，方案 设计/企业微信智能机器人-方案.md，乔淼 10-27）：跟着 remote.cjs 一起（1.3.15 起学员也有，实验版）。
// 长连接（官方文档 developer.work.weixin.qq.com/document/path/101463）：POPPER 往外连 wss://openws.work.weixin.qq.com，
// 用 Bot ID + Secret 订阅（aibot_subscribe），每 30 秒 ping 一次，断了按 1、2、4…30 秒重连。
// 一个机器人同一时间只有一个连接：别处连上了会收到 disconnected_event，这时不自动重连（不然两边互相顶）。
// 绑定：电脑上出 6 位绑定码，在企业微信单聊里发「绑定 123456」，记下发消息的人（userid）；以后只认这个人，别人发的一律不理。
// 主动发消息（通知）要这个人先在单聊里发过消息——绑定那条就算。单聊的 chatid 就是对方的 userid。
// 连接用下面自己写的小 WebSocket（MiniWs）：10-27 实测 Node 自带的 WebSocket 握手被企业微信回 404（curl 照样能连），所以不用它。
// AIWS_WECOM_WS 是本机测试用的假服务地址（ws://）。
const crypto = require('node:crypto');
const tls = require('node:tls');
const net = require('node:net');

// 最小的 WebSocket 客户端：只做文本消息、ping/pong、关闭，接口学浏览器的（onopen / onmessage / onclose / onerror / send / close / readyState）
class MiniWs {
  constructor(url) {
    const u = new URL(url), secure = u.protocol === 'wss:', port = +u.port || (secure ? 443 : 80);
    this.readyState = 0; this.buf = Buffer.alloc(0); this.frag = [];
    const key = crypto.randomBytes(16).toString('base64');
    const s = this.sock = secure ? tls.connect({ host: u.hostname, port, servername: u.hostname, ALPNProtocols: ['http/1.1'] }) : net.connect({ host: u.hostname, port });
    s.setTimeout(20000, () => this.fail(Error('连接超时')));
    s.once(secure ? 'secureConnect' : 'connect', () => s.write(`GET ${u.pathname || '/'}${u.search} HTTP/1.1\r\nHost: ${u.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\nUser-Agent: POPPER\r\n\r\n`));
    const want = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    s.on('data', d => {
      this.buf = Buffer.concat([this.buf, d]);
      if (this.readyState === 0) {
        const end = this.buf.indexOf('\r\n\r\n'); if (end < 0) return;
        const head = this.buf.slice(0, end).toString(); this.buf = this.buf.slice(end + 4);
        if (!/^HTTP\/1\.1 101/.test(head)) return this.fail(Error('握手被拒：' + head.split('\r\n')[0]));
        if (!new RegExp('sec-websocket-accept:\\s*' + want.replace(/[+/=]/g, c => '\\' + c), 'i').test(head)) return this.fail(Error('握手回的不对'));
        this.readyState = 1; s.setTimeout(0); this.onopen && this.onopen();
      }
      this.parse();
    });
    s.on('error', e => this.fail(e));
    s.on('close', () => this.done(1006));
  }
  parse() {
    for (;;) {
      const b = this.buf; if (b.length < 2) return;
      const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80; let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; } else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      const mk = masked ? b.slice(off, off + 4) : null; if (masked) off += 4;
      if (b.length < off + len) return;
      let data = b.slice(off, off + len); this.buf = b.slice(off + len);
      if (mk) data = Buffer.from(data.map((x, i) => x ^ mk[i % 4]));
      if (op === 8) { this.frame(8, data.slice(0, 2)); this.sock.end(); return this.done(data.length >= 2 ? data.readUInt16BE(0) : 1005); }
      if (op === 9) { this.frame(10, data); continue; }
      if (op === 10) continue;
      if (op === 1 || op === 2 || op === 0) { this.frag.push(data); if (fin) { const all = Buffer.concat(this.frag); this.frag = []; this.onmessage && this.onmessage({ data: all.toString('utf8') }); } }
    }
  }
  frame(op, payload) {
    const p = Buffer.from(payload), mask = crypto.randomBytes(4), n = p.length;
    const head = n < 126 ? Buffer.from([0x80 | op, 0x80 | n]) : n < 65536 ? Buffer.from([0x80 | op, 0x80 | 126, n >> 8, n & 255]) : Buffer.concat([Buffer.from([0x80 | op, 0x80 | 127]), (() => { const x = Buffer.alloc(8); x.writeBigUInt64BE(BigInt(n)); return x; })()]);
    try { this.sock.write(Buffer.concat([head, mask, Buffer.from(p.map((x, i) => x ^ mask[i % 4]))])); } catch {}
  }
  send(text) { if (this.readyState !== 1) throw Error('还没连上'); this.frame(1, Buffer.from(String(text))); }
  close() { if (this.readyState === 1) { this.frame(8, Buffer.from([0x03, 0xe8])); } try { this.sock.end(); this.sock.destroy(); } catch {} this.done(1000); }
  fail(e) { this.error = e; if (this.readyState < 2) this.onerror && this.onerror({ error: e, message: e.message }); try { this.sock.destroy(); } catch {} this.done(1006); }
  done(code) { if (this.readyState === 3) return; this.readyState = 3; this.onclose && this.onclose({ code }); }
}

const URL_DEFAULT = 'wss://openws.work.weixin.qq.com';
const reqId = p => `${p}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
const BIND_MS = 10 * 60 * 1000;

function createWecomBot({ settings, save, log = () => {}, onCommand }) {
  const cfg = () => settings.remote.bot || {};
  let ws = null, state = 'off', error = '', manual = true, backoff = 1, retry = null, ping = null, bind = null;
  const seen = []; // 收过的 msgid，防重复
  const sent = []; // 最近一分钟发过的时间：每个会话每分钟最多 30 条，这里留点余量，25 条以上先不发
  const raw = obj => { try { ws && ws.readyState === 1 && ws.send(JSON.stringify(obj)); return true; } catch { return false; } };

  function stopTimers() { clearTimeout(retry); retry = null; clearInterval(ping); ping = null; }
  function close(why) {
    manual = true; stopTimers();
    if (ws) { try { ws.close(); } catch {} ws = null; }
    state = 'off'; error = why || '';
  }
  function later() {
    if (manual) return;
    state = 'connecting'; clearTimeout(retry);
    retry = setTimeout(open, backoff * 1000); retry.unref && retry.unref();
    backoff = Math.min(backoff * 2, 30);
  }
  function open() {
    const c = cfg();
    if (!c.id || !c.secret) return close();
    stopTimers(); manual = false; state = 'connecting'; error = '';
    let sock;
    try { sock = new MiniWs(process.env.AIWS_WECOM_WS || URL_DEFAULT); } catch (e) { error = e.message; return later(); }
    ws = sock;
    sock.onopen = () => raw({ cmd: 'aibot_subscribe', headers: { req_id: reqId('aibot_subscribe') }, body: { bot_id: c.id, secret: c.secret } });
    sock.onmessage = ev => { let f; try { f = JSON.parse(String(ev.data)); } catch { return; } onFrame(f); };
    sock.onclose = () => { if (ws !== sock) return; ws = null; clearInterval(ping); ping = null; if (!manual) { error = error || '连接断了，正在重连'; later(); } };
    sock.onerror = e => { if (!manual && ws === sock) error = '连不上企业微信：' + ((e && e.message) || '看看网络'); }; // 自己关的（订阅失败、被顶掉）不盖掉原因
  }
  function onFrame(f) {
    const id = (f.headers && f.headers.req_id) || '';
    if (!f.cmd && id.startsWith('aibot_subscribe')) {
      if (f.errcode !== 0) { log('企业微信机器人订阅失败：' + (f.errmsg || f.errcode)); return close(`企业微信不让连：${f.errmsg || f.errcode}（看看 Bot ID、Secret 对不对，Secret 重置过要填新的）`); }
      state = 'ok'; error = ''; backoff = 1; log('企业微信机器人：连上了');
      clearInterval(ping); ping = setInterval(() => raw({ cmd: 'ping', headers: { req_id: reqId('ping') } }), 30000); ping.unref && ping.unref();
      return;
    }
    if (f.cmd === 'aibot_event_callback' && f.body && f.body.event && f.body.event.eventtype === 'disconnected_event') {
      log('企业微信机器人：别处连上了同一个机器人，这边断开');
      return close('同一个机器人在别处连上了（一个机器人只能连一个地方），这边已断开。要用这边就点「重新连接」');
    }
    if (f.cmd === 'aibot_msg_callback') return onMessage(f);
  }
  function respond(f, content) {
    return raw({ cmd: 'aibot_respond_msg', headers: { req_id: f.headers.req_id }, body: { msgtype: 'stream', stream: { id: crypto.randomBytes(8).toString('hex'), finish: true, content: String(content).slice(0, 6000) } } });
  }
  async function onMessage(f) {
    const b = f.body || {}, who = b.from && b.from.userid;
    if (!who || b.chattype !== 'single') return; // 只管单聊
    if (b.msgid) { if (seen.includes(b.msgid)) return; seen.push(b.msgid); if (seen.length > 200) seen.shift(); }
    const text = String((b.text && b.text.content) || (b.mixed && (b.mixed.msg_item || []).filter(x => x.msgtype === 'text').map(x => x.text && x.text.content).join('\n')) || '').trim();
    const c = cfg();
    if (!c.owner) {
      const m = text.match(/^绑定\s*(\d{6})$/);
      if (!m) return respond(f, '还没绑定：在电脑上打开 POPPER →「AI学术环境配置 → 手机远程」，点「生成绑定码」，再发「绑定 六位数字」给我。');
      if (!bind || Date.now() > bind.until || m[1] !== bind.code) return respond(f, '绑定码不对或者过期了：请在电脑上重新点「生成绑定码」。');
      settings.remote.bot = { ...c, owner: who }; bind = null; save(); log('企业微信机器人：绑定好了');
      return respond(f, '绑定好了。以后任务做完、出错、停下来等你回复时，我会在这里告诉你。\n发「帮助」看能做什么。');
    }
    if (who !== c.owner) return; // 不是绑定的那个人：不理
    if (b.msgtype !== 'text' && !text) return respond(f, '现在只认文字。图片、文件请用手机网页传。');
    let out;
    try { out = await onCommand(text); } catch (e) { out = '出错了：' + e.message; }
    if (out) respond(f, out);
  }
  // 主动发给绑定的人（通知）
  function send(content) {
    const c = cfg();
    if (state !== 'ok' || !c.owner) return false;
    const now = Date.now(); while (sent.length && now - sent[0] > 60000) sent.shift();
    if (sent.length >= 25) { log('企业微信机器人：一分钟内发太多了，这条先不发'); return false; }
    sent.push(now);
    return raw({ cmd: 'aibot_send_msg', headers: { req_id: reqId('aibot_send_msg') }, body: { chatid: c.owner, chat_type: 1, msgtype: 'markdown', markdown: { content: String(content).slice(0, 6000) } } });
  }
  const ready = () => state === 'ok' && !!cfg().owner;
  function status() {
    const c = cfg();
    return { set: !!(c.id && c.secret), id: c.id ? c.id.slice(0, 4) + '••••' : '', state, error, bound: !!c.owner, bind: bind && Date.now() < bind.until ? { code: bind.code, until: bind.until } : null };
  }
  // 配置页（route 去掉了 remote/bot 前缀）
  function admin(sub, body) {
    if (sub === '') {
      const id = String(body.id || '').trim(), secret = String(body.secret || '').trim();
      if (!/^[\w-]{8,100}$/.test(id)) throw Error('Bot ID 不对：在企业微信机器人详情页复制');
      const old = cfg(), keep = !secret && old.id === id;
      if (!keep && !/^[\w-]{8,200}$/.test(secret)) throw Error('Secret 不对：在企业微信机器人详情页复制');
      settings.remote.bot = { id, secret: keep ? old.secret : secret, ...(old.id === id && old.owner ? { owner: old.owner } : {}) };
      save(); close(); backoff = 1; open(); return;
    }
    if (sub === 'connect') { backoff = 1; close(); open(); return; }
    if (sub === 'clear') { close(); delete settings.remote.bot; bind = null; save(); return; }
    if (sub === 'bind') { if (!cfg().id) throw Error('先填 Bot ID 和 Secret'); bind = { code: String(crypto.randomInt(0, 1e6)).padStart(6, '0'), until: Date.now() + BIND_MS }; return; }
    if (sub === 'unbind') { const c = cfg(); delete c.owner; settings.remote.bot = c; save(); return; }
    if (sub === 'test') { if (!ready()) throw Error(state !== 'ok' ? '机器人还没连上' : '还没绑定：先在企业微信里发「绑定 …」'); send('**POPPER 测试通知**\n收到这条，说明机器人通知能用了。'); return; }
    throw Error('没有这个接口');
  }
  if (cfg().id && cfg().secret) open();
  return { send, ready, status, admin, close };
}

module.exports = { createWecomBot, MiniWs };
