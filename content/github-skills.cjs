'use strict';
// 从 GitHub 链接装第三方 skills，并批量加成「我的工具」（内容 1.3.6，乔淼 10-26，方案见 设计/GitHub-skills导入-方案.md）。
// 链接认成「仓库 + 分支 + 子文件夹」→ 整个仓库下一个压缩包（codeload，和装检索 skills 一样；不用第三方加速站）→ 解压到临时文件夹 →
// 列出范围里所有带 SKILL.md 的文件夹 → 学员勾选 → 复制进选中的 AI 程序的 skills 文件夹（同名的先备份），每个 skill 写来源记号 .popper-source.json。
// GitHub 连不上：学员在浏览器里下 zip 再拖进来，后面一样。卸载 = 移进废纸篓。课程 skills 不让这里覆盖（只走「更新 AI学术Skill库」）
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const MARK = '.popper-source.json';
const MAX_BYTES = 200 * 1024 * 1024;
// AIWS_GH_BASE 只给本机测试用：codeload 和 API 都换成本机地址（<base>/codeload/…、<base>/api/…）
const CODELOAD = () => process.env.AIWS_GH_BASE ? process.env.AIWS_GH_BASE.replace(/\/$/, '') + '/codeload' : 'https://codeload.github.com';
const API = () => process.env.AIWS_GH_BASE ? process.env.AIWS_GH_BASE.replace(/\/$/, '') + '/api' : 'https://api.github.com';
const SCRIPT_EXT = /\.(py|sh|bash|zsh|js|mjs|cjs|ts|ps1|bat|cmd|rb|pl|exe|jar)$/i;
const SHARED_RE = /(^|[-_])(shared|common|lib|libs|utils|core|assets)$|^_/i;
const NAME_RE = /^[\w.-]{1,80}$/;

// 认链接：github.com/作者/仓库[.git][/tree|blob/分支/路径]、作者/仓库；blob 指着文件就取它所在的文件夹
function parseLink(raw) {
  let s = String(raw || '').trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
  if (!s) throw Error('先贴一个 GitHub 链接');
  s = s.replace(/^git@github\.com:/i, 'github.com/').replace(/^https?:\/\//i, '').replace(/^www\./i, '');
  let m = s.match(/^(?:github\.com\/)?([\w-]+)\/([\w.-]+?)(?:\.git)?(?:\/(tree|blob)\/([^/]+)(?:\/(.*))?)?$/i);
  if (!m && /^raw\.githubusercontent\.com\//i.test(s)) { const p = s.split('/'); if (p.length >= 4) m = [s, p[1], p[2], 'blob', p[3], p.slice(4).join('/')]; }
  if (!m || (!/^github\.com\//i.test(s) && !/^raw\./i.test(s) && s.split('/').length !== 2)) throw Error('认不出这个链接。贴 GitHub 上仓库或文件夹的地址，比如 https://github.com/作者/仓库');
  const [, owner, repo, kind, ref, rest] = m;
  if (['orgs', 'settings', 'topics', 'search', 'marketplace'].includes(owner.toLowerCase())) throw Error('这不是一个仓库的链接');
  let sub = (rest || '').split('/').filter(x => x && x !== '.' && x !== '..').map(decodeURIComponent).join('/');
  if (kind === 'blob' || /\.[a-z0-9]{1,6}$/i.test(sub.split('/').pop() || '')) sub = sub.split('/').slice(0, -1).join('/'); // 指着一个文件：看它所在的文件夹
  return { owner, repo, ref: ref || '', sub, key: `github:${owner}/${repo}`.toLowerCase(), label: `${owner}/${repo}` };
}

async function getBuf(url, timeout) {
  const r = await fetch(url, { signal: AbortSignal.timeout(timeout), headers: { 'User-Agent': 'POPPER' } });
  if (!r.ok) throw Object.assign(Error(r.status === 404 ? '找不到（仓库不存在、是私有的，或者分支名不对）' : `下载失败（${r.status}）`), { status: r.status });
  const len = +r.headers.get('content-length') || 0;
  if (len > MAX_BYTES) throw Error(`太大了（${Math.round(len / 1048576)} MB），请贴子文件夹的链接，或者在浏览器里下载后拖进来`);
  const chunks = []; let n = 0;
  for await (const c of r.body) { n += c.length; if (n > MAX_BYTES) throw Error('超过 200 MB，没下完。请贴子文件夹的链接，或者在浏览器里下载后拖进来'); chunks.push(c); }
  return Buffer.concat(chunks);
}
const netWhy = e => e.name === 'TimeoutError' ? '下载超时' : e.status ? e.message : 'GitHub 连不上（可能要换个网络）';

// SKILL.md 开头的 name / description（和 runtime.cjs 的 skillDesc 同一种读法，这里读全文给预览用）
function readSkill(file) {
  let t = ''; try { t = fs.readFileSync(file, 'utf8'); } catch {}
  const fm = (t.match(/^---\s*\n([\s\S]*?)\n---/) || [])[1] || '', lines = fm.split('\n');
  const field = key => {
    const i = lines.findIndex(l => new RegExp(`^${key}:`).test(l)); if (i < 0) return '';
    let v = lines[i].slice(key.length + 1).trim();
    if (!v || /^[>|][-+]?$/.test(v)) { const more = []; for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) more.push(lines[j].trim()); v = more.join(' '); }
    return v.replace(/^(['"])([\s\S]*)\1$/, '$2').trim();
  };
  return { name: field('name'), desc: field('description'), text: t };
}
function walkFiles(dir, fn, depth = 0) {
  let list = []; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const d of list) { const f = path.join(dir, d.name); if (d.isDirectory()) { if (depth < 8 && d.name !== '.git' && d.name !== 'node_modules') walkFiles(f, fn, depth + 1); } else if (d.isFile()) fn(f, d.name); }
}
function findSkillDirs(root, depth = 0, out = []) {
  let names = []; try { names = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
  if (names.some(d => d.isFile() && d.name === 'SKILL.md')) { out.push(root); return out; }
  if (depth >= 5) return out;
  for (const d of names) if (d.isDirectory() && !d.name.startsWith('.') && d.name !== 'node_modules') findSkillDirs(path.join(root, d.name), depth + 1, out);
  return out;
}
// 打包、比对时不算的东西：版本库、依赖、缓存、系统文件、POPPER 自己的来源记号
const SKIP = new Set(['.git', 'node_modules', '__pycache__', '.DS_Store', MARK, '.ai-academic-workflow.json', '.my-skills-lib.json']);
function treeFiles(dir, base = dir, out = []) {
  let list = []; try { list = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const d of list) {
    if (SKIP.has(d.name)) continue;
    const f = path.join(dir, d.name);
    if (d.isDirectory()) { if (out.length < 5000) treeFiles(f, base, out); } else if (d.isFile()) out.push(path.relative(base, f).split(path.sep).join('/')); // 符号链接不跟
  }
  return out.sort();
}
// 两份 skill 一模一样（文件名单和每个文件的内容都一样）
function sameTree(a, b) {
  const x = treeFiles(a), y = treeFiles(b);
  if (x.length !== y.length || x.some((f, i) => f !== y[i])) return false;
  return x.every(f => { try { return fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))); } catch { return false; } });
}
const PACK_MAX = 20 * 1024 * 1024;
const readMark = dir => { try { return JSON.parse(fs.readFileSync(path.join(dir, MARK), 'utf8')); } catch { return null; } };
// 工具名：去掉整个仓库共同的前缀（nature-paper-xray → Paper Xray），短横线换空格、首字母大写
function toolName(name, prefix) {
  const rest = prefix && name.startsWith(prefix) && name.length > prefix.length ? name.slice(prefix.length) : name;
  return rest.split(/[-_]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ').slice(0, 30) || name.slice(0, 30);
}
const firstSentence = s => { s = String(s || '').replace(/\s+/g, ' ').trim(); const m = s.match(/^(.+?[.。!！?？])(\s|$)/); return (m ? m[1] : s).slice(0, 120); };
const toolTemplate = (skill, one) => [`请用「${skill}」skill 完成这项工作${one ? '：' + one : ''}。严格按这个 skill 的步骤、硬约束和输出格式执行；skill 里要停下问我的地方照常停下。`, '',
  '材料在项目里找；下面指定了文件就优先用它们。找不到就停下问我，不要编造。', '做完告诉我：做了什么、写了哪些文件、还有什么要我决定。'].join('\n');

// engines()：[{ id, name, dir }] 启用着的 AI 程序和它们的 skills 文件夹；courseSkills：课程 skill 的名字（不让覆盖）
// backupDir(engineId)：同名旧版备份到哪；tools：{ list, save, remove }（runtime.cjs 的我的工具）；extract(file, dir)：系统 tar 解压；trash(p, nice)
function createGhSkills({ dataDir, engines, courseSkills, backupDir, tools, extract, trash }) {
  const regFile = path.join(dataDir, 'GitHub-skills.json');
  const readReg = () => { try { const r = JSON.parse(fs.readFileSync(regFile, 'utf8')); return r && typeof r.repos === 'object' ? r : { repos: {} }; } catch { return { repos: {} }; } };
  const writeReg = r => { const tmp = regFile + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(r, null, 2)); fs.renameSync(tmp, regFile); };
  // 下载解开的仓库先放在临时文件夹里，等学员勾完再装；30 分钟不用就清掉
  const sessions = new Map();
  const drop = id => { const s = sessions.get(id); if (s) { sessions.delete(id); fs.rm(s.tmp, { recursive: true, force: true }, () => {}); } };
  const sweep = setInterval(() => { for (const [id, s] of sessions) if (Date.now() - s.at > 30 * 60e3) drop(id); }, 5 * 60e3); sweep.unref && sweep.unref();

  // 仓库概况：给学员判断来源用。API 连不上也不挡后面
  async function info(link) {
    const L = parseLink(link);
    let repo = null, error = '';
    try {
      const j = JSON.parse((await getBuf(`${API()}/repos/${L.owner}/${L.repo}`, 8000)).toString('utf8'));
      repo = { full: j.full_name || L.label, desc: j.description || '', stars: j.stargazers_count || 0, pushed: j.pushed_at || '', license: (j.license && (j.license.spdx_id !== 'NOASSERTION' ? j.license.spdx_id : j.license.name)) || '',
        sizeMB: Math.max(1, Math.round((j.size || 0) / 1024)), branch: j.default_branch || '', owner: j.owner && j.owner.login, archived: !!j.archived };
    } catch (e) { error = netWhy(e); }
    return { ...L, repo, error, zipUrl: `https://github.com/${L.owner}/${L.repo}/archive/${L.ref || 'HEAD'}.zip` };
  }

  // 下载（或收学员拖进来的压缩包 / 文件夹）→ 解开 → 列出 skill
  // bundle：工具文件里附带的 skill（内容 1.3.8，见 pack），[{ 名称, 文件: { 相对路径: base64 } }]；bundleName 是工具名
  async function load({ link, zipFrom, zipData, zipName, bundle, bundleName }) {
    const L = link ? parseLink(link) : null;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'popper-gh-'));
    try {
      let root = '', commit = '', fromGitHub = false;
      if (bundle) { root = path.join(tmp, 'x'); unpack(bundle, root); zipName = `工具文件「${String(bundleName || '').slice(0, 30)}」`; }
      else if (zipFrom && fs.existsSync(String(zipFrom)) && fs.statSync(String(zipFrom)).isDirectory()) root = String(zipFrom); // 本机的文件夹：直接读，不复制
      else {
        const file = path.join(tmp, 'pkg' + (/\.zip$/i.test(zipName || zipFrom || '') ? '.zip' : '.tar.gz'));
        if (zipFrom) { const st = fs.statSync(String(zipFrom)); if (st.size > MAX_BYTES) throw Error('压缩包超过 200 MB'); fs.copyFileSync(String(zipFrom), file); }
        else if (zipData) { const b = Buffer.from(String(zipData), 'base64'); if (!b.length) throw Error('压缩包是空的'); fs.writeFileSync(file, b); }
        else if (L) {
          // legacy.tar.gz：顶层文件夹叫「作者-仓库-提交号」，记下提交号以后比对更新
          fromGitHub = true;
          try { fs.writeFileSync(file, await getBuf(`${CODELOAD()}/${L.owner}/${L.repo}/legacy.tar.gz/${encodeURIComponent(L.ref || 'HEAD')}`, 180000)); }
          catch (e) { throw Object.assign(Error(netWhy(e)), { offline: !e.status }); }
        } else throw Error('先贴链接，或者拖一个压缩包进来');
        const out = path.join(tmp, 'x'); extract(file, out);
        const top = fs.readdirSync(out, { withFileTypes: true }).filter(d => !d.name.startsWith('.') && d.name !== '__MACOSX');
        root = top.length === 1 && top[0].isDirectory() ? path.join(out, top[0].name) : out;
        if (fromGitHub && root !== out) { const m = path.basename(root).match(/-([0-9a-f]{7,40})$/i); if (m) commit = m[1]; }
      }
      const scope = L && L.sub ? path.join(root, ...L.sub.split('/')) : root;
      if (!fs.existsSync(scope)) throw Error(`仓库里没有「${L.sub}」这个文件夹`);
      let dirs = findSkillDirs(scope);
      if (!dirs.length) throw Error('这里面没找到 skill（带 SKILL.md 的文件夹）');
      // 自己有 SKILL.md、但别的 skill 用「../名字/」去读它的（nature-skills 的 nature-shared：说明里写着不要单独用）：算共用资料，不列成 skill、不建工具
      const texts = new Map(dirs.map(d => [d, readSkill(path.join(d, 'SKILL.md')).text]));
      const shared = [];
      for (const d of dirs) {
        const n = path.basename(d), users = dirs.filter(o => o !== d && texts.get(o).includes(`../${n}/`)).map(o => path.basename(o));
        if (users.length && NAME_RE.test(n)) shared.push({ name: n, dir: d, users });
      }
      dirs = dirs.filter(d => !shared.some(x => x.dir === d));
      const key = L ? L.key : bundle ? 'tool:' + String(bundleName || '').slice(0, 30).toLowerCase() : 'zip:' + path.basename(String(zipName || zipFrom || 'zip')).replace(/\.(zip|tar\.gz|tgz)$/i, '').toLowerCase();
      const skills = dirs.map(d => {
        const s = readSkill(path.join(d, 'SKILL.md')), name = path.basename(d);
        let size = 0, scripts = 0; walkFiles(d, (f, n) => { try { size += fs.statSync(f).size; } catch {} if (SCRIPT_EXT.test(n)) scripts++; });
        return { name, title: s.name || name, desc: s.desc.slice(0, 600), scripts, size, rel: path.relative(root, d).split(path.sep).join('/'),
          preview: s.text.split('\n').slice(0, 40).join('\n').slice(0, 4000), ok: NAME_RE.test(name), dir: d };
      });
      // 共用资料文件夹（比如 nature-shared）：和 skill 平级、自己没有 SKILL.md、名字像共用的或被某个 SKILL.md 提到；仓库根下的 docs / scripts 之类不算
      for (const parent of new Set(dirs.map(d => path.dirname(d)))) {
        if (parent === root) continue;
        for (const d of fs.readdirSync(parent, { withFileTypes: true })) {
          const f = path.join(parent, d.name);
          if (!d.isDirectory() || d.name.startsWith('.') || dirs.includes(f) || !NAME_RE.test(d.name) || fs.existsSync(path.join(f, 'SKILL.md'))) continue;
          const users = dirs.filter(o => texts.get(o).includes(d.name)).map(o => path.basename(o));
          if (SHARED_RE.test(d.name) || users.length) shared.push({ name: d.name, dir: f, users });
        }
      }
      const names = skills.filter(s => s.ok).map(s => s.name);
      // 工具名要去掉的前缀：一半以上的 skill 都以同一个「xxx-」开头（nature-skills 的 nature-）
      const heads = {}; for (const n of names) { const h = n.match(/^[a-z0-9]+-/i); if (h) heads[h[0]] = (heads[h[0]] || 0) + 1; }
      const [prefix = ''] = Object.entries(heads).filter(([, c]) => c >= 2 && c * 2 >= names.length).sort((a, b) => b[1] - a[1])[0] || [];
      const id = crypto.randomBytes(6).toString('hex');
      sessions.set(id, { tmp, root, key, L, commit, skills, shared, prefix, at: Date.now(), zipName: zipName || (zipFrom ? path.basename(String(zipFrom)) : '') });
      return { id, key, label: L ? L.label : bundle ? zipName : path.basename(String(zipName || zipFrom || '')), sub: L ? L.sub : '', commit, shared: shared.map(s => ({ name: s.name, users: s.users })), ...status(id) };
    } catch (e) { fs.rm(tmp, { recursive: true, force: true }, () => {}); throw e; }
  }

  // 工具文件里带的 skill 解开到 root/<名字>/：名字、路径都要干净（不许 ..、绝对路径），总共不超过 20 MB
  function unpack(bundle, root) {
    if (!Array.isArray(bundle) || !bundle.length || bundle.length > 20) throw Error('工具文件里附带的 skill 不对');
    let total = 0;
    for (const b of bundle) {
      const name = String(b && b['名称'] || ''), files = b && b['文件'];
      if (!NAME_RE.test(name) || name.startsWith('.') || !files || typeof files !== 'object') throw Error('工具文件里附带的 skill 不对');
      if (!Object.keys(files).includes('SKILL.md')) throw Error(`附带的「${name}」里没有 SKILL.md`);
      for (const [rel, data] of Object.entries(files)) {
        const parts = String(rel).split('/');
        if (!rel || parts.length > 12 || parts.some(x => !x || x === '.' || x === '..' || /[\\:\0]/.test(x)) || SKIP.has(parts[parts.length - 1])) throw Error(`附带的「${name}」里有不对的文件名：${rel}`);
        const buf = Buffer.from(String(data || ''), 'base64'); total += buf.length;
        if (total > PACK_MAX) throw Error('附带的 skill 超过 20 MB');
        const f = path.join(root, name, ...parts); if (!f.startsWith(path.join(root, name) + path.sep)) throw Error(`附带的「${name}」里有不对的文件名：${rel}`);
        fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, buf);
      }
    }
  }
  // 导出工具时打包 skill：在几个 AI 的 skills 文件夹里找；不止一处、内容又不一样的，用最近改过的那份
  function pack(names, { dryRun } = {}) {
    const out = [], skipped = []; let total = 0;
    for (const name of names) {
      if (courseSkills.has(name)) continue; // 课程的学员都有
      if (!NAME_RE.test(name)) { skipped.push({ name, why: '插件里的 skill 拿不出来' }); continue; }
      const found = engines().map(e => ({ e, dir: path.join(e.dir, name) })).filter(x => fs.existsSync(path.join(x.dir, 'SKILL.md')))
        .map(x => ({ ...x, at: Math.max(0, ...treeFiles(x.dir).map(f => { try { return fs.statSync(path.join(x.dir, f)).mtimeMs; } catch { return 0; } })) }))
        .sort((a, b) => b.at - a.at);
      if (!found.length) { skipped.push({ name, why: '这台电脑上没找到' }); continue; }
      const { e, dir } = found[0], files = treeFiles(dir);
      let size = 0; for (const f of files) try { size += fs.statSync(path.join(dir, f)).size; } catch {}
      total += size;
      out.push({ name, from: e.name, size, count: files.length, ...(dryRun ? {} : { 文件: Object.fromEntries(files.map(f => [f, fs.readFileSync(path.join(dir, f)).toString('base64')])) }) });
    }
    return { skills: out, skipped, size: total, tooBig: total > PACK_MAX };
  }

  // 每个 skill 在每个启用的 AI 里的情况：none 没有 / identical 已装、一模一样 / same 上次从这里装的 / course 课程的 / other 别处来的
  function status(id) {
    const s = sessions.get(id); if (!s) throw Error('读取的内容过期了，请重新读取');
    const engs = engines(), mine = tools.list();
    return { engines: engs.map(e => ({ id: e.id, name: e.name })), skills: s.skills.map(k => ({
      name: k.name, title: k.title, desc: k.desc, scripts: k.scripts, size: k.size, rel: k.rel, preview: k.preview, ok: k.ok,
      toolName: toolName(k.name, s.prefix), hasTool: mine.some(t => t.skill === k.name),
      where: Object.fromEntries(engs.map(e => { const dest = path.join(e.dir, k.name); if (courseSkills.has(k.name)) return [e.id, 'course']; // 和课程 skill 同名：哪个 AI 里都不装
        if (!fs.existsSync(dest)) return [e.id, 'none']; if (sameTree(k.dir, dest)) return [e.id, 'identical']; const m = readMark(dest); return [e.id, m && m.source === s.key ? 'same' : 'other']; })) })) };
  }

  // 装：names 要装的、engines 装进哪些 AI、overwrite 别处来的同名也覆盖（先备份）、makeTools 是否建「我的工具」、cat 分类
  function install({ id, names, engineIds, overwrite, makeTools, cat }) {
    const s = sessions.get(id); if (!s) throw Error('读取的内容过期了，请重新读取');
    const want = new Set(Array.isArray(names) ? names : []), over = new Set(Array.isArray(overwrite) ? overwrite : []);
    const engs = engines().filter(e => (Array.isArray(engineIds) ? engineIds : []).includes(e.id));
    if (!engs.length) throw Error('至少选一个 AI 程序');
    const picked = s.skills.filter(k => k.ok && want.has(k.name)); if (!picked.length) throw Error('至少勾一个 skill');
    const now = new Date().toISOString(), mark = { source: s.key, repo: s.L ? s.L.label : s.zipName, ref: s.L ? s.L.ref : '', sub: s.L ? s.L.sub : '', commit: s.commit, installedAt: now };
    const res = { installed: {}, skipped: [], backedUp: [], shared: [], tools: [], toolsSkipped: [], errors: [] };
    const reg = readReg(), rec = reg.repos[s.key] = reg.repos[s.key] || { skills: {}, shared: {} };
    Object.assign(rec, { label: mark.repo, link: s.L ? `https://github.com/${s.L.owner}/${s.L.repo}` : '', ref: mark.ref, commit: s.commit, installedAt: now });
    const copy = (src, dest, e, name) => {
      if (fs.existsSync(dest)) { const b = path.join(backupDir(e.id), name); fs.mkdirSync(path.dirname(b), { recursive: true }); fs.rmSync(b, { recursive: true, force: true }); fs.cpSync(dest, b, { recursive: true }); fs.rmSync(dest, { recursive: true, force: true }); res.backedUp.push(`${name}（${e.name}）`); }
      fs.cpSync(src, dest, { recursive: true });
      fs.writeFileSync(path.join(dest, MARK), JSON.stringify(mark, null, 2));
    };
    for (const e of engs) {
      try { fs.mkdirSync(e.dir, { recursive: true }); } catch (x) { res.errors.push(`${e.name}：${x.message}`); continue; }
      let any = false;
      for (const k of picked) {
        const dest = path.join(e.dir, k.name), had = fs.existsSync(dest);
        if (had && !courseSkills.has(k.name) && sameTree(k.dir, dest)) { (res.same = res.same || []).push(`${k.name}（${e.name}）`); continue; } // 已装、一模一样：不动
        if (courseSkills.has(k.name)) { res.skipped.push(`${k.name}（${e.name}：和课程 skill 同名，没覆盖）`); continue; }
        if (had) { const m = readMark(dest); if (!(m && m.source === s.key) && !over.has(k.name)) { res.skipped.push(`${k.name}（${e.name}：已有别处来的同名 skill，没覆盖）`); continue; } }
        try { copy(k.dir, dest, e, k.name); any = true; (res.installed[k.name] = res.installed[k.name] || []).push(e.id);
          const r = rec.skills[k.name] = rec.skills[k.name] || { engines: [] }; if (!r.engines.includes(e.id)) r.engines.push(e.id); }
        catch (x) { res.errors.push(`${k.name}（${e.name}）：${x.message}`); }
      }
      // 共用资料文件夹跟着装（不是 skill，不建工具）；已有的不是这个仓库装的就不动
      if (any) for (const sh of s.shared) {
        const dest = path.join(e.dir, sh.name);
        if (fs.existsSync(dest)) { const m = readMark(dest); if (!(m && m.source === s.key)) { res.skipped.push(`${sh.name}（${e.name}：已有同名文件夹，共用资料没覆盖）`); continue; } }
        try { copy(sh.dir, dest, e, sh.name); if (!res.shared.includes(sh.name)) res.shared.push(sh.name); const r = rec.shared[sh.name] = rec.shared[sh.name] || { engines: [] }; if (!r.engines.includes(e.id)) r.engines.push(e.id); }
        catch (x) { res.errors.push(`${sh.name}（${e.name}）：${x.message}`); }
      }
    }
    if (makeTools) {
      const mine = tools.list(), taken = new Set(mine.map(t => t.name));
      for (const k of picked) {
        if (!res.installed[k.name]) continue;
        const has = mine.find(t => t.skill === k.name);
        if (has) { res.toolsSkipped.push(`${k.name}（已有工具「${has.name}」）`); rec.skills[k.name].tool = rec.skills[k.name].tool || (has.source === '我的' ? has.id : ''); continue; }
        let name = toolName(k.name, s.prefix); if (taken.has(name)) name = k.name.slice(0, 30);
        const one = firstSentence(k.desc);
        try { const c = tools.save({ 名称: name, 一句话: one, 分类: String(cat || '').trim() || '我的工具', skill: k.name, 需要的skill: [k.name], 输入: [], 指令: toolTemplate(k.name, one) });
          taken.add(name); res.tools.push({ id: c.标识, name }); rec.skills[k.name].tool = c.标识; }
        catch (x) { res.errors.push(`工具「${name}」：${x.message}`); }
      }
    }
    writeReg(reg);
    return res;
  }

  // 装过的（按仓库）：每个 skill 现在还在哪些 AI 里、对应的工具还在不在
  function list() {
    const reg = readReg(), engs = engines(), mine = tools.list();
    return Object.entries(reg.repos).map(([key, r]) => ({ key, label: r.label, link: r.link, commit: r.commit, installedAt: r.installedAt,
      skills: Object.entries(r.skills || {}).map(([name, x]) => ({ name, engines: engs.filter(e => { const m = readMark(path.join(e.dir, name)); return m && m.source === key; }).map(e => e.id),
        tool: x.tool && mine.some(t => t.id === x.tool) ? x.tool : '' })),
      shared: Object.keys(r.shared || {}) })).filter(r => r.skills.some(s => s.engines.length || s.tool));
  }

  // 卸载：这个仓库装的 skill 从各个 AI 里移进废纸篓（只动记号对得上的），工具挪进 工具/.已移除/；names 空 = 全部
  function remove({ key, names, removeTools }) {
    const reg = readReg(), r = reg.repos[key]; if (!r) throw Error('没有这个来源');
    const all = Object.keys(r.skills || {}), pick = Array.isArray(names) && names.length ? all.filter(n => names.includes(n)) : all;
    const res = { moved: [], tools: [], errors: [] };
    for (const e of engines()) for (const n of pick) {
      const dest = path.join(e.dir, n), m = readMark(dest);
      if (!m || m.source !== key) continue;
      try { trash(dest, `skill-${n}-${e.id}`); res.moved.push(`${n}（${e.name}）`); } catch (x) { res.errors.push(`${n}（${e.name}）：${x.message}`); }
    }
    for (const n of pick) {
      const t = r.skills[n] && r.skills[n].tool;
      if (removeTools && t) try { tools.remove(t); res.tools.push(t); } catch (x) { res.errors.push(`工具 ${t}：${x.message}`); }
      delete r.skills[n];
    }
    // skill 都卸完了：共用资料也一起移走
    const left = engines().some(e => Object.keys(r.skills).some(n => { const m = readMark(path.join(e.dir, n)); return m && m.source === key; }));
    if (!left) {
      for (const e of engines()) for (const n of Object.keys(r.shared || {})) { const dest = path.join(e.dir, n), m = readMark(dest); if (m && m.source === key) try { trash(dest, `skill-${n}-${e.id}`); res.moved.push(`${n}（${e.name}）`); } catch (x) { res.errors.push(`${n}：${x.message}`); } }
      delete reg.repos[key];
    }
    writeReg(reg);
    return res;
  }

  return { info, load, status, install, list, remove, drop, pack, stop: () => { clearInterval(sweep); for (const id of [...sessions.keys()]) drop(id); } };
}

module.exports = { createGhSkills, parseLink, toolName };
