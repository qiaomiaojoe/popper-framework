'use strict';
// 内容层的「运行时」：引擎、任务、工作流登记、给界面用的接口。外壳的内核负责守门和加载它，
// 这里改了只需发内容更新，不用重装。和内核的约定见 KERNEL_API。
//
// 已接上：引擎检测、工作流登记和工作流页面（第 1 步）；项目（第 2 步，见 projects.cjs）；
// 导入工作流、工作流交来的指令加上项目信息后变成任务、任务写进项目的活动记录（第 3 步）。
// 任务管理（第 4 步，见 tasks.cjs）：同一项目排队、不同项目同时跑，分清「等你回复」和「已完成」，认出产出。
// 工具（第 7 步）：content/工具-*.json，填几个 AI 猜不到的输入 → 拼成指令 → 和工作流一样加上项目信息交给 AI。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

const KERNEL_API = 2; // 要和外壳 app/kernel.cjs 的一样；改了约定两边都加一，content.json 的 minShell 提到新外壳版本
const MAX_CHAIN = 12; // 自动模式（一键跑完）最多几段；bridge.js 和 ui.js 也卡同一个数
// 加一个 AI 程序 = 加一个 engine-xxx.cjs + 在这里登记（内容 1.2.0 起）；新加的默认不启用（DEFAULT_ON）
const BASE_ENGINES = { claude: require('./engine-claude.cjs'), codex: require('./engine-codex.cjs'), codebuddy: require('./engine-codebuddy.cjs') };
const { createProjects, LANGS, ARCHIVE } = require('./projects.cjs');
const { createTasks } = require('./tasks.cjs');
const { createStorage, trash } = require('./storage.cjs');
const { createGhSkills } = require('./github-skills.cjs');
const { createMineru } = require('./mineru.cjs');
const { createTodos } = require('./todos.cjs');
const { createRemote } = require('./remote.cjs');
const { NAMING, hasNaming } = require('./naming.cjs');
const common = require('./engine-common.cjs');
const { APP, CFG, AGENT } = require('./app-name.cjs');

const readJSON = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const writeJSON = (file, data) => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(data, null, 2)); fs.renameSync(tmp, file); };

// ---------- 工作流：一个 HTML 文件 + 里面的说明块（见 设计/实施方案-v0.2.md 第 2 节） ----------
const MANIFEST_RE = /<script[^>]*id=["']aiws-manifest["'][^>]*>([\s\S]*?)<\/script>/i;
function parseWorkflow(html, fallbackName) {
  let m = {}, ok = false;
  const hit = html.match(MANIFEST_RE);
  if (hit) { try { m = JSON.parse(hit[1]); ok = true; } catch { m = {}; } }
  const title = ((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '').trim();
  return {
    hasManifest: ok, wantedId: m['标识'] || '',
    name: String(m['名称'] || title || fallbackName || '未命名工作流').slice(0, 60),
    kind: m['类型'] || '工作流', version: m['版本'] || '', author: m['作者'] || '', icon: m['图标'] || '🧩', one: m['一句话'] || '',
    stages: (Array.isArray(m['阶段']) ? m['阶段'] : []).map(s => ({ name: s['名称'], done: [].concat(s['完成标志'] || []) })),
    skills: m['需要的skill'] || [], texts: Array.isArray(m['工作站文案']) ? m['工作站文案'] : []
  };
}
function readWorkflow(file, source) {
  const w = parseWorkflow(fs.readFileSync(file, 'utf8'), path.basename(file, path.extname(file)));
  return { ...w, file, source };
}
const publicWorkflow = ({ file, texts, wantedId, ...w }) => w;
// 「我的 skills 库」的版本记号：装好以后写进那个 AI 的 skills 文件夹，点开头，Claude Code / Codex 不会当成 skill
const LIB_MARK = '.my-skills-lib.json';
const readMark = dir => { try { return JSON.parse(fs.readFileSync(path.join(dir, LIB_MARK), 'utf8')); } catch { return null; } };
const writeMark = (dir, data) => fs.writeFileSync(path.join(dir, LIB_MARK), JSON.stringify(data, null, 2));
// 「我的 skills 库」的地址：学员自己的 GitHub 仓库（用户名/仓库名，或仓库网址），或者一个能直接下载的压缩包网址（比如阿里云 OSS 上公开读的 .zip / .tar.gz）
function parseSkillsSource(raw) {
  const s = String(raw || '').trim();
  if (!s) throw Error(`还没设置「我的 skills 库」的地址：在「${CFG}」里点「设置地址」`);
  const gh = s.match(/^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/tree\/([\w./-]+))?\/?$/);
  if (gh && !/^https?:/.test(s) || gh && /github\.com/.test(s)) return { kind: 'github', label: `GitHub ${gh[1]}/${gh[2]}`, url: `https://codeload.github.com/${gh[1]}/${gh[2]}/zip/${gh[3] || 'HEAD'}`, ext: '.zip', page: `https://github.com/${gh[1]}/${gh[2]}` };
  const u = (() => { try { return new URL(s); } catch { return null; } })();
  if (u && u.protocol === 'https:' && /\.(zip|tar\.gz|tgz)$/i.test(u.pathname)) return { kind: 'url', label: u.host, url: s, ext: /\.zip$/i.test(u.pathname) ? '.zip' : '.tar.gz', page: s };
  throw Error('地址不对：填 GitHub 的「用户名/仓库名」或仓库网址，或者一个 https 开头、以 .zip / .tar.gz 结尾的下载地址');
}
const MIME = { '.md': 'text/markdown; charset=utf-8', '.markdown': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.svg': 'image/svg+xml', '.pdf': 'application/pdf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.css': 'text/css; charset=utf-8', '.js': 'text/plain; charset=utf-8', '.yaml': 'text/plain; charset=utf-8', '.yml': 'text/plain; charset=utf-8', '.bib': 'text/plain; charset=utf-8', '.ris': 'text/plain; charset=utf-8' };

function createRuntime(k) {
  const { contentDir, dataDir, defaultProjectsDir, hooks } = k;
  const settingsFile = path.join(dataDir, '设置.json');
  const runsDir = path.join(dataDir, '运行记录');
  const importedDir = path.join(dataDir, '工作流');
  // 开发模式多一个「测试用假 AI」：不花额度，用来测执行链路。学员的安装包和内容更新里不带这个文件，开了开发模式也没有
  const hasFake = k.dev && fs.existsSync(path.join(contentDir, 'engine-fake.cjs'));
  // 两个假 AI（内容 1.3.0）：测「不同阶段交给不同的 AI」时当成两个不同的 AI 用，代码是同一份
  const ENGINES = { ...BASE_ENGINES, ...(hasFake ? { fake: require('./engine-fake.cjs'), fake2: { ...require('./engine-fake.cjs'), id: 'fake2', name: '测试用假 AI 乙' } } : {}) };
  const isFake = id => id === 'fake' || id === 'fake2';

  // ---------- 设置 ----------
  fs.mkdirSync(dataDir, { recursive: true });
  const settings = readJSON(settingsFile, {});
  settings.engine = ENGINES[settings.engine] ? settings.engine : 'claude';
  settings.model = typeof settings.model === 'object' && settings.model ? settings.model : {};
  settings.bin = settings.bin || {};
  settings.ack = settings.ack || {};
  // 启用哪些 AI 程序（内容 1.2.0，乔淼 10-24）：启用了的才出现在右栏、换 X 重做、项目选 AI；配置页才检查它。
  // Claude Code、Codex 照旧默认启用（老学员不受影响），以后新加的默认不启用；测试用假 AI 只在开发模式出现，不参与
  settings.enabled = settings.enabled && typeof settings.enabled === 'object' ? settings.enabled : {};
  // 额外放行的服务（内容 1.3.2）：AI 程序 id → 服务名列表（比如 { claude: ['claude.ai Notion'] }），配置页里自己勾；默认空
  settings.extraMcp = settings.extraMcp && typeof settings.extraMcp === 'object' ? settings.extraMcp : {};
  // AI 还能写的文件夹（内容 1.3.2，乔淼 10-26：日常版里任务要往别的项目放文件，比如收件箱的东西放进学员文件夹）：
  // 平时 AI 只能写当前项目文件夹；这里加的文件夹所有 AI 程序都能写（加进各自的沙箱可写范围）。默认空，学员不受影响
  settings.writeDirs = Array.isArray(settings.writeDirs) ? settings.writeDirs.filter(d => typeof d === 'string') : [];
  const DEFAULT_ON = ['claude', 'codex'];
  const isOn = id => isFake(id) ? !!ENGINES[id] : (id in settings.enabled ? !!settings.enabled[id] : DEFAULT_ON.includes(id));
  if (!isOn(settings.engine)) settings.engine = Object.keys(ENGINES).find(id => !isFake(id) && isOn(id)) || 'claude';
  // 一个项目实际用哪个 AI：它选的那个停用了（或者没有了）就用默认的
  const engineOf = p => p && ENGINES[p.engine] && isOn(p.engine) ? p.engine : settings.engine;
  // 现在能交任务的 AI：启用了、电脑上找到了（检测中的不算）
  const usableEngines = () => Object.keys(ENGINES).filter(id => isOn(id) && found[id] && found[id].bin);
  const save = () => writeJSON(settingsFile, settings);

  // ---------- 引擎检测 ----------
  // 不阻塞启动（10-22，乔淼「打开 POPPER 会卡一下」）：以前在这里一个个同步跑 --version，窗口要等它们都跑完才出来。
  // 现在后台同时查，查完之前 found 里是「检测中」（checking），界面显示「检测中…」并过一会儿再取；接口（除了 config）先等检测完
  const found = {}; // id → { bin, info }
  const setFound = (id, best, tried, checking) => {
    const e = ENGINES[id];
    found[id] = { bin: best, info: { id, name: e.name, version: best?.version || null, where: best?.label || null, path: best?.path || null,
      manual: !!settings.bin[id], tried, models: e.models(), model: settings.model[id] || '', defaults: e.defaults ? e.defaults() : null, missingHint: e.missingHint, install: e.install || null, client: e.client || '', riskNotice: e.riskNotice || '',
      riskAcked: !!settings.ack[id], enabled: isOn(id), canExtraMcp: typeof e.listMcp === 'function', extraMcp: settings.extraMcp[id] || [], isDefault: settings.engine === id, ...(checking ? { checking: true } : {}) } };
  };
  // 没启用的不找（乔淼 10-24 方案：多几个 AI 程序也不拖慢启动）
  const detect = async id => { if (!isOn(id)) return setFound(id, null, []); const { best, tried } = await ENGINES[id].locate(settings.bin[id]); setFound(id, best, tried); };
  let detecting = null;
  const detectAll = () => {
    const p = Promise.all(Object.keys(ENGINES).map(id => detect(id).catch(() => setFound(id, null, []))));
    detecting = p; p.finally(() => { if (detecting === p) detecting = null; });
    return p;
  };
  for (const id of Object.keys(ENGINES)) if (!found[id]) setFound(id, null, [], true);
  const ready = detectAll();

  // ---------- 工作流登记：内置的在 content/工作流-*.html，导入的在数据文件夹的「工作流/」 ----------
  // 标识用在工作流的地址里（wf-<标识>.localhost），只能是小写字母、数字、连字符；没写或和别的撞了，就按文件算一个
  function listWorkflows() {
    const files = [];
    for (const f of fs.readdirSync(contentDir).sort()) if (/^工作流-.+\.html$/.test(f)) files.push([path.join(contentDir, f), '内置']);
    if (fs.existsSync(importedDir)) for (const f of fs.readdirSync(importedDir).sort()) if (/\.html?$/i.test(f)) files.push([path.join(importedDir, f), '导入']);
    const used = new Set(), out = [];
    for (const [file, source] of files) {
      const w = readWorkflow(file, source);
      let id = /^[a-z0-9-]{1,40}$/.test(w.wantedId) ? w.wantedId : '';
      if (!id || used.has(id)) id = (source === '导入' ? 'i' : 'w') + crypto.createHash('sha1').update(source + ':' + path.basename(file)).digest('hex').slice(0, 10);
      used.add(id); out.push({ ...w, id });
    }
    return out.filter(w => k.dev || w.kind !== '测试'); // 「测试」类型的只在开发模式里出现
  }
  const workflowById = id => listWorkflows().find(x => x.id === id);

  // 导入：把 HTML 存进数据文件夹的「工作流/」。和已导入的重名时，先问要不要替换（replace: true 才覆盖）
  function importWorkflow({ fileName, html, replace }) {
    if (typeof html !== 'string' || !/<(html|body|script|div)\b/i.test(html)) throw Error('这不像一个网页文件（.html）');
    if (html.length > 30e6) throw Error('文件太大了（超过 30MB）');
    const w = parseWorkflow(html, path.basename(String(fileName || ''), path.extname(String(fileName || ''))));
    fs.mkdirSync(importedDir, { recursive: true });
    const same = listWorkflows().find(x => x.source === '导入' && x.name === w.name);
    if (same && !replace) return { needReplace: true, name: w.name, version: w.version, oldVersion: same.version };
    let file = same ? same.file : null;
    if (!file) {
      const base = w.name.replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^[.-]+/, '').slice(0, 40) || '工作流';
      file = path.join(importedDir, base + '.html');
      for (let i = 2; fs.existsSync(file); i++) file = path.join(importedDir, `${base}-${i}.html`);
    }
    fs.writeFileSync(file, html);
    const now = listWorkflows().find(x => x.file === file);
    return { imported: now ? publicWorkflow(now) : null, replaced: !!same };
  }
  // 移除导入的工作流：不直接删，挪进「工作流/.已移除/」，要找回去那里拿
  function removeWorkflow(id) {
    const w = workflowById(id);
    if (!w) throw Error('没有这个工作流');
    if (w.source !== '导入') throw Error('内置的工作流不能移除');
    const bin = path.join(importedDir, '.已移除');
    fs.mkdirSync(bin, { recursive: true });
    fs.renameSync(w.file, path.join(bin, new Date().toISOString().replace(/[:.]/g, '-') + '-' + path.basename(w.file)));
    return w.name;
  }

  // ---------- 工具：content/工具-*.json（实施方案第 6 节）。只问 AI 猜不到的输入，材料由 AI 自己在项目里找 ----------
  // 指令模板：{{键}} 换成填的值；{{#键}}…{{/键}} 填了才要；{{^键}}…{{/键}} 没填才要；{{#键=值}}…{{/键=值}} 选了这个值才要；{{日期}} 是今天（如 20261011）
  // 输入类型：单行 / 多行 / 选择 / skill（下拉里是本机装好的、课程以外的 skill）。「快速模式」为真的工具，工具页多一个「快速」开关
  // 用户自己加的工具（10-18）：存在数据文件夹的「工具/」里，格式和内置的 工具-*.json 一样；App 更新不会动它们
  const userToolsDir = path.join(dataDir, '工具');
  const toolOfJSON = (t, source, file) => ({ id: t['标识'], name: t['名称'], cat: t['分类'] || (source === '我的' ? '我的工具' : '其他'), icon: t['图标'] || '🛠️', order: t['序号'] || 99, version: t['版本'] || '', quick: !!t['快速模式'],
    one: t['一句话'] || '', skill: t['skill'] || '', local: t['本机'] || '', skills: t['需要的skill'] || [], template: t['指令'], source, file,
    output: typeof t['产出'] === 'string' ? t['产出'] : '', catalog: !!t['附带工具清单'],
    fields: (t['输入'] || []).map(x => ({ key: x['键'], label: x['名称'], type: { '单行': 'text', '多行': 'area', '选择': 'select', 'skill': 'skill', '多选skill': 'skills' }[x['类型']] || 'text',
      required: !!x['必填'], placeholder: x['提示'] || '', options: x['选项'] || [], def: x['默认'] != null ? String(x['默认']) : '' })) });
  function listTools() {
    const out = [], ids = new Set();
    for (const f of fs.readdirSync(contentDir).sort()) {
      if (!/^工具-.+\.json$/.test(f)) continue;
      const t = readJSON(path.join(contentDir, f), null);
      if (!t || !/^[a-z0-9-]{1,40}$/.test(t['标识'] || '') || !t['指令']) continue;
      out.push(toolOfJSON(t, '内置', '')); ids.add(t['标识']);
    }
    let mine = []; try { mine = fs.readdirSync(userToolsDir).filter(f => f.endsWith('.json')).sort(); } catch {}
    for (const f of mine) {
      const t = readJSON(path.join(userToolsDir, f), null);
      if (!t || !/^[a-z0-9-]{1,40}$/.test(t['标识'] || '') || !t['指令'] || ids.has(t['标识'])) continue; // 和内置撞标识的不认
      out.push(toolOfJSON(t, '我的', path.join(userToolsDir, f))); ids.add(t['标识']);
    }
    return out.sort((a, b) => a.order - b.order);
  }
  // 检查、整理一份工具清单（保存和导入共用）：只留认识的字段，限长度；标识没给或撞了就重新起一个 my-xxxxxx
  function cleanTool(t, keepId) {
    if (!t || typeof t !== 'object') throw Error('这不是一个工具文件');
    const str = (v, n) => String(v == null ? '' : v).slice(0, n);
    const name = str(t['名称'], 30).trim(); if (!name) throw Error('先给工具起个名字');
    const tpl = str(t['指令'], 20000); if (!tpl.trim()) throw Error('指令是空的');
    const skill = str(t['skill'], 80).trim(); if (skill && !/^[\w.:-]{1,80}$/.test(skill)) throw Error('skill 名字不对');
    const fields = (Array.isArray(t['输入']) ? t['输入'] : []).slice(0, 12).map((x, i) => {
      const key = /^[a-z][a-z0-9_]{0,20}$/.test(x['键'] || '') ? x['键'] : 'f' + (i + 1);
      const type = ['单行', '多行', '选择', 'skill', '多选skill'].includes(x['类型']) ? x['类型'] : '单行';
      return { 键: key, 名称: str(x['名称'], 30) || key, 类型: type, ...(x['必填'] ? { 必填: true } : {}), ...(x['提示'] ? { 提示: str(x['提示'], 100) } : {}),
        ...(type === '选择' ? { 选项: (Array.isArray(x['选项']) ? x['选项'] : []).map(o => str(o, 40)).filter(Boolean).slice(0, 12) } : {}) };
    });
    if (fields.some(f => f.类型 === '选择' && !f.选项.length)) throw Error('「选择」类型的输入要写选项');
    const taken = new Set(listTools().filter(x => x.id !== keepId).map(x => x.id));
    let id = /^[a-z0-9-]{1,40}$/.test(t['标识'] || '') && !taken.has(t['标识']) ? t['标识'] : (keepId && !taken.has(keepId) ? keepId : '');
    while (!id || taken.has(id)) id = 'my-' + crypto.randomBytes(3).toString('hex');
    const need = [...new Set([...(Array.isArray(t['需要的skill']) ? t['需要的skill'] : []), skill].map(s => str(s, 80)).filter(s => /^[\w.:-]{1,80}$/.test(s)))];
    return { 标识: id, 名称: name, 分类: str(t['分类'], 20).trim() || '我的工具', 图标: '', 序号: Number(t['序号']) || 90, skill, 需要的skill: need,
      一句话: str(t['一句话'], 120), ...(t['产出'] ? { 产出: str(t['产出'], 120).trim() } : {}), 输入: fields, 指令: tpl, 类型: '工具', 版本: str(t['版本'], 12) || '1.0', ...(t['快速模式'] ? { 快速模式: true } : {}) };
  }
  function saveUserTool(t, keepId) {
    const old = keepId ? listTools().find(x => x.id === keepId && x.source === '我的') : null;
    if (keepId && !old) throw Error('只能改自己加的工具');
    const c = cleanTool(t, keepId);
    fs.mkdirSync(userToolsDir, { recursive: true });
    const file = old ? old.file : path.join(userToolsDir, c.标识 + '.json');
    writeJSON(file, c);
    return c;
  }
  function removeUserTool(id) {
    const x = listTools().find(t => t.id === id);
    if (!x) throw Object.assign(Error('没有这个工具'), { status: 404 });
    if (x.source !== '我的') throw Error('内置的工具不能移除');
    const bin = path.join(userToolsDir, '.已移除'); fs.mkdirSync(bin, { recursive: true });
    fs.renameSync(x.file, path.join(bin, new Date().toISOString().replace(/[:.]/g, '-') + '-' + path.basename(x.file)));
    return x.name;
  }
  const publicTool = ({ template, file, ...t }) => t;
  // 「造工作流」（工具清单里「附带工具清单」为真）执行前，把装着的工具写进项目的 .工作站/已装工具.json 给 AI 看（内容 1.4.0）：
  // 每个工具的输入、产出、指令模板原样给，再附一个和 toolPrompt 同规则的填模板函数，AI 造网页时原样抄进去
  const FILL_JS = `function fillTemplate(tpl, v) {
  v = Object.assign({ 日期: new Date().toISOString().slice(0, 10).replace(/-/g, '') }, v || {});
  var prev, on = function (k) { var i = k.indexOf('='); return i < 0 ? !!v[k] : v[k.slice(0, i)] === k.slice(i + 1); };
  do { prev = tpl; tpl = tpl.replace(/\\{\\{([#^])([^}]+)\\}\\}([\\s\\S]*?)\\{\\{\\/\\2\\}\\}/g, function (_, m, k, b) { return on(k) === (m === '#') ? b : ''; }); } while (tpl !== prev);
  return tpl.replace(/\\{\\{([^#^/}][^}]*)\\}\\}/g, function (_, k) { return v[k] == null ? '' : String(v[k]); });
}`;
  // 「这一步用哪个 skill」下拉框（内容 1.4.1，T2 第 4 条）：造好的工作流里每一步都有一个，导入后直接下拉换 skill，不用再找 AI。
  // 选项来自工作站发来的 AIWS.skills（这个项目的 AI 装着的 skill：名字、用途），按用途分组；选了什么记在页面自己的 localStorage 里。
  // skillLine 第三个参数是这一步填的 {输入名: 值}，换了 skill 也带上，没填的跳过（乔淼 10-29）
  const SKILL_PICK_JS = `function skillPick(sel, def, key) {
  var saved = ''; try { saved = localStorage.getItem(key) || ''; } catch (e) {}
  function add(parent, value, text) { var o = document.createElement('option'); o.value = value; o.textContent = text; parent.appendChild(o); }
  function fill() {
    var list = (window.AIWS && AIWS.skills) || [], cur = sel.options.length ? sel.value : (saved || def), groups = {}, order = [], found = !cur || cur === def;
    sel.innerHTML = '';
    add(sel, def, def ? def + '（原来用的）' : '不用 skill（按上面写的做法）');
    for (var i = 0; i < list.length; i++) { var s = list[i]; if (s.name === cur) found = true; if (s.name === def) continue; var g = s.purpose || '其他'; if (!groups[g]) { groups[g] = []; order.push(g); } groups[g].push(s.name); }
    for (var j = 0; j < order.length; j++) { var og = document.createElement('optgroup'); og.label = order[j]; for (var k = 0; k < groups[order[j]].length; k++) add(og, groups[order[j]][k], groups[order[j]][k]); sel.appendChild(og); }
    if (!found) add(sel, cur, cur + '（这台电脑上没找到）');
    sel.value = cur;
  }
  sel.addEventListener('change', function () { try { localStorage.setItem(key, sel.value); } catch (e) {} });
  window.addEventListener('aiws:skills', fill);
  fill();
}
function skillLine(name, what, filled) {
  var s = '请用「' + name + '」skill 完成这一步：' + what + '。严格按这个 skill 的步骤、硬约束和输出格式执行；skill 里要停下问我的地方照常停下。', a = [];
  for (var k in filled || {}) if (filled[k]) a.push('- ' + k + '：' + filled[k]);
  return a.length ? s + '\\n\\n这一步我填的：\\n' + a.join('\\n') : s;
}`;
  function writeToolCatalog(p) {
    const type = { text: '单行', area: '多行', select: '选择', skill: 'skill', skills: '多选skill' };
    const list = listTools().filter(t => !t.local && !t.catalog).map(t => ({
      名称: t.name, 来源: t.source === '我的' ? '我的工具' : '内置', 分类: t.cat, 一句话: t.one, 需要的skill: [].concat(t.skills || []), 产出: t.output,
      输入: t.fields.map(f => ({ 键: f.key, 名称: f.label, 类型: type[f.type] || '单行', ...(f.required ? { 必填: true } : {}), ...(f.options.length ? { 选项: f.options } : {}), ...(f.def ? { 默认: f.def } : {}), ...(f.placeholder ? { 提示: f.placeholder } : {}) })),
      指令: t.template }));
    const dir = path.join(p.path, '.工作站'); fs.mkdirSync(dir, { recursive: true });
    // 这个项目用的 AI 装着的 skill（T2/T3）：造工作流时核对学员点名的 skill 装没装、名字对不对
    const eng = engineOf(p), skills = skillCatalog(p.path).map(x => ({ 名称: x.name, 用途: x.purpose, 来源: x.group, 装在这个项目的AI里: x.engines.includes(eng), 说明: String(x.desc || '').replace(/\s+/g, ' ').slice(0, 160) }));
    fs.writeFileSync(path.join(dir, '已装工具.json'), JSON.stringify({
      说明: APP + ' 里现在装着的工具（内置的 + 我的工具），和这台电脑上装着的 skill，执行「造工作流」时由 ' + APP + ' 写出来。指令是模板：{{键}} 换成输入框的值；{{#键}}…{{/键}} 填了才要；{{^键}}…{{/键}} 没填才要；{{#键=值}}…{{/键=值}} 选了这个值才要；{{日期}} 是今天。值先去掉首尾空格；「选择」没选或选了不在选项里的，用第一个选项。产出：这个工具做完会写出的主文件（相对项目文件夹；不带扩展名的表示同一文件夹里以它开头的文件），空着的表示工具自己不定。已装的skill：「装在这个项目的AI里」是 false 的，这个项目跑不了，要提醒我。换skill：每一步「这一步用哪个 skill」下拉框的代码，原样抄进网页。',
      填模板: FILL_JS, 换skill: SKILL_PICK_JS, 工具: list, 已装的skill: skills }, null, 1));
  }
  // 产出放哪：按项目说明里的「文件放哪」表（旧的写论文项目是 01_…06_ 那套）；项目说明里没有，就把默认表附在指令里（见 naming.cjs）
  // 论文项目才用「文件放哪」表和完整文件清单（内容 1.3.11，乔淼 10-27：日常版的学员交付 / 公众号 / 备课、收件箱也被塞了一张写论文的表和几百个文件名）
  const isPaper = p => p.kind === 'paper' && !p.inbox;
  function placeNote(p) {
    const read = f => { try { return fs.readFileSync(path.join(p.path, f), 'utf8'); } catch { return ''; } };
    if (hasNaming(read('AGENTS.md')) || hasNaming(read('CLAUDE.md'))) return '文件放哪：按 AGENTS.md（或它指向的 CLAUDE.md）里约定的位置放；指令里写的文件夹名和项目约定不一样时，以项目约定为准。';
    if (!isPaper(p)) return `文件放哪：${read('AGENTS.md') || read('CLAUDE.md') ? '按项目说明里的约定，' : ''}放进项目里现有的合适文件夹；没有合适的就问我，不要自己新建一套文件夹。`;
    return '文件放哪：项目说明里没有约定，按下面这张表放（不要写进 AGENTS.md）。\n\n' + NAMING.replace(/^## .*\n/, '');
  }
  // 给 AI 的文件清单：论文项目列全（最多 300 个，材料多在里面挑）；别的项目只列顶层和最近改过的 20 个，其余 AI 自己找
  function inventory(p) {
    if (isPaper(p)) {
      const inv = projects.files(p.id, 300).map(f => '- ' + f.path);
      return `项目里现有的文件（供你挑选；最多列 300 个）：\n${inv.join('\n') || '- （项目里还没有文件）'}`;
    }
    const all = projects.files(p.id, 3000), top = all.filter(f => !f.path.replace(/\/$/, '').includes('/'));
    const recent = all.filter(f => f.kind !== 'dir').sort((a, b) => b.mtime - a.mtime).slice(0, 20);
    if (!all.length) return '项目里还没有文件。';
    return `项目顶层：${top.slice(0, 40).map(f => f.path).join('、')}${top.length > 40 ? ` 等 ${top.length} 项` : ''}\n最近改过的文件：\n${recent.map(f => '- ' + f.path).join('\n')}\n其余的需要时自己在项目里找（按文件名搜），不用全部看一遍。`;
  }
  // 快速模式（10-14 试用反馈第 9 条）：skill 里各自写了「快速模式」一节，这里只负责说一声
  // 快速模式 = 这一次执行不停（10-15 乔淼定）：所有停点都由 AI 按自己的建议直接决定；「自动跑完」是整条工作流连着跑，另一回事
  const QUICK = '【快速模式】这一步不停：skill 和上面指令里写的停点（阶段末确认、选方案、要不要深读、批准写盘等）一律不停，由你按自己的建议和项目材料直接决定、接着往下做；skill 里「快速模式」一节说要停的那一次也不停。最后附「快速模式 · 我替你做的决定」表，方便我回头改。缺材料、输入对不上这类没法替我决定的情况，照样停下说明。硬约束不放松。';
  // 本机装好的 skill（课程自带的、文献数据库检索的除外）：给数据分析「自定义 skill」下拉用——工坊造的、GitHub 装的都在里面
  const COURSE_SKILLS = new Set(['academic-project-init', 'analyze-qualitative-data', 'analyze-quantitative-data', 'article-framework', 'critical-paper-reading',
    'data-analysis-round', 'findings-synthesis', 'fulltext-draft', 'knowledge-module-gen', 'knowledge-module-list', 'lit-pdf-zotero', 'lit-pyramid', 'lit-verify',
    'literature-analysis', 'literature-search', 'methodology-draft', 'methods-map', 'model-paper-deconstruct', 'pxyv-search', 'research-design', 'research-gap-scan',
    'review-blueprint', 'review-draft', 'review-draft-assembly', 'review-synthesis', 'skill-forge', 'skill-workshop-plan', 'sr-search-record', 'scansci-pdf',
    'submission-task-intake', 'manuscript-diagnosis', 'manuscript-revision', 'journal-requirements-check', 'submission-package-preparation', 'review-response-planning', 'review-revision-response']);
  function allSkills(engineId, cwd) {
    const e = ENGINES[engineId]; if (!e || typeof e.skillDirs !== 'function') return [];
    const names = new Set();
    for (const d of e.skillDirs(cwd)) { let list = []; try { list = fs.readdirSync(d); } catch {} for (const n of list) if (/^[\w.-]{1,80}$/.test(n) && fs.existsSync(path.join(d, n, 'SKILL.md'))) names.add(n); }
    return [...names];
  }
  const installedSkills = (engineId, cwd) => allSkills(engineId, cwd).filter(n => !COURSE_SKILLS.has(n) && !/^topic-/.test(n) && !/^(gs|sd|wos|cnki)-/.test(n)).sort();
  // ---------- 全部 skill 目录（「添加工具」边打字边搜用，10-23 乔淼：原来的下拉只列课程以外的、也不看插件） ----------
  // 来源：两个 AI 的 skills 文件夹（含项目里的）＋ Claude Code 已启用插件里的 skill（调用名是「插件名:skill名」）。
  // Claude 桌面 App 同步来的 skill（~/.claude/skills/synced/…）不算：命令行版不一定认，交出去可能找不到
  function skillDesc(file) {
    let t = ''; try { const fd = fs.openSync(file, 'r'), b = Buffer.alloc(6000); t = b.slice(0, fs.readSync(fd, b, 0, 6000, 0)).toString('utf8'); fs.closeSync(fd); } catch { return { name: '', desc: '' }; }
    const fm = (t.match(/^---\s*\n([\s\S]*?)\n---/) || [])[1] || '', lines = fm.split('\n');
    const field = key => {
      const i = lines.findIndex(l => new RegExp(`^${key}:`).test(l)); if (i < 0) return '';
      let v = lines[i].slice(key.length + 1).trim();
      if (!v || /^[>|][-+]?$/.test(v)) { const more = []; for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]); j++) more.push(lines[j].trim()); v = more.join(' '); }
      return v.replace(/^(['"])([\s\S]*)\1$/, '$2').trim();
    };
    return { name: field('name'), desc: field('description').slice(0, 300) };
  }
  // Claude Code 已启用的插件：~/.claude/plugins/installed_plugins.json 里的装在哪 ＋ ~/.claude/settings.json 的 enabledPlugins
  function claudePluginSkills() {
    const home = os.homedir(), out = [];
    const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return {}; } };
    const installed = read(path.join(home, '.claude', 'plugins', 'installed_plugins.json')).plugins || {}, enabled = read(path.join(home, '.claude', 'settings.json')).enabledPlugins || {};
    for (const [key, v] of Object.entries(installed)) {
      if (enabled[key] === false || !(key in enabled)) continue;
      const info = Array.isArray(v) ? v[0] : v, root = info && info.installPath && path.join(info.installPath, 'skills'), plugin = key.split('@')[0];
      if (!root) continue;
      (function walk(dir, depth) {
        let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of ents) {
          if (!e.isDirectory() || e.name.startsWith('.')) continue;
          const f = path.join(dir, e.name, 'SKILL.md');
          if (fs.existsSync(f)) { const m = skillDesc(f); out.push({ name: `${plugin}:${m.name || e.name}`, desc: m.desc, group: '插件 · ' + plugin }); }
          else if (depth < 2) walk(path.join(dir, e.name), depth + 1);
        }
      })(root, 0);
    }
    return out;
  }
  // skill 的用途（内容 1.4.1，第 4 讲 T3）：「造工作流」里按用途分组挑 skill。先看 POPPER 哪个内置工具用了它，就用那个工具的分类；
  // 没有的按名字里的词猜，名字猜不出再看说明；都对不上归「其他」。只是帮着分组，猜错了不影响用
  const PURPOSES = ['选题', '找文献', '读文献', '写综述', '研究设计', '数据分析', '写全文', '审稿返修', '其他'];
  const PURPOSE_WORDS = [['审稿返修', /peer.?review|审稿|返修|revision|rebuttal|response.?to.?review|submission|投稿|manuscript/i], ['选题', /topic|选题/i],
    ['找文献', /\bsearch\b|检索|scholar|cnki|\bwos\b|scansci|zotero|下载|lit-verify|验真|pyramid|金字塔/i], ['写综述', /literature.?review|systematic.?review|scoping|综述|review-(draft|blueprint|synthesis)|synthes/i],
    ['数据分析', /\bdata\b|analy[sz]|统计|regression|qualitative|quantitative|编码|定量|定性|\bsem\b/i], ['研究设计', /method|research.?design|方法|研究设计|hypothes|假设|ethic|伦理/i],
    ['读文献', /\bread|阅读|批判|critical|deconstruct|拆解|knowledge.?module|模块|\bgap\b/i], ['写全文', /writ|draft|写作|初稿|framework|框架|\bpaper\b|figure|\bppt\b|论文/i]];
  function skillToolCats() {
    const m = new Map();
    for (const t of listTools()) if (PURPOSES.includes(t.cat)) for (const n of [t.skill, ...[].concat(t.skills || [])]) if (n && !m.has(n)) m.set(n, t.cat);
    return m;
  }
  function skillPurpose(name, desc, byTool) {
    if (byTool.has(name)) return byTool.get(name);
    for (const text of [name.replace(/^[^:]+:/, ''), desc || '']) { const hit = PURPOSE_WORDS.find(([, re]) => re.test(text)); if (hit) return hit[0]; }
    return '其他';
  }
  function skillCatalog(cwd) {
    const map = new Map(), add = (s, engine) => { const x = map.get(s.name) || { ...s, engines: [] }; if (!x.desc && s.desc) x.desc = s.desc; if (!x.engines.includes(engine)) x.engines.push(engine); map.set(s.name, x); };
    for (const id of Object.keys(BASE_ENGINES)) {
      const e = BASE_ENGINES[id]; if (typeof e.skillDirs !== 'function') continue;
      for (const d of e.skillDirs(cwd)) {
        let names = []; try { names = fs.readdirSync(d); } catch {}
        const inProject = cwd && (d === cwd || d.startsWith(cwd + path.sep));
        for (const n of names) {
          const f = path.join(d, n, 'SKILL.md');
          if (!/^[\w.-]{1,80}$/.test(n) || !fs.existsSync(f)) continue;
          const group = inProject ? '本项目' : COURSE_SKILLS.has(n) || /^topic-/.test(n) ? '课程' : /^(gs|sd|wos|cnki)-/.test(n) ? '文献检索' : '我装的';
          add({ name: n, desc: skillDesc(f).desc, group }, id);
        }
      }
    }
    for (const s of claudePluginSkills()) add(s, 'claude');
    const order = g => ['本项目', '我装的', '课程', '文献检索'].indexOf(g) + 1 || 9, byTool = skillToolCats();
    for (const x of map.values()) x.purpose = skillPurpose(x.name, x.desc, byTool);
    return [...map.values()].sort((a, b) => order(a.group) - order(b.group) || a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  }
  // 文献数据库检索 skill 装没装（写论文的文献搜索用：没装的勾选项标出来）
  function searchTools(engineId, cwd) {
    const all = new Set(allSkills(engineId, cwd));
    return { gs: all.has('gs-search'), sd: all.has('sd-search'), wos: all.has('wos-search'), cnki: all.has('cnki-search') };
  }
  function toolPrompt(t, values, pins) {
    const v = { 日期: new Date().toISOString().slice(0, 10).replace(/-/g, '') };
    for (const f of t.fields) {
      let x = String((values || {})[f.key] ?? '').trim().slice(0, 8000);
      if (f.type === 'select' && !f.options.includes(x)) x = f.options[0] || '';
      if (f.required && !x) throw Error('先填：' + f.label);
      v[f.key] = x;
    }
    const on = key => { const i = key.indexOf('='); return i < 0 ? !!v[key] : v[key.slice(0, i)] === key.slice(i + 1); };
    // 条件段可以套着写（外层是选项、里面是填没填），一层层换到没有为止
    let text = t.template, prev;
    do { prev = text; text = text.replace(/\{\{([#^])([^}]+)\}\}([\s\S]*?)\{\{\/\2\}\}/g, (_, mode, key, body) => (on(key) === (mode === '#') ? body : '')); } while (text !== prev);
    text = text.replace(/\{\{([^#^/}][^}]*)\}\}/g, (_, key) => v[key] ?? '');
    const list = (pins || []).map(String).filter(Boolean).slice(0, 50);
    if (list.length) text += `\n\n这次指定要用的文件（优先用它们，不用再到处找）：\n${list.map(x => '- ' + x).join('\n')}`;
    if (t.quick && (values || {}).__quick) text += '\n\n' + QUICK;
    return { text, title: t.name + (v.paper ? ' · ' + v.paper.slice(0, 20) : '') };
  }

  // 工作流页面：原样送出 HTML，只在 <head> 最前面插一段「桥」，并带上当前项目的信息
  function workflowPage({ id, project }) {
    const w = workflowById(id);
    if (!w) return { status: 404, html: '<meta charset="utf-8"><p style="font:15px sans-serif;padding:30px">没有这个工作流（可能已被移除）。</p>' };
    const html = fs.readFileSync(w.file, 'utf8');
    const ctx = {
      project: projectInfo(project), parentOrigin: k.mainOrigin, texts: w.texts, agentName: settings.agentName || AGENT,
      workflow: { id: w.id, name: w.name, version: w.version },
      // 「一键跑完」每段能选哪些 AI（内容 1.3.0）：只给启用了、找到了的名字；engine = 这个项目用的
      engines: usableEngines().map(id => ({ id, name: ENGINES[id].name })), engine: (p => p && p.exists ? engineOf(p) : settings.engine)(project && projects.get(project))
    };
    const src = fs.readFileSync(path.join(contentDir, 'bridge.js'), 'utf8');
    if (src.split('__CTX__').length !== 2) throw Error('bridge.js 里的占位符 __CTX__ 应该只出现一次');
    const bridge = src.replace('__CTX__', () => JSON.stringify(ctx).replace(/</g, '\\u003c'));
    const tag = '<script>' + bridge + '</' + 'script>';
    return { status: 200, html: /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, m => m + tag) : tag + html };
  }

  // ---------- 项目 ----------
  const projects = createProjects({ dataDir, defaultProjectsDir, defaultEngine: () => settings.engine });
  // 给界面的项目列表。项目记的 AI 这里没有（比如开发时选的「测试用假 AI」，学员版里没有）就显示实际会用的默认 AI，和执行时一致
  // 项目选的 AI 停用了：照样用默认的跑，engineWas 让右栏说一句「原来用 X，已停用」
  const projectSummary = () => projects.summary(listWorkflows()).map(p => ({ ...p, engine: engineOf(p), ...(p.engine && ENGINES[p.engine] && p.engine !== engineOf(p) ? { engineWas: p.engine } : {}) }));
  // 交给工作流页面的项目信息：名字、路径、产出语言、文件清单（最多 500 个）
  function projectInfo(id) {
    const p = id && projects.get(id);
    if (!p || !p.exists) return null;
    return { id: p.id, name: p.name, path: p.path, lang: p.lang, files: projects.files(p.id, 500).map(f => f.path),
      skills: installedSkills(engineOf(p), p.path), searchTools: searchTools(engineOf(p), p.path) };
  }
  // 项目里某个文件的绝对路径；不许跳出项目文件夹
  function inProject(id, rel) {
    const p = projects.get(id); if (!p || !p.exists) throw Error('项目文件夹找不到了');
    const full = path.resolve(p.path, String(rel || '').replace(/\/$/, ''));
    if (full !== p.path && !full.startsWith(p.path + path.sep)) throw Error('只能打开项目文件夹里的东西');
    return full;
  }

  // 工作流交来的指令：前面加上当前项目的信息再交给 AI（实施方案 2.1 第一层）
  function wrapPrompt(p, w, text) {  // w 为空：直接跟 AI 说、交给 AI 改
    // 有项目说明才让 AI 先读（10-27 乔淼：收件箱没有 AGENTS.md，AI 每次都先报一句「收件箱里没有 AGENTS.md」）
    const guide = ['AGENTS.md', 'CLAUDE.md'].find(f => fs.existsSync(path.join(p.path, f)));
    return `【工作站附加 · 项目信息】
项目文件夹：${p.path}
（以这里为准：下面的指令里如果写了别的项目路径或「工作根目录 / 项目名」，一律改用这个文件夹。）
${guide ? `先读项目里的 ${guide}。` : ''}产出语言：${p.lang}
${placeNote(p)}
${inventory(p)}
需要的材料请自己在项目里找（看文件名，必要时打开看内容）；找不到就停下来问我，不要编造。
完成后，列出这次新建或修改的全部文件。
我让你把事情加进 ${APP} 的待办时：在项目文件夹的 .工作站/ 里写一个 待办草稿-<随便起个后缀>.json，格式 {"todos":[{"title":"动词开头的一句话","prompt":"开始这件事时交给 AI 的指令","files":["相关文件的完整路径"]}]}，${APP} 会自动收进待办；不要去写 ${APP} 数据文件夹里的 待办.json（写不了）。没让你加就不写。

${w ? `【以下是${w.kind === '工具' ? '工具' : '工作流'}「${w.name}」${w.version ? '（v' + w.version + '）' : ''}给出的指令】` : '【以下是我的指令】'}
${text}`;
  }

  // ---------- 执行前检查「需要的skill」 ----------
  // 工具：清单里写的都要有；工作流：说明块里写的 skill 中，这一段指令里真提到的才要有（各阶段用的 skill 不一样）。
  // 找不到的交给界面问一句「仍然执行吗」（force 跳过检查）。引擎没写 skillDirs 的不查。
  function missingSkills(engineId, cwd, names) {
    const e = ENGINES[engineId];
    if (!e || typeof e.skillDirs !== 'function' || !names.length) return [];
    const dirs = e.skillDirs(cwd);
    // 插件里的 skill（「插件名:skill名」）只有 Claude Code 认得，也要那个插件装着、启用着
    const plug = names.some(n => n.includes(':')) && engineId === 'claude' ? new Set(claudePluginSkills().map(s => s.name)) : new Set();
    return [...new Set(names)].filter(n => n.includes(':') ? /^[\w.-]{1,80}:[\w.-]{1,80}$/.test(n) && !plug.has(n)
      : /^[\w.-]{1,80}$/.test(n) && !dirs.some(d => fs.existsSync(path.join(d, n, 'SKILL.md'))));
  }
  const mentioned = (names, text) => names.filter(n => new RegExp(`(^|[^\\w-])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\w-])`).test(text));

  // ---------- 收件箱梳理 ----------
  // 梳理时能建议的后续动作：框架里没有（POPPER 的「PDF 入库」要 Zotero 服务，框架不带文献工具）。计划里 follow 恒为空，界面上就不出勾选框
  const NO_FOLLOW = {};
  const TRIAGE_FOLDERS = ['选题/', '文献/', '文献/PDF/', '方法/', '数据/', '写作/', 'skill源材料/'];
  const inboxDirOf = () => { const ib = projects.inbox(); if (!ib || !ib.exists) throw Object.assign(Error('收件箱找不到了'), { status: 404 }); return ib; };
  const planFile = ib => path.join(ib.path, '.工作站', '梳理计划.json');
  const undoFile = ib => path.join(ib.path, '.工作站', '梳理记录.json');
  const relSafe = (s, what) => {
    s = String(s || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
    if (!s || s.split('/').some(x => x === '..' || x.startsWith('.'))) throw Error(`${what}不对：${s}`);
    return s;
  };
  function projectBrief(p) {
    let intro = ''; try { intro = fs.readFileSync(path.join(p.path, 'AGENTS.md'), 'utf8'); } catch {}
    intro = intro.split('\n').filter(l => l.trim() && !/^#|^\||^>|^（|^---/.test(l.trim())).join(' ').replace(/\s+/g, ' ').slice(0, 160);
    let dirs = []; try { dirs = fs.readdirSync(p.path, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name + '/'); } catch {}
    return `- [id:${p.id}] ${p.name}${intro ? ' —— ' + intro : ''}${dirs.length ? '；现有文件夹：' + dirs.slice(0, 30).join(' ') : ''}`;
  }
  // 梳理计划里「去哪个文件夹」的选项（内容 1.3.2）：项目现有的文件夹（两层以内），论文项目再加「文件放哪」表那几个。
  // 以前只有论文项目那一套，学员交付这种按学员分文件夹的项目放不进去
  function projectFolders(p) {
    const out = [];
    const walk = (dir, rel, depth) => { let ds = []; try { ds = fs.readdirSync(dir, { withFileTypes: true }); } catch {}
      for (const d of ds) if (d.isDirectory() && !d.name.startsWith('.') && out.length < 80) { const r = rel + d.name + '/'; out.push(r); if (depth < 2) walk(path.join(dir, d.name), r, depth + 1); } };
    walk(p.path, '', 1);
    const paper = !out.length || TRIAGE_FOLDERS.some(f => out.includes(f));
    return [...new Set([...(paper ? TRIAGE_FOLDERS : []), ...out])];
  }
  // ---------- 下一步建议的线索（内容 1.3.5，方案 设计/下一步建议-按项目类型-方案.md）：非论文项目按类型去数，界面拿来出建议 ----------
  // 只数、不改；项目外的文件夹（数据表现/、备课的逐字稿）也在这里数，界面不直接读。最近 = 14 天
  const RECENT = 14 * 864e5;
  const ls = dir => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => !d.name.startsWith('.') && !d.name.startsWith('~$')); } catch { return []; } };
  const mtimeOf = f => { try { return fs.statSync(f).mtimeMs; } catch { return 0; } };
  const dayOf = (name, t) => { const m = String(name).match(/(20\d\d)[-_.]?(\d\d)[-_.]?(\d\d)/); return m ? m[1] + m[2] + m[3] : new Date(t).toISOString().slice(0, 10).replace(/-/g, ''); };
  let usedCache = { sig: '', names: new Set(), outs: new Set() };
  function usedFiles() { // 任务指令里提到过的文件名、任务写出来的文件（完整路径）
    const all = tasks.list(), sig = all.length + ':' + (all[0] ? all[0].id + all[0].status : '');
    if (usedCache.sig === sig) return usedCache;
    const names = new Set(), outs = new Set();
    for (const r of all) {
      const pr = projects.get(r.project); for (const o of r.outputs || []) if (pr) outs.add(path.join(pr.path, o));
      for (const m of (tasks.prompt(r.id) || '').matchAll(/[^\s/\\、，,（）()「」：:]+\.(?:txt|docx?|pdf|md)/gi)) names.add(m[0]);
    }
    return (usedCache = { sig, names, outs });
  }
  const recentTranscripts = (root, skip) => { // 最近的逐字稿（三层以内）
    const out = [], now = Date.now();
    (function walk(dir, depth) { for (const d of ls(dir)) { const f = path.join(dir, d.name);
      if (d.isDirectory()) { if (depth < 3 && !(skip && skip.test(d.name))) walk(f, depth + 1); }
      else if (/逐字稿|转录/.test(d.name) && /\.(txt|md|docx?)$/i.test(d.name)) { const t = mtimeOf(f); if (now - t < RECENT) out.push({ file: f, t }); } } })(root, 1);
    return out.sort((a, b) => b.t - a.t);
  }
  function suggestFacts(p) {
    const items = [], now = Date.now(), used = usedFiles();
    if (p.kind === 'students') for (const d of ls(p.path).filter(x => x.isDirectory())) {
      const sd = path.join(p.path, d.name), hd = path.join(sd, '会话记录'), hfiles = ls(hd).filter(x => x.isFile());
      for (const x of hfiles) { // 逐字稿还没整理：同一天没有别的 .md
        const f = path.join(hd, x.name), t = mtimeOf(f);
        if (!(/逐字稿/.test(x.name) || /\.txt$/i.test(x.name)) || /整理/.test(x.name) || now - t > RECENT) continue;
        const day = dayOf(x.name, t);
        if (hfiles.some(y => y.name !== x.name && /\.md$/i.test(y.name) && !/逐字稿/.test(y.name) && dayOf(y.name, mtimeOf(path.join(hd, y.name))) === day)) continue;
        items.push({ type: 'transcript', student: d.name, file: path.join(d.name, '会话记录', x.name), t });
      }
      let lastOut = 0; (function walk(dir, depth) { for (const x of ls(dir)) { const f = path.join(dir, x.name); if (x.isDirectory()) { if (depth < 2) walk(f, depth + 1); } else lastOut = Math.max(lastOut, mtimeOf(f)); } })(path.join(sd, '交付文件'), 1);
      for (const x of ls(sd).filter(y => y.isFile() && /\.docx?$/i.test(y.name))) { // 学员发来的新稿子（只认 Word：PDF 多是要求、文献，不是学员的稿子）
        const f = path.join(sd, x.name), t = mtimeOf(f);
        if (now - t > RECENT || used.outs.has(f) || t <= lastOut) continue;
        items.push({ type: 'newdoc', student: d.name, file: path.join(d.name, x.name), t });
      }
    }
    if (p.kind === 'gzh') {
      const dataDir = path.join(path.dirname(p.path), '数据表现'), fresh = ls(dataDir).filter(x => x.isFile());
      if (fresh.length) items.push({ type: 'gzhdata', n: fresh.length });
      const tr = recentTranscripts(path.join(p.path, '转录文稿')).filter(x => !used.names.has(path.basename(x.file)));
      for (const q of projects.list().filter(q => q.exists && q.kind === 'teaching')) // 备课那边新的直播逐字稿也算（方案第四节）
        for (const x of recentTranscripts(q.path, /^AI学术开发$/)) if (!used.names.has(path.basename(x.file)) && !tr.some(y => path.basename(y.file) === path.basename(x.file))) tr.push(x);
      for (const x of tr.sort((a, b) => b.t - a.t)) items.push({ type: 'gzhtranscript', file: x.file, name: path.basename(x.file), t: x.t });
    }
    if (p.kind === 'teaching') for (const x of recentTranscripts(p.path, /^AI学术开发$/)) { // 一讲上完了没复盘
      const dir = path.dirname(x.file), lec = (path.basename(x.file).match(/第\s*([0-9一二三四五六七八九十]+)\s*讲|\bL(\d+)\b/) || []).slice(1).find(Boolean);
      // 同一个文件夹里有几讲的逐字稿时，复盘要对得上讲次（文件名里有「第N讲」或「LN」）才算这一讲复盘过了
      const sameLec = n => !lec || new RegExp('第\\s*' + lec + '\\s*讲|\\bL' + lec + '\\b').test(n);
      if (ls(dir).some(y => y.isFile() && /复盘/.test(y.name) && sameLec(y.name) && mtimeOf(path.join(dir, y.name)) > x.t)) continue;
      items.push({ type: 'kefupan', file: path.relative(p.path, x.file), where: path.relative(p.path, dir) || p.name, t: x.t });
    }
    return { items: items.slice(0, 20) };
  }
  async function inboxRoute(sub, method, body) {
    const ib = inboxDirOf();
    if (sub === 'triage' && method === 'POST') {
      const news = projects.inboxNew(), kept = projects.inboxKept();
      if (!news.length && !kept.length) throw Error('收件箱里没有要梳理的文件');
      const others = projects.list().filter(p => !p.inbox && p.exists);
      const prompt = `请帮我梳理收件箱。你在收件箱文件夹里运行，**只读、只写计划：不要移动、改名、修改或删除任何文件**（搬文件由工作站来做，我确认后它照着计划搬）。

【要梳理的新文件】（相对收件箱）
${news.map(n => '- ' + n).join('\n') || '（没有新文件）'}
${kept.length ? `【上次留在收件箱的】（也要梳理：现在可能有合适的项目了；还是看不出就继续 keep；放了很久、看起来不会再用的，可以建议 archive 或 trash，见下面）
${kept.map(n => { let d = 0; try { d = Math.floor((Date.now() - fs.statSync(path.join(ib.path, n)).ctimeMs) / 864e5); } catch {} return `- ${n}${d >= 1 ? `（在收件箱里约 ${d} 天）` : ''}`; }).join('\n')}
` : ''}
${body.note ? `【我先说一句】（照这个梳理）
${String(body.note).slice(0, 4000)}
` : ''}【我的项目】
${others.map(projectBrief).join('\n') || '- （还没有别的项目）'}

【每个项目里文件放哪】
${NAMING}
【每个文件要做的】打开看内容（PDF 读前一两页，表格看表头，文稿看开头），判断它是什么、属于哪个项目、放进哪个文件夹。看不出属于哪个项目就留在收件箱；明显是一个新课题、又不属于现有项目的，可以建议新建项目。
【不用了的】不会再用的文件有两种去处（都要我点「照这样做」才动，也能撤销）：archive = 归档到收件箱的「${ARCHIVE}/」文件夹，以后梳理不再看（适合留了很久、和现有项目都无关、但删了可惜的）；trash = 移进废纸篓（只给明显没用的：重复的、临时文件、安装包、已经在别处有一份的）。拿不准就 keep，不要为了清空收件箱硬归档。
文件夹：论文项目按上面的「文件放哪」表，只能用 ${TRIAGE_FOLDERS.join(' ')}；别的项目用它现有的文件夹，最多两层——比如学员交付是每个学员一个文件夹，学员的稿子放「学员名/」，会议逐字稿放「学员名/会话记录/」（项目说明里有写，以它为准）；子文件夹还没有也可以写，工作站会建。
【要做的事】从这些文件里看出我接下来要做的事，列成待办：比如学员发来新稿子 → 批注；会议逐字稿 → 整理成要点和待跟进；邮件 → 回复；文献 → 读。一件事一条，只列文件里确实看得出来的，不要编；什么都看不出来就是空的。每条要写清：在哪个项目里做、给 AI 的指令（具体做什么、按项目说明里的哪种做法、产出放哪；要我决定的地方写明让它停下问我）。我会在工作站里一条一条点「开始」，每条单独开一个对话。
【写计划】写到 .工作站/梳理计划.json（已有就覆盖），只写这一个文件，格式：
{"items":[{"file":"文件名（同上面列的）","kind":"文献清单 / 论文PDF / 稿件 / 数据 / 笔记 / 其他","project":"项目 id，或 new:新项目名，或 keep / archive / trash","folder":"文献/PDF/","reason":"一句话理由"}],
 "todos":[{"title":"动词开头的一句话，比如「批注 Kaylynn 的 proposal 第 3 版」","project":"项目 id","files":["相关的文件名（同上面列的）"],"prompt":"交给 AI 的指令"}]}
上面列的每个文件（新文件和上次留下的）都写一条，不要漏；keep / archive / trash 的 folder 留空；列了但在收件箱里找不到的（可能刚被挪走了），计划里不写它、也不用停下来问我，最后提一句就行；收件箱里没有 AGENTS.md 是正常的，不用提；keep 的 folder 留空；不确定就 keep，在 reason 里说为什么。todos 里的文件写收件箱里的文件名就行，工作站开始这件事时会换成搬过去以后的位置。
最后用两三句话告诉我：几个文件建议去哪、梳理出几件要做的事，提醒我在 Dashboard 的收件箱里看计划、点「照这样做」，再一件件点「开始」。`;
      return createRun({ project: ib.id, prompt, free: true, title: '梳理收件箱' }).data;
    }
    if (sub === 'plan' && method === 'GET') {
      let plan = null; try { plan = JSON.parse(fs.readFileSync(planFile(ib), 'utf8')); } catch {}
      const ps = projects.list().filter(p => !p.inbox && p.exists).map(p => ({ id: p.id, name: p.name, folders: projectFolders(p) }));
      if (!plan || !Array.isArray(plan.items)) return { plan: null, projects: ps, folders: TRIAGE_FOLDERS, follow: NO_FOLLOW, canUndo: readJSON(undoFile(ib), []).length > 0 };
      let mtime = 0; try { mtime = fs.statSync(planFile(ib)).mtimeMs; } catch {}
      const items = plan.items.filter(x => x && x.file).slice(0, 200).map(x => {
        const file = String(x.file).replace(/^\/+/, '');
        return { file, exists: fs.existsSync(path.join(ib.path, file)), kind: String(x.kind || ''), project: String(x.project || 'keep'), folder: String(x.folder || ''), reason: String(x.reason || ''), follow: [] };
      });
      const names = new Map([[ib.id, '收件箱'], ...ps.map(p => [p.id, p.name])]);
      const todos = (Array.isArray(plan.todos) ? plan.todos : []).filter(t => t && (t.title || t.prompt)).slice(0, 50).map(t => ({ title: String(t.title || '').slice(0, 80), project: names.has(String(t.project)) ? String(t.project) : ib.id,
        projectName: names.get(String(t.project)) || '收件箱', files: [].concat(t.files || []).map(String).slice(0, 20), prompt: String(t.prompt || '').slice(0, 4000), run: t.run || '' }));
      return { plan: { items, todos, applied: !!plan.applied, at: mtime }, projects: ps, folders: TRIAGE_FOLDERS, follow: NO_FOLLOW, canUndo: readJSON(undoFile(ib), []).length > 0 };
    }
    if (sub === 'apply' && method === 'POST') {
      const items = Array.isArray(body.items) ? body.items.slice(0, 200) : [];
      const prev = projects.current()?.id, moves = [], kept = [], queued = [], errors = [], archived = [], trashed = [], undoable = [];
      const made = new Map(); // 新项目名 → 项目
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      for (const x of items) {
        try {
          const file = relSafe(x.file, '文件名');
          if (file.includes('/')) throw Error(`只梳理收件箱顶层的东西：${file}`);
          const src = path.join(ib.path, file);
          if (!fs.existsSync(src)) throw Error(`找不到 ${file}`);
          if (!x.project || x.project === 'keep') { kept.push(file); continue; }
          // 不用了（内容 1.3.10）：归档到 收件箱/已归档/（以后不再梳理），或移进废纸篓；都记进梳理记录，「撤销上次梳理」能放回来（Windows 回收站的除外）
          if (x.project === 'archive') {
            const dir = path.join(ib.path, ARCHIVE); fs.mkdirSync(dir, { recursive: true });
            const ext = path.extname(file), base = path.basename(file, ext);
            let name = file, k = 1; while (fs.existsSync(path.join(dir, name))) name = `${base}-${stamp}${k > 1 ? '-' + k : ''}${ext}`, k++;
            fs.renameSync(src, path.join(dir, name)); undoable.push({ from: src, to: path.join(dir, name) }); archived.push(file); continue;
          }
          if (x.project === 'trash') {
            const to = trash(src, file); if (to) undoable.push({ from: src, to }); trashed.push(file); continue;
          }
          let p;
          if (String(x.project).startsWith('new:')) {
            const name = String(x.project).slice(4).trim();
            p = made.get(name) || projects.list().find(q => !q.inbox && q.name === name) || projects.create({ name });
            made.set(name, p);
          } else p = projects.get(String(x.project));
          if (!p || !p.exists || p.inbox) throw Error(`目标项目找不到了：${file}`);
          const folder = x.folder ? relSafe(x.folder, '文件夹').replace(/\/?$/, '/') : '';
          if (folder.split('/').filter(Boolean).length > 2) throw Error(`文件夹最多两层：${folder}`);
          const dir = path.join(p.path, folder); fs.mkdirSync(dir, { recursive: true });
          const ext = path.extname(file), base = path.basename(file, ext);
          let name = file, k = 1;
          while (fs.existsSync(path.join(dir, name))) name = `${base}-${stamp}${k > 1 ? '-' + k : ''}${ext}`, k++; // 同名不覆盖，加日期后缀
          const dst = path.join(dir, name);
          try { fs.renameSync(src, dst); }
          catch (e) { // 跨磁盘：复制过去，原件挪进 收件箱/.工作站/已移走/（不删）
            if (e.code !== 'EXDEV') throw e;
            fs.cpSync(src, dst, { recursive: true });
            const keep = path.join(ib.path, '.工作站', '已移走'); fs.mkdirSync(keep, { recursive: true });
            fs.renameSync(src, path.join(keep, Date.now() + '-' + file));
          }
          moves.push({ from: src, to: dst, project: p.id, projectName: p.name, rel: folder + name });
        } catch (e) { errors.push(e.message); }
      }
      if (kept.length) projects.markSeen(kept);
      if (moves.length || undoable.length) { const log = readJSON(undoFile(ib), []); log.push({ at: new Date().toISOString(), moves: [...moves.map(m => ({ from: m.from, to: m.to })), ...undoable] }); writeJSON(undoFile(ib), log.slice(-20)); }
      try { const plan = JSON.parse(fs.readFileSync(planFile(ib), 'utf8')); plan.applied = new Date().toISOString(); writeJSON(planFile(ib), plan); } catch {}
      if (prev) try { projects.setCurrent(prev); } catch {} // 建新项目会把它设成当前，换回来
      return { moved: moves.map(m => ({ to: m.projectName + ' / ' + m.rel })), kept, archived, trashed, trashName: common.WIN ? '回收站' : '废纸篓', trashUndo: trashed.length === undoable.length - archived.length, queued, errors, config: config() };
    }
    if (sub === 'undo' && method === 'POST') {
      const log = readJSON(undoFile(ib), []), last = log.pop();
      if (!last) throw Error('没有能撤销的梳理');
      const back = [], errors = [];
      for (const m of [...last.moves].reverse()) {
        try {
          if (!fs.existsSync(m.to)) throw Error(`${path.basename(m.to)} 已经不在原来移去的地方了`);
          if (fs.existsSync(m.from)) throw Error(`收件箱里已经有同名的 ${path.basename(m.from)}`);
          fs.renameSync(m.to, m.from); back.push(path.basename(m.from));
        } catch (e) { errors.push(e.message); }
      }
      writeJSON(undoFile(ib), log);
      // 计划恢复成没执行过，可以改一改再「照这样做」
      try { const plan = JSON.parse(fs.readFileSync(planFile(ib), 'utf8')); delete plan.applied; writeJSON(planFile(ib), plan); } catch {}
      return { back, errors, config: config() };
    }
    if (sub === 'upload' && method === 'POST') return { name: dropFile(ib.path, body) }; // 旧界面用；现在走 projects/upload
    throw Object.assign(Error('没有这个接口'), { status: 404 });
  }

  // 拖到左栏项目（含收件箱）上的文件：放进项目文件夹最上层，同名加 -2，不覆盖。
  // from = 文件在电脑上的路径（App 1.1.0 起界面拿得到）→ 直接复制，不限大小；拿不到就由界面读成 base64（data）传上来，最大 25MB
  function dropFile(dir, { name, data, from }) {
    name = path.basename(String(name || (from ? path.basename(String(from)) : ''))).replace(/[\\/:*?"<>|]/g, '_');
    if (!name || name.startsWith('.')) throw Error('文件名不对');
    const ext = path.extname(name), base = path.basename(name, ext);
    let out = name, k = 2; while (fs.existsSync(path.join(dir, out))) out = `${base}-${k++}${ext}`;
    if (from) {
      let st; try { st = fs.statSync(String(from)); } catch { throw Error('找不到这个文件'); }
      if (!st.isFile()) throw Error('只能放文件，文件夹请在访达里放');
      fs.copyFileSync(String(from), path.join(dir, out), fs.constants.COPYFILE_EXCL);
    } else {
      const buf = Buffer.from(String(data || ''), 'base64');
      if (buf.length > 25 * 1024 * 1024) throw Error('单个文件最大 25MB');
      fs.writeFileSync(path.join(dir, out), buf, { flag: 'wx' });
    }
    return out;
  }

  // ---------- 任务（见 tasks.cjs：按项目排队、不同项目同时跑、分清等你回复和已完成、认出产出） ----------
  // ---------- 5 小时额度（10-17 界面升级第 3 步）：Claude Code 跑任务时自己报；Codex 读本机会话记录（~/.codex/sessions，不跑任务也能读） ----------
  settings.quota = typeof settings.quota === 'object' && settings.quota ? settings.quota : {};
  function onQuota(engine, q) {
    const old = settings.quota[engine] || {};
    settings.quota[engine] = q;
    if (old.pct !== q.pct || old.status !== q.status || old.resetsAt !== q.resetsAt) save();
  }
  let codexQ = { at: 0, v: null };
  function codexQuota() {
    if (Date.now() - codexQ.at < 15000) return codexQ.v;
    codexQ = { at: Date.now(), v: null };
    try {
      const home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), num = d => { try { return fs.readdirSync(d).filter(n => /^\d+$/.test(n)).sort().reverse(); } catch { return []; } };
      // 最近几天的会话记录，从新到旧找最近一条带额度的（刚开的会话里可能还没有）
      const files = [];
      for (const y of num(path.join(home, 'sessions')).slice(0, 2)) for (const m of num(path.join(home, 'sessions', y)).slice(0, 2)) for (const d of num(path.join(home, 'sessions', y, m)).slice(0, 3)) {
        const dir = path.join(home, 'sessions', y, m, d);
        for (const n of fs.readdirSync(dir)) if (n.endsWith('.jsonl')) files.push(path.join(dir, n));
      }
      files.sort((x, z) => fs.statSync(z).mtimeMs - fs.statSync(x).mtimeMs);
      for (const file of files.slice(0, 10)) {
        const size = fs.statSync(file).size, fd = fs.openSync(file, 'r'), n = Math.min(size, 400000), buf = Buffer.alloc(n);
        fs.readSync(fd, buf, 0, n, size - n); fs.closeSync(fd);
        const lines = buf.toString('utf8').split('\n').filter(l => l.includes('"rate_limits"'));
        for (let i = lines.length - 1; i >= 0; i--) {
          let o; try { o = JSON.parse(lines[i]); } catch { continue; }
          const rl = (o.payload && o.payload.rate_limits) || o.rate_limits; if (!rl) continue;
          const w = [rl.primary, rl.secondary].find(x => x && x.window_minutes === 300); if (!w) return null;
          const pct = Math.round(w.used_percent);
          codexQ.v = { status: pct >= 100 ? 'limit' : pct >= 80 ? 'warn' : 'ok', pct, resetsAt: w.resets_at ? w.resets_at * 1000 : null, at: Date.parse(o.timestamp) || fs.statSync(file).mtimeMs };
          return codexQ.v;
        }
      }
    } catch {}
    return null;
  }
  const quotaAll = () => { const c = found.codex && found.codex.bin ? codexQuota() : null; return { ...settings.quota, ...(c ? { codex: c } : {}) }; };

  // MinerU（内容 1.2.3）：「读文献 → MinerU」是本机任务，POPPER 自己转 PDF，不交给 AI
  const mineru = createMineru({ projects, custom: () => settings.mineruBin || '' }); // mineruBin：自动找不到时学员手动指的 mineru-kit
  // 待办（内容 1.3.3，见 todos.cjs）：所有项目的待办放一起，右栏 AI 下面
  let remote = null, deskSeen = 0;
  const remoteActs = []; // 手机上点了「开始」、要电脑窗口来做的工作流阶段
  const actResults = new Map(); // 窗口回报的结果：key → { run, at }
  const todos = createTodos({ dataDir, projects, getRun: id => tasks.get(id), createRun: (...a) => createRun(...a), inbox: () => { const ib = projects.inbox(); return ib && ib.exists ? ib : null; } });
  const tasks = createTasks({ ENGINES, found, projects, runsDir, settings, onQuota, ready, isOn, locals: { mineru: mineru.local },
    wrap: (run, text) => wrapPrompt(projects.get(run.project), run.workflow ? workflowById(run.workflow) : null, text), onTurnEnd: run => remote && remote.notify(run) });
  // 新建任务：在项目文件夹里、用这个项目选的 AI 跑。workflow 有值时，先给指令加上项目信息
  // 同一步不重复开（内容 1.4.1，第 4 讲当众答应 T1）：这一步还没结束（排队、在跑、等你回复）就不新开，告诉界面是哪个任务。
  // 「同一步」= 同一个工作流里同名的任务（一键跑完在跑时，这个工作流的哪一步都不再单开）；工具 = 同一个工具、拼出来的指令一字不差
  const LIVE = ['queued', 'running', 'stopping', 'waiting'];
  const liveTwin = (pid, same) => tasks.list(pid).find(r => LIVE.includes(r.status) && same(r));
  const busyErr = r => ({ status: 409, data: { error: `这一步正在跑：「${r.title}」${r.status === 'waiting' ? '在等你回复' : r.status === 'queued' ? '在排队' : ''}。要重开，先在右栏把它结束`, busy: r.id, busyProject: r.project, title: r.title } });
  function createRun({ project, prompt, workflow, title, free, tool, values, pins, force, chain, engine, files }) {
    const p = projects.get(project);
    if (!p || !p.exists) return err(400, '项目文件夹找不到了');
    // 收件箱只用来梳理（内容 1.4.1，T4）：工具、工作流都要在项目里跑。梳理、安装、待办这些 POPPER 自己开的任务不走这里，照常
    if (p.inbox && (tool || workflow || Array.isArray(chain))) return err(400, '收件箱只用来梳理文件：先建一个项目或选一个项目，再用工具、跑工作流');
    // 自动模式（一键跑完整个工作流）：一串阶段，先开第一个，其余跟在它后面，上一个做完才开下一个（见 tasks.cjs）
    if (Array.isArray(chain)) {
      const w = workflowById(workflow);
      if (!w) return err(400, '没有这个工作流');
      if (chain.length > MAX_CHAIN) return err(400, `自动模式最多 ${MAX_CHAIN} 段，交来了 ${chain.length} 段`);
      // 每段可以指定 AI（多 agent 第 2 层，内容 1.3.0）：没指定的用项目的；指定的必须启用了、找到了。模型：是项目的 AI 就用项目选的，别的用它的默认
      const projEngine = engineOf(p), modelFor = e => (e === p.engine && p.model) || settings.model[e] || '';
      const steps = chain.filter(x => x && String(x.text || '').trim()).map(x => ({ title: (w.name + ' · ' + String(x.title || '').trim()).slice(0, 60), text: String(x.text), engine: String(x.engine || '') || projEngine }));
      if (!steps.length) return err(400, '指令是空的');
      const twin = liveTwin(p.id, r => r.workflow === w.id && (r.auto || steps.some(x => x.title === r.title)));
      if (twin) return busyErr(twin);
      for (const x of steps) {
        if (!ENGINES[x.engine] || !isOn(x.engine)) return err(400, `「${x.title}」指定的 AI（${ENGINES[x.engine]?.name || x.engine}）没有启用：先在「${CFG}」里启用它，或者换一个`);
        if (!found[x.engine] || !found[x.engine].bin) return err(409, `「${x.title}」指定的 ${ENGINES[x.engine].name} 在这台电脑上没找到：${found[x.engine]?.info.missingHint || ''}`);
        x.model = modelFor(x.engine);
      }
      // 开始前一次查清：每个 AI 查它负责的那几段要的 skill；有风险说明的 AI 先确认（不然跑到那一段才卡住）
      const used = [...new Set(steps.map(x => x.engine))];
      const ack = used.find(e => found[e].info.riskNotice && !settings.ack[e]);
      if (ack) return err(409, found[ack].info.riskNotice, { riskAck: ack });
      const byEngine = force ? [] : used.map(e => ({ engine: e, skills: missingSkills(e, p.path, mentioned([].concat(w.skills || []).map(String), steps.filter(x => x.engine === e).map(x => x.text).join('\n'))) })).filter(x => x.skills.length);
      if (byEngine.length) { const miss = [...new Set(byEngine.flatMap(x => x.skills))]; return { status: 409, data: { error: '缺少 skill：' + miss.join('、'), missingSkills: miss, engine: byEngine[0].engine, byEngine } }; }
      try {
        const [first, ...rest] = steps;
        const run = tasks.create({ project: p.id, prompt: wrapPrompt(p, w, first.text), title: first.title, workflow: w.id, workflowVersion: w.version,
          engine: first.engine, model: first.model, auto: true, chain: { i: 1, n: steps.length, engines: steps.map(x => x.engine) }, chainRest: rest });
        return { status: 201, data: tasks.pub(run) };
      } catch (e) { return err(e.status || 400, e.message, e.riskAck && { riskAck: e.riskAck }); }
    }
    if (tool) { // 工具：指令由工作站按工具清单拼出来
      const t = listTools().find(x => x.id === tool);
      if (!t) return err(400, '没有这个工具');
      if (t.local === 'mineru') { // 本机任务：不拼指令、不查 skill，交给 POPPER 自己做
        const list = [...new Set((Array.isArray(files) ? files : []).map(String))].filter(f => /\.pdf$/i.test(f));
        if (!list.length) return err(400, '先选要转的 PDF');
        for (const f of list) { try { inProject(p.id, f); } catch (e) { return err(400, e.message); } }
        if (mineru.checking()) return err(409, '正在检测电脑上的 MinerU，过几秒再点一次');
        const ms = mineru.status();
        if (ms.problem === 'old') return err(409, `电脑上的 MinerU 是 ${ms.version}，太旧了（要 4.0 以上）：打开「${CFG}」看怎么升级`);
        if (!mineru.usable()) return err(409, `这台电脑上没找到能用的 MinerU：打开「${CFG}」看怎么装`);
        try {
          const run = tasks.create({ project: p.id, title: `MinerU · 转 ${list.length} 篇 PDF`, tool: t.id, toolVersion: t.version, local: { kind: 'mineru', files: list, tier: mineru.tier() },
            prompt: `MinerU 把这些 PDF 转成带页码的文字稿，放 文献/全文/（${APP} 在电脑上自己转，不经过 AI）：\n${list.map(f => '- ' + f).join('\n')}` });
          return { status: 201, data: tasks.pub(run) };
        } catch (e) { return err(e.status || 400, e.message); }
      }
      let built; try { built = toolPrompt(t, values, pins); } catch (e) { return err(400, e.message); }
      const sig = crypto.createHash('sha1').update(built.text).digest('hex').slice(0, 16), twin = liveTwin(p.id, r => r.tool === t.id && r.sig === sig);
      if (twin) return busyErr(twin);
      if (t.catalog) { try { writeToolCatalog(p); } catch (e) { return err(500, '写已装工具清单没成功：' + e.message); } }
      const engineId = engineOf(p);
      const miss = force ? [] : missingSkills(engineId, p.path, [].concat(t.skills || []));
      if (miss.length) return { status: 409, data: { error: '缺少 skill：' + miss.join('、'), missingSkills: miss, engine: engineId } };
      try {
        const run = tasks.create({ project: p.id, prompt: wrapPrompt(p, { name: t.name, version: t.version, kind: '工具' }, built.text), title: built.title,
          tool: t.id, toolVersion: t.version, engine: engineId, model: p.model || settings.model[engineId] || '' });
        run.sig = sig;
        return { status: 201, data: tasks.pub(run) };
      } catch (e) { return err(e.status || 400, e.message, e.riskAck && { riskAck: e.riskAck }); }
    }
    if (!prompt || !String(prompt).trim()) return err(400, '指令是空的');
    const w = workflow ? workflowById(workflow) : null;
    if (workflow && !w) return err(400, '没有这个工作流');
    const engineId = engine && ENGINES[engine] && isOn(engine) ? engine : engineOf(p); // engine：「安装」指定装进哪个 AI 程序
    const miss = force || !w ? [] : missingSkills(engineId, p.path, mentioned([].concat(w.skills || []).map(String), String(prompt)));
    if (miss.length) return { status: 409, data: { error: '缺少 skill：' + miss.join('、'), missingSkills: miss, engine: engineId } };
    const name = (String(title || '').trim() || String(prompt).trim().split('\n')[0]).slice(0, 50), fullTitle = (w && !name.startsWith(w.name) ? w.name + ' · ' : '') + name;
    const twin = w && liveTwin(p.id, r => r.workflow === w.id && (r.auto || r.title === fullTitle));
    if (twin) return busyErr(twin);
    try {
      const run = tasks.create({ project: p.id, prompt: (w || free) ? wrapPrompt(p, w, String(prompt)) : String(prompt),
        title: fullTitle, workflow: w ? w.id : '', workflowVersion: w ? w.version : '',
        engine: engineId, model: p.model || settings.model[engineId] || '' });
      return { status: 201, data: tasks.pub(run) };
    } catch (e) { return err(e.status || 400, e.message, e.riskAck && { riskAck: e.riskAck }); }
  }

  // ---------- 配置页（10-14 试用反馈第 11 条）：我的 skills 库装没装；装不上时给「复制安装指令」 ----------
  // 「安装」一次只装进一个 AI 程序（乔淼 10-21：缺哪边点哪边，分两次装）：POPPER 只放行这个 AI 写自己的 skills 文件夹，
  // 交给 AI 之前先把文件夹建好（新电脑上多半还没有，没有就不放行）。装不进去时，任务卡片上能复制指令，拿到客户端里手动装
  // skills 装到哪、客户端怎么打开、MCP 服务配在哪：都在各 AI 程序自己的文件里（engine-*.cjs，内容 1.2.0 起）
  const skillDirAbs = id => (ENGINES[id] && ENGINES[id].skillsHome ? ENGINES[id] : ENGINES.claude).skillsHome();
  const STUCK = e => `\n\n如果因为权限、沙箱或网络装不进去，不要换别的办法硬装，最后一段以「装不进去：」开头，写清楚卡在哪一步、要运行的命令是什么（我可以自己在终端里运行，或者拿到 ${e.name} 客户端里手动装）。`;
  const INSTALL = {
    course: { title: '安装我的 skills 库', skills: true, text: (dir, e) => {
      let src; try { src = parseSkillsSource(settings.skillsSource); } catch (err) { return `（${err.message}）`; }
      return `请把我的 skills 库安装到我的电脑上：${src.kind === 'github' ? `GitHub 仓库 ${src.page}（用 git clone 拉到一个临时文件夹；没有 git 就下载 ${src.url} 这个 zip 包解压）` : `下载 ${src.url} 这个压缩包，解压到一个临时文件夹`}。

1. 找出里面的全部 skill（每个是一个含 SKILL.md 的文件夹）。
2. 逐个放进 ${dir}（没有就先建好）。只装这一个文件夹，别的 AI 程序的 skills 文件夹不要动。
3. 同名 skill 已存在时用新版覆盖，覆盖前先把旧的整个文件夹备份到当前文件夹下的 .工作站/skills备份/<今天日期>/ 里。
4. 装完删掉临时文件夹，列出装好的 skill 数量、备份了哪些。`; } },
  };
  const installText = (what, engineId) => { const e = ENGINES[engineId] && ENGINES[engineId].skillsHome ? ENGINES[engineId] : ENGINES.claude; return INSTALL[what].text(e.skillsHomeLabel, e) + STUCK(e); };

  // ---------- 我的 skills 库：自己装，不经过 AI（乔淼 10-21：Windows 上 AI 装不了——没有 git、
  // 旧版 PowerShell 下载 GitHub 断连、清理命令被拦）。下载压缩包 → 系统自带 tar 解压（Mac、Windows 10 起都有）→
  // 找出含 SKILL.md 的文件夹 → 同名的先备份到收件箱 .工作站/skills备份/<日期>/<AI 程序>/ → 复制进这个 AI 程序的 skills 文件夹 ----------
  const tarBin = () => {
    if (!common.WIN) return 'tar';
    const sys = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'); // 用 Windows 自带的 bsdtar，不用 Git 带的 GNU tar（解不了 zip）
    return fs.existsSync(sys) ? sys : 'tar.exe';
  };
  function findSkillDirs(root, depth = 0, out = []) {
    let names = []; try { names = fs.readdirSync(root, { withFileTypes: true }); } catch { return out; }
    if (depth > 0 && names.some(d => d.isFile() && d.name === 'SKILL.md')) { out.push(root); return out; }
    if (depth >= 5) return out;
    for (const d of names) if (d.isDirectory() && d.name !== 'node_modules' && d.name !== '.git') findSkillDirs(path.join(root, d.name), depth + 1, out);
    return out;
  }
  const storage = createStorage({ dataDir, projectDirs: () => projects.list().filter(p => p.exists).map(p => p.path) });
  const extract = (file, dir) => {
    fs.mkdirSync(dir, { recursive: true });
    const x = require('node:child_process').spawnSync(tarBin(), ['-xf', file, '-C', dir], { windowsHide: true, encoding: 'utf8' });
    if (x.status !== 0) throw Error('解压失败：' + ((x.stderr || '') + (x.error ? x.error.message : '')).trim().slice(0, 200));
  };
  // 从 GitHub 装的第三方 skills（内容 1.3.6，见 github-skills.cjs）：装进启用着的 AI 程序；同名旧版备份到和课程 skills 同一个地方
  const ghEngines = () => Object.keys(BASE_ENGINES).filter(id => isOn(id) && BASE_ENGINES[id].skillsHome).map(id => ({ id, name: BASE_ENGINES[id].name, dir: BASE_ENGINES[id].skillsHome() }));
  const gh = createGhSkills({ dataDir, engines: ghEngines, courseSkills: { has: n => COURSE_SKILLS.has(n) || /^topic-/.test(n) }, extract, trash,
    backupDir: engineId => { const inbox = projects.list().find(x => x.inbox); return path.join(inbox ? inbox.path : dataDir, '.工作站', 'skills备份', new Date().toISOString().slice(0, 10), engineId); },
    tools: { list: listTools, save: t => saveUserTool(t, ''), remove: removeUserTool } });
  // 「我的 skills 库」：从学员自己设置的地址下载（GitHub 仓库或压缩包网址），不验签名
  async function installSkills(engineId) {
    const target = skillDirAbs(engineId);
    const inbox = projects.list().find(x => x.inbox);
    const day = new Date().toISOString().slice(0, 10);
    const backupRoot = path.join(inbox ? inbox.path : dataDir, '.工作站', 'skills备份', day, engineId);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'popper-skills-'));
    const result = { engine: engineId, target, installed: [], backedUp: [], errors: [] };
    try {
      fs.mkdirSync(target, { recursive: true });
      const pkgs = []; // [名字, 解开后的文件夹]
      try {
        const src = parseSkillsSource(settings.skillsSource);
        const r = await fetch(src.url, { signal: AbortSignal.timeout(120000), headers: { 'User-Agent': 'POPPER-Framework' } });
        if (!r.ok) throw Error(`下载失败（${r.status}）${src.kind === 'github' ? '：仓库要是公开的' : '：文件要设成公开读'}`);
        const file = path.join(tmp, 'mylib' + src.ext);
        fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
        extract(file, path.join(tmp, 'mylib'));
        pkgs.push([src.label, path.join(tmp, 'mylib')]); result.from = src.label;
      } catch (e) { result.errors.push(e.name === 'TimeoutError' ? '下载超时' : e.message); }
      for (const [repo, dir] of pkgs) {
        try {
          const found = findSkillDirs(dir);
          if (!found.length) throw Error('压缩包里没找到 skill');
          for (const src of found) {
            const name = path.basename(src), dest = path.join(target, name);
            if (fs.existsSync(dest)) { fs.mkdirSync(backupRoot, { recursive: true }); fs.cpSync(dest, path.join(backupRoot, name), { recursive: true }); fs.rmSync(dest, { recursive: true, force: true }); result.backedUp.push(name); }
            fs.cpSync(src, dest, { recursive: true });
            result.installed.push(name);
          }
          // 我的 skills 库装好了：在 skills 文件夹里记下是哪一版（包里或仓库里的 version.json，没有就不写版本）
          const vf = [path.join(dir, 'version.json'), ...fs.readdirSync(dir).map(d => path.join(dir, d, 'version.json'))].find(f => fs.existsSync(f));
          let meta = {}; try { meta = vf ? JSON.parse(fs.readFileSync(vf, 'utf8')) : {}; } catch {}
          writeMark(target, { version: meta.version || null, installedAt: new Date().toISOString(), skills: Array.isArray(meta.skills) ? meta.skills : found.map(f => path.basename(f)).sort(), from: result.from || '' });
          result.version = meta.version || null;
        } catch (e) { result.errors.push(`${repo}：${e.message}`); }
      }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    if (result.backedUp.length) result.backupDir = backupRoot;
    await detectAll(); // 重新数一下装了哪些
    return result;
  }

  // ---------- 改文件：先把原文件备份到项目的 .工作站/历史/，再交给这个项目的 AI（「交给 AI 改」和 Roughdraft 批注共用） ----------
  function reviseFile(project, rel, full, title, prompt) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const hist = path.join(projects.get(project).path, '.工作站', '历史');
    fs.mkdirSync(hist, { recursive: true });
    const backup = path.join(hist, `${stamp}-${path.basename(full)}`);
    fs.copyFileSync(full, backup);
    return createRun({ project, free: true, title, prompt: prompt(path.basename(backup)) });
  }

  // ---------- Roughdraft（10-23 乔淼）：md 文件在 Roughdraft 里批注，点了「Approve」 自动交给 AI 按批注改 ----------
  // 只在装了 roughdraft 命令的电脑上出按钮。打开用 roughdraft open <文件> --no-watch（它自己开浏览器、不等），
  // 再在后台跑 roughdraft watch <文件> --json 等「批完了」（Roughdraft 右上角的 Approve / I'm done，旧版叫 Done Reviewing）；那时文件里有 CriticMarkup 批注，就开一个「按批注改」任务
  // npm i -g 装的程序放在哪：Homebrew / 官网安装包的 node 在 /opt/homebrew/bin、/usr/local/bin；nvm 在 ~/.nvm/versions/node/<版本>/bin；Windows 在 %APPDATA%\\npm
  function findRoughdraft() {
    const home = os.homedir(), nvm = path.join(home, '.nvm', 'versions', 'node');
    let nvmDirs = []; try { nvmDirs = fs.readdirSync(nvm).sort().reverse().map(v => path.join(nvm, v, 'bin')); } catch {}
    const dirs = [...common.pathDirs(), '/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.local', 'bin'), path.join(home, '.npm-global', 'bin'), path.join(home, '.volta', 'bin'), ...nvmDirs,
      ...(common.WIN ? [path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'npm')] : [])];
    for (const d of dirs) for (const n of common.WIN ? ['roughdraft.cmd', 'roughdraft.exe'] : ['roughdraft']) if (fs.existsSync(path.join(d, n))) return path.join(d, n);
    return '';
  }
  let roughdraftBin = findRoughdraft();
  // 配置里「怎么装」的弹窗（10-23 乔淼：学员不知道怎么装）。官方装法是 npm i -g roughdraft（roughdraft.md/setup.md），要先有 Node.js
  const ROUGHDRAFT_INSTALL = {
    note: `Roughdraft 是一个免费、开源的 Markdown 批注工具，在浏览器里用。装好后，${APP} 里打开 md 文件，右上角多一个笔形按钮：点了在浏览器里批注，批完点「Approve」（改过字是「I'm done」），自动交给 AI 按批注改。它要用 Node.js：先在${common.WIN ? ' PowerShell ' : '终端'}里输入 node -v 回车，出来版本号就是有了；没有的话先装 Node.js（${common.WIN ? '在 PowerShell 里运行 winget install OpenJS.NodeJS.LTS' : '有 Homebrew 就运行 brew install node'}，或者去 nodejs.org 下载 LTS 版安装包），装完关掉${common.WIN ? ' PowerShell ' : '终端'}再开一个。`,
    shell: common.WIN ? 'PowerShell' : '终端',
    open: common.WIN ? '点开始菜单，搜「PowerShell」，打开它' : '按 ⌘ + 空格，搜「终端」，打开它',
    cmd: 'npm i -g roughdraft',
    login: common.WIN ? '装完输入 roughdraft help 回车，出来一段英文说明就装好了。' : '装完输入 roughdraft help 回车，出来一段英文说明就装好了。提示没有权限（EACCES）的话，在命令前面加 sudo 再运行一次，输入开机密码（输入时不显示）。'
  };
  const rdWatch = new Map(); // 文件绝对路径 → 正在等「批完了」（Roughdraft 右上角的 Approve / I'm done，旧版叫 Done Reviewing） 的 watch 进程
  // 每个文件批注到哪一步了（10-24 乔淼：批完网页关了，任务其实开在那个项目里，她没看到）。界面点了笔之后来问，开了任务就跳过去
  const rdState = new Map(); // 文件绝对路径 → { status: watching / started / nothing / failed, runId, project, msg }
  const CRITIC = /\{>>[\s\S]*?<<\}|\{\+\+[\s\S]*?\+\+\}|\{--[\s\S]*?--\}|\{~~[\s\S]*?~~\}|\{==[\s\S]*?==\}/;
  // Windows 上 roughdraft 是 .cmd，要经过 shell，路径里有空格得自己加引号
  const rdSpawn = (args, opts = {}) => require('node:child_process').spawn(common.WIN ? `"${roughdraftBin}"` : roughdraftBin, common.WIN ? args.map(a => a.startsWith('--') ? a : `"${a}"`) : args, { windowsHide: true, shell: common.WIN,
    env: { ...process.env, PATH: [path.dirname(roughdraftBin), process.env.PATH || ''].join(path.delimiter) }, ...opts }); // roughdraft 是 node 脚本：它旁边一般就有 node
  const critiquePrompt = rel => backup => `要修改的文件：${rel}
我在 Roughdraft 里用 CriticMarkup 批注了这份文件，请按批注改：
- {>>评论<<}（后面可能跟一个 {id=… by=… at=…} 属性块）是我的修改意见，前面紧挨着的 {==高亮==} 是它针对的那段；
- {++新增++}、{--删除--}、{~~旧~>新~~} 是我直接动手改的，照着接受。
逐条处理，直接改原文件；处理完把批注标记和属性块都去掉，留下干净的正文。只改批注涉及的部分，其余保持原样，不要改文件名和格式。
拿不准的批注不要硬改：保留那一条评论，在回复里问我。原文件已经备份到 .工作站/历史/${backup}，不用你再备份。
最后列一个表：批注（摘一句）| 怎么处理的。`;
  function roughdraftOpen(project, rel) {
    if (!roughdraftBin) throw Object.assign(Error('这台电脑上没找到 Roughdraft'), { status: 404 });
    const full = inProject(project, rel);
    if (!/\.(md|markdown)$/i.test(full)) throw Error('Roughdraft 只能打开 Markdown（.md）文件');
    if (!fs.existsSync(full)) throw Object.assign(Error('没有这个文件'), { status: 404 });
    rdSpawn(['open', full, '--no-watch'], { stdio: 'ignore' }).on('error', () => {});
    rdState.set(full, { status: 'watching', project });
    if (rdWatch.has(full)) return { watching: true };
    const child = rdSpawn(['watch', full, '--json'], { stdio: ['ignore', 'pipe', 'ignore'] });
    rdWatch.set(full, child);
    child.on('error', () => rdWatch.delete(full));
    child.on('close', code => {
      if (rdWatch.get(full) === child) rdWatch.delete(full);
      if (code !== 0) return rdState.set(full, { status: 'failed', project, msg: 'Roughdraft 那边断开了，没收到「批完了」。再点一次笔形按钮重新打开就行' }); // 被停掉、超时、出错
      let text = ''; try { text = fs.readFileSync(full, 'utf8'); } catch { return; }
      if (!CRITIC.test(text)) { rdState.set(full, { status: 'nothing', project }); return k.log && k.log(`Roughdraft：${rel} 批完没有批注，不开任务`); }
      const r = reviseFile(project, rel, full, '按批注改：' + path.basename(full), critiquePrompt(rel));
      if (r.status >= 400) { rdState.set(full, { status: 'failed', project, msg: '按批注改没排上：' + r.data.error }); if (k.log) k.log(`Roughdraft：${rel} 按批注改没排上：${r.data.error}`); }
      else rdState.set(full, { status: 'started', project, runId: r.data.id, engine: r.data.engine, queued: r.data.status === 'queued' });
    });
    return { watching: true };
  }

  async function envCheck() {
    const engines = Object.keys(BASE_ENGINES).map(id => {
      if (!isOn(id)) return { id, name: BASE_ENGINES[id].name, enabled: false, found: false }; // 没启用的不检查
      const e = BASE_ENGINES[id], f = found[id] || {}, info = f.info || {}, all = new Set(info.version ? allSkills(id, dataDir) : []);
      return { id, name: e.name, found: !!info.version, version: info.version || '', where: info.where || '', path: info.path || '', missingHint: e.missingHint,
        model: info.model || (info.defaults || {}).model || '', effort: (info.defaults || {}).effort || '',
        // 我的 skills 库：按装的那一次记下的名单看缺哪些（没装过就是空的）
        course: (() => { const m = readMark(skillDirAbs(id)), list = m && Array.isArray(m.skills) ? m.skills : [];
          return { installed: !!m, total: list.length, missing: list.filter(n => !all.has(n)), version: (m && m.version) || null }; })(), enabled: true };
    });
    roughdraftBin = findRoughdraft(); // 装完回来点「重新检测」或重开配置就能找到，md 文件的笔形按钮跟着出来
    const mu = await mineru.recheck();
    return { engines, skillsLatest: { source: settings.skillsSource || '' }, roughdraft: { path: roughdraftBin, install: ROUGHDRAFT_INSTALL }, mineru: mu };
  }
  // 配置指南：content/配置指南.md（内核不直接送 .md，经接口给界面）。里面写的「My App」换成这个 App 的名字
  const guideText = () => { try { return fs.readFileSync(path.join(contentDir, '配置指南.md'), 'utf8').replaceAll('My App', APP); } catch { return '# 配置指南\n\n（没找到指南文件）'; } };

  const config = () => ({
    platform: k.platform, dev: !!k.dev, busy: tasks.isBusy(), engine: settings.engine,
    engines: Object.keys(ENGINES).map(id => found[id].info),
    workflows: listWorkflows().map(publicWorkflow), tools: listTools().map(publicTool),
    projects: projectSummary(), current: projects.current()?.id || null,
    projectsDir: defaultProjectsDir, langs: LANGS, mineru: mineru.usable(), // 装好了能用的 MinerU（首页「下一步」要不要提它）
    selfUse: false, // 项目类型（学员交付 / 公众号 / 备课）是乔淼自用的，框架里不出
    parallel: Number.isInteger(settings.parallel) ? settings.parallel : 3, // 同一个项目最多同时跑几个任务（内容 1.3.9）
    writeDirs: settings.writeDirs, canQuit: typeof hooks.quit === 'function', agentName: settings.agentName || AGENT, quota: quotaAll(), roughdraft: !!roughdraftBin,
    pinnedTools: (settings.pinnedTools || []).filter(id => listTools().some(t => t.id === id))
  });
  const ok = data => ({ status: 200, data }), err = (status, error, extra) => ({ status, data: { error, ...(extra || {}) } });

  async function handle({ method, route, body }) {
    if (route === 'config' && method === 'GET') return ok(config());
    // 国内更新的状态和「检查更新」（外壳的 update* 接口内核自己接走了，这里用另外的名字）
    // 刚启动、AI 程序还在检测：要用到它的接口（交任务、重试回复、环境配置、换 AI / 模型、技能清单、梳理收件箱、交给 AI 改）等它查完（通常不到一秒）；
    // 看项目、看文件、看任务列表这些不等，免得某个程序卡住时整个界面都等
    if (detecting && (/^(runs$|runs\/|env|engine|model|recheck|skills|inbox\/(triage|apply)|todos\/(start|split)|files\/revise)/.test(route) && !(route === 'runs' && method === 'GET'))) await detecting;
    if (route === 'recheck' && method === 'POST') { roughdraftBin = findRoughdraft(); mineru.recheck(); await detectAll(); return ok(config()); }
    if (route === 'env' && method === 'GET') return ok(await envCheck());
    if (route === 'env/guide' && method === 'GET') return ok({ text: guideText() });
    // 空间占用（10-23）：点了才算（文件多时要几秒）；清理只移进废纸篓 / 回收站
    if (route === 'storage' && method === 'GET') return ok(await storage.report());
    if (route === 'storage/clean' && method === 'POST') { try { return ok(storage.clean(String(body.id || ''))); } catch (e) { return err(e.status || 400, e.message); } }
    if (route === 'env/writedirs' && method === 'POST') {
      const home = require('node:os').homedir(), out = [];
      for (const raw of (Array.isArray(body.dirs) ? body.dirs : []).slice(0, 10)) {
        const d = path.resolve(String(raw || '').trim().replace(/^~(?=$|\/)/, home));
        if (!String(raw || '').trim()) continue;
        if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) return err(400, `没有这个文件夹：${raw}`);
        if (d === path.parse(d).root || d === home || home.startsWith(d + path.sep)) return err(400, '不能放开整个硬盘或整个个人文件夹，请选一个具体的文件夹');
        if (d === dataDir || d.startsWith(dataDir + path.sep) || dataDir.startsWith(d + path.sep)) return err(400, `这个文件夹里有 ${APP} 自己的数据，不能放开`);
        if (!out.includes(d)) out.push(d);
      }
      settings.writeDirs = out; save();
      return ok({ writeDirs: out });
    }
    // 同一个项目最多同时跑几个任务（内容 1.3.9，乔淼 10-27：做成设置，默认 3）；改小了不停在跑的，只是后面的多排一会儿
    if (route === 'env/parallel' && method === 'POST') {
      const n = Number(body.n); if (!Number.isInteger(n) || n < 1 || n > 5) return err(400, '只能是 1 到 5');
      settings.parallel = n; save(); tasks.kick(); return ok(config());
    }
    if (route === 'env/install' && method === 'POST') {
      const it = INSTALL[body.what]; if (!it) return err(400, '没有这一项');
      const inbox = projects.list().find(x => x.inbox); if (!inbox) return err(400, '找不到收件箱');
      const engineId = BASE_ENGINES[body.engine] && isOn(body.engine) ? body.engine : engineOf(inbox);
      if (it.skills) try { fs.mkdirSync(skillDirAbs(engineId), { recursive: true }); } catch {}
      const names = { claude: 'Claude Code', codex: 'Codex' };
      return createRun({ project: inbox.id, prompt: installText(body.what, engineId), free: true, engine: engineId,
        title: '环境配置 · ' + it.title + (it.skills || body.engine ? ' · ' + (names[engineId] || engineId) : '') });
    }
    if (route === 'env/skills-source' && method === 'POST') {
      const v = String(body.source || '').trim();
      if (v) try { parseSkillsSource(v); } catch (e) { return err(400, e.message); }
      settings.skillsSource = v; save();
      return ok({ source: v });
    }
    if (route === 'env/install-skills' && method === 'POST') {
      if (body.what !== 'course') return err(400, '没有这一项');
      if (!BASE_ENGINES[body.engine] || !isOn(body.engine)) return err(400, '没有这个 AI 程序，或者它没有启用');
      return ok({ ...(await installSkills(body.engine)), config: config() });
    }
    // 「复制指令」：手动拿到 Claude Code / Codex 客户端里装
    if (route === 'env/install-text' && method === 'GET') {
      if (!INSTALL[body.what]) return err(400, '没有这一项');
      return ok({ text: installText(body.what, BASE_ENGINES[body.engine] ? body.engine : settings.engine) });
    }
    if (route === 'skills/all' && method === 'GET') { const p = projects.get(body.project); return ok(skillCatalog(p && p.exists ? p.path : '')); }
    if (route === 'skills' && method === 'GET') { const p = projects.get(body.project); return ok(p && p.exists ? installedSkills(engineOf(p), p.path) : []); }
    // 双击脚本版在后台跑，界面上要能退出（App 关窗就退出，没有这个钩子）
    if (route === 'quit' && method === 'POST') {
      if (typeof hooks.quit !== 'function') return err(400, '这里不能退出');
      setTimeout(() => { try { tasks.stopAll(); for (const c of rdWatch.values()) try { c.kill(); } catch {} } finally { hooks.quit(); } }, 200); // Roughdraft 的等待进程也停掉
      return ok({});
    }
    // ----- 工作流 -----
    if (route === 'workflows' && method === 'GET') return ok(listWorkflows().map(publicWorkflow));
    if (route === 'workflows/import' && method === 'POST') {
      try { const r = importWorkflow(body); return r.needReplace ? { status: 409, data: { ...r, error: `已经导入过「${r.name}」` } } : ok({ ...config(), ...r }); }
      catch (e) { return err(400, e.message); }
    }
    // ----- 用户自己的工具（10-18）：保存（新建 / 改）、导入、取原文件（编辑、导出）、移除（挪进 工具/.已移除/） -----
    if (route === 'tools/save' && method === 'POST') { try { const c = saveUserTool(body.tool, body.id || ''); return ok({ ...config(), saved: c.标识 }); } catch (e) { return err(400, e.message); } }
    // 导入工具（内容 1.3.8 起工具文件里可以附带 skill）：第一次收到带「附带skill」的，先解开比对、回清单让学员确认（needInstall）；
    // 确认后带 install（id、engineIds、overwrite）再来一次，先装 skill 再存工具；install: false = 只导入工具
    if (route === 'tools/import' && method === 'POST') {
      try {
        let t; try { t = JSON.parse(String(body.json || '')); } catch { throw Error('这不是一个工具文件（.json 读不出来）'); }
        if (t && t['类型'] && t['类型'] !== '工具') throw Error('这不是一个工具文件');
        const same = listTools().find(x => x.source === '我的' && x.name === String(t['名称'] || '').trim());
        if (same && !body.replace) return { status: 409, data: { needReplace: true, name: same.name, error: `已经有「${same.name}」了` } };
        const bundle = Array.isArray(t['附带skill']) && t['附带skill'].length ? t['附带skill'] : null;
        let installed = null;
        if (bundle && body.install === undefined) {
          const r = await gh.load({ bundle, bundleName: String(t['名称'] || '').trim() });
          // 都已经装好、一模一样（或和课程同名不装）：不用问，直接导入工具
          if (r.skills.every(k => Object.values(k.where).every(w => w === 'identical' || w === 'course'))) gh.drop(r.id);
          else return ok({ needInstall: true, toolName: String(t['名称'] || ''), ...r });
        }
        if (bundle && body.install) {
          const i = body.install, x = gh.status(i.id);
          installed = gh.install({ id: i.id, names: x.skills.map(k => k.name), engineIds: i.engineIds, overwrite: i.overwrite, makeTools: false });
          gh.drop(i.id); await detectAll();
        } else if (body.install === false && body.id) gh.drop(body.id);
        const c = saveUserTool({ ...t, 标识: same ? same.id : t['标识'] }, same ? same.id : '');
        return ok({ ...config(), saved: c.标识, replaced: !!same, installed });
      } catch (e) { return err(400, e.message); }
    }
    // 导出工具（内容 1.3.8）：pack 先看能带哪些 skill（不读内容）；export 带 pack=1 就把 skill 文件一起放进「附带skill」
    if (route === 'tools/pack' && method === 'GET') {
      const x = listTools().find(t => t.id === body.id && t.source === '我的'); if (!x) return err(404, '只能导出自己加的工具');
      return ok(gh.pack(x.skills, { dryRun: true }));
    }
    if (route === 'tools/export' && method === 'GET') {
      const x = listTools().find(t => t.id === body.id && t.source === '我的'); if (!x) return err(404, '只能导出自己加的工具');
      const raw = readJSON(x.file, {});
      if (body.pack !== '1') return ok(raw);
      const p = gh.pack(x.skills);
      if (p.tooBig) return err(400, `附带的 skill 太大（${Math.round(p.size / 1048576)} MB，最多 20 MB），请只导出工具，让学员另外装 skill`);
      return ok({ ...raw, ...(p.skills.length ? { 附带skill: p.skills.map(k => ({ 名称: k.name, 文件: k.文件 })) } : {}) });
    }
    if (route === 'tools/raw' && method === 'GET') { const x = listTools().find(t => t.id === body.id && t.source === '我的'); return x ? ok(readJSON(x.file, {})) : err(404, '只能取自己加的工具'); }
    if (route === 'tools/remove' && method === 'POST') { try { return ok({ ...config(), removed: removeUserTool(body.id) }); } catch (e) { return err(e.status || 400, e.message); } }
    // ----- 从 GitHub 装 skills（内容 1.3.6）：读概况 → 下载列出 → 勾选安装（可同时建工具）；装过的按来源列、卸载 -----
    if (route === 'ghskills/info' && method === 'POST') { try { return ok(await gh.info(body.link)); } catch (e) { return err(400, e.message); } }
    if (route === 'ghskills/load' && method === 'POST') {
      try { return ok(await gh.load({ link: body.link, zipFrom: body.from, zipData: body.data, zipName: body.name })); }
      catch (e) { return err(400, e.message, e.offline ? { offline: true } : null); }
    }
    if (route === 'ghskills/install' && method === 'POST') {
      try { const r = gh.install(body); await detectAll(); return ok({ ...r, config: config() }); } catch (e) { return err(400, e.message); }
    }
    if (route === 'ghskills/list' && method === 'GET') return ok({ repos: gh.list(), engines: ghEngines().map(e => ({ id: e.id, name: e.name })) });
    if (route === 'ghskills/remove' && method === 'POST') {
      try { const r = gh.remove(body); await detectAll(); return ok({ ...r, config: config() }); } catch (e) { return err(400, e.message); }
    }
    if (route === 'workflows/remove' && method === 'POST') { try { const name = removeWorkflow(body.id); return ok({ ...config(), removed: name }); } catch (e) { return err(400, e.message); } }
    // ----- 工具：看指令（执行前预览，和真正交出去的一样，只是不带项目信息） -----
    if (route === 'tools/preview' && method === 'POST') {
      const t = listTools().find(x => x.id === body.tool); if (!t) return err(400, '没有这个工具');
      try { return ok(toolPrompt(t, body.values, body.pins)); } catch (e) { return err(400, e.message); }
    }
    // ----- 项目 -----
    if (route === 'projects' && method === 'GET') return ok({ projects: projectSummary(), current: projects.current()?.id || null, mineru: mineru.usable() }); // 任务做完会刷新这个：启动时 MinerU 还没查完也能跟上
    if (route === 'projects/pick-dir' && method === 'POST') return ok({ dir: await hooks.pickFolder('新项目放在哪个文件夹里') });
    if (route === 'projects/create' && method === 'POST') {
      if (body.engine && !ENGINES[body.engine]) return err(400, '没有这个 AI');
      try { const p = projects.create(body); return ok({ ...config(), created: p.id }); } catch (e) { return err(400, e.message); }
    }
    if (route === 'projects/open' && method === 'POST') {
      const dir = body.dir || await hooks.pickFolder('选一个文件夹作为项目（只会在里面加一个 .工作站 文件夹，不动原有文件）');
      if (!dir) return ok(config());
      try { projects.open(dir); return ok(config()); } catch (e) { return err(400, e.message); }
    }
    if (route === 'projects/remove' && method === 'POST') { try { projects.remove(body.id); return ok(config()); } catch (e) { return err(400, e.message); } }
    if (route === 'projects/current' && method === 'POST') { try { projects.setCurrent(body.id); return ok(config()); } catch (e) { return err(400, e.message); } }
    if (route === 'projects/update' && method === 'POST') {
      if (body.engine !== undefined && (!ENGINES[body.engine] || !isOn(body.engine))) return err(400, '没有这个 AI，或者它没有启用');
      if (body.model && !/^[\w.:\-[\]]{1,64}$/.test(body.model)) return err(400, '模型名不对');
      try { projects.update(body.id, body); return ok(config()); } catch (e) { return err(400, e.message); }
    }
    if (route === 'projects/upload' && method === 'POST') {
      const p = projects.get(body.id);
      if (!p || !p.exists) return err(400, '项目文件夹找不到了');
      try { const name = dropFile(p.path, body); if (!p.inbox) projects.markUnread(p.id, [name]); return ok({ name }); } catch (e) { return err(400, e.message); }
    }
    // 对话气泡的附件（内容 1.3.5，乔淼 10-26）：App 里拖进来的文件有原位置，直接用（不复制）；拿不到位置的（日常版、粘贴的截图）存进项目的「附件/」。返回完整路径，界面附在指令末尾
    if (route === 'projects/attach' && method === 'POST') {
      const p = projects.get(body.id);
      if (!p || !p.exists) return err(400, '项目文件夹找不到了');
      if (body.from) { let st; try { st = fs.statSync(String(body.from)); } catch { return err(400, '找不到这个文件'); } if (!st.isFile()) return err(400, '只能附文件，不能附文件夹'); return ok({ path: path.resolve(String(body.from)), copied: false }); }
      try { const dir = path.join(p.path, '附件'); fs.mkdirSync(dir, { recursive: true }); const name = dropFile(dir, body); if (!p.inbox) projects.markUnread(p.id, ['附件/' + name]); return ok({ path: path.join(dir, name), copied: true }); }
      catch (e) { return err(400, e.message); }
    }
    if (route === 'projects/files' && method === 'GET') return ok(projects.files(body.id));
    if (route === 'projects/reveal' && method === 'POST') {
      try { const full = inProject(body.id, body.path); body.path ? hooks.revealPath(full) : hooks.openPath(full); return ok({}); } catch (e) { return err(400, e.message); }
    }
    // ----- 文件：在工作站中间打开看（地址形如 file/<项目>/<相对路径>，里面的相对链接也能对上） -----
    if (route.startsWith('file/') && method === 'GET') {
      const rest = decodeURIComponent(route.slice(5)), i = rest.indexOf('/');
      let full; try { full = inProject(rest.slice(0, i), rest.slice(i + 1)); } catch (e) { return err(400, e.message); }
      let st; try { st = fs.statSync(full); } catch { return err(404, '没有这个文件（可能被移动或删除了）'); }
      if (!st.isFile()) return err(400, '这是一个文件夹');
      if (st.size > 60e6) return err(413, '文件太大（超过 60MB），请用默认程序打开');
      const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
      // 项目里的网页可能是 AI 生成的、带脚本：一律隔离，就算有人直接打开这个地址，也碰不到工作站
      const headers = /html|svg|xml/.test(type) ? { 'Content-Security-Policy': 'sandbox allow-scripts allow-popups allow-forms allow-modals' } : {};
      return { status: 200, raw: fs.readFileSync(full), type, headers };
    }
    if (route === 'files/open-external' && method === 'POST') { try { hooks.openPath(inProject(body.project, body.path)); projects.markRead(body.project, body.path); return ok({}); } catch (e) { return err(400, e.message); } }
    if (route === 'files/read' && method === 'POST') { projects.markRead(body.project, String(body.path || '')); return ok({}); }
    // 交给 AI 改：工作站自己先把原文件备份到 .工作站/历史/，再把修改意见交给 AI
    if (route === 'files/revise' && method === 'POST') {
      const note = String(body.note || '').trim(); if (!note) return err(400, '先写修改意见');
      let full; try { full = inProject(body.project, body.path); } catch (e) { return err(400, e.message); }
      if (!fs.existsSync(full)) return err(404, '没有这个文件');
      const rel = String(body.path);
      return reviseFile(body.project, rel, full, '修改：' + path.basename(full),
        backup => `要修改的文件：${rel}\n修改意见：\n${note}\n\n按修改意见改这份文件，直接改原文件。只改意见涉及的部分，其余保持原样，不要改文件名和格式。原文件已经备份到 .工作站/历史/${backup}，不用你再备份。改完用一两句话说明改了哪里。`);
    }
    // MinerU 手动选择 / 恢复自动（内容 1.2.4）：自动找不到（装在别处）时学员自己指 mineru-kit
    if (route === 'mineru/bin' && method === 'POST') {
      if (body.clear) delete settings.mineruBin;
      else { const file = await hooks.pickFile('找到 MinerU 的 mineru-kit 程序'); if (!file) return ok(mineru.status()); settings.mineruBin = file; }
      save(); return ok(await mineru.recheck());
    }
    if (route === 'mineru/list' && method === 'GET') { try { return ok(await mineru.list(String(body.project || ''))); } catch (e) { return err(e.status || 400, e.message); } }
    if (route === 'files/roughdraft-status' && method === 'GET') { try { return ok(rdState.get(inProject(body.project, String(body.path || ''))) || { status: 'none' }); } catch (e) { return err(400, e.message); } }
    if (route === 'files/roughdraft' && method === 'POST') { try { return ok(roughdraftOpen(body.project, String(body.path || ''))); } catch (e) { return err(e.status || 400, e.message); } }
    // ----- 引擎 -----
    // 用户在确认框里同意了这个 AI 的风险提示（Windows 上的 Claude Code 没有沙箱）：只记下同意，不改默认 AI
    if (route === 'engine/ack' && method === 'POST') {
      if (!ENGINES[body.engine]) return err(400, '没有这个引擎');
      settings.ack[body.engine] = true; save(); return ok(config());
    }
    // 启用 / 停用一个 AI 程序（内容 1.2.0）：最后一个启用的停不掉；停用的是默认的，默认换成别的启用的。
    // 用它的项目不用改：engineOf() 会让它们改用默认的，右栏会说一句
    // 额外放行的服务（内容 1.3.2）：GET 列出这台电脑上这个 AI 程序连着的服务；POST 勾 / 不勾一个
    if (route === 'engine/mcp' && method === 'GET') {
      const e = ENGINES[body.engine];
      if (!e || typeof e.listMcp !== 'function') return err(400, '这个 AI 程序不支持');
      if (!found[body.engine] || !found[body.engine].bin) return err(409, `没找到 ${e.name}`);
      const list = await e.listMcp(found[body.engine].bin);
      if (!list) return err(500, `没能问出 ${e.name} 连着哪些服务，过一会儿再试`);
      return ok({ servers: list, on: settings.extraMcp[body.engine] || [] });
    }
    if (route === 'engine/mcp' && method === 'POST') {
      const e = ENGINES[body.engine], name = String(body.server || '').trim();
      if (!e || typeof e.listMcp !== 'function') return err(400, '这个 AI 程序不支持');
      if (!name || name.length > 80 || /[\n\r]/.test(name)) return err(400, '服务名不对');
      const cur = new Set(settings.extraMcp[body.engine] || []);
      if (body.on) cur.add(name); else cur.delete(name);
      settings.extraMcp[body.engine] = [...cur]; save();
      if (found[body.engine]) found[body.engine].info.extraMcp = settings.extraMcp[body.engine];
      return ok({ on: settings.extraMcp[body.engine] });
    }
    if (route === 'engine/enable' && method === 'POST') {
      const id = body.engine; if (!BASE_ENGINES[id]) return err(400, '没有这个 AI 程序');
      if (!body.enabled && !Object.keys(BASE_ENGINES).some(x => x !== id && isOn(x))) return err(400, '至少要留一个启用的 AI 程序');
      settings.enabled[id] = !!body.enabled;
      if (!body.enabled && settings.engine === id) settings.engine = Object.keys(BASE_ENGINES).find(x => isOn(x) && found[x] && found[x].bin) || Object.keys(BASE_ENGINES).find(x => isOn(x));
      save(); await detect(id).catch(() => setFound(id, null, [])); for (const x of Object.keys(ENGINES)) if (found[x]) found[x].info.isDefault = settings.engine === x;
      return ok(config());
    }
    if (route === 'engine' && method === 'POST') {
      if (!ENGINES[body.engine]) return err(400, '没有这个引擎');
      if (!isOn(body.engine)) return err(400, `这个 AI 程序没有启用：先在「${CFG}」里启用它`);
      if (body.ackRisk) settings.ack[body.engine] = true;
      settings.engine = body.engine; save(); for (const x of Object.keys(ENGINES)) if (found[x]) found[x].info.isDefault = settings.engine === x; return ok(config());
    }
    // 自动找不到时让用户手动指定程序；clear 表示恢复自动查找
    if (route === 'engine-bin' && method === 'POST') {
      const id = body.engine || settings.engine;
      if (!ENGINES[id]) return err(400, '没有这个引擎');
      if (body.clear) delete settings.bin[id];
      else { const file = await hooks.pickFile(ENGINES[id].binTitle); if (!file) return ok(config()); settings.bin[id] = file; }
      save(); await detect(id); return ok(config());
    }
    if (route === 'quota' && method === 'GET') return ok(quotaAll());
    // 手机远程（内容 1.3.13）：配置页用；手机自己走 remote.cjs 的第二个端口
    if (route === 'remote' || route.startsWith('remote/')) {
      if (!remote) return err(404, '这个版本没有手机远程');
      try { return ok(await remote.admin(method, route.slice(7), body)); } catch (e) { return err(400, e.message); }
    }
    // ----- 收件箱一键梳理（10-18 第三轮第 1 条）：AI 只读、只写计划；搬文件、建项目、排后续工具都由工作站来做，可撤销 -----
    // 待办（内容 1.3.3）：列表、开始（单独开一个任务）、打勾、删掉、交给 AI 拆
    if (route === 'todos' && method === 'GET') return ok(todos.list());
    // 电脑窗口来取手机交过来的工作流阶段（见上面 todos/act）；顺便记下窗口还开着
    // 交过来 60 秒还没被窗口取走的（窗口关了）不再做，免得下次打开窗口时突然开一个早就过时的阶段；手机那边会看到「没开起来」
    if (route === 'todos/remote-acts' && method === 'GET') {
      deskSeen = Date.now();
      const all = remoteActs.splice(0), fresh = all.filter(x => Date.now() - x.at < 60000);
      for (const x of all) if (!fresh.includes(x)) actResults.set(x.key, { run: null, at: Date.now() });
      return ok({ acts: fresh });
    }
    // 窗口做完回报：开起来的任务 id，或者没开起来（这一步要选、要填东西）；手机来问结果
    if (route === 'todos/remote-result' && method === 'POST') { actResults.set(String(body.key), { run: body.run && tasks.get(String(body.run)) ? tasks.pub(tasks.get(String(body.run))) : null, busy: !!body.busy, at: Date.now() }); for (const [k, v] of actResults) if (Date.now() - v.at > 600000) actResults.delete(k); return ok({}); }
    if (route === 'todos/act-result' && method === 'GET') { const r = actResults.get(String(body.key)); return ok(r ? { done: true, run: r.run, busy: !!r.busy } : { done: false }); }
    if (route === 'suggest/facts' && method === 'GET') { const p = projects.get(body.project); return ok(p && p.exists && p.kind !== 'paper' ? suggestFacts(p) : { items: [] }); }
    if (route.startsWith('todos/') && method === 'POST') {
      try {
        const sub = route.slice(6);
        if (sub === 'start') return ok({ ...todos.start(String(body.id)), ...todos.list() });
        if (sub === 'done') { todos.setDone(String(body.id), !!body.done); return ok(todos.list()); }
        if (sub === 'remove') { todos.remove(String(body.id)); return ok(todos.list()); }
        if (sub === 'add') { todos.add({ title: body.title, project: body.project, act: body.act }); return ok(todos.list()); }
        if (sub === 'started') { todos.started(String(body.id)); return ok(todos.list()); }
        // 手机上开始「下一步建议」放进来的待办（内容 1.3.16，乔淼 10-27：手机上只显示「到电脑上开始」）：
        // 重试、开另一件待办、梳理收件箱、工具（带预填）在后台直接做；工作流阶段的指令是电脑窗口里的工作流页面拼的，交给开着的窗口（它每 3 秒来取一次）
        if (sub === 'act') {
          const t = todos.get(String(body.id)), a = t && t.act;
          if (!a) return err(404, '没有这件事');
          let out;
          if (a.type === 'retry') out = await handle({ method: 'POST', route: `runs/${a.id}/retry`, body: {} });
          else if (a.type === 'todo') out = await handle({ method: 'POST', route: 'todos/start', body: { id: a.id } });
          else if (a.type === 'triage') out = await handle({ method: 'POST', route: 'inbox/triage', body: {} });
          else if (a.type === 'tool') out = createRun({ project: t.project, tool: a.id, values: a.vals || {}, pins: a.pins || [] });
          else if (a.type === 'go') {
            if (Date.now() - deskSeen > 90000) return err(409, `这一步是工作流里的一个阶段，要电脑上的 ${APP} 窗口来开始，窗口现在没开着：在电脑上打开 ${APP} 窗口后再点一次`);
            const key = t.id + ':' + Date.now();
            remoteActs.push({ key, at: Date.now(), id: t.id, project: t.project, act: { ...a, run: true } }); todos.started(t.id);
            return ok({ sent: key });
          } else return err(409, a.type === 'plan' ? '梳理计划要在电脑上看、点「照这样做」' : '这一条要到电脑上开始');
          if (out.status >= 400) return out;
          todos.started(t.id);
          const run = out.data && (out.data.run || (out.data.id ? out.data : null));
          return ok({ run: run || null });
        }
        if (sub === 'split') {
          const text = String(body.text || '').trim(); if (!text) return err(400, '先写要做的事');
          const run = todos.split({ text, project: body.project, prompt: (fname, p) => `把我下面说的拆成待办。**只写一个文件：.工作站/${fname}**（在当前项目文件夹里），别的什么都不做：不要动、不要新建任何别的文件，不要开始做这些事。

【我说的】
${text}

【我的项目】
${projects.list().filter(x => x.exists).map(x => x.inbox ? `- [id:${x.id}] 收件箱` : projectBrief(x)).join('\n')}

【格式】{"todos":[{"title":"动词开头的一句话，比如「批注 Kaylynn 的 proposal 第 3 版」","project":"在哪个项目里做（项目 id）","prompt":"交给 AI 的指令：具体做什么、按项目说明里的哪种做法、产出放哪；要我决定的地方写明让它停下问我","files":["相关文件的完整路径（我提到的、你在项目里找到的；没有就空）"]}]}
一件事一条，只拆我说到的，不要自己加；${p.inbox ? `没说是哪个项目的，放进最相关的那个项目；实在看不出来再放收件箱（id:${p.id}）。` : `没说是哪个项目的，放当前项目（id:${p.id}）。`}拿不准的文件不要写进去。
最后用一句话告诉我拆成了几条、各是什么，提醒我在 Dashboard 的「待办」里点「开始」。` });
          return { status: 201, data: { run, ...todos.list() } };
        }
        return err(404, '没有这个接口');
      } catch (e) { return err(e.status || 400, e.message, e.data && e.data.riskAck ? { riskAck: e.data.riskAck } : null); }
    }
    if (route.startsWith('inbox/')) {
      try { return ok(await inboxRoute(route.slice(6), method, body)); } catch (e) { return err(e.status || 400, e.message, e.riskAck && { riskAck: e.riskAck }); }
    }
    // 主页「常用」工具（10-23 乔淼：工具太多，常用的 pin 出来单独放）：按 pin 的先后排，存在设置里
    if (route === 'tools/pin' && method === 'POST') {
      if (!listTools().some(t => t.id === body.id)) return err(400, '没有这个工具');
      const list = (settings.pinnedTools || []).filter(id => id !== body.id);
      settings.pinnedTools = body.pinned ? [...list, body.id] : list; save(); return ok(config());
    }
    // 右栏那位 AI 的名字（学员自己起，默认「App 名 Agent」，到手是 My App Agent；10-17 界面升级，10-30 改默认）
    if (route === 'agent-name' && method === 'POST') {
      const name = String(body.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 24);
      if (name && name !== AGENT) settings.agentName = name; else delete settings.agentName;
      save(); return ok(config());
    }
    if (route === 'model' && method === 'POST') {
      const id = body.engine || settings.engine, model = body.model || '';
      if (model && !/^[\w.:\-[\]]{1,64}$/.test(model)) return err(400, '模型名不对');
      settings.model[id] = model; save(); await detect(id); return ok(config());
    }
    // ----- 任务 -----
    if (route === 'runs' && method === 'GET') return ok(tasks.list(body.project).slice(0, 40).map(tasks.pub));
    if (route === 'runs' && method === 'POST') return createRun(body);
    // 清除历史任务（10-18）：body.id 清一个，body.project 清这个项目全部已结束的；只从列表拿掉，记录不删
    if (route === 'runs/clear' && method === 'POST') {
      const ids = body.id ? [String(body.id)] : tasks.list(String(body.project || '')).map(r => r.id);
      return ok({ cleared: tasks.clear(ids) });
    }
    const m = route.match(/^runs\/([\w-]+)(?:\/(reply|stop|prompt|conversation|retry))?$/);
    if (!m || !tasks.get(m[1])) return err(404, '没有这个接口');
    try {
      if (!m[2] && method === 'GET') return ok(tasks.pub(tasks.get(m[1])));
      if (m[2] === 'prompt' && method === 'GET') { const t = tasks.prompt(m[1], Number(body.turn) || 1); return t == null ? err(404, '没有这一轮的指令') : ok({ text: t }); }
      if (m[2] === 'retry' && method === 'POST') { if (body.engine && !isOn(body.engine)) return err(400, '这个 AI 程序没有启用'); return ok(tasks.pub(tasks.retry(m[1], body.engine))); }
      if (m[2] === 'conversation' && method === 'GET') return ok({ turns: tasks.conversation(m[1]) });
      if (m[2] === 'stop' && method === 'POST') return ok(tasks.pub(tasks.stop(m[1])));
      if (m[2] === 'reply' && method === 'POST') return ok(tasks.pub(tasks.reply(m[1], body.text)));
    } catch (e) { return err(e.status || 400, e.message, e.riskAck && { riskAck: e.riskAck }); }
    return err(405, '不支持这个操作');
  }

  // 手机远程 + 企业微信通知（内容 1.3.13，见 remote.cjs）：1.3.15 起学员的 App 里也有（实验版，默认关着）
  remote = createRemote({ dataDir, contentDir, mainPort: Number(new URL(k.mainOrigin).port), settings, save, handle, platform: k.platform,
    projectName: id => (projects.get(id) || {}).name || '', log: k.log || (() => {}) });

  return {
    handle, config, workflowPage,
    isBusy: () => tasks.isBusy(),
    // 退出时也停掉还在等 Roughdraft「批完了」的进程（10-26 乔淼：退出后 macOS 提示「POPPER 在后台运行」——就是它们留下来了，
    // macOS 把 POPPER 启动、POPPER 退出后还活着的进程算成 POPPER 的后台任务）
    stopAll: () => { try { tasks.stopAll(); } finally { for (const c of rdWatch.values()) try { c.kill(); } catch {} rdWatch.clear(); gh.stop(); if (remote) remote.stop(); } }, // 从 GitHub 下载解开的临时文件夹也清掉
    dispose: () => { gh.stop(); if (remote) remote.stop(); for (const c of rdWatch.values()) try { c.kill(); } catch {} } // 换内容时内核会先确认没有任务在跑
  };
}

module.exports = { KERNEL_API, createRuntime, readWorkflow, parseWorkflow };
