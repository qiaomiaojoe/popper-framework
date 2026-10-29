'use strict';
// 独立 App 入口（Electron）：在 App 里起本机服务，用一个独立窗口打开。打包后不需要装 Node。
const { app, BrowserWindow, Menu, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { startKernel, VERSION, NAME, DATA_NAME } = require('./kernel.cjs');

// 固定端口：存在窗口里的数据按地址区分，换端口就看不到了。和浏览器版（17890/17892）、POPPER（1787x）错开
const PORT = 17891, WF_PORT = 17893;
const MAC = process.platform === 'darwin';

// 从程序坞/访达打开的 App 拿不到终端里的 PATH，Codex、Claude Code 以及它们要调用的 node、git 会找不到。
// 问一次用户的登录 shell，取它的 PATH 合并进来。
function inheritLoginPath() {
  if (process.platform !== 'darwin') return; // Windows 从资源管理器打开的程序本来就拿得到完整 PATH
  const shellPath = process.env.SHELL || '/bin/zsh';
  const r = spawnSync(shellPath, ['-ilc', 'printf "__PATH__%s" "$PATH"'], { encoding: 'utf8', timeout: 5000 });
  const found = (r.stdout || '').split('__PATH__')[1] || '';
  const dirs = [...found.split(':'), ...(process.env.PATH || '').split(':'), '/opt/homebrew/bin', '/usr/local/bin', path.join(app.getPath('home'), '.local/bin')];
  process.env.PATH = [...new Set(dirs.filter(Boolean))].join(':');
}

app.setName(NAME);
// 数据文件夹：~/Library/Application Support/POPPER Framework/（Windows：%APPDATA%\POPPER Framework\）
app.setPath('userData', path.join(app.getPath('appData'), DATA_NAME));
const primary = app.requestSingleInstanceLock(); // 已经开着一个就交给它，自己退出
if (!primary) app.quit();

let win = null, svc = null;
const dataDir = () => app.getPath('userData');
// 窗口里只许打开工作站自己和工作流的页面；别的链接（GitHub、论文网址）一律交给系统浏览器
const WF_HOST = new RegExp(`^http://wf-[a-z0-9-]{1,40}\\.localhost:${WF_PORT}/`);
const isLocal = url => url.startsWith(`http://127.0.0.1:${PORT}/`) || WF_HOST.test(url) || url.startsWith('blob:') || url.startsWith('data:') || url === 'about:blank' || url === 'about:srcdoc';

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 920, minWidth: 1100, minHeight: 680, title: NAME, backgroundColor: '#FAF7F2', show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, preload: path.join(__dirname, 'preload.cjs') }
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isLocal(url)) return { action: 'allow' };
    shell.openExternal(url); return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => { if (!isLocal(url)) { e.preventDefault(); shell.openExternal(url); } });
  // 工作流页面（嵌在工作站里的框）点了外部链接，也交给系统浏览器，不在框里跳走
  win.webContents.on('will-frame-navigate', e => { if (!e.isMainFrame && !isLocal(e.url)) { e.preventDefault(); shell.openExternal(e.url); } });
  win.on('page-title-updated', e => e.preventDefault());
  win.on('close', e => {
    if (!svc?.isBusy()) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: ['先不退出', '停止任务并退出'], defaultId: 0, cancelId: 0,
      message: 'AI 还在执行任务', detail: '现在退出会中断这些任务。已经写好的文件会保留，下次打开可以让它接着做。'
    });
    if (choice === 0) e.preventDefault(); else svc.stopAll();
  });
  win.on('closed', () => { win = null; app.quit(); }); // 只有一个窗口：关窗即退出，学员不会留下看不见的后台程序
  win.loadURL(svc.url);
}

function buildMenu() {
  const help = { label: '帮助', role: 'help', submenu: [
    { label: '打开数据文件夹', click: () => shell.openPath(dataDir()) },
    { type: 'separator' },
    { label: '开发者工具', accelerator: MAC ? 'Alt+Command+I' : 'Ctrl+Shift+I', click: () => win?.webContents.toggleDevTools() },
    ...(MAC ? [] : [{ type: 'separator' }, { label: `关于 ${NAME}`, click: () => dialog.showMessageBox(win, {
      title: `关于 ${NAME}`, message: `${NAME} ${VERSION}`, detail: '开发：乔淼PhD' }) }])] };
  const edit = { label: '编辑', submenu: [
    { role: 'undo', label: '撤销' }, { role: 'redo', label: '重做' }, { type: 'separator' },
    { role: 'cut', label: '剪切' }, { role: 'copy', label: MAC ? '拷贝' : '复制' }, { role: 'paste', label: '粘贴' }, { role: 'selectAll', label: '全选' }] };
  const view = { label: '视图', submenu: [
    { role: 'reload', label: '重新载入' }, { type: 'separator' },
    { role: 'resetZoom', label: '实际大小' }, { role: 'zoomIn', label: '放大' }, { role: 'zoomOut', label: '缩小' },
    { type: 'separator' }, { role: 'togglefullscreen', label: '全屏' }] };
  Menu.setApplicationMenu(Menu.buildFromTemplate(MAC ? [
    { label: NAME, submenu: [
      { role: 'about', label: `关于 ${NAME}` }, { type: 'separator' },
      { role: 'hide', label: `隐藏 ${NAME}` }, { role: 'hideOthers', label: '隐藏其他' }, { role: 'unhide', label: '全部显示' },
      { type: 'separator' }, { role: 'quit', label: `退出 ${NAME}` }] },
    edit, view,
    { label: '窗口', role: 'window', submenu: [{ role: 'minimize', label: '最小化' }, { role: 'zoom', label: '缩放' }] },
    help
  ] : [
    { label: '文件', submenu: [{ role: 'quit', label: '退出' }] },
    edit, view, help
  ]));
}

app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('will-quit', () => svc?.stopAll());

app.whenReady().then(async () => {
  if (!primary) return;
  inheritLoginPath();
  app.setAboutPanelOptions({ applicationName: NAME, applicationVersion: VERSION, copyright: '开发：乔淼PhD' });
  try {
    svc = await startKernel({
      port: PORT, wfPort: WF_PORT,
      contentDir: path.join(__dirname, '..', 'content'),
      dataDir: dataDir(),
      defaultProjectsDir: path.join(app.getPath('documents'), DATA_NAME),
      dev: process.env.AIWS_DEV === '1',
      hooks: {
        openPath: target => /^https?:/.test(target) ? shell.openExternal(target) : shell.openPath(target),
        revealPath: target => shell.showItemInFolder(target),
        pickFile: async title => {
          const r = await dialog.showOpenDialog(win, { title: title || '选择程序', message: title || '',
            properties: ['openFile'], ...(MAC ? {} : { filters: [{ name: '程序', extensions: ['exe', 'cmd', 'js'] }] }) });
          return r.canceled ? null : r.filePaths[0];
        },
        pickFiles: async title => {
          const r = await dialog.showOpenDialog(win, { title: title || '选择文件', message: title || '', properties: ['openFile', 'multiSelections'] });
          return r.canceled ? [] : r.filePaths;
        },
        pickFolder: async title => {
          const r = await dialog.showOpenDialog(win, { title: title || '选择文件夹', message: title || '', properties: ['openDirectory', 'createDirectory'] });
          return r.canceled ? null : r.filePaths[0];
        }
      }
    });
  } catch (e) {
    dialog.showErrorBox(`${NAME}打不开`, e.code === 'EADDRINUSE'
      ? `本机端口 ${PORT} 或 ${WF_PORT} 被别的程序占用了。重启电脑后再打开试试；还不行就把这句话发到群里。`
      : String(e.stack || e));
    app.quit(); return;
  }
  buildMenu();
  createWindow();
});
