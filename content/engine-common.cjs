'use strict';
// 两个引擎（Codex、Claude Code）共用的底层：找程序、看版本、启动、逐行读 JSON 输出、停止。
const { spawn, spawnSync, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const WIN = process.platform === 'win32';
const pathDirs = () => (process.env.PATH || '').split(path.delimiter).filter(Boolean);
const isFile = f => { try { return fs.statSync(f).isFile(); } catch { return false; } };

// 把一个文件变成可以直接启动的命令：spawn(file, [...prefix, ...args]) 一律不经过命令行外壳，
// 这样中文路径、空格、引号都不会被拆错。npmJs 是 npm 装的 .cmd 背后那个 js 的相对路径
function launcher(file, where, npmJs) {
  if (/\.cmd$/i.test(file)) {
    // 新版 Node 不允许不经外壳直接启动 .cmd，改为直接跑它背后的 js
    const js = path.join(path.dirname(file), 'node_modules', ...npmJs);
    if (!fs.existsSync(js)) return null;
    file = js;
  }
  // .js 要用 Node 跑；在 App 里 process.execPath 是程序本身，让它以 Node 身份运行
  if (/\.m?js$/i.test(file)) return { file: process.execPath, prefix: [file], label: where, path: file, env: { ELECTRON_RUN_AS_NODE: '1' } };
  return { file, prefix: [], label: where, path: file };
}

// 看版本：不阻塞（以前用 spawnSync，启动时一个个等，程序多、电脑冷启动时窗口要等好几秒才出来）
function version(bin) {
  if (!bin) return Promise.resolve(null);
  return new Promise(res => execFile(bin.file, [...bin.prefix, '--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true, env: cleanEnv(bin.env) },
    (err, out) => res(err ? null : String(out).trim().split('\n')[0])));
}

// 跑一次命令拿输出（比如 claude mcp list）：不阻塞，出错或超时给 null
function exec(bin, args, timeout = 60000) {
  if (!bin) return Promise.resolve(null);
  return new Promise(res => execFile(bin.file, [...bin.prefix, ...args], { encoding: 'utf8', timeout, windowsHide: true, env: cleanEnv(bin.env), maxBuffer: 4 << 20 },
    (err, out) => res(err && !out ? null : String(out || ''))));
}

const num = v => (String(v).match(/(\d+)\.(\d+)\.(\d+)/) || []).slice(1).map(Number);
function newer(a, b) { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; }

// 在候选位置里找能用的、版本最新的那个。custom 是学员手动选的程序，选了就只用它。
// 各候选的版本同时查（返回 Promise），「试过的位置」仍按原来的顺序列
async function locate(places, custom, npmJs) {
  const list = custom ? [{ where: '手动指定', file: custom }] : places;
  const seen = new Set(), rows = [];
  for (const { where, file } of list) {
    if (seen.has(file)) continue; seen.add(file);
    if (!isFile(file)) { if (custom || /桌面版|独立安装|官方安装/.test(where)) rows.push({ where, file, bin: null, missing: true }); continue; }
    rows.push({ where, file, bin: launcher(file, where, npmJs) });
  }
  await Promise.all(rows.map(async r => { if (r.bin) r.bin.version = await version(r.bin); }));
  const tried = [];
  let best = null;
  for (const { where, file, bin, missing } of rows) {
    tried.push({ where, file, result: missing ? '没有' : bin?.version || '找到了但运行不了' });
    if (bin?.version && (!best || newer(bin.version, best.version))) best = bin;
  }
  return { best, tried };
}

// 在 Claude Code 里打开 App 时环境里会带着它的标记，传下去会让子进程以为自己嵌在别的会话里
function cleanEnv(extra) {
  const env = { ...process.env, ...extra };
  for (const k of ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_SSE_PORT']) delete env[k];
  return env;
}

// 启动引擎程序，标准输入送进指令，标准输出一行一个 JSON 事件
function run(bin, args, { cwd, input, env, onJson, onStderr, onExit }) {
  const child = spawn(bin.file, [...bin.prefix, ...args], { cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true, env: cleanEnv({ ...bin.env, ...env }) });
  let buffer = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, i).trim(); buffer = buffer.slice(i + 1);
      if (!line) continue;
      let ev; try { ev = JSON.parse(line); } catch { onStderr(line + '\n'); continue; }
      onJson(ev);
    }
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', onStderr);
  let done = false;
  const finish = (code, err) => { if (!done) { done = true; onExit(code, err); } };
  child.on('error', e => finish(null, '无法启动：' + e.message));
  child.on('close', code => finish(code));
  child.stdin.on('error', () => {});
  child.stdin.end(input);
  return child;
}

function stop(child) {
  if (!child || child.exitCode !== null) return;
  // Windows 上引擎会再起子进程，只杀外层杀不干净
  if (WIN) spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else child.kill('SIGTERM');
}

// 所有 AI 程序的 skills 文件夹（10-26 乔淼：在 Claude Code 里用「数据 skill 工坊」给 Codex 造 skill，写不进 ~/.codex/skills）：
// 交任务时每个 AI 程序都把这几个加进可写范围，造 skill / 装 skill 时装到哪个 AI 都行。只放开 skills 文件夹，各 AI 程序自己的设置照样写不了。
// 那个 AI 程序装了（它的文件夹在）、skills 文件夹还没有的，先建出来——沙箱里建不了
function allSkillDirs() {
  const os = require('node:os'), home = os.homedir();
  const list = [[path.join(home, '.claude'), 'skills'], [home, '.agents/skills'], [process.env.CODEX_HOME || path.join(home, '.codex'), 'skills'], [path.join(home, '.codebuddy'), 'skills']];
  return list.map(([root, sub]) => { const d = path.join(root, ...sub.split('/')); if (!fs.existsSync(d) && fs.existsSync(root) && root !== home) try { fs.mkdirSync(d, { recursive: true }); } catch {} return d; }).filter(d => fs.existsSync(d));
}

module.exports = { WIN, pathDirs, isFile, launcher, version, exec, locate, newer, run, stop, allSkillDirs };
