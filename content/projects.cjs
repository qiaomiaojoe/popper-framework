'use strict';
// 项目：一个文件夹 + AGENTS.md（项目说明）+ CLAUDE.md（一句话指向 AGENTS.md）+ .工作站/（工作站自己的记录）。
// 项目列表记在数据文件夹的「项目列表.json」里（只记路径和顺序）；项目自己的信息记在项目文件夹的 .工作站/项目.json，
// 跟着项目走——拷给别人、换电脑都带着。打开已有文件夹作为项目时，只加 .工作站/，不动原有文件。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { NAMING } = require('./naming.cjs');

const readJSON = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJSON = (file, data) => { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 2)); fs.renameSync(tmp, file); };
const META = '.工作站';
const LANGS = ['中文', '英文', '中英双语'];
// 项目类型（内容 1.3.5，乔淼 10-26）：决定右栏「下一步」建议用哪套规则。没写 = 论文（学员的项目都是这个）
const KINDS = { paper: '论文', students: '学员交付', gzh: '公众号', teaching: '备课', general: '通用' };
// 文件清单里跳过的：隐藏文件、程序依赖，以及临时 / 备份文件（.bak、.tmp、.orig、~ 结尾，Word 的 ~$ 开头）都不列，也不算产出
const ARCHIVE = '已归档'; // 收件箱里「不用了」的文件归档到这里（内容 1.3.10）
const SKIP = name => name.startsWith('.') || name.startsWith('~$') || name === 'node_modules' || name === '__pycache__'
  || /~$/.test(name) || /\.(bak|tmp|temp|orig|swp|crdownload)([-_.\d][^/]*)?$/i.test(name) || /[._-]bak\d*\./i.test(name);
const KIND = { '.md': 'md', '.markdown': 'md', '.txt': 'text', '.html': 'html', '.htm': 'html', '.pdf': 'pdf', '.docx': 'docx', '.doc': 'docx',
  '.csv': 'data', '.xlsx': 'data', '.xls': 'data', '.sav': 'data', '.json': 'text', '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.svg': 'image' };
const kindOf = p => KIND[path.extname(p).toLowerCase()] || 'other';

const agentsTemplate = ({ name, lang }) => `# 项目说明（AI 每次开工都会先读这份）

- 项目：${name}
- 产出语言：${lang}
- 关联的 Zotero 集合：（还没有）

## 我的规矩
- 引用只用真实存在、能核对的文献
- （在这里补充你自己的要求，比如写作风格、目标期刊）

${NAMING}`;

function createProjects({ dataDir, defaultProjectsDir, defaultEngine }) {
  const listFile = path.join(dataDir, '项目列表.json');
  const reg = readJSON(listFile, { items: [], current: null });
  reg.items = Array.isArray(reg.items) ? reg.items : [];
  const saveReg = () => writeJSON(listFile, reg);
  const metaFile = dir => path.join(dir, META, '项目.json');

  // 读项目自己的信息；文件夹不见了（被移动或删除）就标出来，不自动从列表里删
  function load(item) {
    const exists = fs.existsSync(item.path);
    const m = exists ? readJSON(metaFile(item.path), null) : null;
    return { id: item.id, path: item.path, exists, inbox: !!item.inbox,
      name: m?.name || item.name || path.basename(item.path), lang: m?.lang || '中文',
      engine: m?.engine || defaultEngine(), model: m?.model || '', createdAt: m?.createdAt || '', kind: KINDS[m?.kind] ? m.kind : 'paper' };
  }
  function writeMeta(dir, data) { writeJSON(metaFile(dir), data); }
  function ensureMeta(dir, extra = {}) {
    const old = readJSON(metaFile(dir), null);
    const m = { id: old?.id || crypto.randomBytes(6).toString('hex'), name: old?.name || extra.name || path.basename(dir),
      lang: old?.lang || extra.lang || '中文', engine: old?.engine || extra.engine || defaultEngine(), model: old?.model || '',
      createdAt: old?.createdAt || new Date().toISOString() };
    if (!old || Object.keys(m).some(k => old[k] !== m[k])) writeMeta(dir, { ...old, ...m });
    const log = path.join(dir, META, '日志.jsonl');
    if (!fs.existsSync(log)) fs.writeFileSync(log, '');
    return m;
  }

  // 收件箱：不属于哪个项目的零散文件和任务放这里，10-18 起总在列表最上面（第三轮第 1 条）
  const inboxDir = path.join(defaultProjectsDir, '收件箱');
  if (!reg.items.some(i => i.inbox)) {
    fs.mkdirSync(inboxDir, { recursive: true });
    const m = ensureMeta(inboxDir, { name: '收件箱' });
    reg.items.push({ id: m.id, path: inboxDir, inbox: true });
    if (!reg.current) reg.current = m.id;
    saveReg();
  }
  const byId = id => reg.items.find(i => i.id === id);
  const order = () => [...reg.items.filter(i => i.inbox), ...reg.items.filter(i => !i.inbox)];

  function add(dir, extra) {
    const m = ensureMeta(dir, extra);
    let item = reg.items.find(i => i.id === m.id || i.path === dir);
    if (item) { item.path = dir; item.id = m.id; }
    else { item = { id: m.id, path: dir }; reg.items.push(item); }
    reg.current = m.id; saveReg();
    return load(item);
  }

  function create({ name, dir, lang, engine }) {
    name = String(name || '').trim();
    if (!name) throw Error('项目名不能空');
    if (/[\\/:*?"<>|]/.test(name) || name.startsWith('.')) throw Error('项目名里不能有 \\ / : * ? " < > | 这些符号，也不能用点开头');
    const parent = dir || defaultProjectsDir, full = path.join(parent, name);
    if (fs.existsSync(full)) throw Error(`「${full}」已经有了。要用它的话，点「打开已有文件夹作为项目」`);
    fs.mkdirSync(full, { recursive: true });
    const l = LANGS.includes(lang) ? lang : '中文';
    fs.writeFileSync(path.join(full, 'AGENTS.md'), agentsTemplate({ name, lang: l }));
    fs.writeFileSync(path.join(full, 'CLAUDE.md'), '见 [AGENTS.md](AGENTS.md)。\n');
    return add(full, { name, lang: l, engine });
  }

  function open(dir) {
    if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw Error('没有这个文件夹');
    dir = path.resolve(dir);
    if (dir === path.parse(dir).root || dir === require('node:os').homedir()) throw Error('不能把整个硬盘或个人文件夹当成一个项目，请选一个具体的项目文件夹');
    if (dir === dataDir || dir.startsWith(dataDir + path.sep)) throw Error('这是工作站自己的数据文件夹，不能当项目');
    return add(dir, {});
  }

  function remove(id) {
    const item = byId(id);
    if (!item) throw Error('没有这个项目');
    if (item.inbox) throw Error('收件箱不能移除');
    reg.items = reg.items.filter(i => i !== item);
    if (reg.current === id) reg.current = reg.items.find(i => i.inbox)?.id || null;
    saveReg();
  }

  function setCurrent(id) { if (!byId(id)) throw Error('没有这个项目'); reg.current = id; saveReg(); }

  function update(id, changes) {
    const item = byId(id); if (!item) throw Error('没有这个项目');
    if (!fs.existsSync(item.path)) throw Error('项目文件夹找不到了');
    const m = ensureMeta(item.path);
    // 换了 AI 程序又没指定模型：模型清空（上一个 AI 的模型名对新的 AI 没意义）
    if (changes.engine !== undefined && changes.engine !== m.engine && changes.model === undefined) m.model = '';
    if (changes.engine !== undefined) m.engine = changes.engine;
    if (changes.model !== undefined) m.model = changes.model;
    if (changes.lang !== undefined && LANGS.includes(changes.lang)) m.lang = changes.lang;
    const extra = changes.kind !== undefined && KINDS[changes.kind] ? { kind: changes.kind } : {};
    writeMeta(item.path, { ...readJSON(metaFile(item.path), {}), ...m, ...extra });
    return load(item);
  }

  // 项目里的文件：给右栏「文件」和工作流页面用。最多列 2000 个，跳过隐藏文件和程序依赖
  function files(id, limit = 2000) {
    const item = byId(id); if (!item || !fs.existsSync(item.path)) return [];
    const out = [];
    (function walk(dir, rel, depth) {
      if (out.length >= limit || depth > 8) return;
      let names; try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const d of names) {
        if (SKIP(d.name) || out.length >= limit) continue;
        const r = rel ? rel + '/' + d.name : d.name, full = path.join(dir, d.name);
        if (d.isDirectory()) { out.push({ path: r + '/', kind: 'dir' }); walk(full, r, depth + 1); }
        else if (d.isFile()) { let st; try { st = fs.statSync(full); } catch { continue; } out.push({ path: r, kind: kindOf(r), size: st.size, mtime: st.mtimeMs }); }
      }
    })(item.path, '', 0);
    const unread = unreadSet(item);
    if (unread.size) for (const f of out) if (unread.has(f.path)) f.unread = true;
    return out;
  }

  // 工作流进度：项目里有完成标志文件（或以它开头的文件）就算这个阶段完成；备份、临时文件不算（和文件清单一样跳过，工作流页面看到的也是那份清单）
  // 完成标志可以写成数组（新旧两套文件夹名都认：["选题/选题.md", "01_选题/选题.md"]），有一个就算
  function stageDone(dir, flag) {
    const rel = String(flag).replace(/^\/+/, ''), full = path.join(dir, rel);
    if (rel.endsWith('/')) return fs.existsSync(full);
    if (fs.existsSync(full)) return true;
    const parent = path.dirname(full), base = path.basename(full);
    try { return fs.readdirSync(parent).some(n => n.startsWith(base) && !SKIP(n)); } catch { return false; }
  }

  // 活动记录：.工作站/日志.jsonl，一个任务一行（第 4 步开始写）；这里读最近的若干条，同一任务以最后一行为准
  function activity(id, n = 50) {
    const item = byId(id); if (!item) return [];
    let text = ''; try { text = fs.readFileSync(path.join(item.path, META, '日志.jsonl'), 'utf8'); } catch { return []; }
    const seen = new Map();
    for (const line of text.split('\n')) { if (!line.trim()) continue; try { const e = JSON.parse(line); if (e && e.id) { seen.delete(e.id); seen.set(e.id, e); } } catch {} }
    return [...seen.values()].reverse().slice(0, n);
  }

  // 给左栏用的概况：每个项目用过的工作流（进度）+ 最近的活动
  function summary(workflows) {
    return order().map(item => {
      const p = load(item), acts = p.exists ? activity(item.id, 8) : [];
      const used = !p.exists ? [] : workflows.filter(w => w.stages.length).map(w => {
        const done = w.stages.filter(s => s.done.some(f => stageDone(item.path, f))).length;
        return { id: w.id, name: w.name, icon: w.icon, done, total: w.stages.length, stages: w.stages.map(s => ({ name: s.name, done: s.done.some(f => stageDone(item.path, f)) })),
          used: done > 0 || acts.some(a => a.workflow === w.id) };
      }).filter(w => w.used);
      return { ...p, workflows: used, activity: acts, ...(item.inbox && p.exists ? { inboxNew: inboxNew().length } : {}) };
    });
  }

  // 未读：AI 产出（新建或改过）的文件记进 .工作站/未读.json，用户在工作站里点开（或用默认程序打开）就去掉
  const unreadFile = item => path.join(item.path, META, '未读.json');
  // 文件被手改坏（不是数组）时当作没有未读，不能让整个文件清单和工作流页面打不开
  const unreadSet = item => { const v = readJSON(unreadFile(item), []); return new Set(Array.isArray(v) ? v.filter(x => typeof x === 'string') : []); };
  function markUnread(id, paths) {
    const item = byId(id); if (!item || !paths.length || !fs.existsSync(item.path)) return;
    const set = unreadSet(item); paths.forEach(p => set.add(p)); writeJSON(unreadFile(item), [...set].slice(-500));
  }
  function markRead(id, rel) {
    const item = byId(id); if (!item) return;
    const set = unreadSet(item); if (set.delete(rel)) writeJSON(unreadFile(item), [...set]);
  }

  // 追加一行活动记录（任务状态变了就追加；读的时候同一任务以最后一行为准）
  function appendLog(id, entry) {
    const item = byId(id); if (!item || !fs.existsSync(item.path)) return;
    fs.mkdirSync(path.join(item.path, META), { recursive: true });
    fs.appendFileSync(path.join(item.path, META, '日志.jsonl'), JSON.stringify(entry) + '\n');
  }

  // 收件箱里还没梳理过的东西：顶层的文件和文件夹（隐藏的、AGENTS.md、CLAUDE.md 不算），减去「已看过」（梳理时决定留在收件箱的）
  const inboxItem = () => reg.items.find(i => i.inbox);
  const seenFile = () => path.join(inboxItem().path, META, '已看过.json');
  function inboxTop() {
    const it = inboxItem(); if (!it) return [];
    let names = []; try { names = fs.readdirSync(it.path); } catch {}
    return names.filter(n => !SKIP(n) && !n.startsWith('.') && !['AGENTS.md', 'CLAUDE.md', ARCHIVE].includes(n)).sort(); // 「已归档」里的不再梳理（内容 1.3.10）
  }
  function inboxNew() { const seen = new Set(readJSON(seenFile(), [])); return inboxTop().filter(n => !seen.has(n)); }
  // 上次梳理决定留在收件箱、现在还在的：新一轮梳理时一起再看一遍（10-23 乔淼：不然留下的会一直留着）
  function inboxKept() { const seen = new Set(readJSON(seenFile(), [])); return inboxTop().filter(n => seen.has(n)); }
  function markSeen(names) { const s = new Set(readJSON(seenFile(), [])); for (const n of names) s.add(n); writeJSON(seenFile(), [...s]); }
  return { list: () => order().map(load), summary, inboxNew, inboxKept, markSeen, inbox: () => { const i = inboxItem(); return i ? load(i) : null; }, appendLog, markUnread, markRead, create, open, remove, setCurrent, update, files, activity,
    current: () => { const i = byId(reg.current) || reg.items.find(x => x.inbox); return i ? load(i) : null; },
    get: id => { const i = byId(id); return i ? load(i) : null; } };
}

module.exports = { createProjects, KINDS, LANGS, ARCHIVE };
