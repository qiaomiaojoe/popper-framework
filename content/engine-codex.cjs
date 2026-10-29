'use strict';
// Codex 引擎：调用学员本机已登录的 Codex 命令行（codex exec），用它自己的沙箱把写权限限制在工作目录。
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const common = require('./engine-common.cjs');

const home = os.homedir();
const codexHome = () => process.env.CODEX_HOME || path.join(home, '.codex');

// 依次列出可能装着 Codex 的位置（找到的、没找到的都记下来，面板上给学员看，方便排错）
function places() {
  const env = process.env, list = [];
  const add = (where, file) => list.push({ where, file });
  if (!common.WIN) {
    // ChatGPT 桌面版自带一份 Codex 命令行，跟着 App 更新，和 ChatGPT 共用登录
    add('ChatGPT 桌面版自带', '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex');
    add('ChatGPT 桌面版自带（用户应用程序）', path.join(home, 'Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex'));
    add('Codex 独立安装', path.join(codexHome(), 'packages/standalone/current/bin/codex'));
    for (const dir of [...common.pathDirs(), path.join(home, '.local/bin'), '/opt/homebrew/bin', '/usr/local/bin']) add('PATH：' + dir, path.join(dir, 'codex'));
    return list;
  }
  // Windows：ChatGPT 桌面版（10-21 乔淼 Windows 虚拟机实测）把 Codex 放在 %LOCALAPPDATA%\OpenAI\Codex\bin\<一串编号>\codex.exe，
  // 编号随 ChatGPT 更新而变，按修改时间新的在前都列上
  if (env.LOCALAPPDATA) {
    const bin = path.join(env.LOCALAPPDATA, 'OpenAI', 'Codex', 'bin');
    let dirs = [];
    try { dirs = fs.readdirSync(bin).map(n => ({ n, t: (() => { try { return fs.statSync(path.join(bin, n)).mtimeMs; } catch { return 0; } })() })).sort((a, b) => b.t - a.t); } catch {}
    for (const { n } of dirs) add('ChatGPT 桌面版自带', path.join(bin, n, 'codex.exe'));
    if (!dirs.length) add('ChatGPT 桌面版自带', path.join(bin, '…', 'codex.exe'));
  }
  // 其他安装方式的位置也随安装方式不同，常见的几处都看一眼
  const roots = [env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, 'Programs'), env.LOCALAPPDATA, env.ProgramFiles, env['ProgramFiles(x86)']].filter(Boolean);
  for (const root of roots) {
    let names = [];
    try { names = fs.readdirSync(root).filter(n => /chatgpt|codex|openai/i.test(n)); } catch {}
    for (const n of names) {
      add('ChatGPT / Codex 桌面版自带', path.join(root, n, 'resources', 'codex-cli', 'bin', 'codex.exe'));
      add('ChatGPT / Codex 桌面版自带', path.join(root, n, 'resources', 'codex.exe'));
    }
  }
  add('Codex 独立安装', path.join(codexHome(), 'packages', 'standalone', 'current', 'bin', 'codex.exe'));
  add('Codex 独立安装', path.join(codexHome(), 'packages', 'standalone', 'current', 'codex.exe'));
  if (env.LOCALAPPDATA) add('Codex 独立安装', path.join(env.LOCALAPPDATA, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'));
  add('Codex 独立安装', path.join(home, '.local', 'bin', 'codex.exe'));
  for (const dir of [...common.pathDirs(), env.APPDATA && path.join(env.APPDATA, 'npm')].filter(Boolean)) {
    add('PATH：' + dir, path.join(dir, 'codex.exe')); add('npm 安装：' + dir, path.join(dir, 'codex.cmd'));
  }
  return list;
}

// 本机 Codex 命令行能用的模型（Codex 自己缓存的列表）
function models() {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(codexHome(), 'models_cache.json'), 'utf8'));
    return (data.models || []).filter(m => m.visibility === 'list').map(m => m.slug).filter(Boolean);
  } catch { return []; }
}

// Zotero：Codex 给 MCP 的每个工具单独管审批，没批准过的工具在后台跑时会被自动拒绝（10-11 写综述时 zotero_advanced_search 被拒）。
// 这里只给工作站发起的这次运行临时批准，不改用户自己的 Codex 设置。读取、检索、入库、打标签都放行；
// 删笔记（zotero_delete_note）、合并重复条目（zotero_merge_duplicates）会删改文献库，不放行（用到时 Codex 会说被拒）。
const ZOTERO_TOOLS = ['search', 'fetch', 'scite_check_retractions', 'scite_enrich_item', 'scite_enrich_search',
  'zotero_search_items', 'zotero_advanced_search', 'zotero_semantic_search', 'zotero_search_by_tag', 'zotero_search_by_citation_key',
  'zotero_search_collections', 'zotero_search_notes', 'zotero_get_collections', 'zotero_get_collection_items', 'zotero_get_item_metadata',
  'zotero_get_item_fulltext', 'zotero_get_item_children', 'zotero_get_items_children', 'zotero_get_annotations', 'zotero_get_notes',
  'zotero_get_pdf_outline', 'zotero_get_recent', 'zotero_get_tags', 'zotero_get_feed_items', 'zotero_list_feeds', 'zotero_list_libraries',
  'zotero_get_search_database_status', 'zotero_find_duplicates', 'zotero_switch_library', 'zotero_update_search_database',
  'zotero_add_by_doi', 'zotero_add_by_url', 'zotero_add_from_file', 'zotero_create_collection', 'zotero_manage_collections',
  'zotero_batch_update_tags', 'zotero_update_item', 'zotero_create_note', 'zotero_update_note', 'zotero_create_annotation', 'zotero_create_area_annotation',
  // zotero-mcp 0.15 起改了名字、加了工具（10-23）：删条目 / 删分类 / 删批注、合并重复、改父条目、弹窗要本机写权限这几个不放行
  'zotero_add_item', 'zotero_attach_file', 'zotero_set_item_collections', 'zotero_batch_update', 'zotero_manage_note', 'zotero_update_annotation',
  'zotero_update_collection', 'zotero_add_item_relation', 'zotero_get_item_related', 'zotero_get_attachment_path', 'zotero_read_pdf_pages', 'zotero_get_page_layout',
  'zotero_write_capabilities', 'zotero_export_bibliography', 'zotero_find_related_papers', 'zotero_library_coverage', 'zotero_literature_review',
  'zotero_synthesize_annotations', 'zotero_synthesize_my_notes', 'zotero_find_contradicting_evidence', 'zotero_expand_from_paper'];
// 另外：Codex 自带的官方 Zotero 插件（zotero@openai-curated）会把 Codex 引到 ChatGPT 的 Zotero 应用上，那边的工具同样要审批、
// 也不是 skills 用的那套。这次运行里临时关掉它，让 Codex 只用本机的 zotero 服务（10-11 实测：不关的话 Codex 会挑它，然后被拒）。
// 只有用户的 Codex 设置里真有叫 zotero 的服务时才加批准：没有的话，这些设置会凭空造出一个不完整的 zotero 服务，
// Codex 直接启动失败（「invalid transport in mcp_servers.zotero」，10-11 实测）。关插件那条对没装插件的电脑无害。
const reEsc = x => x.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
function hasServer(name) {
  try { return new RegExp(`^\\s*\\[mcp_servers\\.(?:${reEsc(name)}|"${reEsc(name)}")(?:\\]|\\.)`, 'm').test(fs.readFileSync(path.join(codexHome(), 'config.toml'), 'utf8')); } catch { return false; }
}
// 这个 MCP 服务配了哪些环境变量（只要名字，不读值）：[mcp_servers.X.env] 一节里的 KEY = …，或 [mcp_servers.X] 里的 env = { KEY = … }
function mcpEnvKeys(name) {
  let text; try { text = fs.readFileSync(path.join(codexHome(), 'config.toml'), 'utf8'); } catch { return []; }
  const n = `(?:${reEsc(name)}|"${reEsc(name)}")`, envSec = new RegExp(`^mcp_servers\\.${n}\\.env$`), srvSec = new RegExp(`^mcp_servers\\.${n}$`);
  const keys = new Set(); let sec = '';
  for (const line of text.split(/\r?\n/)) {
    const h = line.match(/^\s*\[([^\[\]]+)\]\s*(#.*)?$/); if (h) { sec = h[1].trim(); continue; }
    if (envSec.test(sec)) { const m = line.match(/^\s*"?([A-Za-z_]\w*)"?\s*=/); if (m) keys.add(m[1]); }
    else if (srvSec.test(sec)) { const m = line.match(/^\s*env\s*=\s*\{(.*)\}/); if (m) for (const x of m[1].matchAll(/"?([A-Za-z_]\w*)"?\s*=/g)) keys.add(x[1]); }
  }
  return [...keys];
}
// scansci-pdf（下载文献 PDF）：同样只在这次运行里临时批准。检索、下载、取引用、推 Zotero、看状态都放行；
// 装 Tor / 开关 Tor、清缓存、改设置、各种登录和导入浏览器 cookie 不放行（会装软件、动登录状态或删东西，要用的话让学员自己在终端里做）。
const SCANSCI_TOOLS = ['scansci_pdf_search', 'scansci_pdf_download', 'scansci_pdf_batch_download', 'scansci_pdf_smart_download',
  'scansci_pdf_resolve_and_download', 'scansci_pdf_citation', 'scansci_pdf_paper_metadata', 'scansci_pdf_parse_list', 'scansci_pdf_import_bib',
  'scansci_pdf_zotero_push', 'scansci_pdf_health_check', 'scansci_pdf_setup_check', 'scansci_pdf_source_scores', 'scansci_pdf_network_diagnose',
  'scansci_pdf_config_get', 'scansci_pdf_browser_status', 'scansci_pdf_browser_doctor', 'scansci_pdf_carsi_status', 'scansci_pdf_ezproxy_status',
  'scansci_pdf_vpnsci_status', 'scansci_pdf_vpnsci_schools', 'scansci_pdf_vpnsci_test'];
const approve = (server, tools) => (hasServer(server) ? tools.flatMap(t => ['-c', `mcp_servers.${server}.tools.${t}.approval_mode="approve"`]) : []);
// 关插件还不够：ChatGPT 账号里连的 Zotero 应用（乔淼的叫「Zotero MCP」，工具名 mcp__codex_apps__zotero_mcp_*）照样会出现，
// 后台跑没人点批准，一调就被拒（10-13 文献搜索实测）。从 Codex 缓存的应用工具清单里找名字带 zotero 的应用，这次运行里临时关掉。
function zoteroApps() {
  const ids = new Set();
  const walk = x => {
    if (Array.isArray(x)) return x.forEach(walk);
    if (!x || typeof x !== 'object') return;
    if (typeof x.connector_id === 'string' && /zotero/i.test(`${x.connector_name || ''} ${x.tool_namespace || ''}`)) ids.add(x.connector_id);
    Object.values(x).forEach(walk);
  };
  const dir = path.join(codexHome(), 'cache', 'codex_apps_tools');
  try { for (const f of fs.readdirSync(dir)) if (f.endsWith('.json')) try { walk(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); } catch {} } catch {}
  return [...ids].filter(id => /^[\w-]+$/.test(id));
}
const mcpArgs = () => ['-c', 'plugins."zotero@openai-curated".enabled=false', ...zoteroApps().flatMap(id => ['-c', `apps.${id}.enabled=false`]),
  ...approve('zotero', ZOTERO_TOOLS), ...approve('scansci-pdf', SCANSCI_TOOLS)];

// 写权限：工作目录 + 全局 skills 目录（工作台里有「安装 skills」「造 skill」的指令）；联网打开（检索文献要用）
// writeDirs：配置里「AI 还能写的文件夹」（内容 1.3.2），一起加进可写范围
function sandboxArgs(writeDirs = []) {
  const skills = common.allSkillDirs().concat(writeDirs); // 所有 AI 程序的 skills 文件夹
  return ['-c', 'sandbox_mode="workspace-write"', '-c', 'sandbox_workspace_write.network_access=true',
    ...(skills.length ? ['-c', 'sandbox_workspace_write.writable_roots=' + JSON.stringify(skills)] : []), ...mcpArgs()];
}

// 把 codex --json 的事件翻译成统一格式
function translate(ev, emit) {
  if (ev.type === 'thread.started') return emit({ kind: 'session', id: ev.thread_id });
  if (ev.type === 'turn.completed') {
    const u = ev.usage || {};
    emit({ kind: 'recovered' }); // 这一轮正常做完了：中途「Reconnecting…」之类自己恢复了的报错不算失败
    return emit({ kind: 'usage', usage: { input: u.input_tokens || 0, output: u.output_tokens || 0, cached: u.cached_input_tokens || 0 } });
  }
  if (ev.type === 'turn.failed') return emit({ kind: 'error', message: ev.error?.message || '本轮失败' });
  // 网络抖一下时 Codex 会发「Reconnecting... 1/5 (stream disconnected before completion…)」，然后自己重连接着做。
  // 以前把它当成出错：活干完了右栏却显示「网络断了」（10-23 学员截图：梳理计划写好了、任务却出错）。现在只记下来，真没恢复会有 turn.failed
  if (ev.type === 'error') return emit({ kind: /^\s*reconnecting/i.test(ev.message || '') ? 'warn' : 'error', message: ev.message || 'Codex 报错' });
  if (!ev.item) return;
  const it = ev.item;
  const view = { id: it.id, type: it.type, status: it.status || (ev.type === 'item.completed' ? 'completed' : 'in_progress') };
  if (it.type === 'agent_message' || it.type === 'reasoning') view.text = it.text;
  else if (it.type === 'command_execution') { view.text = it.command; view.exitCode = it.exit_code; }
  else if (it.type === 'file_change') view.files = (it.changes || []).map(c => ({ path: c.path, kind: c.kind }));
  else if (it.type === 'mcp_tool_call') view.text = [it.server, it.tool].filter(Boolean).join(' · ');
  else if (it.type === 'web_search') view.text = it.query;
  else if (it.type === 'todo_list') view.todos = (it.items || []).map(t => ({ text: t.text, completed: !!t.completed }));
  else if (it.type === 'error') view.text = it.message;
  emit({ kind: 'item', item: view });
}

module.exports = {
  id: 'codex', name: 'Codex', binTitle: '选择 Codex 程序（codex.exe 或 codex.cmd）',
  locate: custom => common.locate(places(), custom, ['@openai', 'codex', 'bin', 'codex.js']),
  models,
  // 设置里显示：config.toml 顶层的 model、model_reasoning_effort（没写就是 Codex 的默认）
  defaults() {
    let top = ''; try { top = fs.readFileSync(path.join(codexHome(), 'config.toml'), 'utf8').split(/^\s*\[/m)[0]; } catch {}
    const get = k => (top.match(new RegExp(`^\\s*${k}\\s*=\\s*"([^"]*)"`, 'm')) || [])[1] || '';
    return { model: get('model'), effort: get('model_reasoning_effort') };
  },
  // 执行前检查「需要的skill」：Codex 从这几处找 skill
  skillDirs: cwd => [path.join(codexHome(), 'skills'), path.join(home, '.agents', 'skills'), path.join(cwd, '.agents', 'skills'), path.join(cwd, '.codex', 'skills')],
  hasMcp: hasServer,
  // 内容 1.2.0 起：原来写死在 runtime.cjs 里的说法挪到这里
  skillsHome: () => path.join(codexHome(), 'skills'), skillsHomeLabel: '~/.codex/skills/',
  client: '打开 ChatGPT 桌面版里的 Codex（或者终端里运行 codex）',
  mcpConfig: '在 ~/.codex/config.toml 里加 [mcp_servers.<服务名>] 一节（环境变量写在 [mcp_servers.<服务名>.env]）',
  mcpEnvKeys,
  missingHint: `没找到 Codex 命令行版：点「怎么装」，复制一行命令到${common.WIN ? ' PowerShell ' : '「终端」'}里装好、登录，再点「重新检测」。`,
  // 「怎么装」弹窗用（10-22 乔淼：Mac 上 ChatGPT 桌面版会自带 Codex 命令行版，Windows 上不会）。命令来自 OpenAI 官方安装脚本 chatgpt.com/codex/install.sh / install.ps1
  install: {
    note: common.WIN
      ? 'POPPER 用的是 Codex 命令行版。Windows 上的 ChatGPT 桌面版不会自动带上它，要按下面单独装。'
      : 'POPPER 用的是 Codex 命令行版。Mac 上装了 ChatGPT 桌面版一般就自带一份，POPPER 会自己找到；找不到再按下面装。',
    shell: common.WIN ? 'PowerShell' : '终端',
    open: common.WIN ? '点开始菜单，搜「PowerShell」，打开它' : '按 ⌘ + 空格，搜「终端」，打开它',
    cmd: common.WIN ? 'powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"' : 'curl -fsSL https://chatgpt.com/codex/install.sh | sh',
    login: `装完关掉这个${common.WIN ? ' PowerShell ' : '终端'}窗口、再开一个，输入 codex 回车，选「Sign in with ChatGPT」，用你的 ChatGPT 账号登录。`
  },
  start(bin, { cwd, prompt, sessionId, model, writeDirs, emit, onStderr, onExit }) {
    const common_ = ['--json', '--skip-git-repo-check', ...sandboxArgs(writeDirs), ...(model ? ['-m', model] : [])];
    const args = sessionId ? ['exec', 'resume', ...common_, sessionId, '-'] : ['exec', ...common_, '--color', 'never', '-C', cwd, '-'];
    return common.run(bin, args, { cwd, input: prompt, onJson: ev => translate(ev, emit), onStderr, onExit });
  },
  stop: common.stop,
  friendlyError(msg) {
    if (/model is not supported|model_not_found/i.test(msg)) return 'Codex 现在设的模型不能在命令行里用：换一个 AI 重做，或在 Codex 自己的设置里换默认模型。\n\n原始信息：' + msg;
    return msg;
  }
};
