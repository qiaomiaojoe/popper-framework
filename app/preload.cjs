'use strict';
// 只给工作站自己的窗口（主框架）用；工作流页面是跨域 iframe，拿不到（nodeIntegrationInSubFrames 默认关）。
// 网页拿不到拖进来的文件在电脑上的路径，这里只开一个口子：给一个拖进来的 File，告诉它完整路径（1.1.0 起，拖文件夹新建项目用）。
const { contextBridge, webUtils } = require('electron');
contextBridge.exposeInMainWorld('popperHost', {
  pathOf: file => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } }
});
