'use strict';
// 手机远程（内容 1.3.13，方案 设计/手机远程控制-方案.md，乔淼 10-27）：1.3.15 起学员也有（配置页标「实验版」，默认关着；配置方法在 AI学术环境配置指南.md 第 8 节）。
// - 打开后 POPPER 在第二个端口（主端口 + 10）上给手机一个网页（手机.html）。只接 Tailscale（100.64.0.0/10）、局域网和本机来的请求，别处一律拒绝。
// - 配对：电脑上点「配对一部手机」出 6 位数字（5 分钟有效、用一次），手机打开网页输进去，拿到这部手机自己的凭证（cookie，存一年）。
//   数据文件夹的「手机.json」只存凭证的 sha256；配置页能一部部撤销。
// - 手机只能调白名单里的接口（看任务、回复、停止、重试、跟 AI 说、待办开始 / 打勾、看文件、拍照当附件）；改设置、装 skill、删东西这些都不行。
// - 打开期间 Mac 上跑 caffeinate -i，电脑不自己睡（合盖照样会睡）。
// - 企业微信通知：配置页填群机器人的 Webhook 地址，任务做完、出错、停下来等你回复时发一条，带手机网页的链接。不开手机远程也能单独用。
// - 企业微信智能机器人（内容 1.3.14，见 wecom-bot.cjs）：配了就用它发通知（带任务编号 #n），不再走 Webhook；在单聊里能回 AI、看任务、停任务（botCommand）。
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { createWecomBot } = require('./wecom-bot.cjs');

const readJSON = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJSON = (file, data) => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 2)); fs.renameSync(tmp, file); };
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const WECOM = /^https:\/\/qyapi\.weixin\.qq\.com\/cgi-bin\/webhook\/send\?key=[\w-]{8,80}$/;
const PAIR_MS = 5 * 60 * 1000;
const COOKIE = 'popm';

// 谁能连：Tailscale、局域网、本机（开发预览里用本机测）
function allowedAddr(a) {
  a = String(a || '').replace(/^::ffff:/, '');
  if (a === '127.0.0.1' || a === '::1') return true;
  if (/^fd7a:115c:a1e0:/i.test(a)) return true; // Tailscale 的 IPv6
  const m = a.match(/^(\d+)\.(\d+)\.\d+\.\d+$/); if (!m) return false;
  const [x, y] = [+m[1], +m[2]];
  return x === 10 || (x === 192 && y === 168) || (x === 172 && y >= 16 && y <= 31) || (x === 100 && y >= 64 && y <= 127);
}
// 这台电脑能让手机连的地址：Tailscale 的放前面
function addresses(port) {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) for (const n of list || []) {
    if (n.family !== 'IPv4' || n.internal) continue;
    const ts = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(n.address);
    if (ts || allowedAddr(n.address)) out.push({ kind: ts ? 'Tailscale' : '局域网', url: `http://${n.address}:${port}/` });
  }
  return out.sort((a, b) => (a.kind === 'Tailscale' ? 0 : 1) - (b.kind === 'Tailscale' ? 0 : 1));
}

function createRemote({ dataDir, contentDir, mainPort, settings, save, handle, projectName, platform, log = () => {} }) {
  const file = path.join(dataDir, '手机.json');
  const load = () => { const d = readJSON(file, {}); return { ...d, devices: Array.isArray(d.devices) ? d.devices : [] }; };
  const port = Number(process.env.AIWS_REMOTE_PORT) || mainPort + 10;
  settings.remote = settings.remote && typeof settings.remote === 'object' ? settings.remote : {};
  let server = null, awake = null, pair = null, lastError = '';
  let tries = 0; // 配对码输错的次数：错 5 次作废，要在电脑上重新点

  const deviceOf = req => {
    const c = (req.headers.cookie || '').split(/;\s*/).find(x => x.startsWith(COOKIE + '='));
    if (!c) return null;
    const h = sha(c.slice(COOKIE.length + 1)), d = load(), dev = d.devices.find(x => x.hash === h);
    if (dev && Date.now() - Date.parse(dev.lastSeen || 0) > 60000) { dev.lastSeen = new Date().toISOString(); writeJSON(file, d); }
    return dev || null;
  };
  const send = (res, code, data, headers = {}) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers }); res.end(JSON.stringify(data)); };
  const readBody = async req => { let d = ''; for await (const c of req) { d += c; if (d.length > 36e6) throw Error('内容过大'); } return JSON.parse(d || '{}'); };

  // 手机能调的接口：[方法, 路由的样子]；runs 新建、附件另外收紧
  const ALLOW = [
    ['GET', /^projects$/], ['GET', /^runs$/], ['GET', /^runs\/[\w-]+$/], ['GET', /^runs\/[\w-]+\/conversation$/], ['GET', /^todos$/], ['GET', /^todos\/act-result$/], ['GET', /^projects\/files$/], ['GET', /^file\//],
    ['POST', /^runs$/], ['POST', /^runs\/[\w-]+\/(reply|stop|retry)$/], ['POST', /^todos\/(start|done|act)$/], ['POST', /^projects\/attach$/]
  ];
  async function api(req, res, route) {
    const method = req.method;
    if (!ALLOW.some(([m, re]) => m === method && re.test(route))) return send(res, 403, { error: '手机上不能做这个，请回电脑上做' });
    // 防别的网页借手机浏览器的 cookie 发请求：POST 必须带这个头（跨站带自定义头要先预检，这里不应答预检）
    if (method !== 'GET' && req.headers['x-popper'] !== '1') return send(res, 403, { error: '只允许手机网页操作' });
    const url = new URL(req.url, 'http://x');
    let body = method === 'GET' ? Object.fromEntries(url.searchParams) : await readBody(req);
    if (method === 'POST' && route === 'runs') body = { project: String(body.project || ''), prompt: String(body.prompt || '').slice(0, 20000), free: true, title: body.title ? String(body.title).slice(0, 50) : undefined };
    if (method === 'POST' && route === 'projects/attach') body = { id: body.id, name: body.name, data: body.data }; // 只收手机传上来的文件，不许指电脑上的路径
    if (method === 'POST' && /\/retry$/.test(route)) body = {};
    const out = await handle({ method, route, body });
    if (out.raw !== undefined) { res.writeHead(out.status || 200, { ...(out.headers || {}), 'Content-Type': out.type || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); return res.end(out.raw); }
    return send(res, out.status || 200, out.data);
  }

  async function onRequest(req, res) {
    try {
      if (!allowedAddr(req.socket.remoteAddress)) { res.writeHead(403); return res.end(); }
      const url = new URL(req.url, 'http://x'), p = decodeURIComponent(url.pathname);
      if (p === '/' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' });
        return res.end(fs.readFileSync(path.join(contentDir, '手机.html')));
      }
      if (p === '/pair' && req.method === 'POST') {
        if (req.headers['x-popper'] !== '1') return send(res, 403, { error: '只允许手机网页操作' });
        const b = await readBody(req);
        if (!pair || Date.now() > pair.until) return send(res, 400, { error: '电脑上还没点「配对一部手机」，或者配对码过期了' });
        if (String(b.code || '').trim() !== pair.code) { if (++tries >= 5) pair = null; return send(res, 400, { error: pair ? '配对码不对' : '错了 5 次，这个配对码作废了：请在电脑上重新点「配对一部手机」' }); }
        pair = null; tries = 0;
        const token = crypto.randomBytes(32).toString('hex'), d = load();
        const ua = String(req.headers['user-agent'] || ''), guess = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android 手机' : '手机';
        d.devices.push({ id: 'd' + crypto.randomBytes(4).toString('hex'), name: String(b.name || '').trim().slice(0, 30) || guess, hash: sha(token), createdAt: new Date().toISOString(), lastSeen: new Date().toISOString() });
        writeJSON(file, d); log('手机远程：配对了一部手机');
        return send(res, 200, { ok: true }, { 'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000` });
      }
      if (p === '/me' && req.method === 'GET') { const dev = deviceOf(req); return send(res, 200, { paired: !!dev, name: dev ? dev.name : '' }); }
      if (p.startsWith('/api/')) {
        if (!deviceOf(req)) return send(res, 401, { error: '这部手机还没配对，或者已经被撤销了' });
        return await api(req, res, url.pathname.slice(5)); // 不解码：看文件的路由由 runtime 自己解码（和主端口一样）
      }
      return send(res, 404, { error: '没有这个页面' });
    } catch (e) { if (!res.headersSent) send(res, 400, { error: e.message }); else res.end(); }
  }

  let tries2 = 0, again = null;
  function start() {
    if (server) return;
    lastError = ''; clearTimeout(again);
    const srv = server = http.createServer(onRequest);
    // 内容更新时旧内容刚关掉端口、新内容马上又开，端口可能还没放出来：等 1 秒再试，最多 5 次
    srv.on('error', e => {
      lastError = e.code === 'EADDRINUSE' ? `端口 ${port} 被别的程序占用了` : e.message; try { srv.close(); } catch {} if (server === srv) server = null;
      if (e.code === 'EADDRINUSE' && tries2++ < 5 && settings.remote.on) { again = setTimeout(start, 1000); again.unref && again.unref(); } else log('手机远程：' + lastError);
    });
    srv.on('listening', () => { tries2 = 0; lastError = ''; });
    srv.listen(port, '0.0.0.0', () => log(`手机远程：在端口 ${port} 上等手机连`));
    if (platform === 'darwin' && !awake) { // 打开期间电脑不自己睡；POPPER 退出时 caffeinate 跟着退（-w）
      try { awake = spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' }); awake.on('exit', () => { awake = null; }); awake.unref(); } catch { awake = null; }
    }
  }
  function stop() {
    clearTimeout(again);
    if (server) { try { server.close(); server.closeAllConnections && server.closeAllConnections(); } catch {} server = null; }
    if (awake) { try { awake.kill(); } catch {} awake = null; }
    pair = null;
  }
  if (settings.remote.on) start();

  const link = runId => { const a = addresses(port)[0]; return a ? a.url + (runId ? '#run=' + runId : '') : ''; };
  const masked = u => u ? u.replace(/key=([\w-]{4})[\w-]*/, 'key=$1••••') : '';
  function status() {
    return { on: !!settings.remote.on, listening: !!server, port, error: lastError, urls: settings.remote.on ? addresses(port) : [], awake: !!awake,
      devices: load().devices.map(({ hash, ...d }) => d), pair: pair && Date.now() < pair.until ? { code: pair.code, until: pair.until } : null,
      bot: bot.status(),
      wecom: { set: !!settings.remote.wecom, url: masked(settings.remote.wecom), notify: { waiting: true, done: true, failed: true, ...(settings.remote.notify || {}) } } };
  }

  // ---------- 任务编号（企业微信里用「3 好的」「停 3」指任务）：存在 手机.json，重启后照旧 ----------
  function numOf(runId) {
    const d = load(); d.nums = d.nums && typeof d.nums === 'object' ? d.nums : {};
    if (!d.nums[runId]) { d.next = (d.next || 0) + 1; d.nums[runId] = d.next; const ks = Object.keys(d.nums); if (ks.length > 500) for (const k of ks.slice(0, ks.length - 500)) delete d.nums[k]; writeJSON(file, d); }
    return d.nums[runId];
  }
  const runOfNum = n => Object.entries(load().nums || {}).find(([, v]) => v === n)?.[0] || null;

  // ---------- 企业微信智能机器人：单聊里的几样命令 ----------
  const ST = { queued: '排队', running: '在做', stopping: '在停', waiting: '等你回复', done: '完成', failed: '出错', stopped: '已停止' };
  const line = r => `#${numOf(r.id)} ${ST[r.status] || r.status} · ${projectName(r.project)} · ${r.title || ''}`;
  const HELP = '能做的：\n- 直接回一句话：交给正在等你回复的那个任务（只有一个在等时）\n- 「3 好的」：回给 #3\n- 「任务」：看在等你、在做的任务\n- 「停 3」：停掉 #3\n开新任务、看产出、待办请用手机网页';
  async function botCommand(text) {
    const runs = (await handle({ method: 'GET', route: 'runs', body: {} })).data || [];
    const waiting = runs.filter(r => r.status === 'waiting');
    const web = settings.remote.on && link('') ? `\n手机网页：${link('')}` : '';
    if (/^(帮助|help|\?|？)$/i.test(text)) return HELP + web;
    if (/^(任务|列表)$/.test(text)) {
      const act = runs.filter(r => ['waiting', 'running', 'queued', 'stopping'].includes(r.status));
      return act.length ? act.slice(0, 15).map(line).join('\n') : '现在没有在做、在等你的任务。' + web;
    }
    let m = text.match(/^停\s*#?(\d+)$/);
    if (m) {
      const id = runOfNum(+m[1]); if (!id) return `没有 #${m[1]} 这个任务`;
      const r = await handle({ method: 'POST', route: `runs/${id}/stop`, body: {} });
      return r.status >= 400 ? `#${m[1]} 停不了：${r.data.error}` : `#${m[1]} 停下了`;
    }
    let id = null, say = text;
    m = text.match(/^#?(\d{1,5})[\s,，:：]+([\s\S]+)$/);
    if (m && runOfNum(+m[1])) { id = runOfNum(+m[1]); say = m[2].trim(); }
    else if (waiting.length === 1) id = waiting[0].id;
    else if (waiting.length > 1) return `有 ${waiting.length} 个在等你回复，请写成「编号 回复」，比如「${numOf(waiting[0].id)} 好的」：\n${waiting.map(line).join('\n')}`;
    else return '现在没有在等你回复的任务。\n' + HELP + web;
    const r = await handle({ method: 'POST', route: `runs/${id}/reply`, body: { text: say } });
    if (r.status >= 400) return `#${numOf(id)} 没交上：${r.data.error}`;
    return `收到，交给 #${numOf(id)} 了${r.data.status === 'queued' ? '（这个项目的任务满了，先排队）' : ''}。AI 回完我再告诉你。`;
  }
  const bot = createWecomBot({ settings, save, log, onCommand: botCommand });

  // ---------- 企业微信群机器人 ----------
  const wecomBase = () => process.env.AIWS_WECOM_URL || settings.remote.wecom; // AIWS_WECOM_URL：本机测试用，指到一个本地的假服务
  function post(url, data) {
    return new Promise((resolve, reject) => {
      const u = new URL(url), lib = u.protocol === 'https:' ? https : http, body = JSON.stringify(data);
      const req = lib.request(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }, timeout: 10000 }, res => {
        let d = ''; res.on('data', c => d += c); res.on('end', () => { try { const j = JSON.parse(d); j.errcode === 0 ? resolve() : reject(Error(`企业微信说：${j.errmsg || j.errcode}`)); } catch { reject(Error('企业微信回的不对：HTTP ' + res.statusCode)); } });
      });
      req.on('timeout', () => req.destroy(Error('连企业微信超时')));
      req.on('error', reject); req.end(body);
    });
  }
  const sendWecom = content => post(wecomBase(), { msgtype: 'markdown', markdown: { content: content.slice(0, 3800) } });
  const LABEL = { waiting: '⏳ 等你回复', done: '✅ 做完了', failed: '❌ 没做完' };
  // 一轮结束时调：等你回复 / 做完（自动模式整条做完才算）/ 出错。停掉的不发
  function notify(run) {
    if (!LABEL[run.status] || !(bot.ready() || wecomBase())) return;
    const want = { waiting: true, done: true, failed: true, ...(settings.remote.notify || {}) };
    if (!want[run.status]) return;
    const said = String(run.status === 'failed' ? run.error || '' : run.lastMessage || '').replace(/\s+/g, ' ').trim();
    const l = settings.remote.on ? link(run.id) : '';
    const text = `**${LABEL[run.status]}** · ${projectName(run.project)}\n${run.title || ''}\n> ${said.slice(0, 300)}${said.length > 300 ? '…' : ''}${l ? `\n[在手机上打开](${l})` : ''}`;
    if (bot.ready()) return bot.send(`**#${numOf(run.id)}** ` + text + (run.status === 'waiting' ? '\n直接回复我就交给它' : ''));
    sendWecom(text).catch(e => log('企业微信通知没发出去：' + e.message));
  }

  // ---------- 给电脑上配置页的接口（route 去掉了 remote/ 前缀） ----------
  async function admin(method, sub, body) {
    if (method === 'GET' && sub === '') return status();
    if (method !== 'POST') throw Error('不支持这个操作');
    if (sub === 'bot' || sub.startsWith('bot/')) { bot.admin(sub.slice(4), body); await new Promise(r => setTimeout(r, sub === 'bot' || sub === 'bot/connect' ? 1500 : 50)); return status(); }
    if (sub === 'on') { settings.remote.on = !!body.on; save(); body.on ? start() : stop(); await new Promise(r => setTimeout(r, 150)); return status(); }
    if (sub === 'pair') {
      if (!server) throw Error('先打开手机远程');
      pair = { code: String(crypto.randomInt(0, 1e6)).padStart(6, '0'), until: Date.now() + PAIR_MS }; tries = 0; return status();
    }
    if (sub === 'revoke') { const d = load(); d.devices = d.devices.filter(x => x.id !== String(body.id)); writeJSON(file, d); return status(); }
    if (sub === 'wecom') {
      const u = String(body.url || '').trim(), keep = u === '__keep__'; // __keep__：只改什么时候发，地址不动
      if (u && !keep && !WECOM.test(u)) throw Error('地址不对：应该是 https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=… 这样的');
      if (!keep) { if (u) settings.remote.wecom = u; else delete settings.remote.wecom; }
      if (body.notify && typeof body.notify === 'object') settings.remote.notify = { waiting: !!body.notify.waiting, done: !!body.notify.done, failed: !!body.notify.failed };
      save(); return status();
    }
    if (sub === 'wecom-test') {
      if (!wecomBase()) throw Error('先填企业微信群机器人的地址');
      const l = settings.remote.on ? link('') : '';
      await sendWecom(`**POPPER 测试通知**\n收到这条，说明通知能用了。${l ? `\n[在手机上打开 POPPER](${l})` : ''}`);
      return status();
    }
    throw Error('没有这个接口');
  }

  return { admin, notify, stop: () => { stop(); bot.close(); }, status };
}

module.exports = { createRemote, allowedAddr };
