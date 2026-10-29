'use strict';
// Claude Code 引擎：调用学员本机已安装、已用自己账号登录的原版 Claude Code（claude -p）。
// 不改它、不碰它的登录凭证、不替学员付费——这是 Anthropic 对第三方产品调用 Claude Code 的要求。
//
// 权限（2026-10-09 在 Claude Code 2.1.267 上实测）：
// - 文件编辑：acceptEdits 模式，只自动批准工作目录（和 --add-dir 加进来的 skills 目录）里的改动；
// - 命令：Mac / Linux 打开 Claude Code 自己的沙箱，命令只能写工作目录和临时目录，联网放开（检索文献要用），
//   并关掉「沙箱里失败就跳出沙箱重试」，沙箱起不来就直接报错，不悄悄裸跑。往桌面写文件实测被拒。
// - Windows 原生没有这个沙箱（官方文档：只有 macOS、Linux、WSL2 有），依乔淼的决定照样放行，但面板第一次切过来时提示风险。
// - MCP 工具只放行课程用到的几个；Gmail、云盘这类 claude.ai 连接器不放行，免得执行工作台指令时去发邮件。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const common = require('./engine-common.cjs');

const home = os.homedir();
const MCP_ALLOWED = ['zotero', 'scansci-pdf'];
// 额外放行的服务（内容 1.3.2，乔淼 10-26：日常版要让 AI 读写 Notion）：配置页里自己勾，默认一个都没有，学员不受影响。
// 名字是 claude mcp list 里的服务名；claude.ai 网页上连的（「claude.ai Notion」）在 Claude Code 里叫 mcp__claude_ai_Notion__…（10-26 实测）。
// 删除类工具照样不放行（Notion 的删页面、删数据库、删评论）
const mcpPrefix = name => 'mcp__' + String(name).replace(/^claude\.ai /, 'claude_ai ').replace(/[^A-Za-z0-9_-]/g, '_');
const MCP_DENY = { notion: ['notion-delete-pages', 'notion-delete-databases', 'notion-delete-comment'] };

function places() {
  const env = process.env, list = [];
  const add = (where, file) => list.push({ where, file });
  if (!common.WIN) {
    add('Claude Code 官方安装', path.join(home, '.local/bin/claude'));
    add('Claude Code 官方安装（旧版位置）', path.join(home, '.claude/local/claude'));
    for (const dir of [...common.pathDirs(), '/opt/homebrew/bin', '/usr/local/bin']) add('PATH：' + dir, path.join(dir, 'claude'));
    return list;
  }
  add('Claude Code 官方安装', path.join(home, '.local', 'bin', 'claude.exe'));
  for (const dir of [...common.pathDirs(), env.APPDATA && path.join(env.APPDATA, 'npm')].filter(Boolean)) {
    add('PATH：' + dir, path.join(dir, 'claude.exe')); add('npm 安装：' + dir, path.join(dir, 'claude.cmd'));
  }
  return list;
}

function args({ cwd, sessionId, model, extraMcp = [], writeDirs = [] }) {
  const extra = extraMcp.filter(n => !MCP_ALLOWED.includes(n));
  const allowed = ['Bash', 'WebFetch', 'WebSearch', 'Skill', ...MCP_ALLOWED.map(n => 'mcp__' + n), ...extra.map(mcpPrefix), ...(common.WIN ? ['PowerShell'] : [])];
  const denied = extra.flatMap(n => Object.entries(MCP_DENY).filter(([k]) => n.toLowerCase().includes(k)).flatMap(([, tools]) => tools.map(t => mcpPrefix(n) + '__' + t)));
  const skills = common.allSkillDirs(); // 所有 AI 程序的 skills 文件夹（造 skill 时装给 Codex / WorkBuddy 也写得进）
  const settings = common.WIN ? {} : { sandbox: { enabled: true, failIfUnavailable: true, allowUnsandboxedCommands: false, network: { allowedDomains: ['*'] } } };
  return ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'acceptEdits',
    '--settings', JSON.stringify(settings),
    // writeDirs：配置里「AI 还能写的文件夹」（内容 1.3.2，乔淼日常版：任务要往别的项目里放文件）。--add-dir 的目录改文件自动批准，沙箱里的命令也能写
    ...(skills.length || writeDirs.length ? ['--add-dir', ...skills, ...writeDirs] : []),
    '--allowedTools', ...allowed,
    ...(denied.length ? ['--disallowedTools', ...denied] : []),
    ...(model ? ['--model', model] : []),
    ...(sessionId ? ['--resume', sessionId] : [])];
}

const short = (v, n = 200) => { const s = typeof v === 'string' ? v : JSON.stringify(v || ''); return s.length > n ? s.slice(0, n) + ' …' : s; };

// 把一次工具调用翻译成面板上的一步
function toolView(b) {
  const i = b.input || {}, n = b.name || '';
  const v = { id: b.id, status: 'in_progress' };
  if (n === 'Bash' || n === 'PowerShell') return { ...v, type: 'command_execution', text: i.command };
  if (n === 'Write') return { ...v, type: 'file_change', files: [{ path: i.file_path, kind: 'add' }] };
  if (n === 'Edit' || n === 'MultiEdit' || n === 'NotebookEdit') return { ...v, type: 'file_change', files: [{ path: i.file_path || i.notebook_path, kind: 'update' }] };
  if (n === 'Read' || n === 'Glob' || n === 'Grep') return { ...v, type: 'read', text: `${n} ${i.file_path || i.pattern || i.path || ''}` };
  if (n === 'WebSearch') return { ...v, type: 'web_search', text: i.query };
  if (n === 'WebFetch') return { ...v, type: 'web_search', text: i.url };
  if (n === 'Skill') return { ...v, type: 'skill', text: i.skill || i.command || short(i) };
  if (n === 'Task' || n === 'Agent') return { ...v, type: 'subagent', text: i.description || short(i.prompt) };
  if (n === 'TodoWrite') return { ...v, type: 'todo_list', status: 'completed', todos: (i.todos || []).map(t => ({ text: t.content, completed: t.status === 'completed' })) };
  if (n.startsWith('mcp__')) return { ...v, type: 'mcp_tool_call', text: n.slice(5).split('__').join(' · ') };
  return { ...v, type: 'tool', text: n + ' ' + short(i, 120) };
}

function translator(emit, name = 'Claude Code') {
  const open = new Map(); // tool_use id → 已经发出去的那一步，收到结果时更新状态
  return ev => {
    if (ev.type === 'system' && ev.subtype === 'init') return emit({ kind: 'session', id: ev.session_id, model: ev.model });
    // 额度（10-17）：Claude Code 每次请求后会报一次订阅额度。只要 5 小时窗口；百分比（utilization）不一定有，没有就只报状态
    if (ev.type === 'rate_limit_event' && ev.rate_limit_info) {
      const r = ev.rate_limit_info;
      if (r.rateLimitType && r.rateLimitType !== 'five_hour') return;
      const u = typeof r.utilization === 'number' ? Math.round(r.utilization <= 1 ? r.utilization * 100 : r.utilization) : null;
      return emit({ kind: 'quota', quota: { status: r.status === 'rejected' ? 'limit' : r.status === 'allowed_warning' ? 'warn' : 'ok', pct: u, resetsAt: r.resetsAt ? r.resetsAt * 1000 : null, at: Date.now() } });
    }
    if (ev.type === 'assistant' && ev.message) {
      (ev.message.content || []).forEach((b, idx) => {
        if (b.type === 'text' && b.text && b.text.trim()) emit({ kind: 'item', item: { id: `${ev.message.id}:${idx}`, type: 'agent_message', status: 'completed', text: b.text } });
        else if (b.type === 'tool_use') { const v = toolView(b); open.set(b.id, v); emit({ kind: 'item', item: v }); }
      });
      return;
    }
    if (ev.type === 'user' && ev.message) {
      for (const b of ev.message.content || []) {
        if (b.type !== 'tool_result' || !open.has(b.tool_use_id)) continue;
        const v = { ...open.get(b.tool_use_id), status: b.is_error ? 'failed' : 'completed' };
        if (b.is_error && v.type === 'command_execution') v.exitCode = 1;
        open.delete(b.tool_use_id);
        emit({ kind: 'item', item: v });
      }
      return;
    }
    if (ev.type === 'result') {
      const u = ev.usage || {};
      emit({ kind: 'usage', usage: { input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0), output: u.output_tokens || 0, cached: u.cache_read_input_tokens || 0 } });
      // 被权限规则拦下的工具：写进过程里，学员能看到是哪一步没让做
      for (const d of ev.permission_denials || []) emit({ kind: 'item', item: { id: 'deny:' + d.tool_use_id, type: 'error', status: 'completed', text: `没放行：${d.tool_name} ${short(d.tool_input?.command || d.tool_input, 120)}` } });
      if (ev.is_error || (ev.subtype && ev.subtype !== 'success')) emit({ kind: 'error', message: typeof ev.result === 'string' && ev.result ? ev.result : `${name} 没跑完（${ev.subtype}）` });
    }
  };
}

module.exports = {
  id: 'claude', name: 'Claude Code', binTitle: '选择 Claude Code 程序（claude 或 claude.exe）',
  locate: custom => common.locate(places(), custom, ['@anthropic-ai', 'claude-code', 'cli.js']),
  models: () => ['opus', 'sonnet', 'haiku'],
  // 设置里显示：Claude Code 自己设置里的默认模型和 effort（~/.claude/settings.json；没写就是 Claude Code 的默认）
  defaults() {
    try { const d = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8')); return { model: d.model || '', effort: d.effortLevel || '' }; }
    catch { return { model: '', effort: '' }; }
  },
  // 执行前检查「需要的skill」：Claude Code 从这两处找 skill（插件里的 skill 带插件名前缀，课程的 skill 不走插件）
  skillDirs: cwd => [path.join(home, '.claude', 'skills'), path.join(cwd, '.claude', 'skills')],
  // 内容 1.2.0 起（多 AI 程序，乔淼 10-24）：原来写死在 runtime.cjs 里的「Claude Code 怎样、Codex 怎样」都挪到各自的文件里
  skillsHome: () => path.join(home, '.claude', 'skills'), skillsHomeLabel: '~/.claude/skills/',
  client: '打开终端，运行 claude',
  mcpConfig: '用 claude mcp add --scope user … 添加，存在 ~/.claude.json 里（用户级那一份）',
  // 设置里的 Zotero 检查：用户级的 MCP 服务在 ~/.claude.json 的 mcpServers 里（claude mcp add --scope user）
  hasMcp(name) { try { return !!(JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).mcpServers || {})[name]; } catch { return false; } },
  // 这个 MCP 服务配了哪些环境变量（只要名字，不读值）：Zotero 服务配没配网页版 key 决定能不能入库
  mcpEnvKeys(name) { try { return Object.keys(((JSON.parse(fs.readFileSync(path.join(home, '.claude.json'), 'utf8')).mcpServers || {})[name] || {}).env || {}); } catch { return []; } },
  missingHint: `没找到 Claude Code 命令行版：点「怎么装」，复制一行命令到${common.WIN ? ' PowerShell ' : '「终端」'}里装好、登录，再点「重新检测」。`,
  // 「怎么装」弹窗用（10-22 乔淼：要写明得先装命令行版）。命令来自 Anthropic 官方安装说明 code.claude.com/docs/en/setup
  install: {
    note: 'POPPER 用的是 Claude Code 命令行版。Claude 桌面 App（平时聊天的那个）不算，要另外装这个。',
    shell: common.WIN ? 'PowerShell' : '终端',
    open: common.WIN ? '点开始菜单，搜「PowerShell」，打开它' : '按 ⌘ + 空格，搜「终端」，打开它',
    cmd: common.WIN ? 'irm https://claude.ai/install.ps1 | iex' : 'curl -fsSL https://claude.ai/install.sh | bash',
    login: `装完关掉这个${common.WIN ? ' PowerShell ' : '终端'}窗口、再开一个，输入 claude 回车，按提示用你的 Claude 账号登录（要 Pro 或 Max 订阅，免费账号用不了 Claude Code）。`
  },
  // Windows 原生没有沙箱，命令可能写到工作目录以外（依乔淼的决定：允许，但第一次使用时提示）
  riskNotice: common.WIN ? 'Windows 上 Claude Code 没有沙箱：它跑的命令（比如 Python 脚本）有可能写到工作目录以外的地方。Codex 没有这个问题。确定要用 Claude Code 吗？' : '',
  start(bin, { cwd, prompt, sessionId, model, extraMcp, writeDirs, emit, onStderr, onExit }) {
    return common.run(bin, args({ cwd, sessionId, model, extraMcp, writeDirs }), { cwd, input: prompt, onJson: translator(emit), onStderr, onExit });
  },
  // 这台电脑上 Claude Code 连着哪些服务（claude mcp list，不调模型、不花额度；要等它逐个检查连接，十几秒）。课程本来就放行的不列
  async listMcp(bin) {
    const out = await common.exec(bin, ['mcp', 'list'], 90000);
    if (out == null) return null;
    return out.split('\n').map(l => l.match(/^(.+?): .* - (.+)$/)).filter(Boolean).map(m => ({ name: m[1].trim(), ok: /connected|✔/i.test(m[2]) && !/needs|fail|✗/i.test(m[2]) }))
      .filter(x => !MCP_ALLOWED.includes(x.name) && !/^plugin:/.test(x.name));
  },
  mcpDeny: MCP_DENY,
  stop: common.stop,
  translator, // CodeBuddy Code（WorkBuddy）的输出格式和 Claude Code 一样，共用这段翻译（内容 1.2.1）
  friendlyError(msg) {
    if (/session expired|could not be refreshed|token expired/i.test(msg)) return 'Claude Code 的登录过期了：打开终端运行 claude，输入 /login，用你自己的 Claude 账号重新登录一次，再回来点「重试」。\n\n原始信息：' + msg;
    if (/invalid api key|please run \/login|not logged in|authentication|failed to authenticate/i.test(msg)) return 'Claude Code 还没登录：打开终端运行 claude，按提示用你自己的 Claude 账号登录一次，再回来重试。\n\n原始信息：' + msg;
    if (/sandbox/i.test(msg) && /unavailable|not available|failed to start/i.test(msg)) return 'Claude Code 的沙箱没能启动，为了安全这次没有执行。把运行记录发给老师。\n\n原始信息：' + msg;
    return msg;
  }
};
