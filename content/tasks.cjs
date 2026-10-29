'use strict';
// 任务管理（第 4 步）：
// - 同一个项目最多同时跑几个任务（设置 parallel，默认 3，1–5；内容 1.3.9 乔淼 10-27 定，以前是一个），多了的排队，有一个结束就自动开始下一个；
//   「等你回复」的不占位（以前占着，一个任务等你，后面的全卡住）。不同项目各算各的。
// - 每一轮结束后分清「等你回复」和「已完成」：指令末尾请 AI 在最后一行写【等你回复】或【完成】；没写就看结尾是不是在问问题。
// - 产出：每一轮开始前记下项目里所有文件的修改时间，结束后对比，新建或改过的文件就是产出（不靠 AI 自己汇报）。
// - 每个任务的完整记录在数据文件夹的「运行记录/<任务>/」；项目里的活动记录（.工作站/日志.jsonl）记状态、产出和一句总结。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const readJSON = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJSON = (file, data) => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 2)); fs.renameSync(tmp, file); };

// 过程里的一步（10-17 界面升级第 3 步，右栏「实时动作流」）：只留种类、动作、对象（项目里的相对路径）和状态。
// 完整内容（命令全文、工具参数）只在 运行记录/<任务>/events.jsonl，界面不碰。翻不成人话的（AI 自己的话、思考、待办清单）返回 null。
const READ_CMD = /^\s*(cat|sed|head|tail|nl|less|bat|rg|grep|ls|find|wc)\b/;
function stepOf(item, cwd) {
  const home = process.env.HOME || '';
  const rel = s => { s = String(s || '').trim(); return cwd && s.startsWith(cwd + path.sep) ? s.slice(cwd.length + 1) : home && s.startsWith(home) ? '~' + s.slice(home.length) : s; };
  const cut = (s, n = 80) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n) + '…' : s; };
  const x = String(item.text || '');
  switch (item.type) {
    case 'read': { const [verb, ...r] = x.split(' '); return { kind: 'read', label: verb === 'Read' ? '读' : '找', target: cut(rel(r.join(' '))) || cut(x) }; }
    case 'file_change': { const fl = item.files || [], f = fl[0] || {}; return { kind: 'write', label: f.kind === 'add' ? '写' : '改', target: rel(f.path) + (fl.length > 1 ? ` 等 ${fl.length} 个文件` : ''), path: rel(f.path) }; }
    case 'command_execution': {
      // Codex 把命令包在 /bin/zsh -lc "…" 里：先拆开，再按 && ; | 分段，挑最能说明在干什么的那一段
      let cmd = x.replace(/^\s*(?:\/\S*\/)?(?:ba|z)?sh\s+-l?c\s+/, '').trim();
      if (/^(["']).*\1$/s.test(cmd)) cmd = cmd.slice(1, -1);
      const segs = cmd.split(/\s*(?:&&|\|\||;|\|)\s*/).map(s => s.trim()).filter(Boolean);
      const file = s => { if (cwd && s.includes(cwd + path.sep)) return rel(s.slice(s.indexOf(cwd + path.sep)).split(/['"]/)[0].trim()); const toks = s.split(/\s+/).slice(1).map(z => z.replace(/^['"]|['"]$/g, '')).filter(z => /[./]/.test(z) && !z.startsWith('-')); return toks.length ? rel(toks[toks.length - 1]) : ''; };
      for (const s of segs) if (/^(cat|sed|head|tail|nl|less|bat)\b/.test(s)) { const f = file(s); if (f) return { kind: 'read', label: '读', target: cut(f) }; }
      for (const s of segs) if (/^(rg|grep)\b/.test(s) && !/--files\b/.test(s)) { const m = s.match(/['"]([^'"]+)['"]/); return { kind: 'read', label: '搜', target: cut(m ? m[1] : s.split(/\s+/).slice(1).join(' '), 50) }; }
      for (const s of segs) if (/^(rg\s+--files|find|ls|fd|tree)\b/.test(s)) { const g = [...s.matchAll(/-g\s+['"]?([^'"\s]+)/g)].map(m => m[1]); return { kind: 'read', label: '找', target: g.length ? cut(g.join('、'), 50) : '文件' }; }
      for (const s of segs) if (/^(pandoc)\b/.test(s)) return { kind: 'run', label: '转', target: cut(file(s) || 'Word', 50) };
      for (const s of segs) if (/^(python3?|node)\b/.test(s)) return { kind: 'run', label: '运行', target: cut(file(s) || s, 50) };
      return { kind: 'run', label: '运行', target: cut((segs.find(s => !/^(pwd|cd|echo|printf|true)\b/.test(s)) || cmd).split(cwd || '\u0000').join('.'), 60) };
    }
    case 'web_search': return { kind: 'web', label: '查', target: cut(x, 60) };
    case 'skill': return { kind: 'skill', label: '用', target: cut(x, 60) };
    case 'subagent': return { kind: 'agent', label: '派了个子任务', target: cut(x, 50) };
    case 'mcp_tool_call': return /zotero/i.test(x) ? { kind: 'mcp', label: '查', target: 'Zotero' } : /scansci/i.test(x) ? { kind: 'mcp', label: '取', target: '论文 PDF' } : { kind: 'mcp', label: '用', target: cut(x, 60) };
    // 「没放行」只给真被拦的工具调用（Claude Code 的权限拒绝，前面带「没放行：」）。
    // Codex 的 error 类条目多是它自己的提醒（设置里有认不出的项、换 HTTPS、重连…），和学术任务无关：
    // 不在动作流里显示（乔淼 10-23），原文记进任务的原始信息（见 apply 里的 'note'）
    case 'error': return /^没放行：/.test(x) ? { kind: 'deny', label: '没放行', target: cut(x.replace(/^没放行：/, ''), 60) } : { kind: 'note', hidden: true, text: x };
    case 'tool': return { kind: 'tool', label: '用', target: cut(x, 60) };
    case 'convert': return { kind: 'run', label: '转', target: cut(x, 60), ...(item.path ? { path: item.path } : {}) }; // 本机任务（MinerU）转一篇 PDF
    default: return null;
  }
}

const FOOTER = '\n\n【给工作站的结尾标记】回复的最后一行单独写一个标记：需要我回答或确认才能继续，就写【等你回复】；这件事已经做完，就写【完成】。';
const FOOTER_REPLY = '\n\n（结尾照旧：要我回答或确认，最后一行写【等你回复】；做完了写【完成】。）';
const WAIT_MARK = /【\s*等你回复\s*】/, DONE_MARK = /【\s*完成\s*】/;
// 自动模式（一键跑完整个工作流）：阶段停下来问时工作站替用户回这一句，同一阶段最多回 3 次，再问就真的等用户
const AUTO_REPLY = '（自动模式）我不在电脑前，不用等我确认：按你的判断选最合适的做法，继续做完这一阶段；你替我做的决定都列在最后。';
const AUTO_MAX = 3;

// 判断这一轮结束后是「等你回复」还是「已完成」，并去掉给工作站看的标记
function judge(text) {
  const t = String(text || '').trim();
  const lines = t.split('\n'), tail = lines.slice(-3).join('\n');
  const clean = lines.filter(l => !/^\s*【\s*(等你回复|完成)\s*】\s*$/.test(l)).join('\n').replace(/【\s*(等你回复|完成)\s*】/g, '').trim();
  if (WAIT_MARK.test(tail)) return { waiting: true, text: clean };
  if (DONE_MARK.test(tail)) return { waiting: false, text: clean };
  // 没写标记：结尾是问句，或最后几行在请你确认 / 选择，就当它在等你
  const last = clean.split('\n').filter(l => l.trim()).slice(-2).join('\n');
  return { waiting: /[？?]\s*$/.test(clean) || /(请(你)?(确认|回复|选择|告诉我)|要不要|是否需要|你想|你希望)/.test(last), text: clean };
}

// 本机任务（内容 1.2.3，MinerU）：不是 AI 跑的，由 POPPER 自己在电脑上做（locals 里登记，和引擎一样有 start / stop / name）。
// 同样进右栏、排队、能停、记活动记录、算产出；没有会话，不能回复 / 追问，「重试」就是照原样再做一遍。
// 多 agent 第 2 层（内容 1.3.0）：自动模式每一段可以交给不同的 AI。chainRest 里每段带自己的 engine / model（老任务没有，就沿用上一段的）；
// chain.engines 记整条每段用哪个 AI（右栏、工作流页面显示用），某一段「换 X 重做」只改这一段那一格。
function createTasks({ ENGINES, found, projects, runsDir, settings, wrap, onQuota, ready, locals = {}, isOn = () => true, onTurnEnd = () => {} }) {
  const runs = new Map();     // id → 任务
  const live = new Map();     // 任务 id → { run, child, engine }（正在跑的）
  const runDir = run => path.join(runsDir, run.id);
  const save = run => { try { writeJSON(path.join(runDir(run), 'run.json'), run); } catch {} };
  // 同一个项目最多同时跑几个（设置里能改，默认 3）；占位的只算在跑的，「等你回复」不算
  const limit = () => { const n = Number(settings.parallel); return Number.isInteger(n) && n >= 1 && n <= 5 ? n : 3; };
  const runningIn = projectId => [...runs.values()].filter(r => r.project === projectId && (r.status === 'running' || r.status === 'stopping'));
  const busyRun = projectId => { const r = runningIn(projectId); return r.length >= limit() ? r[0] : null; }; // 满了：返回其中一个（排队的写「等它」）

  function log(run) {
    projects.appendLog(run.project, { id: run.id, title: run.title, status: run.status, workflow: run.workflow || '', workflowVersion: run.workflowVersion || '', tool: run.tool || '', toolVersion: run.toolVersion || '',
      engine: run.engine, model: run.model || '', started: run.createdAt, ended: run.endedAt || '', outputs: run.outputs || [], summary: (run.lastMessage || '').slice(0, 200) });
  }
  // 项目文件快照：路径 → 修改时间和大小（跳过隐藏文件和 .工作站）
  function snapshot(projectId) {
    const m = new Map();
    for (const f of projects.files(projectId, 5000)) if (f.kind !== 'dir') m.set(f.path, f.mtime + ':' + f.size);
    return m;
  }

  // ---------- 启动时读回以前的任务 ----------
  fs.mkdirSync(runsDir, { recursive: true });
  for (const name of fs.readdirSync(runsDir)) {
    const run = readJSON(path.join(runsDir, name, 'run.json'), null);
    if (!run || run.id !== name || !run.turns) continue;
    run.outputs = run.outputs || [];
    // 第 3 步留下的旧记录：那时的 waiting 意思是「这一轮做完了」，不是「等你回复」，按已完成算，免得占着项目
    if (!run.v && run.status === 'waiting') { run.status = 'done'; run.endedAt = run.endedAt || new Date().toISOString(); run.v = 2; save(run); log(run); }
    if (run.status === 'running' || run.status === 'stopping') {
      run.status = 'failed'; run.error = '程序关闭时任务还在执行，已中断。可以在下面回复，让它接着做。'; run.endedAt = new Date().toISOString(); save(run); log(run);
    }
    runs.set(run.id, run);
  }
  // 上次关程序时还在排队的：等引擎都检测完、接口都准备好再接着排（见文件末尾）
  const resumeQueues = () => { for (const pid of new Set([...runs.values()].filter(r => r.status === 'queued').map(r => r.project))) next(pid); };

  // ---------- 跑一轮 ----------
  function apply(run, ev) {
    const turn = run.turns[run.turns.length - 1];
    if (ev.kind === 'session') { run.sessionId = ev.id; if (ev.model) turn.model = ev.model; }
    else if (ev.kind === 'usage') turn.usage = ev.usage;
    else if (ev.kind === 'error') run.error = ev.message;
    // 中途自己恢复了的问题（Codex 网络抖动重连）：记进 stderr 留底，不算出错；这一轮正常做完时，之前记的错也清掉
    else if (ev.kind === 'warn') run.stderr = ((run.stderr || '') + '[已自动重连] ' + ev.message + '\n').slice(-20000);
    else if (ev.kind === 'recovered') { if (run.error) run.stderr = ((run.stderr || '') + '[这一轮最后做完了，之前的报错忽略] ' + run.error + '\n').slice(-20000); run.error = null; }
    else if (ev.kind === 'quota') { run.quota = ev.quota; if (onQuota) onQuota(run.engine, ev.quota); }
    else if (ev.kind === 'progress') run.todo = ev.todo; // 本机任务：第几篇 / 共几篇
    else if (ev.kind === 'item') {
      const it = ev.item;
      if (it.type === 'agent_message') turn.lastMessage = it.text;
      if (Array.isArray(it.todos) && it.todos.length) run.todo = { done: it.todos.filter(x => x.completed).length, total: it.todos.length };
      const st = stepOf(it, run.cwd);
      if (st && st.hidden) { if (it.status !== 'in_progress') run.stderr = ((run.stderr || '') + '[提醒] ' + st.text + '\n').slice(-20000); }
      else if (st) {
        const steps = run.steps || (run.steps = []), i = steps.findIndex(s => s.id === String(it.id));
        const v = { id: String(it.id), ...st, status: it.status === 'failed' ? 'failed' : it.status === 'completed' ? 'done' : 'running' };
        if (i >= 0) steps[i] = v; else { steps.push(v); if (steps.length > 30) steps.splice(0, steps.length - 30); }
      }
    }
  }
  function startTurn(run, prompt) {
    const engine = run.local ? locals[run.local.kind] : ENGINES[run.engine], bin = run.local ? null : found[run.engine]?.bin;
    const turnNo = run.turns.length + 1, dir = runDir(run);
    const full = run.local ? prompt : prompt + (turnNo === 1 ? FOOTER : FOOTER_REPLY);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `第${turnNo}轮-指令.txt`), full);
    if (!run.local) try { const pd = path.join(run.cwd, '.工作站', '指令'); fs.mkdirSync(pd, { recursive: true }); fs.writeFileSync(path.join(pd, `${run.id}-第${turnNo}轮.txt`), full); } catch {}
    run.turns.push({ startedAt: new Date().toISOString(), ...(turnNo > 1 ? { ask: prompt.slice(0, 4000) } : {}) });
    run.status = 'running'; run.error = null; run.endedAt = ''; delete run.chainBlocked; run.steps = []; delete run.todo; run.startedAt = run.turns[run.turns.length - 1].startedAt;
    const before = snapshot(run.project);
    save(run); log(run);
    const events = fs.createWriteStream(path.join(dir, 'events.jsonl'), { flags: 'a' });
    let lastSave = 0;
    const child = engine.start(bin, {
      cwd: run.cwd, prompt: full, sessionId: run.sessionId, model: run.model, job: run.local || null,
      extraMcp: run.local ? [] : ((settings.extraMcp || {})[run.engine] || []), // 配置页里额外放行的服务（内容 1.3.2）
      writeDirs: run.local ? [] : (settings.writeDirs || []).filter(d => fs.existsSync(d)), // 「AI 还能写的文件夹」（内容 1.3.2）
      emit(ev) {
        events.write(JSON.stringify(ev) + '\n'); apply(run, ev);
        if (Date.now() - lastSave > 1000) { lastSave = Date.now(); save(run); }
      },
      onStderr(text) { run.stderr = ((run.stderr || '') + text).slice(-20000); },
      onExit(code, startError) {
        events.end();
        const turn = run.turns[run.turns.length - 1]; turn.endedAt = new Date().toISOString(); turn.exitCode = code;
        if (turn.lastMessage) fs.writeFileSync(path.join(dir, `第${turnNo}轮-回复.md`), turn.lastMessage);
        // 这一轮的产出：新建或改过的文件
        const after = snapshot(run.project), changed = [];
        for (const [p, sig] of after) if (before.get(p) !== sig) changed.push(p);
        turn.outputs = changed;
        run.outputs = [...new Set([...(run.outputs || []), ...changed])];
        projects.markUnread(run.project, changed);
        const j = judge(turn.lastMessage);
        run.lastMessage = j.text;
        if (run.status === 'stopping') run.status = 'stopped';
        else if (code === 0 && !run.error) run.status = j.waiting && !run.local ? 'waiting' : 'done';
        else { run.status = 'failed'; run.error = run.error || startError || `${engine.name} 退出码 ${code}：${(run.stderr || '').trim().split('\n').slice(-3).join(' ')}`; }
        if (run.error) run.error = engine.friendlyError(run.error);
        if (run.status !== 'waiting') run.endedAt = turn.endedAt;
        live.delete(run.id);
        save(run); log(run);
        // 自动模式：停下来问 → 替用户回一句接着做；做完 → 开下一阶段；出错或被停 → 整条停在这里（重试后接着往下）
        if (run.auto && run.status === 'waiting' && (run.autoReplies || 0) < AUTO_MAX) {
          run.autoReplies = (run.autoReplies || 0) + 1; save(run);
          setTimeout(() => { try { reply(run.id, AUTO_REPLY); } catch {} }, 0);
          return;
        }
        if (run.auto && run.status === 'waiting') { run.autoGaveUp = true; save(run); } // 回了 3 次还在问：真的等用户
        // 手机远程的企业微信通知（内容 1.3.13）：自动模式中间一段做完、还要接着开下一段的不算
        if (!(run.status === 'done' && run.chainRest && run.chainRest.length)) { try { onTurnEnd(run); } catch {} }
        if (run.status === 'done' && run.chainRest && run.chainRest.length) chainNext(run);
        if (run.status !== 'waiting') next(run.project);
      }
    });
    live.set(run.id, { run, child, engine });
  }
  // 项目有空位了：排队里最早的开始，直到占满
  function next(projectId) {
    if (busyRun(projectId)) return;
    // 自动模式的下一阶段先跑，免得后来排的任务插进一条工作流中间
    const q = [...runs.values()].filter(r => r.project === projectId && r.status === 'queued').sort((a, b) => (b.chain ? 1 : 0) - (a.chain ? 1 : 0) || a.createdAt.localeCompare(b.createdAt))[0];
    if (!q) return;
    const f = found[q.engine];
    if (!q.local && (!f || !f.bin)) { q.status = 'failed'; q.error = `没找到可用的 ${ENGINES[q.engine]?.name || q.engine}`; q.endedAt = new Date().toISOString(); save(q); log(q); return next(projectId); }
    startTurn(q, q.pendingPrompt); delete q.pendingPrompt; delete q.queuedReply; save(q);
    next(projectId); // 还有空位就接着开
  }

  // ---------- 对外 ----------
  // 新建任务：项目空着就马上跑，否则排队
  function create({ project, prompt, title, workflow, workflowVersion, tool, toolVersion, engine, model, auto, chain, chainRest, local }) {
    const p = projects.get(project);
    if (!p || !p.exists) throw Object.assign(Error('项目文件夹找不到了'), { status: 400 });
    if (local && !locals[local.kind]) throw Object.assign(Error('没有这种本机任务'), { status: 400 });
    if (local) engine = 'local';
    const f = found[engine];
    if (!local && !isOn(engine)) throw Object.assign(Error(`${ENGINES[engine]?.name || engine} 已经在「AI学术环境配置」里停用了`), { status: 409 });
    if (!local && (!f || !f.bin)) throw Object.assign(Error(`没找到可用的 ${ENGINES[engine]?.name || engine}：${f?.info.missingHint || ''}`), { status: 409 });
    if (!local && f.info.riskNotice && !settings.ack[engine]) throw Object.assign(Error(f.info.riskNotice), { status: 409, riskAck: engine }); // 界面弹确认框，确认后 POST engine/ack 再重做
    if (auto && chain && Array.isArray(chain.engines)) { chain = { ...chain, engines: chain.engines.slice() }; chain.engines[chain.i - 1] = engine; }
    const now = new Date();
    const id = now.toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15) + '-' + crypto.randomBytes(3).toString('hex');
    const run = { id, title, createdAt: now.toISOString(), cwd: p.path, project: p.id, workflow: workflow || '', workflowVersion: workflowVersion || '', tool: tool || '', toolVersion: toolVersion || '',
      v: 2, engine, model: model || '', status: 'queued', sessionId: null, turns: [], outputs: [], lastMessage: '', error: null, stderr: '', endedAt: '',
      ...(auto ? { auto: true, chain: chain || null, chainRest: chainRest || [], autoReplies: 0 } : {}), ...(local ? { local } : {}) };
    runs.set(id, run);
    fs.mkdirSync(runDir(run), { recursive: true });
    const blocker = busyRun(p.id);
    if (blocker) { run.pendingPrompt = prompt; run.waitingFor = blocker.title; save(run); log(run); }
    else startTurn(run, prompt);
    return run;
  }
  // 回复 / 追问：同一个会话接着做。项目里在跑的满了就先排队（排到了接着这个会话跑）
  function reply(id, text) {
    const run = runs.get(id);
    if (!run) throw Object.assign(Error('没有这个任务'), { status: 404 });
    if (!text || !String(text).trim()) throw Object.assign(Error('回复是空的'), { status: 400 });
    if (run.status === 'running' || run.status === 'stopping') throw Object.assign(Error('这个任务还在跑，等它这一轮结束'), { status: 409 });
    if (run.status === 'queued') throw Object.assign(Error('这个任务还在排队'), { status: 409 });
    if (run.local) throw Object.assign(Error('这是 POPPER 在电脑上自己做的任务，不是 AI，没法回复或追问'), { status: 409 });
    if (!run.sessionId) throw Object.assign(Error('这个任务没有建立会话，没法接着做，请重新执行'), { status: 409 });
    if (!found[run.engine]?.bin) throw Object.assign(Error(`这个任务是用 ${ENGINES[run.engine]?.name || run.engine} 跑的，现在找不到它，没法接着做`), { status: 409 });
    if (busyRun(run.project)) { run.queuedReply = run.status; run.status = 'queued'; run.pendingPrompt = String(text); save(run); log(run); return run; }
    startTurn(run, String(text));
    return run;
  }
  // 自动模式的下一阶段：指令在这时才加项目信息（文件清单要用最新的）。返回新任务；开不了返回 null
  // 开不了（AI 程序找不到了、项目文件夹挪走了……）：这一阶段标成出错（chainBlocked），界面提醒、能点「重试」，重试只开下一阶段，这一阶段不重做
  // engine：「换 X 接着跑」时只给下一段换；不给就用下一段自己分到的 AI（老任务没分，沿用这一段的）
  function chainNext(run, engine, model) {
    const [step, ...rest] = run.chainRest; run.chainRest = []; save(run);
    const eng = engine || step.engine || run.engine;
    try {
      return create({ project: run.project, prompt: wrap(run, step.text), title: step.title, workflow: run.workflow, workflowVersion: run.workflowVersion,
        engine: eng, model: engine ? model : step.engine ? step.model || '' : run.model, auto: true,
        chain: { i: (run.chain ? run.chain.i : 1) + 1, n: run.chain ? run.chain.n : rest.length + 2, ...(run.chain && run.chain.engines ? { engines: run.chain.engines } : {}) }, chainRest: rest });
    } catch (e) {
      run.chainRest = [step, ...rest]; run.status = 'failed'; run.chainBlocked = true;
      const planned = !engine && step.engine && step.engine !== run.engine ? `下一阶段原定交给 ${ENGINES[eng]?.name || eng}，它现在用不了：可以点「换 … 接着跑」交给别的 AI，后面各段不变。\n\n` : '';
      run.error = `这一阶段已经做完，但自动模式没能开始下一阶段「${step.title}」。${planned ? '' : '处理好之后点「重试」接着往下跑，做完的这一阶段不会重做。'}\n\n${planned}原始信息：${e.message}`;
      save(run); log(run);
      return null;
    }
  }
  // 出错后重试：同一个 AI 而且有会话 → 接着这个会话从中断处做；换了 AI 或没建立会话 → 用第 1 轮的指令新开一个任务
  function retry(id, engineId) {
    const run = runs.get(id);
    if (!run) throw Object.assign(Error('没有这个任务'), { status: 404 });
    if (!['failed', 'stopped'].includes(run.status)) throw Object.assign(Error('只有出错或停止的任务能重试'), { status: 409 });
    // 本机任务：照原样再做一遍（转过的会跳过，所以等于接着做）
    if (run.local) { let first = ''; try { first = fs.readFileSync(path.join(runDir(run), '第1轮-指令.txt'), 'utf8'); } catch {}
      return create({ project: run.project, prompt: first || run.title, title: run.title, tool: run.tool, toolVersion: run.toolVersion, local: run.local }); }
    const eng = engineId && ENGINES[engineId] ? engineId : run.engine;
    const p = projects.get(run.project);
    // 这一阶段做完了、只是下一阶段没开起来：重试就是再开一次下一阶段
    if (run.chainBlocked && (run.chainRest || []).length) {
      run.status = 'done'; run.error = null; delete run.chainBlocked; save(run); log(run);
      // 点了「换 X 接着跑」：只有下一段换成 X；普通「重试」：下一段还用它分到的 AI
      const nx = chainNext(run, engineId && ENGINES[engineId] ? engineId : '', (p && p.engine === eng && p.model) || settings.model[eng] || '');
      if (!nx) throw Object.assign(Error(run.error.split('\n\n原始信息：').pop()), { status: 409 });
      return nx;
    }
    if (eng === run.engine && run.sessionId) return reply(id, '刚才这一轮中断了（出错或被停止）。请从中断的地方接着做，已经做完的部分不用重做。');
    let first = ''; try { first = fs.readFileSync(path.join(runDir(run), '第1轮-指令.txt'), 'utf8').split(FOOTER)[0]; } catch {}
    if (!first.trim()) throw Object.assign(Error('找不到这个任务原来的指令，请回到工作流或工具重新执行'), { status: 409 });
    const carry = run.auto ? { auto: true, chain: run.chain, chainRest: run.chainRest || [] } : {};
    if (run.auto) { run.chainRest = []; save(run); }
    try {
      return create({ project: run.project, prompt: first, title: run.title, workflow: run.workflow, workflowVersion: run.workflowVersion,
        tool: run.tool, toolVersion: run.toolVersion, engine: eng, model: eng === run.engine ? run.model : (p && p.engine === eng && p.model) || settings.model[eng] || '', ...carry });
    } catch (e) { if (run.auto) { run.chainRest = carry.chainRest; save(run); } throw e; } // 开不起来：后面各段还留在这个任务上
  }
  // 停止：在跑的停掉；排队的取消；等你回复的直接结束（不再等）
  function stop(id) {
    const run = runs.get(id);
    if (!run) throw Object.assign(Error('没有这个任务'), { status: 404 });
    const l = live.get(run.id);
    if (l && l.run === run) { run.status = 'stopping'; save(run); l.engine.stop(l.child); return run; }
    if (run.status === 'queued' || run.status === 'waiting') {
      // 排着队的回复取消了：回到排队前的样子（等你回复 → 结束，做完的还是做完）
      run.status = run.queuedReply ? (run.queuedReply === 'waiting' ? 'done' : run.queuedReply) : run.status === 'waiting' ? 'done' : 'stopped'; run.endedAt = new Date().toISOString(); delete run.pendingPrompt; delete run.queuedReply;
      save(run); log(run); next(run.project);
    }
    return run;
  }
  const pub = run => {
    const { stderr, pendingPrompt, turns, chainRest, steps, ...rest } = run, last = turns[turns.length - 1] || {};
    // 动作流只给在跑的任务（最近 12 步），别的任务不带，免得列表太大
    return { ...rest, steps: ['running', 'stopping'].includes(run.status) ? (steps || []).slice(-12) : undefined, chainLeft: (chainRest || []).length, turns: turns.length, usage: last.usage || null, lastOutputs: last.outputs || [], stderr: (stderr || '').slice(-2000),
      waitingFor: run.status === 'queued' ? (busyRun(run.project) || {}).title || '' : '' };
  };
  Promise.resolve(ready).then(resumeQueues, resumeQueues); // AI 程序检测完再接着排，不然会误报「没找到」
  return {
    create, reply, retry, stop, pub,
    // 清除过的任务不进列表（10-18）：记录（运行记录/<任务>/、项目的 .工作站/日志.jsonl）都还在
    list: projectId => [...runs.values()].filter(r => !r.cleared && (!projectId || r.project === projectId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    // 清除：只认已经结束的（完成、出错、已停止）；返回清了几个
    clear(ids) {
      let n = 0;
      for (const id of ids) { const r = runs.get(id); if (r && !r.cleared && ['done', 'failed', 'stopped'].includes(r.status)) { r.cleared = new Date().toISOString(); save(r); n++; } }
      return n;
    },
    get: id => runs.get(id),
    prompt(id, turn) { const run = runs.get(id); if (!run) return null; try { return fs.readFileSync(path.join(runDir(run), `第${turn || 1}轮-指令.txt`), 'utf8'); } catch { return null; } },
    // 完整对话（右栏「放大」用）：每一轮你说的（第 1 轮是工作流 / 工具的指令，不显示）和 AI 的回复
    conversation(id) {
      const run = runs.get(id); if (!run) return null;
      const read = f => { try { return fs.readFileSync(path.join(runDir(run), f), 'utf8'); } catch { return ''; } };
      return run.turns.map((t, i) => ({ ask: i ? (t.ask ?? read(`第${i + 1}轮-指令.txt`).split(FOOTER_REPLY)[0]) : '',
        reply: t.lastMessage || read(`第${i + 1}轮-回复.md`), at: t.startedAt || '', error: t.error || '' }));
    },
    isBusy: () => live.size > 0,
    kick: () => resumeQueues(), // 设置里调大了同时跑的个数：排着的马上补上
    stopAll: () => { for (const { run, child, engine } of live.values()) { run.status = 'stopping'; engine.stop(child); } }
  };
}

module.exports = { createTasks, judge };
