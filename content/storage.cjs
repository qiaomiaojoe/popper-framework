'use strict';
const { APP } = require('./app-name.cjs');
// 「AI学术环境配置 → 空间占用」（内容 1.1.11 起，乔淼 10-23：学员问磁盘为什么占得快、去哪清理）。
// 10-23 在乔淼 Mac 上量的：POPPER 自己只有几 MB；大头是 Codex 把每个旧版本都留着（~/.codex/packages/*/releases/，一个约 300 MB），
// 其次是 Codex、Claude Code 的对话记录。这里只算占用、只清两样：Codex 的旧版本、3 个月以前的 Codex 对话记录；都是移进废纸篓 / 回收站，不直接删。
// 外壳没有「移进废纸篓」的接口（要出新安装包），所以在内容层自己做：Mac 挪进 ~/.Trash，Windows 用系统自带的 PowerShell 送进回收站。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const { modelDirs } = require('./mineru.cjs');
const WIN = process.platform === 'win32';
const codexHome = () => process.env.CODEX_HOME || path.join(os.homedir(), '.codex');

// 文件夹多大：一个个加，不跟符号链接；文件太多时只数前 20 万个（够看个大概）
async function sizeOf(p) {
  let bytes = 0, n = 0;
  const walk = async dir => {
    let list; try { list = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const d of list) {
      if (++n > 200000) return;
      const f = path.join(dir, d.name);
      if (d.isDirectory()) await walk(f);
      else if (d.isFile()) try { bytes += (await fs.promises.stat(f)).size; } catch {}
    }
  };
  try { const st = await fs.promises.lstat(p); if (st.isDirectory()) await walk(p); else if (st.isFile()) bytes = st.size; } catch {}
  return bytes;
}

const num = v => String(v || '').split(/[.-]/).slice(0, 3).map(n => parseInt(n, 10) || 0);
const cmpVer = (a, b) => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };
// Codex 的旧版本：packages/<名字>/releases/<版本> 里，除了 current 指着的那个、和版本号最大的那个，都算旧的
function codexOldReleases() {
  const out = [], pk = path.join(codexHome(), 'packages');
  let kinds = []; try { kinds = fs.readdirSync(pk); } catch { return out; }
  for (const k of kinds) {
    const rel = path.join(pk, k, 'releases');
    let vers = []; try { vers = fs.readdirSync(rel, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name); } catch { continue; }
    if (vers.length < 2) continue;
    let cur = ''; try { cur = path.basename(fs.realpathSync(path.join(pk, k, 'current'))); } catch {}
    const newest = [...vers].sort(cmpVer).pop();
    for (const v of vers) if (v !== cur && v !== newest) out.push(path.join(rel, v));
  }
  return out;
}
// 3 个月以前的 Codex 对话记录：sessions/<年>/<月>/
function codexOldSessions(months = 3) {
  const out = [], root = path.join(codexHome(), 'sessions'), now = new Date();
  const cut = now.getFullYear() * 12 + now.getMonth() - months; // 早于这个月份的都算旧
  let years = []; try { years = fs.readdirSync(root).filter(y => /^\d{4}$/.test(y)); } catch { return out; }
  for (const y of years) {
    let ms = []; try { ms = fs.readdirSync(path.join(root, y)).filter(m => /^\d{2}$/.test(m)); } catch { continue; }
    for (const m of ms) if (+y * 12 + (+m - 1) < cut) out.push(path.join(root, y, m));
  }
  return out;
}

// 移进废纸篓 / 回收站。Mac 上起个看得懂的名字（不然废纸篓里只是「05」「0.150.0」）；Windows 回收站自己记着原来的位置，能还原
function trash(p, nice) {
  if (WIN) {
    const ps = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const cmd = "Add-Type -AssemblyName Microsoft.VisualBasic; $p = $env:POPPER_TRASH; if (Test-Path -LiteralPath $p -PathType Container) { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory($p, 'OnlyErrorDialogs', 'SendToRecycleBin') } else { [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile($p, 'OnlyErrorDialogs', 'SendToRecycleBin') }";
    const r = spawnSync(fs.existsSync(ps) ? ps : 'powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], { windowsHide: true, encoding: 'utf8', env: { ...process.env, POPPER_TRASH: p }, timeout: 120000 });
    if (r.status !== 0 || fs.existsSync(p)) throw Error(((r.stderr || '') + (r.error ? r.error.message : '')).trim().slice(0, 200) || '没能移进回收站（可能有程序正在用它）');
    return ''; // 回收站：撤销不了，学员自己去回收站还原
  }
  const bin = path.join(os.homedir(), '.Trash');
  fs.mkdirSync(bin, { recursive: true });
  const base = nice || path.basename(p);
  let dest = path.join(bin, base), i = 1;
  while (fs.existsSync(dest)) dest = path.join(bin, `${base} ${++i}`);
  try { fs.renameSync(p, dest); return dest; }
  catch (e) {
    // macOS 可能不让程序直接往废纸篓里放（隐私保护）：改请访达来做（第一次会问要不要允许 POPPER 控制「访达」）
    if (!['EPERM', 'EACCES'].includes(e.code)) throw e;
    const r = spawnSync('/usr/bin/osascript', ['-e', 'on run argv', '-e', 'tell application "Finder" to delete (POSIX file (item 1 of argv) as alias)', '-e', 'end run', p], { encoding: 'utf8', timeout: 120000 });
    if (r.status !== 0 || fs.existsSync(p)) throw Error('没能移进废纸篓：' + ((r.stderr || '').trim().slice(0, 160) || e.message));
    return ''; // 访达放的：不知道在废纸篓里叫什么，撤销不了
  }
}

function createStorage({ dataDir, projectDirs }) {
  const home = os.homedir(), ch = codexHome();
  const label = p => p.startsWith(home) ? (WIN ? '%USERPROFILE%' : '~') + p.slice(home.length) : p;
  async function report() {
    const olds = codexOldReleases(), oldSess = codexOldSessions();
    const sum = async list => (await Promise.all(list.map(sizeOf))).reduce((a, b) => a + b, 0);
    const dirs = [...new Set(projectDirs())];
    // MinerU（内容 1.2.3）：程序（uv 给它的独立环境）和模型（~/.mineru，下载时 Hugging Face / ModelScope 缓存里它的那几个文件夹）
    const mDirs = modelDirs().flatMap(d => { if (!d.only) return fs.existsSync(d.path) ? [d.path] : []; try { return fs.readdirSync(d.path).filter(n => d.only.test(n)).map(n => path.join(d.path, n)); } catch { return []; } });
    const mProg = WIN ? path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'uv', 'data', 'tools', 'mineru') : path.join(process.env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'uv', 'tools', 'mineru');
    const [codex, codexOld, sessions, sessionsOld, claudeProj, popper, projects, mModels, mProgSize] = await Promise.all([
      sizeOf(ch), sum(olds), sizeOf(path.join(ch, 'sessions')), sum(oldSess), sizeOf(path.join(home, '.claude', 'projects')), sizeOf(dataDir), sum(dirs), sum(mDirs), sizeOf(mProg)]);
    return { trashName: WIN ? '回收站' : '废纸篓', items: [
      { id: 'codex', name: 'Codex', where: label(ch), bytes: codex, exists: fs.existsSync(ch),
        clean: [{ id: 'codex-old', label: `旧版本 ${olds.length} 个`, bytes: codexOld, count: olds.length },
                { id: 'codex-sessions-old', label: '3 个月以前的对话记录', bytes: sessionsOld, count: oldSess.length }], sessions },
      { id: 'claude', name: 'Claude Code 对话记录', where: label(path.join(home, '.claude', 'projects')), bytes: claudeProj, exists: fs.existsSync(path.join(home, '.claude', 'projects')), note: 'Claude Code 默认自己删 30 天以前的' },
      { id: 'mineru', name: 'MinerU（程序和模型）', where: [label(mProg), ...mDirs.map(label)].join('、'), bytes: mModels + mProgSize, exists: mDirs.length > 0 || fs.existsSync(mProg), note: `转 PDF 用的；不用了在${WIN ? ' PowerShell ' : '终端'}里运行 uv tool uninstall mineru，再把 ${WIN ? '%USERPROFILE%\\.mineru' : '~/.mineru'} 移进${WIN ? '回收站' : '废纸篓'}` },
      { id: 'popper', name: APP + ' 自己的数据', where: label(dataDir), bytes: popper, exists: true, note: '设置、项目列表、任务记录，不要删' },
      { id: 'projects', name: `项目文件（${dirs.length} 个项目）`, where: '', bytes: projects, exists: true, note: '论文 PDF、稿子都在这里，按需要自己整理' }
    ] };
  }
  function clean(id) {
    const list = id === 'codex-old' ? codexOldReleases() : id === 'codex-sessions-old' ? codexOldSessions() : null;
    if (!list) throw Object.assign(Error('没有这一项'), { status: 400 });
    const done = [], errors = [];
    for (const p of list) {
      const nice = id === 'codex-old' ? `Codex旧版本-${path.basename(path.dirname(path.dirname(p)))}-${path.basename(p)}` : `Codex对话记录-${path.relative(path.join(ch, 'sessions'), p).split(path.sep).join('-')}`;
      try { trash(p, nice); done.push(nice); } catch (e) { errors.push(`${nice}：${e.message}`); }
    }
    return { moved: done, errors };
  }
  return { report, clean };
}

module.exports = { createStorage, codexOldReleases, codexOldSessions, trash };
