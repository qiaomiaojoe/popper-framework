'use strict';
// 这个 App 叫什么：package.json 的 productName（到手是 My App；学员改名只改那一处，独立 App 里读打包时写进去的那份）。
// 提示和说明里说到「这个 App」、左下角「My App 配置」、右栏 AI 默认叫「My App Agent」，都跟着它（乔淼 10-30）
const fs = require('node:fs');
const path = require('node:path');
let APP = 'My App';
try { APP = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).productName || APP; } catch {}
module.exports = { APP, CFG: APP + ' 配置', AGENT: APP + ' Agent' };
