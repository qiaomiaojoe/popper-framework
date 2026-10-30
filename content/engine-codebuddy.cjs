'use strict';
const { APP } = require('./app-name.cjs');
// WorkBuddy 引擎（内容 1.2.1，乔淼 10-24）：调用学员本机装好、用自己的腾讯账号登录的 CodeBuddy Code 命令行版（codebuddy -p）。
// 腾讯把它叫 CodeBuddy Code，官网和学员熟悉的名字是 WorkBuddy（workbuddy.ai/cli），界面上显示 WorkBuddy。
// 好处：选「国内站」登录不用翻墙，能用混元、DeepSeek、GLM、Kimi 等国内模型（也有 GPT、Gemini）。
// 它的命令行参数和输出（stream-json）照搬 Claude Code，所以输出翻译直接用 engine-claude.cjs 的那一段。
// 权限：后台跑时要事先放行（没人点确认）。和 Claude Code 一样用 acceptEdits（只自动批准工作目录里的改动）+ 只放行课程用到的工具。
// 沙箱：见 SANDBOX 那段注释（10-24 实测）。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const common = require('./engine-common.cjs');
const { translator } = require('./engine-claude.cjs');

const home = os.homedir();
const MCP_ALLOWED = ['zotero', 'scansci-pdf'];
const cbHome = path.join(home, '.codebuddy');

function places() {
  const env = process.env, list = [];
  const add = (where, file) => list.push({ where, file });
  const nvm = path.join(home, '.nvm', 'versions', 'node');
  let nvmDirs = []; try { nvmDirs = fs.readdirSync(nvm).sort().reverse().map(v => path.join(nvm, v, 'bin')); } catch {}
  if (!common.WIN) {
    add('官方安装', path.join(cbHome, 'bin', 'codebuddy'));
    for (const dir of [...common.pathDirs(), '/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.local', 'bin'), path.join(home, '.npm-global', 'bin'), ...nvmDirs]) add('PATH：' + dir, path.join(dir, 'codebuddy'));
    return list;
  }
  add('官方安装', path.join(cbHome, 'bin', 'codebuddy.exe'));
  for (const dir of [...common.pathDirs(), env.APPDATA && path.join(env.APPDATA, 'npm')].filter(Boolean)) {
    add('PATH：' + dir, path.join(dir, 'codebuddy.exe')); add('npm 安装：' + dir, path.join(dir, 'codebuddy.cmd'));
  }
  return list;
}

// 用户级的 MCP 服务配在这几个文件里，按这个顺序用第一个存在的（官方文档 workbuddy.ai/docs/cli/mcp）
const MCP_FILES = [path.join(cbHome, '.mcp.json'), path.join(cbHome, 'mcp.json'), path.join(home, '.codebuddy.json')];
function mcpServers() {
  for (const f of MCP_FILES) {
    if (!fs.existsSync(f)) continue;
    try { return JSON.parse(fs.readFileSync(f, 'utf8').replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1')).mcpServers || {}; } catch { return {}; } // 允许注释和末尾逗号（JSONC）
  }
  return {};
}

// 沙箱（10-24 实测）：CodeBuddy 不认 Claude Code 那种 settings.sandbox——给了照样能往桌面写文件；它自己的 --sandbox 要 Docker，学员电脑上一般没有。
// 所以 Mac 上 POPPER 自己把它整个放进 macOS 自带的沙箱（sandbox-exec，Claude Code 在 Mac 上也是靠它）：
// 只许写项目文件夹、它自己的 ~/.codebuddy、临时文件夹；读文件和联网照常（检索文献要联网）。它的所有工具（Bash、写文件、改文件）都受这个限制。
// Windows 没有这种沙箱：第一次用时弹风险提示（和 Windows 上的 Claude Code 一样）。
const SANDBOX = process.platform === 'darwin' && fs.existsSync('/usr/bin/sandbox-exec');
const sbq = p => '"' + String(p).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
function profile(cwd, writeDirs = []) {
  const real = p => { try { return fs.realpathSync(p); } catch { return p; } };
  const tmp = real(os.tmpdir());
  const skills = common.allSkillDirs(); // 别的 AI 程序的 skills 文件夹也能写（造 skill 时装给它们）
  const dirs = [real(cwd), ...writeDirs, ...writeDirs.map(real), ...skills, ...skills.map(real), cbHome, real(cbHome), '/private/tmp', '/private/var/folders', tmp, path.join(home, 'Library', 'Caches'), path.join(home, '.npm')];
  return `(version 1)\n(allow default)\n(deny file-write*)\n(allow file-write* ${[...new Set(dirs)].map(d => `(subpath ${sbq(d)})`).join(' ')} (subpath "/dev"))\n`;
}
function args({ sessionId, model, writeDirs = [] }) {
  const allowed = ['Bash', 'WebFetch', 'WebSearch', 'Skill', ...MCP_ALLOWED.map(n => 'mcp__' + n), ...(common.WIN ? ['PowerShell'] : [])];
  return ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
    ...(common.allSkillDirs().length ? ['--add-dir', ...common.allSkillDirs()] : []),
    ...(writeDirs.length ? ['--add-dir', ...writeDirs] : []), // 配置里「AI 还能写的文件夹」（内容 1.3.2）
    '--allowedTools', ...allowed,
    ...(model ? ['--model', model] : []),
    ...(sessionId ? ['--resume', sessionId] : [])];
}

module.exports = {
  id: 'codebuddy', name: 'WorkBuddy', binTitle: '选择 WorkBuddy（CodeBuddy Code）程序（codebuddy）',
  locate: custom => common.locate(places(), custom, ['@tencent-ai', 'codebuddy-code', 'codebuddy']),
  // 能用哪些要看账号（国内站 / 国际站不一样），这里列 codebuddy --help 里写的常用几个；空着就是它自己的默认
  // DeepSeek 放最前面（乔淼 10-24：国内大家用 DeepSeek 最多）
  models: () => ['deepseek-v4.1-flash', 'deep-model', 'primary-model', 'balanced-model', 'fast-model', 'hy3', 'glm-5.3', 'kimi-k3'],
  defaults() {
    try { const d = JSON.parse(fs.readFileSync(path.join(cbHome, 'settings.json'), 'utf8')); return { model: d.model || '', effort: d.effortLevel || d.effort || '' }; }
    catch { return { model: '', effort: '' }; }
  },
  skillDirs: cwd => [path.join(cbHome, 'skills'), path.join(cwd, '.codebuddy', 'skills')],
  skillsHome: () => path.join(cbHome, 'skills'), skillsHomeLabel: '~/.codebuddy/skills/',
  client: '打开终端，运行 codebuddy',
  mcpConfig: '用 codebuddy mcp add --scope user … 添加，存在 ~/.codebuddy/.mcp.json 里',
  hasMcp: name => !!mcpServers()[name],
  mcpEnvKeys: name => Object.keys((mcpServers()[name] || {}).env || {}),
  missingHint: `没找到 WorkBuddy 命令行版（CodeBuddy Code）：点「怎么装」，复制一行命令到${common.WIN ? ' PowerShell ' : '「终端」'}里装好、登录，再点「重新检测」。`,
  // 「怎么装」：官方装法（workbuddy.ai/docs/cli/installation）。Mac 用 npm（要 Node.js 18 以上）；Windows 有不用 Node.js 的官方安装脚本
  install: {
    note: common.WIN
      ? APP + ' 用的是 WorkBuddy 的命令行版（腾讯 CodeBuddy Code）。选「国内站」用腾讯账号登录，不用翻墙。'
      : APP + ' 用的是 WorkBuddy 的命令行版（腾讯 CodeBuddy Code）。选「国内站」用腾讯账号登录，不用翻墙。要先有 Node.js 18 以上：在终端里输入 node -v 回车，出版本号就有；没有的话先装（有 Homebrew 就运行 brew install node，或者去 nodejs.org 下载 LTS 版）。',
    shell: common.WIN ? 'PowerShell' : '终端',
    open: common.WIN ? '点开始菜单，搜「PowerShell」，打开它' : '按 ⌘ + 空格，搜「终端」，打开它',
    cmd: common.WIN ? 'irm https://copilot.tencent.com/cli/install.ps1 | iex' : 'npm install -g @tencent-ai/codebuddy-code',
    login: `装完关掉这个${common.WIN ? ' PowerShell ' : '终端'}窗口、再开一个，输入 codebuddy 回车，登录方式选「国内站」（Chinese Site），用你的腾讯账号登录。${common.WIN ? '' : ' 提示没有权限（EACCES）的话，在命令前面加 sudo 再运行一次。'}`
  },
  riskNotice: SANDBOX ? '' : 'Windows 上 WorkBuddy 没有沙箱：它跑的命令（比如 Python 脚本）有可能写到工作目录以外的地方。确定要用 WorkBuddy 吗？',
  start(bin, { cwd, prompt, sessionId, model, writeDirs, emit, onStderr, onExit }) {
    const a = args({ cwd, sessionId, model, writeDirs });
    // Mac：整个放进沙箱跑（见上面 SANDBOX）：sandbox-exec -p <规则> <原来的程序> <原来的参数>…
    if (SANDBOX) return common.run({ ...bin, file: '/usr/bin/sandbox-exec', prefix: ['-p', profile(cwd, writeDirs || []), bin.file, ...(bin.prefix || [])] }, a, { cwd, input: prompt, onJson: translator(emit, 'WorkBuddy'), onStderr, onExit });
    return common.run(bin, a, { cwd, input: prompt, onJson: translator(emit, 'WorkBuddy'), onStderr, onExit });
  },
  stop: common.stop,
  friendlyError(msg) {
    if (/not logged in|please (log ?in|login)|unauthori[sz]ed|authentication|未登录|请先登录|登录已过期/i.test(msg)) return 'WorkBuddy 还没登录或登录过期了：打开终端运行 codebuddy，登录方式选「国内站」，用你的腾讯账号登录一次，再回来点「重试」。\n\n原始信息：' + msg;
    if (/sandbox/i.test(msg) && /unavailable|not available|failed to start/i.test(msg)) return 'WorkBuddy 的沙箱没能启动，为了安全这次没有执行。把运行记录发给老师。\n\n原始信息：' + msg;
    return msg;
  }
};
