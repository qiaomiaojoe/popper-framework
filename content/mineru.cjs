'use strict';
const { APP, CFG } = require('./app-name.cjs');
// MinerU：PDF 转带页码的 Markdown（内容 1.2.3，方案 设计/MinerU-方案.md，乔淼 10-24 定）。
// 本机版、可选安装：学员自己用 uv 装 MinerU（配置里「怎么装」），POPPER 找到它以后，「读文献 → MinerU」工具由 POPPER 自己在后台转，不交给 AI——
// 不花额度，也不会被 AI 的沙箱拦住下载模型。转好的放 文献/全文/<PDF 同名>.md，每页开头一行 <!-- 第 N 页 -->，读文献的 skill 优先读它。
// 转换由 mineru-pages.py 在 MinerU 自己的 Python 里做（一次转一批，模型只加载一次），一行一个 JSON 报进度；这里管找程序、挑要转的、进度和停止。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const common = require('./engine-common.cjs');

const WIN = common.WIN;
const OUT_DIR = '文献/全文';
const SPEC = 'mineru>=4.0,<5';
// 档位：默认 standard（表格、公式更准），内存小的用 basic。不让学员选（乔淼 10-24）。
// 官方：standard 在 Windows / Intel 上走 ONNX + llama.cpp，至少 8 GB；M 芯片 Mac 走 PyTorch + llama.cpp，至少 16 GB（10-24 乔淼 M4 16 GB 实测转 12 页峰值约 8 GB）。basic 2 GB 就够
const tier = () => os.totalmem() >= (process.platform === 'darwin' && process.arch === 'arm64' ? 15 : 7.5) * 1024 ** 3 ? 'standard' : 'basic'; // 标 8 / 16 GB 的电脑报出来常常略少一点

// ---------- 找 MinerU（内容 1.2.4，乔淼 10-24：学员自己早就装过、不是照指南装的，也要认得出） ----------
// 候选位置：uv tool / pipx（~/.local/bin）、PATH、Homebrew、pip --user、conda 的 base 和各个环境、常见的虚拟环境文件夹（MinerU 官方教程建议 uv venv .mineru）。
// 每个位置先找 mineru-kit（4.x 才有），再找 mineru（2.x / 3.x 只有它，找到了用来说「版本太旧」）
function places() {
  const home = os.homedir(), out = [], add = (where, dir) => out.push({ where, dir });
  const ls = d => { try { return fs.readdirSync(d, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => path.join(d, x.name)); } catch { return []; } };
  const bin = d => path.join(d, WIN ? 'Scripts' : 'bin');
  add('uv / pipx', path.join(home, '.local', 'bin'));
  for (const d of common.pathDirs()) add('PATH', d);
  if (!WIN) { add('Homebrew', '/opt/homebrew/bin'); add('Homebrew', '/usr/local/bin'); }
  // pip install --user
  if (WIN) for (const d of ls(path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Python'))) add('pip --user', path.join(d, 'Scripts'));
  else for (const d of ls(path.join(home, 'Library', 'Python'))) add('pip --user', path.join(d, 'bin'));
  // Windows 官网装的 Python：Scripts 在 Python 自己的文件夹里
  if (WIN) for (const d of ls(path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local'), 'Programs', 'Python'))) add('Python', path.join(d, 'Scripts'));
  // conda / mamba：base 和 envs/*
  const condas = ['miniconda3', 'anaconda3', 'miniforge3', 'mambaforge', 'micromamba', path.join('opt', 'miniconda3'), path.join('opt', 'anaconda3')].map(n => path.join(home, n));
  if (!WIN) condas.push('/opt/homebrew/Caskroom/miniconda/base', '/opt/homebrew/Caskroom/miniforge/base', '/opt/miniconda3', '/opt/anaconda3');
  if (process.env.CONDA_PREFIX) condas.push(process.env.CONDA_PREFIX);
  for (const c of condas) { add('conda', WIN ? path.join(c, 'Scripts') : bin(c)); for (const e of ls(path.join(c, 'envs'))) add('conda 环境 ' + path.basename(e), WIN ? path.join(e, 'Scripts') : bin(e)); }
  // 虚拟环境：~/.mineru、~/mineru*、~/.venv*、~/venv*，~/.virtualenvs/* 和 ~/.venvs/* 里每一个
  for (const d of ls(home).filter(d => /^(\.?mineru|\.?venv)/i.test(path.basename(d)))) add('虚拟环境 ' + path.basename(d), bin(d));
  for (const g of ['.virtualenvs', '.venvs', 'venvs']) for (const d of ls(path.join(home, g))) add('虚拟环境 ' + path.basename(d), bin(d));
  return out;
}
const exe = n => WIN ? n + '.exe' : n;
// 这个命令用的是哪个 Python：先看旁边（uv / pipx 是链接，跟到真实位置；venv、conda 的 python 就在同一个 bin 里）；
// Windows 官网 Python 的 Scripts 在 python.exe 下一层；再不行读程序开头的 #!（pip 生成的 Mac 脚本、Windows 启动器里都写着）；最后看 uv tool 的固定位置
function pythonOf(file) {
  if (!file) return '';
  const c = [];
  try { const real = fs.realpathSync(file); c.push(path.join(path.dirname(real), exe('python')), path.join(path.dirname(real), exe('python3'))); } catch {}
  c.push(path.join(path.dirname(file), exe('python')), path.join(path.dirname(file), exe('python3')));
  if (WIN) c.push(path.join(path.dirname(file), '..', 'python.exe'));
  try {
    const st = fs.statSync(file);
    if (st.size < 8 * 1024 * 1024) {
      const text = fs.readFileSync(file).toString('latin1'), all = [...text.matchAll(/#!\s*"?([^"\r\n]*?python[\d.]*(?:\.exe)?)"?\s*[\r\n]/gi)];
      if (all.length) c.push(all[all.length - 1][1].trim());
    }
  } catch {}
  const toolDirs = [process.env.UV_TOOL_DIR, WIN ? path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'uv', 'data', 'tools') : path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'uv', 'tools')].filter(Boolean);
  for (const d of toolDirs) c.push(path.join(d, 'mineru', WIN ? 'Scripts' : 'bin', exe('python')));
  return c.find(common.isFile) || '';
}
const run = (file, args, timeout = 20000) => new Promise(res => require('node:child_process').execFile(file, args, { timeout, windowsHide: true, encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }, (e, out) => res({ code: e ? (typeof e.code === 'number' ? e.code : -1) : 0, out: String(out || '').trim() })));
const major = v => parseInt(String(v || '').split('.')[0], 10) || 0;
// 找到的结果：{ bin, python, version, where, manual, problem, models, tried }
// problem：'' 能用 / 'none' 没找到 / 'old' 版本太旧（要 4.x）/ 'nopython' 找到命令但找不到它的 Python
async function locate(custom) {
  const list = custom ? [{ where: '手动指定', file: custom }] : places().flatMap(p => [{ where: p.where, file: path.join(p.dir, exe('mineru-kit')) }, { where: p.where, file: path.join(p.dir, exe('mineru')) }]);
  const seen = new Set(), tried = [];
  let old = null, nopy = null;
  for (const { where, file } of list) {
    if (seen.has(file) || !common.isFile(file)) continue; seen.add(file);
    const python = pythonOf(file);
    if (!python) { tried.push({ where, file, result: '找不到它的 Python' }); nopy = nopy || { bin: file, where }; continue; }
    const v = await run(python, ['-I', '-c', "import importlib.metadata as m; print(m.version('mineru'))"]);
    const version = v.code === 0 ? v.out.split('\n').pop() : '';
    tried.push({ where, file, result: version || '运行不了' });
    if (!version) { nopy = nopy || { bin: file, where }; continue; }
    if (major(version) < 4) { old = old || { bin: file, python, version, where }; continue; }
    const kit = /mineru-kit(\.exe)?$/i.test(file) ? file : path.join(path.dirname(file), exe('mineru-kit'));
    return { bin: kit, python, version, where, manual: !!custom, problem: '', tried };
  }
  if (old) return { ...old, manual: !!custom, problem: 'old', tried };
  if (nopy) return { ...nopy, python: '', version: '', manual: !!custom, problem: 'nopython', tried };
  return { bin: '', python: '', version: '', where: '', manual: !!custom, problem: 'none', tried };
}
// 模型下好了没有：mineru-kit models verify --tier <档位>，一两秒，缺了退出码是 1
async function modelsReady(found, t) {
  if (!found || found.problem || !common.isFile(found.bin)) return null;
  const r = await run(found.bin, ['models', 'verify', '--tier', t], 30000);
  return r.code === 0;
}
// 模型放在哪（空间占用里显示）：MINERU_HOME（默认 ~/.mineru）下的 models；下载时 Hugging Face / ModelScope 的缓存也算
const modelDirs = () => {
  const home = os.homedir(), mh = process.env.MINERU_HOME || path.join(home, '.mineru');
  return [{ id: 'mineru', path: mh }, { id: 'hf', path: path.join(process.env.HF_HOME || path.join(home, '.cache', 'huggingface'), 'hub'), only: /mineru|opendatalab/i },
    { id: 'ms', path: path.join(process.env.MODELSCOPE_CACHE || path.join(home, '.cache', 'modelscope'), 'hub'), only: /mineru|opendatalab/i }];
};

// 「怎么装」弹窗（和 Roughdraft 那一行同一个弹窗，多了分步）
const shell = WIN ? 'PowerShell' : '终端';
const INSTALL = {
  note: `MinerU 是上海 AI 实验室开源的 PDF 转文字工具（github.com/opendatalab/MinerU），表格、公式、扫描版（OCR）都能转。装好后，「读文献」里的「MinerU」工具会把项目里的 PDF 转成带页码的文字稿（文献/全文/），以后知识模块、单篇深读、拆 Model Paper、写综述都优先读它：扫描版也读得出来，表格不容易错行，同一篇不用每次重新读 PDF。全在你电脑上转，论文不上传。可选：不装不影响别的。要用 uv 来装（它会给 MinerU 单独准备一套 Python，不弄乱电脑上别的）：先在${shell}里输入 uv --version 回车，出来版本号就是有了，可以跳过第 2 步。`,
  shell, open: WIN ? '点开始菜单，搜「PowerShell」，打开它' : '按 ⌘ + 空格，搜「终端」，打开它',
  steps: [
    { say: `没有 uv 的话先装 uv（官方命令），装完关掉${shell}再开一个：`, cmd: WIN ? 'powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"' : 'curl -LsSf https://astral.sh/uv/install.sh | sh' },
    { say: '装 MinerU（下载约 300 MB，装好约 1 GB；国内慢的话在命令最后加一段 --default-index https://mirrors.aliyun.com/pypi/simple/ 走阿里云的源）：', cmd: `uv tool install --python 3.12 "${SPEC}"` },
    { say: `下载 MinerU 要用的模型（${tier() === 'standard' ? '约 2 GB' : '约 0.8 GB'}，从国内的 ModelScope 下载，不用翻墙）：`, cmd: `mineru-kit models download --tier ${tier()} --source modelscope` }
  ],
  login: '第 4 步结束时出来「ready」「verified」之类的字样就好了；提示找不到 mineru-kit 的话，关掉' + shell + '再开一个，重新运行第 4 步。'
};

// 「怎么升级」弹窗：电脑上是 MinerU 2.x / 3.x（命令叫 mineru，没有 mineru-kit），POPPER 的转换要 4.x
const UPGRADE = {
  title: '升级 MinerU 到 4.x',
  note: `电脑上已经有 MinerU，但版本太旧（${APP} 要 4.0 以上，4.0 起能在普通电脑的 CPU 上转、命令也换了）。按你当初怎么装的，选一种升级；升级不会删你转过的东西。升级完还要下一次新版的模型（4.0 的模型和旧版不通用）。`,
  shell, open: WIN ? '点开始菜单，搜「PowerShell」，打开它' : '按 ⌘ + 空格，搜「终端」，打开它',
  steps: [
    { say: '当初用 uv 装的（或者不记得了）：用 uv 装一份新的，最省事', cmd: `uv tool install --force --python 3.12 "${SPEC}"` },
    { say: '当初在自己的 Python 环境里用 pip 装的：先进入那个环境（conda activate 环境名，或 source 环境/bin/activate），再运行', cmd: `pip install -U "${SPEC}"` },
    { say: `下载新版的模型（${tier() === 'standard' ? '约 2 GB' : '约 0.8 GB'}，从国内的 ModelScope 下载）：`, cmd: `mineru-kit models download --tier ${tier()} --source modelscope` }
  ],
  login: '第 4 步结束时出来「ready」「verified」之类的字样就好了。'
};
// 「模型没下」：只要最后一步
// 装在 conda / 虚拟环境里的，终端里不一定直接认得 mineru-kit：这时命令写完整路径（PowerShell 前面要加 &）
const kitCmd = f => !f || !f.bin || ['uv / pipx', 'PATH'].includes(f.where) ? 'mineru-kit' : WIN ? `& "${f.bin}"` : `"${f.bin}"`;
const MODELS = f => ({ title: '下载 MinerU 的模型', note: `MinerU 装好了，但它要用的模型还没下（${tier() === 'standard' ? '约 2 GB' : '约 0.8 GB'}）。不下也行：第一次转的时候 MinerU 会自己下，只是那一篇要多等几分钟到半小时。想先下好，就运行下面这一行（从国内的 ModelScope 下）。`,
  shell, open: WIN ? '点开始菜单，搜「PowerShell」，打开它' : '按 ⌘ + 空格，搜「终端」，打开它',
  steps: [{ say: '下载模型：', cmd: `${kitCmd(f)} models download --tier ${tier()} --source modelscope` }],
  login: '出来「ready」「verified」之类的字样就好了。' });

const isPdf = f => /\.pdf$/i.test(f);
const outOf = rel => `${OUT_DIR}/${path.basename(rel).replace(/\.pdf$/i, '')}.md`;
const sha256 = file => new Promise((res, rej) => { const h = crypto.createHash('sha256'); fs.createReadStream(file).on('error', rej).on('data', d => h.update(d)).on('end', () => res(h.digest('hex'))); });
// 转好的文件第一行记着源文件的大小、修改时间和 sha256：大小和时间都没变就当转过；变了再算一遍 sha256，内容真改了才重转
const HEAD_RE = /^<!-- POPPER · MinerU：源文件 (.+?) · 大小 (\d+) · 修改 (\d+) · sha256 ([0-9a-f]{64})/;
function headOf(file) {
  try { const fd = fs.openSync(file, 'r'), b = Buffer.alloc(1024), n = fs.readSync(fd, b, 0, 1024, 0); fs.closeSync(fd); const m = HEAD_RE.exec(b.slice(0, n).toString('utf8')); return m ? { size: +m[2], mtime: +m[3], sha: m[4] } : null; } catch { return null; }
}
// 这个 PDF 的转换状态：new 没转过 / done 转过了 / changed PDF 改过了（要重转）/ other 文献/全文/ 里有同名文件但不是 MinerU 转的（不覆盖）
async function stateOf(cwd, rel) {
  const pdf = path.join(cwd, rel), md = path.join(cwd, outOf(rel));
  if (!fs.existsSync(md)) return 'new';
  const h = headOf(md); if (!h) return 'other';
  let st; try { st = fs.statSync(pdf); } catch { return 'new'; }
  if (st.size === h.size && Math.floor(st.mtimeMs) === h.mtime) return 'done';
  try { return (await sha256(pdf)) === h.sha ? 'done' : 'changed'; } catch { return 'changed'; }
}

// custom()：学员手动指过的程序（设置里的 mineruBin），没有就是空
function createMineru({ projects, custom = () => '' }) {
  let found = { bin: '', python: '', version: '', problem: 'none', tried: [] }, models = null, checking = null;
  // 重新找一遍、顺便看模型下好没有。同时只跑一次；不阻塞启动
  const recheck = () => checking || (checking = (async () => {
    try { found = await locate(custom()); models = await modelsReady(found, tier()); } catch (e) { found = { bin: '', python: '', version: '', problem: 'none', tried: [], error: e.message }; models = null; }
    checking = null; return status();
  })());
  const status = () => ({ path: found.bin, version: found.version, where: found.where || '', manual: !!found.manual, problem: found.problem, models, tier: tier(), tried: found.tried, install: INSTALL, upgrade: UPGRADE, modelsHelp: MODELS(found) });
  const usable = () => !found.problem && !!found.python;
  recheck();
  // 工具页的清单：项目里所有 PDF（.工作站 和隐藏文件夹不算），带转换状态；默认勾上 文献/PDF/ 里还没转过（或改过）的
  async function list(projectId) {
    const p = projects.get(projectId); if (!p || !p.exists) throw Object.assign(Error('项目文件夹找不到了'), { status: 400 });
    const pdfs = projects.files(projectId, 5000).filter(f => f.kind !== 'dir' && isPdf(f.path) && !f.path.startsWith('.'));
    const items = await Promise.all(pdfs.map(async f => ({ path: f.path, out: outOf(f.path), size: f.size, state: await stateOf(p.path, f.path) })));
    if (checking) await checking;
    return { installed: usable(), problem: found.problem, version: found.version, models, tier: tier(), items: items.sort((a, b) => a.path.localeCompare(b.path, 'zh')) };
  }

  // 本机任务（tasks.cjs 的 locals.mineru）：job = { kind: 'mineru', files: [项目里的相对路径], tier }
  const local = {
    name: 'MinerU',
    friendlyError: s => s,
    stop: h => h && h.stop(),
    start(_, { cwd, job, emit, onStderr, onExit }) {
      let finished = false, stopped = false, child = null; // 每次 start 自己的进程：不同项目可以同时转
      const finish = (code, err) => { if (!finished) { finished = true; onExit(code, err); } };
      const fail = (msg, raw) => { emit({ kind: 'error', message: msg + (raw ? '\n\n原始信息：' + raw : '') }); setTimeout(() => finish(1), 0); return null; };
      const py = found.python, script = path.join(__dirname, 'mineru-pages.py'), firstModels = models === false; // 模型没下：第一篇开头 MinerU 会先下模型
      if (found.problem === 'old') return fail(`电脑上的 MinerU 是 ${found.version}，太旧了，要 4.0 以上。打开「${CFG} → 大家共用的 → MinerU」看怎么升级，升级完点「重新检测」，再点「重试」。`);
      if (!usable()) return fail(`这台电脑上没找到 MinerU。打开「${CFG} → 大家共用的 → MinerU」看怎么装，装好点「重新检测」，再点「重试」。`);
      const files = [...new Set((job.files || []).map(String))].filter(isPdf);
      const t0 = Date.now(), result = { ok: [], skipped: [], failed: [] };
      let total = 0; // 真要转的篇数（挑完才知道）
      const say = () => {
        const L = [];
        if (stopped) L.push(`停下了：${total - result.ok.length - result.failed.filter(f => f.i != null).length} 篇还没转（转到一半的那篇不留文件）。点「重试」接着转，转好的会跳过。`);
        if (result.ok.length) L.push(`转好了 ${result.ok.length} 篇，放在 ${OUT_DIR}/：\n${result.ok.map(x => `- ${x.out}（${x.pages} 页，${Math.max(1, Math.round(x.secs))} 秒）`).join('\n')}`);
        if (result.skipped.length) L.push(`跳过 ${result.skipped.length} 篇（转过了，PDF 也没改）：${result.skipped.map(x => path.basename(x)).join('、')}`);
        if (result.failed.length) L.push(`没转好 ${result.failed.length} 篇：\n${result.failed.map(x => `- ${path.basename(x.path)}：${x.msg}`).join('\n')}`);
        if (!L.length) L.push(stopped ? '还没开始转就停下了。' : '没有要转的 PDF。');
        L.push(`用时 ${Math.round((Date.now() - t0) / 1000)} 秒，档位 ${job.tier}。以后读文献的 skill 会先读 ${OUT_DIR}/ 里同名的文字稿。`);
        emit({ kind: 'item', item: { id: 'summary', type: 'agent_message', text: L.join('\n\n') } });
      };
      (async () => {
        const todo = [];
        for (const rel of files) {
          const pdf = path.join(cwd, rel);
          if (!fs.existsSync(pdf)) { result.failed.push({ path: rel, msg: '文件不见了' }); continue; }
          const st = await stateOf(cwd, rel);
          if (st === 'done') { result.skipped.push(rel); continue; }
          if (st === 'other') { result.failed.push({ path: rel, msg: `${outOf(rel)} 已经有一个不是 MinerU 转的同名文件，没覆盖它` }); continue; }
          const s = fs.statSync(pdf);
          todo.push({ pdf, rel, out: path.join(cwd, outOf(rel)), outRel: outOf(rel),
            header: `<!-- POPPER · MinerU：源文件 ${rel} · 大小 ${s.size} · 修改 ${Math.floor(s.mtimeMs)} · sha256 ${await sha256(pdf)} · 档位 ${job.tier} · ${new Date().toISOString().slice(0, 10)} -->` });
        }
        if (!todo.length) { say(); emit({ kind: 'progress', todo: { done: files.length, total: files.length } }); return finish(result.failed.length && !result.skipped.length ? 1 : 0, result.failed.length && !result.skipped.length ? '一篇都没转成' : undefined); }
        if (stopped) { say(); return finish(1); }
        const n = total = todo.length, base = result.skipped.length;
        emit({ kind: 'progress', todo: { done: base, total: base + n } });
        const step = (i, text, status, extra) => emit({ kind: 'item', item: { id: 'f' + i, type: 'convert', text, status, ...extra } });
        let cur = -1;
        // 模型缺了 MinerU 会自己下：默认从国内的 ModelScope 下（官方默认先试 Hugging Face，国内常连不上）
        child = common.run({ file: py, prefix: ['-I', script], env: { PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8', MINERU_MODEL_SOURCE: process.env.MINERU_MODEL_SOURCE || 'modelscope' } }, [], {
          cwd, input: JSON.stringify({ tier: job.tier, items: todo.map(({ pdf, out, header }) => ({ pdf, out, header })) }),
          onJson(ev) {
            const x = todo[ev.i];
            if (ev.ev === 'start' && x) { cur = ev.i; step(ev.i, `${path.basename(x.rel)}（第 ${ev.i + 1} / ${n} 篇${ev.pages ? `，共 ${ev.pages} 页` : ''}${!ev.i && firstModels ? `；第一次用，先下载模型约 ${tier() === 'standard' ? '2' : '0.8'} GB，要等几分钟到半小时` : ''}）`, 'in_progress'); }
            else if (ev.ev === 'done' && x) { if (firstModels) models = true; result.ok.push({ out: x.outRel, pages: ev.pages, secs: ev.secs }); step(ev.i, `${path.basename(x.rel)} → ${x.outRel}`, 'completed', { path: x.outRel }); emit({ kind: 'progress', todo: { done: base + result.ok.length + result.failed.filter(f => f.i != null).length, total: base + n } }); }
            else if (ev.ev === 'fail' && x) { result.failed.push({ path: x.rel, msg: ev.msg, i: ev.i }); step(ev.i, `${path.basename(x.rel)}：没转好`, 'failed'); emit({ kind: 'progress', todo: { done: base + result.ok.length + result.failed.filter(f => f.i != null).length, total: base + n } }); }
            else if (ev.ev === 'fatal') emit({ kind: 'error', message: ev.msg + (ev.raw ? '\n\n原始信息：' + ev.raw : '') });
          },
          // MinerU 一段一段转（长文献分几段，一段几十页），日志里有「processing window 2/3: pages 65-128/150」：拿来显示转到第几页
          onStderr(text) {
            onStderr(text);
            const m = /processing window \d+\/\d+: pages (\d+)-(\d+)\/(\d+)/.exec(text), x = todo[cur];
            if (m && x && +m[3] > +m[2] - +m[1] + 1) step(cur, `${path.basename(x.rel)}（第 ${cur + 1} / ${n} 篇，在转第 ${m[1]}–${m[2]} / ${m[3]} 页）`, 'in_progress');
          },
          onExit(code, startError) {
            say();
            // 停掉或崩了：转到一半的那篇不留文件（脚本先写临时文件，转完才改名）
            const none = !result.ok.length && !result.skipped.length;
            finish(code === 0 && !none ? 0 : code === 0 ? 1 : code, startError ? 'MinerU 没能启动：' + startError : code === 0 && none ? '一篇都没转成，原因见上面' : undefined);
          }
        });
      })().catch(e => fail('准备转换时出错了', e.message));
      // 停止：tasks.cjs 拿返回值去 stop()；准备阶段（算 sha256）还没起进程时返回一个占位，停的时候直接结束
      return { stop() { stopped = true; if (child) common.stop(child); } }; // 还在挑文件、算 sha256 时停：不起进程，挑完就结束
    }
  };
  return { list, local, recheck, status, usable, checking: () => checking, install: INSTALL, tier, modelDirs };
}

module.exports = { createMineru, OUT_DIR, outOf, modelDirs, tier };
