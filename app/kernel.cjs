'use strict';
// POPPER Framework 的「小内核」：守门（只听本机、令牌、同源检查）、送页面、加载内容层。
// 项目、任务、引擎、工作流都在内容层 content/ 的 runtime.cjs 里。
//
// 两个端口：
// - 主端口（App 17891 / 浏览器版 17890）：工作站页面、界面文件、接口。要登录令牌。
// - 工作流端口（主端口 + 2）：每个工作流一个独立地址 http://wf-<标识>.localhost:<端口>/，
//   和工作站、和别的工作流都不同源——碰不到工作站的页面、接口和登录凭证，浏览器存储也各自分开。
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const VERSION = require('./version.json').version;
// 内核和内容层之间的接口约定。改了约定就加一，同时把内容的 minShell 提到对应的外壳版本
const KERNEL_API = 2; // 1.0.0 第一次对外发布时从 1 改成 2：0.1.x 期间约定改过很多次、没有加过号，从这里重新算
const WIN = process.platform === 'win32';
const readJSON = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
// 名字：窗口、菜单、提示用 package.json 的 productName（学员改名只改那一处）。
// 数据文件夹、默认项目文件夹固定叫「POPPER Framework」：改名不搬家、不丢项目；也和 POPPER（AI学术工作站）的数据分开，两个可以同时装、同时开
const NAME = readJSON(path.join(__dirname, '..', 'package.json'), {}).productName || 'POPPER Framework';
const DATA_NAME = 'POPPER Framework';
// 主端口可以直接送的界面文件（平铺、不含 .cjs 和 .html：程序代码不外送，工作流页面只从工作流端口送）
// .mjs 是 PDF.js（0.1.4 起）
const STATIC = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };

// ---------- 系统动作：App 里由 main.cjs 换成原生对话框；双击脚本版用下面的系统命令 ----------
function defaultHooks() {
  const ask = (win, mac) => new Promise(resolve => {
    const [cmd, args] = WIN ? ['powershell.exe', ['-NoProfile', '-STA', '-Command', "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Add-Type -AssemblyName System.Windows.Forms; " + win]] : ['osascript', ['-e', mac]];
    const child = spawn(cmd, args, { windowsHide: true });
    let out = ''; child.stdout.setEncoding('utf8'); child.stdout.on('data', d => out += d);
    child.on('error', () => resolve(null));
    child.on('close', () => resolve(out.trim() || null));
  });
  const one = s => (s ? s.replace(/[\\/]$/, '') : null);
  return {
    openPath(target) {
      const [cmd, args] = WIN ? ['explorer.exe', [target]] : ['open', [target]];
      spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    },
    revealPath(target) {
      const [cmd, args] = WIN ? ['explorer.exe', ['/select,', target]] : ['open', ['-R', target]];
      spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    },
    pickFolder: async title => one(await ask(`$d=New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='${title || '选择文件夹'}'; if($d.ShowDialog() -eq 'OK'){ $d.SelectedPath }`,
      `POSIX path of (choose folder with prompt "${title || '选择文件夹'}")`)),
    pickFile: async title => one(await ask(`$d=New-Object System.Windows.Forms.OpenFileDialog; $d.Title='${title}'; if($d.ShowDialog() -eq 'OK'){ $d.FileName }`,
      `POSIX path of (choose file with prompt "${title}")`)),
    pickFiles: async title => {
      const out = await ask(`$d=New-Object System.Windows.Forms.OpenFileDialog; $d.Multiselect=$true; $d.Title='${title || '选择文件'}'; if($d.ShowDialog() -eq 'OK'){ $d.FileNames -join [char]10 }`,
        `set fs to (choose file with prompt "${title || '选择文件'}" with multiple selections allowed)\nset out to ""\nrepeat with f in fs\nset out to out & POSIX path of f & linefeed\nend repeat\nreturn out`);
      return out ? out.split('\n').map(s => s.trim()).filter(Boolean) : [];
    }
  };
}

// 启动本机服务。返回 { url, isBusy, stopAll, setContentDir, contentVersion, contentError, settings, hooks }；
// 端口被占时 reject，err.code === 'EADDRINUSE'。
// options.onContentError(err) 返回一个可以退回去的内容文件夹（App 自带的那份），返回 null 表示没有退路
function startKernel(options) {
  const { port, dataDir, defaultProjectsDir, onContentError } = options;
  const wfPort = options.wfPort || port + 2;
  const hooks = { ...defaultHooks(), ...(options.hooks || {}) };
  const token = crypto.randomBytes(24).toString('hex');
  const wfToken = crypto.randomBytes(16).toString('hex'); // 工作流页面的通行码：只有工作站页面知道，别的本机网页打不开工作流
  // 看项目文件的通行码：写在地址里（/__api/file/<通行码>/<项目>/<路径>）。PDF 阅读器、隔离显示的网页取文件时浏览器不带登录凭证，靠它放行；
  // 只能读项目里的文件，别的接口仍然要登录
  const fileToken = crypto.randomBytes(16).toString('hex');
  const origin = `http://127.0.0.1:${port}`;
  // 登录凭证的名字带端口：浏览器里的凭证按地址存、不分端口，同名的话浏览器版和别的本机工作站会互相顶掉
  const COOKIE = 'popperfw' + port;
  let contentDir = options.contentDir, runtime = null, loadError = null;
  const contentFile = name => path.join(contentDir, name);
  const contentVersion = () => readJSON(contentFile('content.json'), {}).version || '';

  // 加载内容层的 runtime.cjs。内容文件夹换了要清掉旧的缓存，否则 require 还是拿到旧代码
  function load(dir) {
    for (const key of Object.keys(require.cache)) if (key.startsWith(dir + path.sep)) delete require.cache[key];
    const mod = require(path.join(dir, 'runtime.cjs'));
    if (!mod.KERNEL_API || mod.KERNEL_API > KERNEL_API) throw Error(`内容需要内核接口 ${mod.KERNEL_API}，这个外壳只有 ${KERNEL_API}`);
    return mod.createRuntime({
      kernelApi: KERNEL_API, shellVersion: VERSION, platform: process.platform, contentDir: dir,
      dataDir, defaultProjectsDir, mainOrigin: origin, wfPort, hooks, dev: !!options.dev,
      log: (...a) => console.log('[内容]', ...a)
    });
  }
  function useContent(dir) {
    if (runtime && runtime.dispose) { try { runtime.dispose(); } catch {} }
    contentDir = dir; runtime = load(dir); loadError = null;
  }
  // 内容层出错：能退回就退回自带的那份，并记下原因；退不了就让页面显示错误
  function fallback(err) {
    const back = onContentError ? onContentError(err) : null;
    if (back && back !== contentDir) {
      try { useContent(back); loadError = { message: err.message, recovered: true }; return true; } catch (e) { err = e; }
    }
    runtime = null; loadError = { message: err.message, recovered: false };
    return false;
  }
  try { useContent(contentDir); } catch (e) { fallback(e); }

  const send = (res, code, data) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  // 导入工作流时要送整个 HTML 上来（旧工作台打包版约 2MB），上限放到 40MB
  const readBody = async req => { let d = ''; for await (const c of req) { d += c; if (d.length > 40e6) throw Error('内容过大'); } return JSON.parse(d || '{}'); };
  const authed = req => (req.headers.cookie || '').split(/;\s*/).includes(COOKIE + '=' + token);
  const busy = () => !!(runtime && runtime.isBusy());
  const boot = () => ({
    ...(runtime ? runtime.config() : {}), shellVersion: VERSION, contentVersion: contentVersion(), contentError: loadError,
    wf: { port: wfPort, token: wfToken }, fileToken
  });
  const page = (res, code, text) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(`<meta charset="utf-8"><p style="font:16px sans-serif;padding:40px">${text}</p>`); };

  // ---------- 主端口：工作站页面、界面文件、接口 ----------
  const server = http.createServer(async (req, res) => {
    try {
      if (req.headers.host !== `127.0.0.1:${port}`) return send(res, 403, { error: '只允许本机访问' });
      const url = new URL(req.url, origin);
      if (url.pathname === '/__ping') return send(res, 200, { app: 'popper-framework', version: VERSION });

      if (url.pathname === '/' && req.method === 'GET') {
        if (url.searchParams.get('t') === token) {
          res.writeHead(302, { 'Set-Cookie': `${COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/`, Location: '/' });
          return res.end();
        }
        if (!authed(req)) return page(res, 401, `请关掉这个页面，重新打开「${NAME}」。`);
        let cfg;
        try { cfg = boot(); } catch (e) { fallback(e); cfg = boot(); }
        const script = `<script>window.__AIWS__=${JSON.stringify(cfg).replace(/</g, '\\u003c')}</script>`;
        const html = fs.readFileSync(contentFile('index.html'), 'utf8').replace(/<head[^>]*>/i, m => m + script);
        // 不许别的页面把工作站嵌进去
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Security-Policy': "frame-ancestors 'none'" });
        return res.end(html);
      }

      // 界面文件：content/ 里平铺的 .js / .css / 图片
      const name = decodeURIComponent(url.pathname.slice(1));
      const ext = path.extname(name).toLowerCase();
      if (req.method === 'GET' && STATIC[ext] && name === path.basename(name) && !name.startsWith('.')) {
        if (!authed(req)) return send(res, 401, { error: '登录已失效' });
        const file = contentFile(name);
        if (!fs.existsSync(file)) return send(res, 404, { error: '没有这个文件' });
        res.writeHead(200, { 'Content-Type': STATIC[ext] + (ext === '.js' || ext === '.mjs' || ext === '.css' ? '; charset=utf-8' : ''), 'Cache-Control': 'no-store' });
        return res.end(fs.readFileSync(file));
      }

      if (!url.pathname.startsWith('/__api/')) return send(res, 404, { error: '没有这个页面' });
      let fileRoute = null;
      if (req.method === 'GET' && url.pathname.startsWith(`/__api/file/${fileToken}/`)) fileRoute = 'file/' + url.pathname.slice(`/__api/file/${fileToken}/`.length);
      if (!fileRoute && !authed(req)) return send(res, 401, { error: `登录已失效：请重新打开「${NAME}」` });
      if (req.method !== 'GET' && req.headers.origin !== origin) return send(res, 403, { error: '只允许工作站页面操作' });
      const route = fileRoute || url.pathname.slice('/__api/'.length);
      if (!fileRoute && route.startsWith('file/')) return send(res, 404, { error: '没有这个接口' }); // 看文件只走带通行码的地址
      const body = req.method === 'GET' ? Object.fromEntries(url.searchParams) : await readBody(req);

      // 更新属于外壳：状态由 main.cjs 提供（双击脚本版没有更新功能）
      if (route === 'update' && req.method === 'GET') return send(res, 200, hooks.updateState ? hooks.updateState() : { supported: false, reason: '双击脚本版不自动更新' });
      if (route === 'update/check' && req.method === 'POST') { if (!hooks.checkUpdate) return send(res, 409, { error: '这个版本不支持自动更新' }); return send(res, 200, await hooks.checkUpdate()); }
      if (route === 'update/apply' && req.method === 'POST') {
        if (!hooks.applyUpdate) return send(res, 409, { error: '这个版本不支持自动更新' });
        if (busy()) return send(res, 409, { error: 'AI 还在执行任务，等它结束再更新' });
        return send(res, 200, await hooks.applyUpdate());
      }
      if (route === 'update/download-shell' && req.method === 'POST') { if (hooks.openShellDownload) hooks.openShellDownload(); return send(res, 200, {}); }

      if (!runtime) return send(res, 503, { error: '内容加载失败：' + (loadError?.message || '未知原因') + '。请用菜单「帮助 → 恢复到 App 自带的版本」，或重新安装。' });
      let out;
      try { out = await runtime.handle({ method: req.method, route, body }); }
      catch (e) {
        // 内容层的代码抛了异常（不是正常的业务报错）：配置接口都坏了说明这份内容不能用，退回自带的
        if (route === 'config' && fallback(e)) out = { status: 200, data: boot() };
        else throw e;
      }
      if (route === 'config' && out.status === 200) out = { status: 200, data: boot() };
      // 文件这类原样送出（比如在工作站里看项目里的 PDF）；其余一律 JSON
      if (out.raw !== undefined) { res.writeHead(out.status || 200, { ...(out.headers || {}), 'Content-Type': out.type || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); return res.end(out.raw); }
      return send(res, out.status || 200, out.data);
    } catch (e) { if (!res.headersSent) send(res, 400, { error: e.message }); else res.end(); }
  });

  // ---------- 工作流端口：每个工作流一个独立来源 ----------
  const wfServer = http.createServer((req, res) => {
    try {
      const m = (req.headers.host || '').match(new RegExp(`^wf-([a-z0-9-]{1,40})\\.localhost:${wfPort}$`));
      if (!m) return page(res, 403, '只允许本机访问');
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method !== 'GET' || url.pathname !== '/') return page(res, 404, '没有这个页面');
      if (url.searchParams.get('k') !== wfToken) return page(res, 401, `请在「${NAME}」里打开这个工作流。`);
      if (!runtime || !runtime.workflowPage) return page(res, 503, '内容加载失败');
      const out = runtime.workflowPage({ id: m[1], project: url.searchParams.get('p') || '' });
      res.writeHead(out.status || 200, {
        'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store',
        // 只许工作站把它嵌进去
        'Content-Security-Policy': `frame-ancestors ${origin}`
      });
      return res.end(out.html);
    } catch (e) { if (!res.headersSent) page(res, 500, '工作流页面出错：' + e.message); else res.end(); }
  });

  const listen = (srv, p) => new Promise((resolve, reject) => { srv.once('error', reject); srv.listen(p, '127.0.0.1', resolve); });
  return listen(server, port).then(() => listen(wfServer, wfPort).catch(e => { server.close(); throw e; })).then(() => ({
    url: `${origin}/?t=${token}`, origin, wfPort,
    isBusy: busy,
    stopAll: () => { if (runtime && runtime.stopAll) runtime.stopAll(); },
    setContentDir: dir => { try { useContent(dir); } catch (e) { fallback(e); } },
    contentVersion, contentError: () => loadError,
    settings: () => (runtime ? runtime.config() : {}),
    hooks
  }));
}
module.exports = { startKernel, VERSION, KERNEL_API, NAME, DATA_NAME };

// 浏览器版（双击「启动.command」/「启动.bat」）走这里：服务开在本机，用默认浏览器打开。
// 端口 17890（工作流 17892）；数据在用户资料文件夹的「POPPER Framework-浏览器版」，和独立 App 的数据分开；
// 项目默认放「文稿/POPPER Framework」。重新解压框架不会丢数据和项目。加 --dev 多出「隔离测试」工作流和测试用假 AI。
if (require.main === module) {
  const os = require('node:os');
  const root = path.resolve(__dirname, '..');
  const port = Number(process.env.AIWS_PORT) || 17890;
  const sessionFile = path.join(__dirname, '.会话');
  const dataDir = WIN ? path.join(process.env.APPDATA || os.homedir(), DATA_NAME + '-浏览器版') : path.join(os.homedir(), 'Library', 'Application Support', DATA_NAME + '-浏览器版');
  const projectsDir = path.join(os.homedir(), 'Documents', DATA_NAME);
  const open = target => defaultHooks().openPath(target);
  let app = null;
  const quit = () => { try { app && app.stopAll(); } catch {} try { fs.unlinkSync(sessionFile); } catch {} process.exit(0); };
  startKernel({ port, contentDir: path.join(root, 'content'), dataDir, defaultProjectsDir: projectsDir,
    dev: process.env.AIWS_DEV === '1' || process.argv.includes('--dev'), hooks: { quit } })
    .then(a => {
      app = a;
      fs.writeFileSync(sessionFile, app.url, { mode: 0o600 });
      const cfg = app.settings();
      console.log(`${NAME} · 浏览器版 v${VERSION}`);
      if (app.contentError()) console.log('⚠ 内容层加载失败：' + app.contentError().message);
      for (const e of cfg.engines || []) console.log(`${e.name}：${e.version ? `${e.version}（${e.where}）` : e.checking ? '检测中（结果看界面）' : '没找到'}`);
      console.log(`\n浏览器没自动打开的话，复制这个链接：\n${app.url}\n\n用完关掉这个窗口即可退出。`);
      if (!process.argv.includes('--no-open')) open(app.url);
    })
    .catch(async e => {
      if (e.code !== 'EADDRINUSE') throw e;
      // 已经开着一个就直接打开它，不重复启动
      try {
        const r = await fetch(`http://127.0.0.1:${port}/__ping`);
        if ((await r.json()).app === 'popper-framework') { console.log('已经在运行，直接打开。'); if (!process.argv.includes('--no-open')) open(fs.readFileSync(sessionFile, 'utf8').trim()); return; }
      } catch {}
      console.error(`端口 ${port} 或 ${port + 2} 被别的程序占用了。可以关掉占用的程序，或设置环境变量 AIWS_PORT 换一个端口。`);
      process.exitCode = 1;
    });
}
