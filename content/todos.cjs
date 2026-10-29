'use strict';
// 待办（内容 1.3.3，乔淼 10-26）：右栏 AI 下面一个独立模块，所有项目的待办放在一起，存在数据文件夹的「待办.json」。
// 来源两种：
// - 收件箱梳理：梳理计划（收件箱/.工作站/梳理计划.json）里的 todos，按计划文件的修改时间整批导入，同一份计划只导一次；
// - 「跟 AI 说」气泡里点「放进待办」（1.3.3 叫「拆成待办」）：交给 AI 拆，AI 写进当前项目的 .工作站/待办草稿-<时间>.json，看到草稿就导入（草稿挪进 .工作站/待办草稿-已导入/）。
// - 任何对话里的 AI 自己写的 .工作站/待办草稿-*.json（内容 1.3.12）：没登记过的也导入，做法同上。
// - AI 卡上的「下一步」建议点「放进待办」（内容 1.3.4）：存的是建议本身的动作（act），「开始」由界面照建议原样做（打开工作流那一阶段、重试、开工具…），做完要自己勾。
// 「开始」= 在它的项目里单独开一个任务（一个对话）；任务做完自动打勾，手动勾 / 取消以手动的为准；删掉的只标 removed，不显示。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const readJSON = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJSON = (file, data) => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 2)); fs.renameSync(tmp, file); };
const newId = () => 't' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex');
const clean = t => ({ title: String(t.title || t.prompt || '').trim().slice(0, 80), prompt: String(t.prompt || '').slice(0, 4000), files: [].concat(t.files || []).map(String).slice(0, 20) });
const when = iso => { const d = new Date(iso); return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const DRAFT = /^待办草稿-.+\.json$/;
// 一份梳理计划的记号：按它的 todos 内容算（10-27 乔淼：点「照这样做」会改写计划文件、修改时间变了，原来按时间认，同一批待办又导进来一遍）
const planKey = plan => 'p' + crypto.createHash('sha1').update(JSON.stringify(plan && plan.todos || [])).digest('hex').slice(0, 16);
const sameTodo = (a, b) => a.project === b.project && a.title === b.title && a.prompt === b.prompt;

function createTodos({ dataDir, projects, getRun, createRun, inbox }) {
  const file = path.join(dataDir, '待办.json');
  const load = () => { const s = readJSON(file, {}); return { items: Array.isArray(s.items) ? s.items : [], plans: Array.isArray(s.plans) ? s.plans : [], splits: Array.isArray(s.splits) ? s.splits : [] }; };
  const save = s => writeJSON(file, s);
  const projectOk = id => { const p = id && projects.get(String(id)); return p && p.exists ? p : null; };

  // 把还没导进来的都导进来：新的梳理计划、AI 拆好的草稿
  function sync(s) {
    let changed = false;
    const ib = inbox();
    if (ib) {
      const pf = path.join(ib.path, '.工作站', '梳理计划.json');
      let at = 0; try { at = fs.statSync(pf).mtimeMs; } catch {}
      const plan = at && !s.plans.includes(at) ? readJSON(pf, null) : null; // 修改时间没变的不用再读
      if (plan) {
        s.plans.push(at); changed = true;
        const key = planKey(plan);
        if (Array.isArray(plan.todos) && plan.todos.length && !s.plans.includes(key)) {
          s.plans.push(key);
          for (const t of plan.todos.filter(x => x && (x.title || x.prompt)).slice(0, 50)) {
            const item = { id: newId(), ...clean(t), project: projectOk(t.project) ? String(t.project) : ib.id, from: { kind: 'triage', label: '收件箱梳理 ' + when(at), plan: key }, createdAt: new Date().toISOString() };
            // 还没做完的待办里已经有一模一样的（同项目、同标题、同指令）就不再加
            if (!s.items.some(x => !x.removed && x.done !== true && sameTodo(x, item))) s.items.push(item);
          }
        }
      }
    }
    for (const sp of s.splits.filter(x => !x.done)) {
      const p = projectOk(sp.project), f = p && path.join(p.path, '.工作站', sp.file);
      const run = getRun(sp.run);
      if (f && fs.existsSync(f)) {
        const d = readJSON(f, null);
        for (const t of (d && Array.isArray(d.todos) ? d.todos : []).filter(x => x && (x.title || x.prompt)).slice(0, 30))
          s.items.push({ id: newId(), ...clean(t), project: projectOk(t.project) ? String(t.project) : sp.project, from: { kind: 'ask', label: '跟 AI 说 ' + when(sp.at) }, createdAt: new Date().toISOString() });
        const keep = path.join(p.path, '.工作站', '待办草稿-已导入'); fs.mkdirSync(keep, { recursive: true });
        try { fs.renameSync(f, path.join(keep, sp.file)); } catch {}
        sp.done = true; changed = true;
      } else if (!run || ['done', 'failed', 'stopped'].includes(run.status)) { sp.done = true; sp.missing = true; changed = true; } // 任务结束了也没写出草稿
    }
    // 对话里的 AI 自己写的草稿（10-27 乔淼：批注改文档的对话里让 AI「写进待办」，它写不了数据文件夹的 待办.json）：
    // 每个对话的项目信息里都告诉 AI 写到项目的 .工作站/待办草稿-*.json，这里把没登记过的也收进来
    const pending = new Set(s.splits.filter(x => !x.done).map(x => x.file));
    for (const p of projects.list().filter(x => x.exists)) {
      const dir = path.join(p.path, '.工作站');
      let names = []; try { names = fs.readdirSync(dir).filter(n => DRAFT.test(n) && !pending.has(n)); } catch {}
      for (const n of names) {
        const f = path.join(dir, n);
        let st; try { st = fs.statSync(f); } catch { continue; }
        const d = readJSON(f, null);
        if (!d && Date.now() - st.mtimeMs < 30000) continue; // AI 可能还在写，下次再看
        for (const t of (d && Array.isArray(d.todos) ? d.todos : []).filter(x => x && (x.title || x.prompt)).slice(0, 30))
          s.items.push({ id: newId(), ...clean(t), project: projectOk(t.project) ? String(t.project) : p.id, from: { kind: 'ai', label: 'AI 写的 ' + when(new Date(st.mtimeMs).toISOString()) }, createdAt: new Date().toISOString() });
        const keep = path.join(dir, '待办草稿-已导入'); fs.mkdirSync(keep, { recursive: true });
        try { fs.renameSync(f, path.join(keep, n)); } catch {}
        changed = true;
      }
    }
    if (changed) save(s);
    return s;
  }

  // 给界面的样子：状态按它开的任务算（做完自动打勾；手动勾过的以手动为准）
  function view(t, plan) {
    const run = t.run ? getRun(t.run) : null, p = projects.get(t.project);
    const auto = run && run.status === 'done';
    const done = typeof t.done === 'boolean' ? t.done : !!auto;
    const status = done ? 'done' : !t.run ? 'todo' : !run ? 'todo' : ['failed', 'stopped'].includes(run.status) ? 'stuck' : run.status === 'done' ? 'done' : run.status === 'waiting' ? 'waiting' : 'doing';
    // 梳理来的、相关文件还等着「照这样做」搬走的，先不让开始（不然 AI 拿到的是收件箱里的旧位置）
    const wait = !t.run && t.from && t.from.plan && plan && plan.key === t.from.plan && !plan.applied
      && (plan.items || []).some(x => x && x.project && x.project !== 'keep' && t.files.includes(String(x.file)) && fs.existsSync(path.join(inbox().path, String(x.file))));
    if (t.act) { // 建议放进来的：没有自己的任务，开始过就算「已开始」，做完自己勾
      const st = typeof t.done === 'boolean' && t.done ? 'done' : t.startedAt ? 'started' : 'todo';
      return { id: t.id, title: t.title, prompt: '', files: [], project: t.project, projectName: p ? p.name : '（项目找不到了）', from: t.from, createdAt: t.createdAt, act: t.act, run: '', runStatus: '', status: st, wait: false, doneAt: t.doneAt || '' };
    }
    return { id: t.id, title: t.title, prompt: t.prompt, files: t.files, project: t.project, projectName: p ? p.name : '（项目找不到了）', from: t.from, createdAt: t.createdAt,
      run: t.run || '', runStatus: run ? run.status : '', status, wait: !!wait, doneAt: t.doneAt || '' };
  }

  function list() {
    const s = sync(load()), ib = inbox();
    let plan = null;
    if (ib) { const d = readJSON(path.join(ib.path, '.工作站', '梳理计划.json'), null); if (d) plan = { ...d, key: planKey(d) }; }
    return { items: s.items.filter(t => !t.removed).map(t => view(t, plan)), splitting: s.splits.filter(x => !x.done).length };
  }

  // 相关文件现在在哪：完整路径还在就用；收件箱里的名字 → 还在收件箱就用收件箱的，搬过就按梳理记录换成搬后的位置
  function where(files) {
    const ib = inbox(), moved = new Map();
    if (ib) for (const b of readJSON(path.join(ib.path, '.工作站', '梳理记录.json'), [])) for (const m of b.moves || []) moved.set(m.from, m.to);
    return files.map(f => {
      if (path.isAbsolute(f)) return fs.existsSync(f) ? f : null;
      if (!ib) return null;
      const src = path.join(ib.path, f.replace(/^\/+/, ''));
      return fs.existsSync(src) ? src : moved.get(src) && fs.existsSync(moved.get(src)) ? moved.get(src) : null;
    }).filter(Boolean);
  }

  function start(id) {
    const s = load(), t = s.items.find(x => x.id === id && !x.removed);
    if (!t) throw Error('没有这件事');
    if (t.act) throw Error('这条要在界面里开始');
    const v = list().items.find(x => x.id === id);
    if (v && v.wait) throw Error('相关文件还在收件箱：先在「梳理计划」里点「照这样做」把文件放好');
    if (t.run && getRun(t.run) && !['failed', 'stopped'].includes(getRun(t.run).status)) throw Error('这件事已经开始了');
    const p = projectOk(t.project) || inbox();
    const fs_ = where(t.files);
    const prompt = (t.prompt || t.title) + (fs_.length ? `\n\n相关文件（完整路径）：\n${fs_.map(f => '- ' + f).join('\n')}` : '');
    const r = createRun({ project: p.id, prompt, free: true, title: t.title.slice(0, 50) });
    if (r.status >= 400) throw Object.assign(Error(r.data.error), { status: r.status, data: r.data });
    t.run = r.data.id; t.startedAt = new Date().toISOString(); delete t.done; save(s);
    return { run: r.data, project: p.id };
  }
  // 下一步建议放进待办：act 是建议的动作（界面给的，存原样，只限大小）
  function add({ title, project, act }) {
    const p = projectOk(project); if (!p) throw Error('项目找不到了');
    const a = act && typeof act === 'object' ? act : null, txt = JSON.stringify(a || {});
    if (!a || txt.length > 4000 || typeof a.type !== 'string') throw Error('这条建议放不进待办');
    const s = load(); s.items.push({ id: newId(), title: String(title || '').trim().slice(0, 80) || '下一步', prompt: '', files: [], project: p.id, act: JSON.parse(txt), from: { kind: 'suggest', label: '下一步建议 ' + when(new Date().toISOString()) }, createdAt: new Date().toISOString() }); save(s);
  }
  function started(id) { const s = load(), t = s.items.find(x => x.id === id); if (!t) throw Error('没有这件事'); t.startedAt = new Date().toISOString(); save(s); }
  function setDone(id, done) {
    const s = load(), t = s.items.find(x => x.id === id); if (!t) throw Error('没有这件事');
    t.done = !!done; t.doneAt = done ? new Date().toISOString() : ''; save(s);
  }
  function remove(id) {
    const s = load(), t = s.items.find(x => x.id === id); if (!t) throw Error('没有这件事');
    t.removed = new Date().toISOString(); save(s);
  }
  // 交给 AI 拆：记下任务和草稿文件名，任务写出草稿后由 sync() 导入
  function split({ text, project, prompt }) {
    const p = projectOk(project) || inbox();
    const at = new Date().toISOString(), fname = `待办草稿-${at.replace(/[-:.TZ]/g, '').slice(0, 14)}-${crypto.randomBytes(2).toString('hex')}.json`;
    const r = createRun({ project: p.id, prompt: prompt(fname, p), free: true, title: '放进待办：' + (text.length > 12 ? text.slice(0, 12) + '…' : text) });
    if (r.status >= 400) throw Object.assign(Error(r.data.error), { status: r.status, data: r.data });
    const s = load(); s.splits.push({ run: r.data.id, project: p.id, file: fname, at }); save(s);
    return r.data;
  }
  const get = id => load().items.find(x => x.id === id && !x.removed) || null;
  return { list, get, start, add, started, setDone, remove, split, DRAFT };
}

module.exports = { createTodos };
