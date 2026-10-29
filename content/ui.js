'use strict';
// AI学术工作站 · 界面。
// 三栏：左边项目（当前项目展开工作流进度）；中间标签页（应用、工作流、工具、文档）；右边任务、文件、直接跟 AI 说。
// 界面上不放说明文字；版本、AI 程序、我的 skills 库、文献工具、Zotero、pandoc 的检测和安装都在左下角「AI学术环境配置」里。
// 重画时内容没变就不动页面（innerHTML 只在变了时才写），免得窗口刚回到前台时的刷新吞掉一次点击。
(function () {
  const B = window.__AIWS__ || {};
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const put = (el, html) => { if (el && el.__html !== html) { el.innerHTML = html; el.__html = html; } };
  // 动效：put() 一变就整块重写，进场动画写进 CSS 会每次刷新都重播。所以记住容器里每个带 data-mk 的元素上次的 data-ms，
  // 只在新出现（fx-enter）或状态变了（fx-change）那一刻加一次 class，播完拿掉。scope 变了（换项目、换视图）只记不播。
  const FX = new WeakMap(), lessMotion = matchMedia('(prefers-reduced-motion: reduce)');
  function fx(root, scope) {
    if (!root) return;
    const prev = FX.get(root), els = [...root.querySelectorAll('[data-mk]')], seen = new Map(els.map(el => [el.dataset.mk, el.dataset.ms || '']));
    FX.set(root, { scope, seen });
    const hit = { entered: [], changed: [] };
    if (!prev || prev.scope !== scope || lessMotion.matches) return hit;
    for (const el of els) {
      const was = prev.seen.get(el.dataset.mk), cls = was === undefined ? 'fx-enter' : was !== (el.dataset.ms || '') ? 'fx-change' : '';
      if (!cls) continue;
      hit[cls === 'fx-enter' ? 'entered' : 'changed'].push(el);
      el.classList.remove('fx-enter', 'fx-change'); void el.offsetWidth; el.classList.add(cls);
      el.addEventListener('animationend', function done(e) { if (e.target !== el) return; el.classList.remove(cls); el.removeEventListener('animationend', done); });
    }
    return hit;
  }
  // 飞行：一个光点（或一段文字）从 a 沿弧线飞到 b（「执行」交出去、写出的文件落进文件栏）
  function fly(a, b, label) {
    if (!a || !b || lessMotion.matches) return Promise.resolve();
    const ra = a.getBoundingClientRect ? a.getBoundingClientRect() : { left: a.x, top: a.y, width: 1, height: 1 }, rb = b.getBoundingClientRect();
    if (!ra.width || !rb.width) return Promise.resolve();
    const ax = ra.left + ra.width / 2, ay = ra.top + ra.height / 2, bx = rb.left + Math.min(rb.width / 2, 90), by = rb.top + rb.height / 2, mx = (ax + bx) / 2, my = Math.min(ay, by) - 60;
    const d = document.createElement('span'); d.className = label ? 'flyname' : 'flydot'; if (label) d.textContent = label;
    document.body.appendChild(d);
    const ox = label ? d.offsetWidth / 2 : 0, oy = label ? d.offsetHeight / 2 : 0, tf = (x, y, s) => `translate(${x - ox}px,${y - oy}px) scale(${s})`;
    return d.animate([{ transform: tf(ax, ay, label ? 1 : .6) }, { transform: tf(mx, my, label ? 1.04 : 1.4), offset: .5 }, { transform: tf(bx, by, label ? .85 : .5), opacity: .2 }],
      { duration: label ? 650 : 720, easing: 'cubic-bezier(.3,.6,.2,1)' }).finished.catch(() => {}).then(() => d.remove());
  }
  const UI = {}; // 每个项目自己的界面状态：开着哪些标签页
  let STO = null; // 配置里上次算出来的空间占用（关掉配置再打开要重新点「查看」）
  const ui = () => (UI[B.current] = UI[B.current] || { tabs: [{ id: 'store' }], active: 'store' });
  // 名字和 logo：POPPER framework。天鹅和 POPPER 同一只，框架里只画轮廓线（乔淼 10-29 定「线稿天鹅、细线」，App 图标 构建素材/图标.svg 同一套），
  // 原稿 100×100、线宽 2.4，这里缩进 24×24。左上角的字是「POPPER / framework」两行，用 SVG 的 textLength 定成一样宽（见 renderLeft 里的 brand）
  const BRAND = 'POPPER', LOGO = '<g transform="translate(-2.22 -2.48) scale(.295)"><path d="M10.5 50.2 C15.5 53.5,19.5 55.2,22.5 55 C27 48.2,36.5 45.6,45 46 C53 46.5,59 49,62.4 52.8 C61.4 47,60.9 41.2,61.9 37 C63.2 31.4,67.6 27.6,73.6 27.1 C78.4 26.7,81.6 27.8,83.1 30.6 C84 32.4,84.3 34,84.7 35.6 C85.6 38.2,87.1 41,87.9 43.4 C88.3 44.8,87.4 45.8,86.5 45.1 C85.2 43.6,83.6 40.8,82.2 38.6 C81.3 37.2,79.8 36.4,78.2 36.2 C75.4 35.6,72.6 35.2,70.8 37.6 C68.8 40,68.4 43.4,68.9 47.2 C69.5 51.4,72.1 55.2,72.9 59.2 C73.8 64.4,69.6 69.8,62 70.6 C45 71.6,33 71.3,26 69.9 C19 68.4,14 63.8,11.8 59.6 C11 58.4,9.6 57,8.2 55.6 C10.6 56,12.6 55.8,14.4 55.1 C13.2 53.6,11.8 51.8,10.5 50.2Z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/></g>';
  const S = { files: [], fileMode: 'recent', filesOf: null, runs: [], expanded: null, skills: {} };
  window.__wfTests = {}; // 开发用：隔离测试工作流交回来的检查结果

  async function api(route, method = 'GET', data) {
    const q = method === 'GET' && data ? '?' + new URLSearchParams(data) : '';
    const r = await fetch('/__api/' + route + q, { method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: method !== 'GET' && data ? JSON.stringify(data) : undefined });
    const json = await r.json().catch(() => ({}));
    // 这个 AI 第一次用之前要你确认风险（Windows 上的 Claude Code 没有沙箱）：弹确认框，确认后记下、把刚才的请求再发一次
    if (r.status === 409 && json.riskAck && await riskConfirm(json)) {
      await api('engine/ack', 'POST', { engine: json.riskAck });
      return api(route, method, data);
    }
    if (!r.ok) { const e = Error(json.error || ('请求失败 ' + r.status)); e.status = r.status; e.data = json; throw e; }
    return json;
  }
  function toast(text) {
    const el = document.createElement('div'); el.className = 'toast'; el.textContent = text;
    $('#toasts').appendChild(el); setTimeout(() => el.remove(), 3200);
  }
  const wfOf = id => (B.workflows || []).find(w => w.id === id);
  const toolOf = id => (B.tools || []).find(t => t.id === id);
  const KINDS = { md: 'md', markdown: 'md', txt: 'text', html: 'html', htm: 'html', pdf: 'pdf', docx: 'docx', doc: 'docx', csv: 'data', xlsx: 'data', xls: 'data', png: 'image', jpg: 'image', jpeg: 'image', svg: 'image', json: 'text' };
  const kindOf = f => KINDS[(f.split('.').pop() || '').toLowerCase()] || 'other';
  const proj = (id = B.current) => (B.projects || []).find(p => p.id === id);
  const engineName = id => ((B.engines || []).find(e => e.id === id) || {}).name || id;
  const isFake = id => id === 'fake' || id === 'fake2'; // 开发模式的两个测试用假 AI
  // 自动模式（内容 1.3.0）：整条每段用哪个 AI。老任务没记，就当整条都是这一段的 AI；用了不止一个时界面上才标出来
  const chainEngines = r => (r.chain && Array.isArray(r.chain.engines) && r.chain.engines.length === r.chain.n ? r.chain.engines : Array(r.chain ? r.chain.n : 1).fill(r.engine));
  const chainMulti = r => !!(r.auto && r.chain && new Set(chainEngines(r)).size > 1);
  async function act(route, data, okText) {
    try { const r = await api(route, 'POST', data); Object.assign(B, r); renderAll(); if (okText) toast(okText); return r; }
    catch (e) { toast(e.message); return null; }
  }

  // ---------- 图标：24×24、线宽 1.5、圆头圆角、不填色（设计稿第 3 步；同一套 SVG 在 设计/图标/） ----------
  const P = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    chev: '<path d="M9 6l6 6-6 6"/>',
    wand: '<path d="M5 19L15 9M17 3v3M20 6h-3M19.5 3.5l-2 2M10 4.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4L8 6.5l1.4-.6z"/>',
    folder: '<path d="M3.5 7.5a2 2 0 0 1 2-2h3.6l2 2h7.4a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
    pin: '<path d="M9.5 4h5l-.8 5.2 3 2.8v1.2H7.3V12l3-2.8zM12 13.2V20"/>',
    pen: '<path d="M4.5 19.5h4l10-10-4-4-10 10zM13 7l4 4"/>',
    folderOpen: '<path d="M3.5 18V7a2 2 0 0 1 2-2h3.6l2 2H17a2 2 0 0 1 2 2v1.5M3.5 18l2.3-6.2a1.5 1.5 0 0 1 1.4-1h12.6a1 1 0 0 1 .9 1.3L18.6 17a1.5 1.5 0 0 1-1.4 1z"/>',
    inbox: '<path d="M4 13.5l2-7.5A1.5 1.5 0 0 1 7.5 5h9A1.5 1.5 0 0 1 18 6l2 7.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18zM4 13.5h4.5l1 2h5l1-2H20"/>',
    file: '<path d="M7 3.5h6.5l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5zM13.5 3.5V8H18"/>',
    doc: '<path d="M7 3.5h6.5l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5zM13.5 3.5V8H18M9 12.5h6M9 16h4"/>',
    fileWeb: '<path d="M7 3.5h6.5l4.5 4.5v11a1.5 1.5 0 0 1-1.5 1.5h-9.5A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5zM13.5 3.5V8H18M10 12l-2 2 2 2M14 12l2 2-2 2"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4"/>',
    external: '<path d="M13.5 4.5h6v6M19.5 4.5l-8 8M17.5 13.5v4.5a1.5 1.5 0 0 1-1.5 1.5H6a1.5 1.5 0 0 1-1.5-1.5V8A1.5 1.5 0 0 1 6 6.5h4.5"/>',
    x: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    more: '<path d="M7 12a1 1 0 1 1-2 0a1 1 0 1 1 2 0M13 12a1 1 0 1 1-2 0a1 1 0 1 1 2 0M19 12a1 1 0 1 1-2 0a1 1 0 1 1 2 0"/>',
    dash: '<rect x="4" y="4" width="7" height="9" rx="1.5"/><rect x="13" y="4" width="7" height="5" rx="1.5"/><rect x="13" y="11" width="7" height="9" rx="1.5"/><rect x="4" y="15" width="7" height="5" rx="1.5"/>',
    grid: '<path d="M5.5 4H9A1.5 1.5 0 0 1 10.5 5.5V9A1.5 1.5 0 0 1 9 10.5H5.5A1.5 1.5 0 0 1 4 9V5.5A1.5 1.5 0 0 1 5.5 4zM15 4h3.5A1.5 1.5 0 0 1 20 5.5V9a1.5 1.5 0 0 1-1.5 1.5H15A1.5 1.5 0 0 1 13.5 9V5.5A1.5 1.5 0 0 1 15 4zM5.5 13.5H9a1.5 1.5 0 0 1 1.5 1.5v3.5A1.5 1.5 0 0 1 9 20H5.5A1.5 1.5 0 0 1 4 18.5V15a1.5 1.5 0 0 1 1.5-1.5zM15 13.5h3.5A1.5 1.5 0 0 1 20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15a1.5 1.5 0 0 1-1.5-1.5V15a1.5 1.5 0 0 1 1.5-1.5z"/>',
    send: '<path d="M12 19V5M6.5 10.5 12 5l5.5 5.5"/>',
    clip: '<path d="M19 11.5l-6.8 6.8a4.2 4.2 0 0 1-6-6l7.3-7.3a2.8 2.8 0 0 1 4 4l-7.2 7.2a1.4 1.4 0 0 1-2-2l6.5-6.5"/>',
    eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM14.75 12a2.75 2.75 0 1 1-5.5 0a2.75 2.75 0 1 1 5.5 0"/>',
    trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5"/>',
    upload: '<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15"/>',
    download: '<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15"/>',
    alert: '<path d="M12 4.5 20.5 19h-17zM12 10v4M12 16.6v.1"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9M17 7a2 2 0 1 1-4 0a2 2 0 1 1 4 0M11 17a2 2 0 1 1-4 0a2 2 0 1 1 4 0"/>',
    power: '<path d="M12 4v8"/><path d="M7 7a7 7 0 1 0 10 0"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    stop: '<path d="M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/>',
    image: '<rect x="4" y="5" width="16" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M20 16l-4.5-4.5L7 19"/>',
    search: '<path d="M17 10.5a6.5 6.5 0 1 1-13 0a6.5 6.5 0 1 1 13 0M15.5 15.5L20 20"/>',
    expand: '<path d="M14 4.5h5.5V10M19.5 4.5l-6 6M10 19.5H4.5V14M4.5 19.5l6-6"/>',
    chat: '<path d="M5.5 5h13A1.5 1.5 0 0 1 20 6.5v8.5a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 3.5v-3.5h0A1.5 1.5 0 0 1 4 15V6.5A1.5 1.5 0 0 1 5.5 5zM8 9.5h8M8 12.5h5"/>',
    // 工具与工作流
    'search-lit': '<path d="M16.5 10.5a6 6 0 1 1-12 0a6 6 0 1 1 12 0M15 15l5 5M8 9h5M8 12h3"/>',
    verify: '<path d="M18 11V8l-4.5-4.5H7A1.5 1.5 0 0 0 5.5 5v14A1.5 1.5 0 0 0 7 20.5h4.5M13.5 3.5V8H18M14 17.5l2 2 4-4.5"/>',
    'deep-read': '<path d="M4 5.5h5.5A2.5 2.5 0 0 1 12 8v11a2 2 0 0 0-2-2H4zM20 5.5h-5.5A2.5 2.5 0 0 0 12 8v11a2 2 0 0 1 2-2h6z"/>',
    'module-list': '<path d="M5.5 4h4A1.5 1.5 0 0 1 11 5.5v4A1.5 1.5 0 0 1 9.5 11h-4A1.5 1.5 0 0 1 4 9.5v-4A1.5 1.5 0 0 1 5.5 4zM14.5 4h4A1.5 1.5 0 0 1 20 5.5v4a1.5 1.5 0 0 1-1.5 1.5h-4A1.5 1.5 0 0 1 13 9.5v-4A1.5 1.5 0 0 1 14.5 4zM5.5 13h4a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 9.5 20h-4A1.5 1.5 0 0 1 4 18.5v-4A1.5 1.5 0 0 1 5.5 13zM13 14.5h7M13 18.5h4.5"/>',
    gap: '<path d="M5 8.5h3a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 8 15.5H5A1.5 1.5 0 0 1 3.5 14v-4A1.5 1.5 0 0 1 5 8.5zM16 8.5h3a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5h-3a1.5 1.5 0 0 1-1.5-1.5v-4A1.5 1.5 0 0 1 16 8.5zM12 5v1.5M12 17.5V19M11.5 12h1"/>',
    'write-review': '<path d="M4 6h9M4 10h6M4 14h4M17.5 7.5l2 2-7 7h-2v-2z"/>',
    assemble: '<path d="M12 4l8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4"/>',
    'write-paper': '<path d="M14.5 4.5l5 5-9.5 9.5H5v-5zM12.5 6.5l5 5M13 20h6"/>',
    'submission': '<path d="M20.5 3.5l-17 7 7 3 3 7z"/><path d="M10.5 13.5l10-10"/>',
    'review-ledger': '<rect x="5" y="4.5" width="14" height="16" rx="1.5"/><path d="M9 3.5h6v2.5H9zM8.5 10.5h1M11.5 10.5h4M8.5 14h1M11.5 14h4M8.5 17.5h1M11.5 17.5h4"/>',
    'review-revise': '<path d="M9.5 8.5L5 13l4.5 4.5"/><path d="M5 13h8.5A5.5 5.5 0 0 0 19 7.5V5"/>',
    'review-article': '<rect x="8.5" y="3.5" width="11" height="14" rx="1.5"/><path d="M5 7.5V19a1.5 1.5 0 0 0 1.5 1.5H15M11.5 8h5M11.5 11h5M11.5 14h3"/>',
    pxyv: '<circle cx="12" cy="12" r="5.5"/><path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3M12 12l2-2"/>',
    pyramid: '<path d="M12 4l8 15H4zM8.3 12h7.4M6.2 16h11.6"/>',
    'pdf-zotero': '<path d="M12 4v10M8 10l4 4 4-4M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15"/>',
    'module-gen': '<rect x="4" y="7" width="12" height="13" rx="1.5"/><path d="M8 4h10.5A1.5 1.5 0 0 1 20 5.5V16M7 12h6M7 15.5h4"/>',
    blueprint: '<path d="M4.5 5.5h15M4.5 10h10M8.5 14.5h11M8.5 19h7"/>',
    'methods-map': '<path d="M3.5 6.5l5-2 7 2.5 5-2v13l-5 2-7-2.5-5 2zM8.5 4.5v13M15.5 7v13"/>',
    'method-draft': '<path d="M9 4h6v2.5H9zM7 5.5H6A1.5 1.5 0 0 0 4.5 7v12A1.5 1.5 0 0 0 6 20.5h12a1.5 1.5 0 0 0 1.5-1.5V7A1.5 1.5 0 0 0 18 5.5h-1M8 12l1.5 1.5L12 11M8 16.5l1.5 1.5 2.5-2.5M14 12.5h2.5M14 17h2.5"/>',
    'data-round': '<path d="M4.5 19.5h15M7.5 16.5v-4M11 16.5v-9M14.5 16.5v-6M18 16.5v-11"/>',
    synth: '<path d="M4 5h16l-6 7.5V19l-4 1.5v-8z"/>',
    'skill-shop': '<path d="M9.5 3.5h5M10.5 3.5v6L5 18.5A1.5 1.5 0 0 0 6.3 20.5h11.4a1.5 1.5 0 0 0 1.3-2l-5.5-9v-6M7.5 15h9"/>',
    'wf-build': '<circle cx="6" cy="5.5" r="2"/><circle cx="6" cy="18.5" r="2"/><path d="M6 7.5v9M8 5.5h5.5A2.5 2.5 0 0 1 16 8v2.5M16 14.5v6M13 17.5h6"/>',
    deconstruct: '<path d="M7 3.5h6.5L18 8v3M13.5 3.5V8H18M5.5 5v14A1.5 1.5 0 0 0 7 20.5h3.5"/><circle cx="15.5" cy="15.5" r="3"/><path d="M17.7 17.7l2.3 2.3"/>',
    framework: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9h16M10 9v11"/>',
    'full-draft': '<path d="M5.5 3.5h8.5l4.5 4.5v12.5h-13zM14 3.5V8h4.5M8.5 12h7M8.5 15h7M8.5 18h4"/>',
    'pdf-text': '<path d="M11 20.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5h7l4.5 4.5v3M13 3.5V8h4.5M7.5 9.5h3"/><path d="M14 14.5h6M14 17.5h6M14 20.5h4"/>'
  };
  const I = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24">${P[n] || ''}</svg>`;
  const fileIcon = kind => kind === 'dir' ? I('folder', 'k-dir') : kind === 'image' ? I('image', 'k-image') : kind === 'html' ? I('fileWeb', 'k-html') : I(kind === 'md' || kind === 'text' ? 'doc' : 'file', 'k-' + kind);
  // 图标图块：工作流琥珀，工具按分类（找文献蓝、读文献绿、写综述紫、研究设计青、数据分析石板、写全文橄榄、审稿返修砖红）。标识对得上就用线条图标，对不上（导入的、新加的）退回名字首字
  const CAT_CLASS = { '找文献': 'find', '读文献': 'read', '写综述': 'write', '研究设计': 'design', '数据分析': 'data', '写全文': 'draft', '审稿返修': 'reply', '我的工具': 'mine' };
  const ICON_OF = { search: 'search-lit', verify: 'verify', deep: 'deep-read', modlist: 'module-list', gap: 'gap', review: 'write-review', assembly: 'assemble', paper: 'write-paper', 'review-article': 'review-article',
    pxyv: 'pxyv', pyramid: 'pyramid', pdfzotero: 'pdf-zotero', modgen: 'module-gen', blueprint: 'blueprint', methodsmap: 'methods-map', methoddraft: 'method-draft',
    dataround: 'data-round', synth: 'synth', skillshop: 'skill-shop', wfbuild: 'wf-build', deconstruct: 'deconstruct', framework: 'framework', fulldraft: 'full-draft',
    submission: 'submission', 'review-ledger': 'review-ledger', 'review-revise': 'review-revise', mineru: 'pdf-text' };
  const glyph = name => (String(name || '').trim().match(/[\p{Script=Han}A-Za-z0-9]/u) || ['·'])[0].toUpperCase();
  const tile = (id, name, cls, size = '') => `<span class="tile ${cls} ${size}">${ICON_OF[id] ? I(ICON_OF[id]) : esc(glyph(name))}</span>`;
  const wfTile = (w, size) => tile(w.id, w.name, w.kind === '测试' ? '' : 'wf', size);
  const toolTile = (t, size) => tile(t.id, t.name, CAT_CLASS[t.cat] || '', size);
  // 状态记号（16×16）：排队空心圈、执行转弧、等你实心带晕、完成对勾、出错叹号、已停止灰点
  const SG = {
    queued: '<circle cx="8" cy="8" r="3.75" fill="none" style="stroke:var(--faint)" stroke-width="1.5"/>',
    running: '<circle cx="8" cy="8" r="5" fill="none" style="stroke:var(--blue-light)" stroke-width="1.75"/><path class="spin" d="M8 3a5 5 0 0 1 5 5" fill="none" style="stroke:var(--blue)" stroke-width="1.75" stroke-linecap="round"/>',
    waiting: '<circle class="halo" cx="8" cy="8" r="7" style="fill:var(--amber)" opacity=".3"/><circle cx="8" cy="8" r="4" style="fill:var(--amber)"/>',
    done: '<path d="M3.8 8.4l2.6 2.6 5.8-6" fill="none" style="stroke:var(--success)" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>',
    failed: '<circle cx="8" cy="8" r="6" style="fill:var(--rose)"/><path d="M8 4.8v3.6" style="stroke:var(--card)" stroke-width="1.6" stroke-linecap="round"/><circle cx="8" cy="11" r=".95" style="fill:var(--card)"/>',
    stopped: '<circle cx="8" cy="8" r="3.5" style="fill:var(--border-strong)"/>'
  };
  SG.stopping = SG.running;
  const sg = (status, cls = '') => `<svg class="sg ${esc(status)} ${cls}" viewBox="0 0 16 16" aria-hidden="true">${SG[status] || SG.stopped}</svg>`;
  // 空状态插画（120×96，设计稿第 4 步）：只一处琥珀；不配文字
  const ART = {
    tasks: '<rect x="28" y="20" width="56" height="68" rx="6" transform="rotate(-7 56 54)" fill="#FBF9F4" stroke="#D9D3C6"/><rect x="34" y="12" width="56" height="68" rx="6" fill="#fff" stroke="#CFC8BA"/><path d="M44 32h26M44 40h34M44 48h20" stroke="#E5E0D5"/><path d="M76 12v22l5-4 5 4V12" fill="#E9E5DC" stroke="#A59F93"/>',
    projects: '<path d="M22 34a6 6 0 0 1 6-6h18l6 6h40a6 6 0 0 1 6 6v36a6 6 0 0 1-6 6H28a6 6 0 0 1-6-6z" fill="#FBF9F4" stroke="#D9D3C6"/><rect x="38" y="16" width="44" height="44" rx="4" fill="#fff" stroke="#CFC8BA"/><path d="M46 26h22M46 33h28" stroke="#E5E0D5"/><path d="M20 47a5 5 0 0 1 5-5h70a5 5 0 0 1 5 5l-3 29a6 6 0 0 1-6 6H29a6 6 0 0 1-6-6z" fill="#fff" stroke="#CFC8BA"/><rect x="50" y="56" width="20" height="8" rx="2" fill="#E9E5DC" stroke="#A59F93"/>',
    files: '<rect x="34" y="12" width="52" height="68" rx="6" fill="#FBF9F4" stroke="#CFC8BA" stroke-dasharray="4 4"/><path d="M44 30h22M44 38h30" stroke="#E5E0D5" stroke-dasharray="4 4"/><circle cx="84" cy="74" r="11" fill="#E9E5DC" stroke="#A59F93"/><path d="M84 69v10M79 74h10" stroke="#A59F93"/>',
    missing: '<path d="M40 12h30l16 16v42l-6.5 4-6.5-4-6.5 4-6.5-4-6.5 4-6.5-4-6.5 4-6.5-4V18a6 6 0 0 1 6-6z" fill="#fff" stroke="#CFC8BA"/><path d="M70 12v10a6 6 0 0 0 6 6h10" stroke="#CFC8BA"/><path d="M44 38h28M44 46h20M44 54h32" stroke="#E5E0D5"/><path d="M50 84l6.5-4 6.5 4 6.5-4v6a2 2 0 0 1-2 2H52a2 2 0 0 1-2-2z" fill="#E9E5DC" stroke="#A59F93"/>',
    search: '<rect x="28" y="12" width="50" height="64" rx="6" fill="#FBF9F4" stroke="#CFC8BA"/><path d="M38 28h24M38 36h30M38 44h14" stroke="#E5E0D5"/><path d="M83 67l12 12" stroke="#A59F93" stroke-width="4"/><circle cx="72" cy="56" r="14" fill="#F3EFE7" stroke="#A59F93"/>',
    agent: '<rect x="12" y="30" width="36" height="36" rx="8" fill="#fff" stroke="#CFC8BA"/><path d="M20 41h20M20 48h14M20 55h17" stroke="#E5E0D5"/><rect x="72" y="30" width="36" height="36" rx="8" fill="#fff" stroke="#CFC8BA"/><path d="M90 38l2.4 6.6 6.6 2.4-6.6 2.4L90 56l-2.4-6.6L81 47l6.6-2.4z" stroke="#CFC8BA"/><path d="M48 48h6M66 48h6" stroke="#CFC8BA"/><circle cx="60" cy="48" r="3.5" fill="#E9E5DC" stroke="#A59F93"/>'
  };
  const ART_LABEL = { tasks: '没有任务', projects: '没有项目', files: '没有文件', missing: '文件打不开', search: '没有结果', agent: 'AI 程序未连接' };
  const art = (name, big, title) => `<svg width="${big ? 240 : 120}" height="${big ? 192 : 96}" viewBox="0 0 120 96" fill="none" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" role="img" aria-label="${esc(title || ART_LABEL[name])}">${title ? `<title>${esc(title)}</title>` : ''}${ART[name]}</svg>`;
  const plainLabel = s => String(s || '').replace(/[（(]可选[)）]/g, '').trim();

  // ---------- 弹窗、菜单 ----------
  const layer = document.createElement('div'); document.body.appendChild(layer);
  const close = () => { layer.innerHTML = ''; };
  layer.addEventListener('click', e => { if (e.target.hasAttribute('data-close') || e.target.closest('button[data-close]')) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  function modal(title, inner, wide) {
    layer.innerHTML = `<div class="modal-back" data-close><div class="modal ${wide ? 'wide' : ''}"><div class="row"><h3 class="grow">${title}</h3><button class="ib sm" data-close>${I('x')}</button></div>${inner}</div></div>`;
  }
  // 风险确认（10-21 Windows 实测：以前只闪一句提示、没有确认按钮，Claude Code 在 Windows 上一个任务都开不起来）
  function riskConfirm(json) {
    const name = ((B.engines || []).find(e => e.id === json.riskAck) || {}).name || json.riskAck;
    return new Promise(res => {
      modal(`使用 ${esc(name)}？`, `<p style="line-height:1.7">${esc(json.error || '')}</p><p style="color:var(--soft);font-size:13px">不想用的话，可以在右栏 AI 名字下面的下拉里换成别的 AI 程序。</p>
        <div class="mfoot"><button class="btn" id="rkNo">取消</button><button class="btn primary" id="rkOk">确定使用 ${esc(name)}</button></div>`);
      const done = v => { close(); res(v); };
      $('#rkNo').onclick = () => done(false); $('#rkOk').onclick = () => done(true);
      layer.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => res(false)));
    });
  }
  function confirmBox(title, html, okText, onOk, danger) {
    modal(title, `${html}<div class="mfoot"><button class="btn" data-close>取消</button><button class="btn ${danger ? 'accent' : 'primary'}" id="cfOk">${okText}</button></div>`);
    $('#cfOk').onclick = () => { close(); onOk(); };
  }
  function menu(anchor, items) {
    const r = anchor.getBoundingClientRect();
    layer.innerHTML = `<div style="position:fixed;inset:0;z-index:45" data-close></div><div class="menu" style="left:${Math.min(r.left, innerWidth - 210)}px;top:${r.bottom + 4}px;max-height:${Math.max(160, innerHeight - r.bottom - 16)}px;overflow:auto">${items.map((it, i) => it.head ? `<div class="mhead">${esc(it.head)}</div>` : `<div class="pick ${it.danger ? 'danger' : ''}" data-i="${i}">${it.icon ? I(it.icon) : ''}${it.label}${it.on ? '<span class="chk">✓</span>' : ''}</div>`).join('')}</div>`;
    layer.querySelectorAll('[data-i]').forEach(el => el.onclick = () => { close(); items[+el.dataset.i].run(); });
  }

  // ---------- 左栏：项目。Dashboard（下面一级是收件箱）+ 项目；当前项目展开文件 ----------
  const ST = { queued: '排队', running: '执行中', stopping: '停止中', waiting: '等你回复', done: '完成', failed: '出错', stopped: '已停止' };
  const ACTIVE = ['running', 'stopping', 'queued', 'waiting'], LIVE_ST = ACTIVE; // 还没结束的（和 runtime.cjs 的 LIVE 一样）
  function when(iso) {
    if (!iso) return '';
    const d = new Date(iso); if (isNaN(d)) return '';
    const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    return d.toDateString() === new Date().toDateString() ? hm : `${d.getMonth() + 1}/${d.getDate()}`;
  }
  // 阶段进度：完成的琥珀、下一段浅琥珀、其余灰；全做完变绿
  const bar = (done, total, cls = 'pbar') => `<div class="${cls} ${done === total ? 'full' : ''}">${Array.from({ length: total }, (_, i) => `<i class="${i < done ? 'ok' : i === done ? 'next' : ''}"></i>`).join('')}</div>`;
  function renderLeft() {
    const list0 = B.projects || [];
    const tri = p => p.inboxNew ? `<span class="ibadge" title="还没梳理的文件">${p.inboxNew}</span><button class="ib sm" data-triage title="一键梳理：Research Agent 看一遍，给出每个文件放哪的计划">${I('wand')}</button>` : '';
    const row = p => {
      const on = p.id === B.current, acts = p.activity || [];
      const live = acts.find(a => a.status === 'waiting') || acts.find(a => ACTIVE.includes(a.status));
      // 当前项目下面是文件（10-18 第三轮从右栏挪来）：占位，内容由 renderFiles() 单独画，互不重写。工作流进度条不放左栏了（乔淼 10-29，主页卡片上有）
      // Dashboard 下面一级是收件箱（乔淼 10-29）：选中时就是收件箱里的文件，没选中时一行「收件箱」
      const body = on ? (p.exists ? '<div class="pfiles" id="l-files"></div>' : '') : p.inbox ? `<div class="pbody"><div class="pinbox">${I('inbox')}<span class="grow">收件箱</span>${tri(p)}</div></div>` : '';
      return `<div class="proj ${on ? 'on' : ''} ${p.exists ? '' : 'gone'} ${p.inbox ? 'inbox' : ''}" data-proj="${esc(p.id)}" ${p.inbox ? 'title="收件箱、各项目近况、所有待办都在这里；把零散文件拖到这里，就放进收件箱"' : ''}>
        <div class="prow" title="${esc(p.exists ? p.path : '找不到这个文件夹了')}">${I(p.inbox ? 'dash' : 'folder')}<span class="nm">${esc(p.inbox ? 'Dashboard' : p.name)}</span>
          ${!on && live ? `<span class="live ${esc(live.status)}" title="${esc(ST[live.status] || '')}"></span>` : ''}${on && !p.inbox ? `<button class="ib sm more" data-more="${esc(p.id)}" title="更多">${I('more')}</button>` : ''}</div>${body}</div>`;
    };
    // Dashboard 置顶；下面「项目 +」和各个项目是一块（乔淼 10-29）
    const plain = list0.filter(p => !p.inbox).map(row).join(''), inbox = list0.filter(p => p.inbox).map(row).join('');
    const cards = inbox + (inbox ? '<div class="pdiv0"></div>' : '') + `<div class="lhead"><span class="grow">项目</span><button class="ib sm" data-act="add" title="新建或打开项目">${I('plus')}</button></div>` + plain;
    const cp = proj(); document.title = (cp && !cp.inbox ? cp.name + ' · ' : '') + BRAND + ' Framework';
    put($('#left'), `<div class="brand" title="${BRAND} · 开发：乔淼PhD"><svg viewBox="0 4 24 16" width="39" height="26">${LOGO}</svg><svg class="wmark" viewBox="0 0 96 34" width="96" height="34" role="img" aria-label="${BRAND} framework"><text x="0" y="15" font-size="18" font-weight="700" textLength="95" lengthAdjust="spacing" fill="currentColor">${BRAND}</text><text x="0.5" y="31" font-size="12" textLength="94" lengthAdjust="spacing" class="wsub">framework</text></svg></div>
      <div class="scroll scroll-y">${cards}</div>
      <div class="leftfoot">${updHTML()}<button class="btn ghost small" data-act="settings">${I('sliders')}AI学术环境配置</button><div class="motto" title="Karl Popper">All life is problem-solving.</div></div>`);
    const lf = $('#l-files'); if (lf && lf.__html === undefined) renderFiles(); // 左栏整块重写过：文件区是新的空壳，补画
  }
  function addMenu(anchor) {
    menu(anchor, [{ label: '新建项目', icon: 'plus', run: newProject },
      { label: '打开文件夹…', icon: 'folderOpen', run: () => act('projects/open', {}).then(r => { if (r) { loadFiles(); loadRuns(); } }) }]);
  }
  function newProject() {
    modal('新建项目', `
      <div class="field"><label>名称</label><input type="text" id="npName"></div>
      <div class="field"><label>位置</label><div class="row"><input type="text" id="npDir" value="${esc(B.projectsDir)}"><button class="btn small" id="npPick">选择…</button></div></div>
      <div class="field inline"><label>产出语言</label><select id="npLang">${(B.langs || ['中文']).map(l => `<option>${esc(l)}</option>`).join('')}</select></div>
      <div class="err" id="npErr"></div>
      <div class="mfoot"><button class="btn" data-close>取消</button><button class="btn primary" id="npOk">新建</button></div>`);
    $('#npName').focus();
    $('#npPick').onclick = async () => { try { const r = await api('projects/pick-dir', 'POST', {}); if (r.dir) $('#npDir').value = r.dir; } catch (e) { toast(e.message); } };
    const ok = async () => {
      try {
        const r = await api('projects/create', 'POST', { name: $('#npName').value, dir: $('#npDir').value.trim(), lang: $('#npLang').value });
        close(); Object.assign(B, r); renderAll(); loadFiles(); loadRuns();
      } catch (e) { $('#npErr').textContent = e.message; }
    };
    $('#npOk').onclick = ok;
    $('#npName').addEventListener('keydown', e => { if (e.key === 'Enter') ok(); });
  }
  const KIND_NAME = { paper: '论文', students: '学员交付', gzh: '公众号', teaching: '备课', general: '通用' };
  function projectMenu(anchor, p) {
    const items = [{ label: '项目说明', icon: 'doc', run: () => openDoc('AGENTS.md') },
      { label: '在访达中打开', icon: 'folderOpen', run: () => api('projects/reveal', 'POST', { id: p.id }).catch(e => toast(e.message)) }];
    // 项目类型（内容 1.3.5）：决定「下一步」建议用哪套规则。乔淼自用：学员的 App 里不出这一项（B.selfUse）
    if (!p.inbox && B.selfUse) items.push({ label: `项目类型：${KIND_NAME[p.kind || 'paper']}`, icon: 'sliders', run: () => menu(anchor, Object.entries(KIND_NAME).map(([k, n]) => ({ label: n, on: (p.kind || 'paper') === k,
      run: () => act('projects/update', { id: p.id, kind: k }, `「${p.name}」改成${n}项目：下一步建议按${n}的规则出`).then(() => { delete (S.facts || {})[p.id]; loadFacts(); }) }))) });
    if (!p.inbox) items.push({ label: '从列表移除', icon: 'x', danger: true, run: () => confirmBox(`从列表移除「${esc(p.name)}」？`,
      '<p class="muted small" style="margin:10px 0 0">文件夹和文件保留。</p>', '移除',
      () => act('projects/remove', { id: p.id }).then(r => { if (r) { loadFiles(); loadRuns(); } }), true) });
    menu(anchor, items);
  }

  // ---------- 更新（第 8 步）：App 在后台下好新内容 / 发现新安装包后，左下角出一个按钮。下好的内容要点了才换上（会刷新窗口），
  // 免得工作流里填到一半的东西丢了；有任务在跑时工作站会拒绝，提示等它结束 ----------
  // 左下角的更新提示。两路：外壳自己的（只查 GitHub，下好了能「立即更新」）和内容层的国内更新（先阿里云再 GitHub，下好了要重新打开 POPPER）
  function updHTML() {
    const u = S.upd || {}, m = S.mupd || {};
    if (u.contentReady) return `<button class="btn primary small upd" data-act="upd-apply" title="${esc(u.contentReady.notes || '')}">${I('refresh')}立即更新 ${esc(u.contentReady.version)}</button>`;
    if (m.ready) return `<button class="btn primary small upd" data-act="upd-restart">${I('refresh')}新版本 ${esc(m.ready)} 已下好</button>`;
    if (u.shellAvailable) return `<button class="btn small upd" data-act="upd-shell" title="${esc(u.shellAvailable.notes || '')}">${I('upload')}下载新安装包 ${esc(u.shellAvailable.version)}</button>`;
    if (m.error && !m.checking) return `<button class="btn ghost small upd" data-act="upd-err" title="${esc(m.error)}">${I('refresh')}检查更新没成功</button>`;
    return '';
  }
  function loadUpd() {
    Promise.all([api('update').catch(() => ({})), Promise.resolve({})]).then(([x, m]) => { const was = updHTML(); S.upd = x; S.mupd = m; if (updHTML() !== was) renderLeft(); });
  }
  // 「检查更新」：走国内更新（先阿里云再 GitHub），等结果出来再说话
  async function checkUpdateNow(btn) {
    if (btn) { btn.disabled = true; btn.textContent = '正在检查…'; }
    let m; try { m = await api('mirror-update/check', 'POST', {}); } catch (err) { m = { error: err.message }; }
    S.mupd = m; renderLeft();
    if (!m.supported && !m.error) return toast('这个版本不自动更新');
    // 不说更新信息从哪来（国内 / GitHub），学员不需要知道（乔淼 10-24）；出错的原文放在鼠标悬停里
    const msg = m.error ? '没检查成功，可能是网络不通。换个网络（比如开一下梯子）再点一次。'
      : m.ready ? `新版本 ${m.ready} 已下好：关掉 POPPER 窗口再打开就生效。`
      : `已经是最新版（内容 ${m.running}）。`;
    modal('检查更新', `<p style="line-height:1.7;margin:0" title="${esc(m.error || '')}">${esc(msg)}</p><div class="mfoot"><span class="grow"></span><button class="btn" data-close>好</button></div>`);
  }
  // ---------- AI学术环境配置：AI 程序（模型、effort）、我的 skills 库、文献工具、Zotero、pandoc、版本 ----------
  // 每一项「已就绪 / 没装」；没装的「交给 AI 安装」，在收件箱里跑；顶上「配置指南」看每一项干什么用、怎么装
  async function openSettings() {
    STO = null;
    const yes = (ok, a, b, title) => `<span class="chip ${ok ? 'ok' : 'bad'}" ${title ? `title="${esc(title)}"` : ''}>${ok ? a : b}</span>`;
    const inst = (what, show) => show ? `<button class="btn small" data-install="${what}" title="交给 AI 安装，在收件箱里跑">安装</button>` : '';
    // skills 类：缺哪个 AI 程序就给哪个一个按钮，一次只装进一个（乔淼 10-21：分两次装）
    const instTo = (what, list) => list.map(e => `<button class="btn small" data-install="${what}" data-engine="${esc(e.id)}" title="${['course', 'search'].includes(what) ? `下载后装进 ${esc(e.name)} 的 skills 文件夹` : `在 ${esc(e.name)} 客户端里装：复制指令粘贴进去`}">安装</button>`).join('');
    // 内容 1.2.0（乔淼 10-24）：先选 AI 程序（上面一排卡片），下面只显示这一个的配置；和哪个 AI 都无关的放最下面「大家共用的」
    const ENG = () => (B.engines || []).filter(e => !isFake(e.id));
    if (!S.cfgEng || !ENG().some(e => e.id === S.cfgEng)) S.cfgEng = B.engine;
    const nSearch = e => ['gs', 'sd', 'wos', 'cnki'].filter(k => e.search[k]).length;
    const wait = '<div class="set-row muted">检查中…</div>';
    const engRow = (e, x) => {
      const meta = e.version ? `<div class="sub2 mono">模型 ${esc((x && x.model) || e.model || (e.defaults || {}).model || '默认')} · effort ${esc((x && x.effort) || (e.defaults || {}).effort || '默认')}</div>` : '';
      // 「手动选择」：自动找不到时自己指给 POPPER（10-21）；手动指过的可以「恢复自动」
      const pick = `<button class="btn small" data-pickbin="${esc(e.id)}" title="自己找到 ${esc(e.name)} 的程序文件指给 ${BRAND}">手动选择</button>${e.manual ? `<button class="linkish" data-clearbin="${esc(e.id)}">恢复自动</button>` : ''}`;
      return `<div class="set-row"><span class="grow">程序${meta}<div class="sub2 ellipsis" title="${esc(e.path || '')}">${esc(e.version ? e.where : e.missingHint)}</div></span>${e.version ? `<span class="chip ok">${esc(e.version.replace(/\s*\(.*\)$/, ''))}</span>` : e.checking ? '<span class="chip">检测中…</span>' : '<span class="chip bad">没找到</span>'}${!e.version && !e.checking && e.install ? `<button class="btn small primary" data-howto="${esc(e.id)}">怎么装</button>` : ''}${!e.version || e.manual ? pick : ''}</div>`;
    };
    // 额外放行的服务（内容 1.3.2）：点「选择」才去问这台电脑上的 AI 程序连着哪些服务（要十几秒），问到的记在 S.mcpList
    const short = n => n.replace(/^claude\.ai /, '');
    const mcpRow = e => {
      const list = (S.mcpList || {})[e.id], on = new Set(e.extraMcp || []);
      const rows = list === 'loading' ? '<div class="set-row muted small">正在问 ' + esc(e.name) + ' 连着哪些服务（十几秒）…</div>'
        : Array.isArray(list) ? (list.length ? list.map(m => `<div class="set-row"><span class="grow">${esc(short(m.name))}${m.name.startsWith('claude.ai ') ? '<div class="sub2">claude.ai 网页上连的</div>' : ''}${m.ok ? '' : '<div class="sub2">现在没连上</div>'}</span><label class="qswitch ${on.has(m.name) ? 'on' : ''}" data-mcpon="${esc(m.name)}"><i></i>${on.has(m.name) ? '已放行' : '没放行'}</label></div>`).join('')
          : '<div class="set-row muted small">没有别的服务</div>') : '';
      return `<div class="set-sub">额外放行的服务</div><div class="set-row"><span class="grow">让 AI 在 ${BRAND} 里也能用<div class="sub2">${on.size ? '已放行：' + [...on].map(n => esc(short(n))).join('、') : '课程只放行 Zotero、scansci-pdf；要用 Notion 这类服务，在这里勾'}。删除类的操作照样不放行</div></span>${Array.isArray(list) ? '' : `<button class="btn small" data-mcplist="${esc(e.id)}">选择</button>`}</div>${rows}`;
    };
    const stateOf = (e, x, L) => !e.enabled ? 'off' : e.checking ? 'wait' : !e.version ? 'missing' : x && x.found && (skillState(x, L) !== 'ok' || !x.zotero) ? 'warn' : 'ok';
    const STATE = { off: '没启用', wait: '检测中…', missing: '没找到', warn: '有要处理的', ok: '就绪' };
    const draw = (env, u) => {
      const L = (env && env.skillsLatest) || {}, envOf = id => env && env.engines.find(y => y.id === id);
      const cards = ENG().map(e => { const st = stateOf(e, envOf(e.id), L); return `<button class="engcard ${st} ${e.id === S.cfgEng ? 'on' : ''}" data-engsel="${esc(e.id)}"><i class="dot"></i><span class="grow"><b>${esc(e.name)}</b><span>${STATE[st]}${e.isDefault ? ' · 默认' : ''}</span></span></button>`; }).join('');
      const e = ENG().find(y => y.id === S.cfgEng), x = envOf(S.cfgEng);
      let pane = `<div class="set-row"><span class="grow">启用 ${esc(e.name)}<div class="sub2">启用了才出现在右栏的 AI 选择、「换一个 AI 重做」里，这里才检查它的 skills 和服务</div></span>${e.enabled && e.isDefault ? '<span class="chip">默认</span>' : e.enabled ? `<button class="btn small ghost" data-engdef="${esc(e.id)}" title="新项目、收件箱默认用它">设为默认</button>` : ''}<label class="qswitch ${e.enabled ? 'on' : ''}" data-engon="${esc(e.id)}" title="${e.enabled ? '停用' : '启用'}"><i></i>${e.enabled ? '已启用' : '没启用'}</label></div>`;
      if (!e.enabled) pane += `<div class="set-row muted small">没启用：右栏里不会出现它，也不检查它。用之前先在电脑上装好、登录，再打开上面的开关。</div>`;
      else {
        pane += engRow(e, x);
        if (e.riskNotice) pane += `<div class="set-row small muted">${esc(e.riskNotice)}</div>`;
        if (e.canExtraMcp && e.version) pane += mcpRow(e);
        if (!env) pane += wait;
        else if (x && x.found) pane += `<div class="set-sub">skills</div>${skillLibRow(env, [x])}
          <div class="set-row"><span class="grow">第三方 skills<div class="sub2">从 GitHub 装的、工具文件里带的：看装了哪些、卸载</div></span><button class="btn small" data-ghmanage>管理</button></div>
          <div class="set-sub">文献工具</div>
          <div class="set-row"><span class="grow">数据库检索 skills<div class="sub2">Google Scholar · ScienceDirect · Web of Science · 知网</div></span>${yes(nSearch(x) === 4, '4/4', `${nSearch(x)}/4`)}${instTo('search', nSearch(x) < 4 ? [x] : [])}</div>
          <div class="set-row"><span class="grow">scansci-pdf<div class="sub2">批量下载论文 PDF</div></span>${yes(x.scansci, '已配置', '未配置')}${instTo('scansci', x.scansci ? [] : [x])}</div>
          <div class="set-row"><span class="grow">Zotero 服务<div class="sub2">让 AI 能检索、读写你的 Zotero 文献库</div></span>${yes(x.zotero, '已配置', '未配置')}${instTo('zotero', x.zotero ? [] : [x])}</div>${!x.zotero || !('zoteroWrite' in x) ? '' : `
          <div class="set-row"><span class="grow">能入库<div class="sub2" title="梳理收件箱的「PDF 入库」、文献搜索最后的入库都要用。本地模式只能读，要加 Zotero 网页版的 key">PDF 入库要用；本地模式只能读</div></span>${yes(x.zoteroWrite, '能入库', '只能读')}${x.zoteroWrite ? '' : `<button class="btn small" data-install="zoteroWrite" data-engine="${esc(x.id)}" title="在 ${esc(x.name)} 客户端里改：复制指令粘贴进去">让它能入库</button>`}</div>`}`;
      }
      modal(`AI学术环境配置<button class="btn ghost small guide" data-guide>${I('doc')}配置指南</button>`, `
        <div class="set-sec">AI 程序</div><div class="engcards">${cards}</div><div class="engpane">${pane}</div>
        <div class="set-sec">大家共用的</div>
        <div class="set-row"><span class="grow">AI 的名字<div class="sub2">右栏顶上那位 AI 叫什么</div></span><input type="text" id="agentName" maxlength="24" value="${esc(B.agentName || 'Research Agent')}" style="width:160px"><button class="btn small" id="agentNameOk">保存</button></div>${!env ? wait : `
          <div class="set-row"><span class="grow">Zotero</span>${yes(env.zotero.running, '已打开', '没打开')}${env.zotero.running ? '' : '<button class="btn small" data-guide2 title="要装最新版 Zotero 并打开它">怎么设置</button>'}</div>
          <div class="set-row"><span class="grow">Zotero 本地 API</span>${env.zotero.running ? yes(env.zotero.api, '已开启', '未开启', env.zotero.api ? '' : '在 Zotero 的设置里勾上「允许此计算机上的其他应用程序与 Zotero 通信」') : '<span class="chip">—</span>'}${env.zotero.running && !env.zotero.api ? '<button class="btn small" data-guide2>怎么设置</button>' : ''}</div>
          <div class="set-row"><span class="grow">同一个项目同时跑几个任务<div class="sub2">多了的排队，有一个结束就接着开；「等你回复」的不占位。同时跑得越多，额度用得越快、电脑越忙，也更容易两个 AI 改到同一个文件</div></span><select id="parN">${[1, 2, 3, 4, 5].map(n => `<option ${n === (B.parallel || 3) ? 'selected' : ''}>${n}</option>`).join('')}</select></div>
          <div class="set-row"><span class="grow">AI 还能写的文件夹<div class="sub2">平时 AI 只能写当前项目的文件夹；这里加的文件夹所有 AI 都能写（比如让收件箱的任务把文件放进别的项目）。${(B.writeDirs || []).length ? (B.writeDirs || []).map(d => `<span class="mono">${esc(d.replace(/^\/Users\/[^/]+/, '~'))}</span>`).join('、') : '现在没有'}</div></span><button class="btn small" data-wdirs>${(B.writeDirs || []).length ? '修改' : '添加'}</button></div>
          <div class="set-row"><span class="grow">OpenAlex<div class="sub2">综述文章的检索筛选用</div></span>${yes(env.openalex.key, '已填 API key', '没填 API key', env.openalex.mailto ? '邮箱 ' + env.openalex.mailto : '')}<button class="btn small" data-oa>${env.openalex.key ? '修改' : '填写'}</button></div>
          <div class="set-row"><span class="grow">pandoc<div class="sub2">综述、全文初稿转 Word 用</div></span>${yes(!!env.pandoc, '已安装', '没装', env.pandoc)}${inst('pandoc', !env.pandoc)}</div>
          <div class="set-row"><span class="grow">Roughdraft<div class="sub2">md 文件在浏览器里批注，批完自动交给 AI 改</div></span>${yes(!!env.roughdraft.path, '已安装', '没装', env.roughdraft.path)}${env.roughdraft.path ? '' : '<button class="btn small" data-howto-rd>怎么装</button>'}</div>${env.mineru ? `
          ${muRow(env.mineru)}` : ''}`}

        <div class="set-sec">手机远程 <span class="chip">实验版</span></div>
        <div class="set-row"><span class="grow">用手机看任务、回复 AI、开新任务<div class="sub2">手机和电脑装同一个 Tailscale；任务做完、等你回复时发企业微信通知。怎么配见「配置指南」第 8 节</div></span><button class="btn small" data-remote>设置</button></div>
        <div class="set-sec">空间占用</div><div id="stoBox"><div class="set-row"><span class="grow">看看 POPPER 和 AI 程序在电脑上占了多少地方<div class="sub2">大头一般是 Codex 留着的旧版本；能清的只移进${/^win/.test(B.platform || '') ? '回收站' : '废纸篓'}，不直接删</div></span><button class="btn small" id="stoGo">查看</button></div></div>
        <div class="set-sec">版本</div>
        <div class="set-row"><span class="grow">${BRAND} · 外壳 ${esc(B.shellVersion)} · 内容 ${esc(B.contentVersion)}${B.dev ? ' · 开发模式' : ''}<div class="sub2">开发：乔淼PhD</div></span></div>
        <div class="mfoot">${B.canQuit ? `<button class="btn ghost" id="quitBtn">${I('power')}退出工作站</button><span class="grow"></span>` : ''}<button class="btn" id="recheck">${I('refresh')}重新检测</button></div>`, true);
    };
    let env = null, u = '';
    const wire = () => {
      $('#recheck').onclick = async () => { try { Object.assign(B, await api('recheck', 'POST', {})); renderTasks(); env = null; draw(env, u); wire(); load(); } catch (err) { toast(err.message); } };
      const q = $('#quitBtn'); if (q) q.onclick = quit;
      // 选 AI 程序、启用 / 停用、设为默认（内容 1.2.0）
      layer.querySelectorAll('[data-engsel]').forEach(b => b.onclick = () => { S.cfgEng = b.dataset.engsel; draw(env, u); wire(); });
      layer.querySelectorAll('[data-mcplist]').forEach(b => b.onclick = async () => {
        const id = b.dataset.mcplist; S.mcpList = { ...(S.mcpList || {}), [id]: 'loading' }; draw(env, u); wire();
        try { const r = await api('engine/mcp', 'GET', { engine: id }); S.mcpList[id] = r.servers; const e = (B.engines || []).find(x => x.id === id); if (e) e.extraMcp = r.on; }
        catch (err) { delete S.mcpList[id]; toast(err.message); }
        if (layer.querySelector('.engpane')) { draw(env, u); wire(); } // 配置还开着才重画（关掉了就不重新弹出来）
      });
      layer.querySelectorAll('[data-mcpon]').forEach(b => b.onclick = async () => {
        const id = S.cfgEng, name = b.dataset.mcpon, e = (B.engines || []).find(x => x.id === id), on = !(e.extraMcp || []).includes(name);
        try { const r = await api('engine/mcp', 'POST', { engine: id, server: name, on }); e.extraMcp = r.on; toast(on ? `放行了 ${short(name)}：之后的任务里 AI 能用它（删除类操作除外）` : `不再放行 ${short(name)}`); draw(env, u); wire(); }
        catch (err) { toast(err.message); }
      });
      layer.querySelectorAll('[data-engon]').forEach(b => b.onclick = async () => {
        const id = b.dataset.engon, on = !((B.engines || []).find(e => e.id === id) || {}).enabled;
        try { Object.assign(B, await api('engine/enable', 'POST', { engine: id, enabled: on })); renderAll(); toast(on ? `启用了 ${engineName(id)}` : `停用了 ${engineName(id)}：右栏里不再出现它`); env = null; draw(env, u); wire(); load(); }
        catch (err) { toast(err.message); }
      });
      layer.querySelectorAll('[data-engdef]').forEach(b => b.onclick = async () => {
        try { Object.assign(B, await api('engine', 'POST', { engine: b.dataset.engdef })); renderAll(); toast(`默认用 ${engineName(b.dataset.engdef)}`); draw(env, u); wire(); }
        catch (err) { toast(err.message); }
      });
      const cu = $('#chkUpd'); if (cu) cu.onclick = () => checkUpdateNow(cu);
      if (STO) renderStorage(STO); else { const sg = $('#stoGo'); if (sg) sg.onclick = () => showStorage(); } // 配置窗口检测完会重画，算过的结果要留着
      layer.querySelectorAll('[data-pickbin], [data-clearbin]').forEach(b => b.onclick = async () => {
        try { Object.assign(B, await api('engine-bin', 'POST', b.dataset.clearbin ? { engine: b.dataset.clearbin, clear: true } : { engine: b.dataset.pickbin })); renderAll(); env = null; draw(env, u); wire(); load(); }
        catch (err) { toast(err.message); }
      });
      $('#agentNameOk').onclick = async () => { try { Object.assign(B, await api('agent-name', 'POST', { name: $('#agentName').value })); renderAgent(); toast('改好了'); } catch (err) { toast(err.message); } };
      layer.querySelector('[data-guide]').onclick = openGuide;
      layer.querySelectorAll('[data-guide2]').forEach(b => b.onclick = openGuide);
      const oa = layer.querySelector('[data-oa]'); if (oa) oa.onclick = () => openOpenAlex(env.openalex);
            const wd = layer.querySelector('[data-wdirs]'); if (wd) wd.onclick = openWriteDirs;
      const rm = layer.querySelector('[data-remote]'); if (rm) rm.onclick = () => openRemote();
      const pn = $('#parN'); if (pn) pn.onchange = async () => { try { Object.assign(B, await api('env/parallel', 'POST', { n: +pn.value })); toast(`同一个项目最多同时跑 ${pn.value} 个`); poll(); } catch (err) { toast(err.message); } };
      layer.querySelectorAll('[data-howto]').forEach(b => b.onclick = () => howToInstall(b.dataset.howto));
      const rd = layer.querySelector('[data-howto-rd]'); if (rd) rd.onclick = () => howToInstall(null, { name: 'Roughdraft', install: env.roughdraft.install });
      // MinerU（内容 1.2.4）：怎么装 / 怎么升级 / 下模型 / 手动选择 / 恢复自动
      layer.querySelectorAll('[data-howto-mu]').forEach(b => b.onclick = () => { const m = env.mineru, k = b.dataset.howtoMu; howToInstall(null, { name: 'MinerU', install: k === 'upgrade' ? m.upgrade : k === 'models' ? m.modelsHelp : m.install }); });
      layer.querySelectorAll('[data-mubin]').forEach(b => b.onclick = async () => {
        try { env.mineru = await api('mineru/bin', 'POST', b.dataset.mubin === 'clear' ? { clear: true } : {}); draw(env, u); wire(); toast(env.mineru.problem ? '还是用不了：' + MU_PROBLEM[env.mineru.problem] : `找到了 MinerU ${env.mineru.version}`); }
        catch (err) { toast(err.message); }
      });
      const gm = layer.querySelector('[data-ghmanage]'); if (gm) gm.onclick = openGhManage;
      const sl = layer.querySelector('[data-skilllib]'); if (sl) sl.onclick = () => updateSkillLib(sl, sl.dataset.skilllib.split(','));
      const ss = layer.querySelector('[data-skillsrc]'); if (ss) ss.onclick = () => openSkillsSource(env && env.skillsLatest && env.skillsLatest.source);
      layer.querySelectorAll('[data-install]').forEach(b => b.onclick = async () => {
        if (['course', 'search'].includes(b.dataset.install)) return installSkills(b, b.dataset.install, b.dataset.engine);
        if (['scansci', 'zotero', 'zoteroWrite', 'pandoc'].includes(b.dataset.install)) return installInClient(b.dataset.install, b.dataset.engine);
        try { const r = await api('env/install', 'POST', { what: b.dataset.install, engine: b.dataset.engine || undefined }); close(); askNotify(); toast(`已交给 ${engineName(r.engine)}，在收件箱里跑`); refreshProjects(); poll(); }
        catch (err) { toast(err.message); }
      });
    };
    const load = () => api('env').then(r => { env = r; B.mineru = !!(r.mineru && !r.mineru.problem); if ($('#recheck')) { draw(env, u); wire(); } }).catch(() => {});
    draw(env, u); wire(); load();
    // 只在测试版通道上写「测试版通道」，正式版什么都不写：学员不需要知道有测试版（10-22）
    api('update').then(x => { u = x.supported && x.channel === 'beta' ? '测试版通道' : ''; if ($('#recheck') && env) { draw(env, u); wire(); } }).catch(() => {});
  }
  // 配置里 MinerU 那一行（内容 1.2.4，乔淼 10-24：学员自己早装过的也要认得出、认不出能手动指）
  const MU_PROBLEM = { none: '没找到', old: '版本太旧', nopython: '找到了但用不了' };
  function muRow(m) {
    const tip = (m.tried || []).map(t => `${t.where}：${t.file} → ${t.result}`).join('\n');
    const chip = !m.problem ? `<span class="chip ok" title="${esc((m.where ? m.where + '：' : '') + m.path)}">${esc(m.version || '已安装')}</span>`
      : m.problem === 'old' ? `<span class="chip bad" title="${esc(m.path)}">${esc(m.version)} 太旧</span>`
      : `<span class="chip bad" title="${esc(tip || '')}">${MU_PROBLEM[m.problem] || '没装'}</span>`;
    const models = !m.problem && m.models === false ? `<span class="chip amber" title="第一次转时会自己下，那一篇要多等一会儿">模型没下</span><button class="btn small" data-howto-mu="models">下模型</button>` : '';
    const act = m.problem === 'old' ? '<button class="btn small" data-howto-mu="upgrade">怎么升级</button>' : m.problem ? '<button class="btn small" data-howto-mu="install">怎么装</button>' : '';
    const pick = m.problem && m.problem !== 'old' ? `<button class="btn small" data-mubin="pick" title="自己装在别处（conda、虚拟环境）的，找到里面的 mineru-kit 指给 ${BRAND}">手动选择</button>` : '';
    return `<div class="set-row"><span class="grow">MinerU<div class="sub2">PDF 转成带页码的文字稿（「读文献 → MinerU」），扫描版、表格也能读；可选${m.problem === 'nopython' ? '。找到了程序，但找不到它用的 Python：点「手动选择」指另一个，或者照「怎么装」重装一份' : ''}</div></span>${chip}${models}${act}${pick}${m.manual ? '<button class="linkish" data-mubin="clear">恢复自动</button>' : ''}</div>`;
  }
  // 我的 skills 库、数据库检索 skills：自己下载、解压、复制（不经过 AI）；装完弹结果，装不上给「复制安装指令」去客户端手动装
  // 我的 skills 库：学员自己的 GitHub 仓库或阿里云上的压缩包（地址在这里设置，怎么准备见配置指南第 2 节）。设置了地址、这个 AI 还没装或缺了，才算「要处理」
  const skillState = (e, L) => e.course.missing.length ? 'missing' : L.source && !e.course.installed ? 'none' : 'ok';
  function skillLibRow(env, E) {
    const L = env.skillsLatest || {};
    const chip = e => {
      const st = skillState(e, L), v = e.course.version;
      if (st === 'missing') return `<span class="chip bad" title="${esc(e.course.missing.join('、'))}">缺 ${e.course.missing.length}</span>`;
      if (!e.course.installed) return L.source ? '<span class="chip amber">没装</span>' : '';
      return `<span class="chip ok">${v ? esc(v) : '已装'}</span>`;
    };
    const sub = L.source ? L.source : '你自己的 skills 放在 GitHub 或阿里云上，填个地址，一键装进 AI';
    return `<div class="set-row"><span class="grow">我的 skills 库<div class="sub2 ellipsis" title="${esc(L.source || '')}">${esc(sub)}</div></span>${E.map(chip).join('')}<button class="btn small${L.source ? ' ghost' : ''}" data-skillsrc>${L.source ? '改地址' : '设置地址'}</button>${L.source ? `<button class="btn small" data-skilllib="${esc(E.map(e => e.id).join(','))}" title="下载最新的装进去：同名的旧版先备份到收件箱 .工作站/skills备份/">${E.some(e => e.course.installed) ? '更新' : '安装'}</button>` : ''}</div>`;
  }
  function openSkillsSource(cur) {
    modal('我的 skills 库', `
      <p style="line-height:1.7;margin:0 0 8px">把你自己写的 skills 放在网上一个地方，这里填它的地址，就能一键装进 AI、以后一键更新。两种放法（详细步骤见「配置指南」第 2 节）：</p>
      <ol style="line-height:1.8;padding-left:20px;margin:0 0 12px">
        <li><b>GitHub</b>：建一个公开仓库，每个 skill 一个文件夹（里面有 SKILL.md）。填「用户名/仓库名」或仓库网址。</li>
        <li><b>阿里云 OSS</b>：把 skills 文件夹打成 .zip，传到 OSS、设成公开读，复制文件网址。国内下载快。</li>
      </ol>
      <div class="field"><label>地址</label><input type="text" id="srcVal" value="${esc(cur || '')}" placeholder="例：yourname/my-skills，或 https://….aliyuncs.com/my-skills.zip"></div>
      <p class="small muted" style="margin:4px 0 0">只存在这台电脑上。清空再保存 = 不用了（已经装进 AI 的 skills 不会删）。</p>
      <div class="mfoot"><button class="btn" id="srcBack">返回</button><button class="btn primary" id="srcSave">保存</button></div>`);
    $('#srcBack').onclick = openSettings;
    $('#srcSave').onclick = async () => {
      try { await api('env/skills-source', 'POST', { source: $('#srcVal').value }); toast('已保存'); openSettings(); } catch (err) { toast(err.message); }
    };
  }
  // 空间占用（10-23 学员：磁盘占得快，不知道是哪里）：点「查看」才算；Codex 旧版本、3 个月以前的 Codex 对话记录能一键移进废纸篓 / 回收站
  const fmtSize = b => b >= 1e9 ? (b / 1e9).toFixed(1) + ' GB' : b >= 1e6 ? Math.round(b / 1e6) + ' MB' : b >= 1e3 ? Math.round(b / 1e3) + ' KB' : b + ' B';
  async function showStorage() {
    let box = $('#stoBox'); if (!box) return;
    box.innerHTML = '<div class="set-row muted">正在算…（文件多时要几秒）</div>';
    let r; try { r = await api('storage'); } catch (err) { box = $('#stoBox'); if (box) box.innerHTML = `<div class="set-row bad">${esc(err.message)}</div>`; return; }
    STO = r; renderStorage(r);
  }
  function renderStorage(r) {
    const box = $('#stoBox'); if (!box) return;
    const why = { 'codex-old': 'Codex 每次自动更新都把旧版本留着，现在用的那一版和最新的一版不动', 'codex-sessions-old': `移走以后，那些旧任务在 ${BRAND} 里不能再「接着做 / 追问」；已经做出来的文件不受影响` };
    box.innerHTML = r.items.filter(x => x.exists).map(x => `<div class="set-row"><span class="grow">${esc(x.name)}<div class="sub2 ellipsis" title="${esc(x.where)}">${esc([x.where, x.note].filter(Boolean).join(' · '))}</div></span><span class="chip">${fmtSize(x.bytes)}</span></div>`
      + (x.clean || []).filter(c => c.count).map(c => `<div class="set-row indent"><span class="grow">${esc(c.label)}<div class="sub2">${esc(why[c.id] || '')}</div></span><span class="chip amber">${fmtSize(c.bytes)}</span><button class="btn small" data-stoclean="${esc(c.id)}" data-stolabel="${esc(c.label)}" data-stosize="${fmtSize(c.bytes)}">移进${esc(r.trashName)}</button></div>`).join('')).join('')
      + `<div class="set-row"><span class="grow small muted">想从${esc(r.trashName)}里彻底删掉，自己去清空${esc(r.trashName)}；后悔了也能从那里拿回来。</span><button class="btn small ghost" id="stoGo">重新算</button></div>`;
    $('#stoGo').onclick = () => showStorage();
    box.querySelectorAll('[data-stoclean]').forEach(b => b.onclick = () => confirmBox(`把「${esc(b.dataset.stolabel)}」（${esc(b.dataset.stosize)}）移进${esc(r.trashName)}？`,
      `<p style="line-height:1.7">${esc(why[b.dataset.stoclean] || '')}。建议先关掉 Codex 和 ChatGPT 桌面版。</p>`, `移进${esc(r.trashName)}`, async () => {
        try { const x = await api('storage/clean', 'POST', { id: b.dataset.stoclean }); toast(`移进${r.trashName}：${x.moved.length} 个${x.errors.length ? `，${x.errors.length} 个没移成：${x.errors.join('；')}` : ''}`); }
        catch (err) { toast(err.message); }
        STO = null; await openSettings(); showStorage(); // 确认框换掉了配置窗口：回到配置、重新算
      }));
  }
  async function updateSkillLib(btn, engines) {
    btn.disabled = true; btn.textContent = '正在下载…';
    const rs = [];
    for (const engine of engines) {
      let r; try { r = await api('env/install-skills', 'POST', { what: 'course', engine }); } catch (err) { r = { engine, installed: [], backedUp: [], errors: [err.message] }; }
      if (r.config) Object.assign(B, r.config);
      rs.push(r);
    }
    const bad = rs.some(r => (r.errors || []).length);
    modal(bad ? (rs.some(r => r.installed.length) ? '更新了一部分' : '没更新上') : '更新好了', rs.map(r => `
      <div class="set-row"><span class="grow">${esc(engineName(r.engine))}${r.version ? ' · ' + esc(r.version) : ''}<div class="sub2 ellipsis" title="${esc(r.target || '')}">${esc(r.target || '')}</div></span><span class="chip ${r.installed.length ? 'ok' : 'bad'}">${r.installed.length} 个</span></div>
      ${r.backedUp.length ? `<div class="set-row"><span class="grow">同名的旧版先备份了<div class="sub2 ellipsis" title="${esc(r.backupDir || '')}">${esc(r.backupDir || '')}</div></span><span class="chip">${r.backedUp.length} 个</span></div>` : ''}
      ${r.errors.length ? `<div class="set-row"><span class="grow">没装上的<div class="sub2">${r.errors.map(esc).join('<br>')}</div></span></div>` : ''}`).join('') + `
      ${bad ? `<div class="set-row"><span class="grow small muted">网络不好时换个网络再点一次；也可以复制安装指令，到 Claude Code / Codex 客户端里手动装</span><button class="btn small" id="isCopy">复制安装指令</button></div>` : ''}
      <div class="mfoot"><button class="btn" id="isBack">回到配置</button></div>`);
    $('#isBack').onclick = openSettings;
    const c = $('#isCopy'); if (c) c.onclick = () => copyInstall('course', (rs.find(r => r.errors.length) || {}).engine);
  }
  async function installSkills(btn, what, engine) {
    btn.disabled = true; btn.textContent = '正在安装…';
    let r;
    try { r = await api('env/install-skills', 'POST', { what, engine }); } catch (err) { r = { engine, installed: [], backedUp: [], errors: [err.message] }; }
    if (r.config) Object.assign(B, r.config);
    const name = engineName(engine), bad = (r.errors || []).length;
    modal(bad ? (r.installed.length ? '装了一部分' : '没装上') : '装好了', `
      <div class="set-row"><span class="grow">装进 ${esc(name)}<div class="sub2 ellipsis" title="${esc(r.target || '')}">${esc(r.target || '')}</div></span><span class="chip ${r.installed.length ? 'ok' : 'bad'}">${r.installed.length} 个</span></div>
      ${r.backedUp.length ? `<div class="set-row"><span class="grow">同名的旧版先备份了<div class="sub2 ellipsis" title="${esc(r.backupDir || '')}">${esc(r.backupDir || '')}</div></span><span class="chip">${r.backedUp.length} 个</span></div>` : ''}
      ${bad ? `<div class="set-row"><span class="grow">没装上的<div class="sub2">${r.errors.map(esc).join('<br>')}</div></span></div>
        <div class="set-row"><span class="grow small muted">可以复制安装指令，打开 ${esc(name)} 客户端粘贴进去手动装</span><button class="btn small" id="isCopy">复制安装指令</button></div>` : ''}
      <div class="mfoot"><button class="btn" id="isBack">回到配置</button></div>`);
    $('#isBack').onclick = openSettings;
    const c = $('#isCopy'); if (c) c.onclick = () => copyInstall(what, engine);
  }
  // scansci-pdf、Zotero 服务、pandoc：要装程序、改 AI 程序的设置，POPPER 里的 AI 没有这个权限，给指令到客户端里装（10-21）
  async function installInClient(what, engine) {
    let t; try { t = await api('env/install-text', 'GET', { what, engine }); } catch (err) { return toast(err.message); }
    const who = engine ? engineName(engine) : 'AI 程序', isMac = navigator.platform.startsWith('Mac');
    modal('在客户端里安装', `
      <p style="line-height:1.7">这一项要装程序、改 AI 程序的设置，需要你在 ${esc(who)} 客户端里点同意。${esc(((B.engines || []).find(x => x.id === engine) || {}).client || '打开它的客户端')}，把下面的指令粘贴进去；装完回到这里点「重新检测」。</p>
      <textarea id="instText" readonly rows="11" style="width:100%;font:12.5px/1.6 var(--font-mono)">${esc(t.text)}</textarea>
      <div class="mfoot"><button class="btn" id="icBack">回到配置</button><span class="grow"></span><button class="btn primary" id="icCopy">复制指令</button></div>`, true);
    const ta = $('#instText'); ta.focus(); ta.select();
    $('#icBack').onclick = openSettings;
    $('#icCopy').onclick = async () => { if (await copyText(t.text)) toast('已复制，粘贴到客户端里'); else { ta.focus(); ta.select(); toast(`按 ${isMac ? '⌘C' : 'Ctrl+C'} 复制`); } };
  }
  async function copyInstall(what, engine) {
    try {
      const t = await api('env/install-text', 'GET', { what, engine });
      if (await copyText(t.text)) toast('安装指令已复制，粘贴到客户端里');
      else { // 复制不成功（没有剪贴板权限）：把指令摆出来、选中，让人自己按 ⌘C
        modal('安装指令', `<textarea id="instText" readonly rows="12" style="width:100%;font:12.5px/1.6 var(--font-mono)">${esc(t.text)}</textarea><div class="mfoot"><span class="grow small muted">按 ${navigator.platform.startsWith('Mac') ? '⌘C' : 'Ctrl+C'} 复制</span><button class="btn" data-close>关闭</button></div>`);
        const ta = $('#instText'); ta.focus(); ta.select();
      }
    } catch (err) { toast(err.message); }
  }
  // 没找到 Claude Code / Codex：说清楚要装的是命令行版，给这台电脑对应的一行官方安装命令（10-22 乔淼）
  // 没找到 Claude Code / Codex，或者没装 Roughdraft（tool：{ name, install }）：给这台电脑对应的一行安装命令
  function howToInstall(id, tool) {
    const e = tool || (B.engines || []).find(x => x.id === id); if (!e || !e.install) return;
    const x = e.install, isMac = navigator.platform.startsWith('Mac');
    modal(esc(x.title || '安装 ' + e.name), `
      <p style="line-height:1.7;margin:0 0 12px">${esc(x.note)}</p>
      <ol style="line-height:1.8;padding-left:20px;margin:0">
        <li>${esc(x.open)}。</li>
        ${x.steps ? x.steps.map((st, i) => `<li>${esc(st.say)}<div class="row" style="gap:6px;align-items:center"><textarea readonly rows="2" data-howcmd="${i}" style="flex:1;margin:6px 0;font:12.5px/1.6 var(--font-mono)">${esc(st.cmd)}</textarea><button class="btn small" data-howcopy="${i}">复制</button></div></li>`).join('') : `<li>把下面这一行粘贴进去，回车，等它装完（下载时可能好一会儿没有动静）：
          <textarea id="howCmd" readonly rows="2" style="width:100%;margin:6px 0;font:12.5px/1.6 var(--font-mono)">${esc(x.cmd)}</textarea></li>`}
        <li>${esc(x.login)}</li>
        <li>回到这里点「重新检测」。</li>
      </ol>
      ${tool ? '' : `<p class="small muted" style="margin:12px 0 0">装好了还是「没找到」：点「手动选择」，找到 ${esc(e.name)} 的程序文件指给 ${BRAND}。</p>`}
      <div class="mfoot"><button class="btn" id="howBack">回到配置</button><span class="grow"></span>${x.steps ? '' : '<button class="btn primary" id="howCopy">复制命令</button>'}</div>`, true);
    $('#howBack').onclick = openSettings;
    const copy = async (cmd, ta) => { if (await copyText(cmd)) toast(`已复制，粘贴到${x.shell}里`); else { ta.focus(); ta.select(); toast(`按 ${isMac ? '⌘C' : 'Ctrl+C'} 复制`); } };
    if (x.steps) layer.querySelectorAll('[data-howcopy]').forEach(b => b.onclick = () => copy(x.steps[+b.dataset.howcopy].cmd, layer.querySelector(`[data-howcmd="${b.dataset.howcopy}"]`)));
    else $('#howCopy').onclick = () => copy(x.cmd, $('#howCmd'));
  }
  // OpenAlex API key：存在本机 ~/.config/openalex/，检索脚本从那里读；空着的不改
  // AI 还能写的文件夹（内容 1.3.2）：一行一个完整路径，清空就是只能写当前项目
  function openWriteDirs() {
    modal('AI 还能写的文件夹', `
      <p style="line-height:1.7;margin:0 0 8px">平时 AI 只能写当前项目的文件夹。这里加的文件夹，所有 AI 程序在每个任务里都能写（新建、修改、移动文件）。只加你放心让 AI 动的文件夹。</p>
      <div class="field"><label>一行一个完整路径（可以用 ~ 开头）</label><textarea id="wdList" rows="4" placeholder="例：~/Documents/我的工作">${esc((B.writeDirs || []).join('\n'))}</textarea></div>
      <p class="small muted" style="margin:4px 0 0">清空 = 只能写当前项目。不能放开整个硬盘或整个个人文件夹。</p>
      <div class="mfoot"><button class="btn" id="wdBack">返回</button><button class="btn primary" id="wdSave">保存</button></div>`);
    $('#wdBack').onclick = openSettings;
    $('#wdSave').onclick = async () => {
      try { const r = await api('env/writedirs', 'POST', { dirs: $('#wdList').value.split('\n') }); B.writeDirs = r.writeDirs; toast(r.writeDirs.length ? '之后的任务里 AI 也能写这些文件夹' : '只能写当前项目了'); openSettings(); }
      catch (err) { toast(err.message); }
    };
  }
  // 手机远程（内容 1.3.13，见 remote.cjs；1.3.15 起学员也有，标「实验版」）：开关、配对、配过的手机、企业微信通知
  async function openRemote(st) {
    try { st = st || await api('remote'); } catch (e) { return toast(e.message); }
    const n = st.wecom.notify, bt = st.bot || {}, when = iso => { const d = new Date(iso); return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
    const left = st.pair ? Math.max(0, Math.round((st.pair.until - Date.now()) / 60000)) : 0;
    modal('手机远程 <span class="chip">实验版</span>', `
      <div class="set-row small muted" style="display:block">实验版：还在试，可能有不稳定的地方。先在「配置指南」第 8 节看清楚怎么配、国内网络下有哪些限制。<button class="btn ghost small" id="rmGuide">${I('doc')}看配置指南</button></div>
      <div class="set-row"><span class="grow">打开手机远程<div class="sub2">打开后手机能连上这台电脑上的 POPPER；电脑开着、POPPER 开着才能用，打开期间电脑不会自己睡（合上盖子照样会睡）</div></span><button class="btn small ${st.on ? '' : 'primary'}" id="rmOn">${st.on ? '关掉' : '打开'}</button></div>
      ${st.on ? `${st.error ? `<div class="errbox">${esc(st.error)}</div>` : ''}
      <div class="set-sub">手机上打开</div>
      ${st.urls.length ? st.urls.map(u => `<div class="set-row"><span class="grow"><span class="mono">${esc(u.url)}</span><div class="sub2">${u.kind === 'Tailscale' ? 'Tailscale：手机在哪都能连（手机上也要开着 Tailscale）' : '局域网：手机和电脑连同一个 Wi-Fi 时能用'}</div></span><button class="btn small" data-copy="${esc(u.url)}">复制</button></div>`).join('')
        : '<div class="set-row small muted">没找到能让手机连的网络：请在电脑上装好 Tailscale 并登录，或者连上 Wi-Fi，再打开一次这个窗口。</div>'}
      <div class="set-sub">配过的手机</div>
      ${st.devices.length ? st.devices.map(d => `<div class="set-row"><span class="grow">${esc(d.name)}<div class="sub2">${when(d.createdAt)} 配对 · 最近用 ${when(d.lastSeen)}</div></span><button class="btn small" data-revoke="${esc(d.id)}">撤销</button></div>`).join('') : '<div class="set-row small muted">还没有</div>'}
      <div class="set-row"><span class="grow">${st.pair ? `配对码 <b class="mono" style="font-size:22px;letter-spacing:4px">${esc(st.pair.code)}</b><div class="sub2">在手机上打开上面的地址，输入这 6 位数字；${left} 分钟内有效，用一次就失效</div>` : '配对一部手机<div class="sub2">出一个 6 位配对码，在手机上输入</div>'}</span><button class="btn small" id="rmPair">${st.pair ? '换一个' : '配对一部手机'}</button></div>` : ''}
      <div class="set-sub">企业微信 · 智能机器人</div>
      ${!bt.set || S.botEdit ? `<div class="set-row small muted" style="display:block">在企业微信的机器人详情页（API 模式、长连接）复制 Bot ID 和 Secret 填在这里。Secret 只存在这台电脑上，不要发给别人。</div>
      <div class="field"><input type="text" id="btId" autocomplete="off" placeholder="Bot ID"></div>
      <div class="field"><input type="password" id="btSecret" autocomplete="off" placeholder="Secret${bt.set ? '（同一个机器人不换 Secret 可以留空）' : ''}"></div>
      <div class="set-row"><span class="grow"></span>${bt.set ? '<button class="btn small" id="btCancel">取消</button>' : ''}<button class="btn small primary" id="btSave">连接</button></div>`
      : `<div class="set-row"><span class="grow">机器人 <span class="mono">${esc(bt.id)}</span><div class="sub2">${bt.state === 'ok' ? '已连上' : bt.state === 'connecting' ? '正在连…' : '没连上'}${bt.error ? '：' + esc(bt.error) : ''}</div></span>${bt.state === 'ok' ? '<span class="chip ok">已连上</span>' : `<button class="btn small" id="btRe">重新连接</button>`}<button class="btn small" id="btEdit">换一个</button><button class="btn small" id="btClear">删掉</button></div>
      ${bt.bound ? `<div class="set-row"><span class="grow">已绑定你的企业微信<div class="sub2">任务做完、出错、等你回复时发到和机器人的单聊里；在单聊里发「帮助」看能做什么。只认你，别人发的不理</div></span><button class="btn small" id="btTest">发一条测试</button><button class="btn small" id="btUnbind">解绑</button></div>`
        : `<div class="set-row"><span class="grow">${bt.bind ? `绑定码 <b class="mono" style="font-size:22px;letter-spacing:4px">${esc(bt.bind.code)}</b><div class="sub2">在企业微信里打开和这个机器人的单聊，发「绑定 ${esc(bt.bind.code)}」；10 分钟内有效</div>` : '绑定你的企业微信<div class="sub2">绑定以后机器人只认你，也才能主动给你发通知</div>'}</span><button class="btn small" id="btBind">${bt.bind ? '换一个' : '生成绑定码'}</button></div>`}`}
      <div class="set-sub">企业微信 · 群机器人 Webhook（备用：没配智能机器人时才用）</div>
      <div class="set-row"><span class="grow">群机器人的 Webhook 地址<div class="sub2">群设置 →「消息推送」/「群机器人」→ 添加 → 复制 Webhook 地址。${st.wecom.set ? '现在：<span class="mono">' + esc(st.wecom.url) + '</span>' : '现在没填'}</div></span>${st.wecom.set ? '<button class="btn small" id="rmNoWx">删掉</button><button class="btn small" id="rmTest">发一条测试</button>' : ''}</div>
      <div class="field"><input type="password" id="rmUrl" autocomplete="off" placeholder="${st.wecom.set ? '已填；要换就粘贴新的' : 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…'}"></div>
      <div class="set-sub">通知</div>
      <div class="set-row"><span class="grow">什么时候发</span>
        <label class="small"><input type="checkbox" id="rmW" ${n.waiting ? 'checked' : ''}> 等你回复</label>
        <label class="small"><input type="checkbox" id="rmD" ${n.done ? 'checked' : ''}> 做完了</label>
        <label class="small"><input type="checkbox" id="rmF" ${n.failed ? 'checked' : ''}> 出错</label></div>
      <p class="small muted" style="margin:4px 0 0">通知里的链接要在 Safari 里打开（企业微信里点右上角「在浏览器打开」），手机网页认的是 Safari 里配过对的那部手机。</p>
      <div class="mfoot"><button class="btn" id="rmBack">返回</button><button class="btn primary" id="rmSave">保存通知设置</button></div>`);
    const go = async (route, body, msg) => { try { const r = await api(route, 'POST', body || {}); if (msg) toast(msg); openRemote(r); } catch (e) { toast(e.message); } };
    $('#rmBack').onclick = () => { S.botEdit = false; openSettings(); };
    $('#rmGuide').onclick = () => { S.botEdit = false; openGuide(); };
    $('#rmOn').onclick = () => go('remote/on', { on: !st.on }, st.on ? '关掉了：手机连不上了' : '打开了');
    const pr = $('#rmPair'); if (pr) pr.onclick = () => go('remote/pair');
    layer.querySelectorAll('[data-revoke]').forEach(b => b.onclick = () => go('remote/revoke', { id: b.dataset.revoke }, '撤销了：那部手机再打开要重新配对'));
    layer.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('复制了'); } catch { toast(b.dataset.copy); } });
    const notify = () => ({ waiting: $('#rmW').checked, done: $('#rmD').checked, failed: $('#rmF').checked });
    $('#rmSave').onclick = () => { const url = $('#rmUrl').value.trim(); go('remote/wecom', { url: url || '__keep__', notify: notify() }, '保存了'); };
    const nw = $('#rmNoWx'); if (nw) nw.onclick = () => go('remote/wecom', { url: '', notify: notify() }, '删掉了群机器人地址');
    const ts = $('#rmTest'); if (ts) ts.onclick = () => go('remote/wecom-test', {}, '发了：看看企业微信群里收到没有');
    // 智能机器人（内容 1.3.14）
    const on = (id, f) => { const b = $(id); if (b) b.onclick = f; };
    on('#btSave', () => { S.botEdit = false; go('remote/bot', { id: $('#btId').value, secret: $('#btSecret').value }, ''); });
    on('#btCancel', () => { S.botEdit = false; openRemote(st); });
    on('#btEdit', () => { S.botEdit = true; openRemote(st); });
    on('#btRe', () => go('remote/bot/connect'));
    on('#btClear', () => go('remote/bot/clear', {}, '删掉了：不再连这个机器人'));
    on('#btBind', () => go('remote/bot/bind'));
    on('#btUnbind', () => go('remote/bot/unbind', {}, '解绑了'));
    on('#btTest', () => go('remote/bot/test', {}, '发了：看看企业微信单聊里收到没有'));
    // 配对码 / 绑定码倒计时、手机配上了、机器人连上了、你在企业微信里发了绑定：过一会儿自己刷新
    if (st.pair || (bt.set && !S.botEdit && (bt.state === 'connecting' || (bt.bind && !bt.bound)))) setTimeout(() => { if ($('#rmBack') && !S.botEdit) openRemote(); }, bt.bind || bt.state === 'connecting' ? 3000 : 30000);
  }
  function openOpenAlex(cur) {
    modal('OpenAlex API key', `
      <p style="line-height:1.7;margin:0 0 8px">OpenAlex 是免费的学术文献数据库。「综述文章」的检索筛选用它批量抓文献，没有 key 只能抓第一页。key 免费，拿一次大约一分钟：</p>
      <ol style="line-height:1.8;padding-left:20px;margin:0 0 12px">
        <li>打开 <a href="https://openalex.org" target="_blank" rel="noopener">openalex.org</a>，右上角注册一个账号（邮箱即可）并登录。</li>
        <li>打开 <a href="https://openalex.org/settings/api" target="_blank" rel="noopener">openalex.org/settings/api</a>（也可以点右上角头像 → Settings → API），复制页面上的 API key。</li>
        <li>粘贴到下面，点「保存」。</li>
      </ol>
      <div class="field"><label>API key</label><input type="password" id="oaKey" autocomplete="off" placeholder="${cur && cur.key ? '已填；要换就粘贴新的' : '粘贴从 openalex.org 复制的 key'}"></div>
      <div class="field"><label>邮箱（可留空）</label><input type="text" id="oaMail" value="${esc((cur && cur.mailto) || '')}" placeholder="写你的邮箱，OpenAlex 出问题时能联系到你"></div>
      <p class="small muted" style="margin:4px 0 0">只存在这台电脑上（~/.config/openalex/），检索脚本自己去读，不写进交给 AI 的指令。</p>
      <div class="mfoot"><button class="btn" id="oaBack">返回</button><button class="btn primary" id="oaSave">保存</button></div>`);
    $('#oaBack').onclick = openSettings;
    $('#oaSave').onclick = async () => {
      try { await api('env/openalex', 'POST', { key: $('#oaKey').value, mailto: $('#oaMail').value }); toast('已保存'); openSettings(); }
      catch (e) { toast(e.message); }
    };
    $('#oaKey').focus();
  }
  async function openGuide() {
    try { const r = await api('env/guide'); modal('配置指南', `<div class="md guidebox">${md(r.text).replace(/^<h1>.*?<\/h1>/, '')}</div><div class="mfoot"><button class="btn" id="guideBack">返回</button></div>`, true); $('#guideBack').onclick = openSettings; }
    catch (e) { toast(e.message); }
  }
  function quit() {
    const busy = (S.allRuns || []).some(r => ['running', 'stopping', 'queued', 'waiting'].includes(r.status));
    const go = async () => { try { await api('quit', 'POST', {}); } catch {} document.body.innerHTML = '<div class="empty" style="padding-top:30vh">工作站已退出，可以关掉这个窗口。</div>'; };
    if (busy) confirmBox('还有任务没结束', '<p class="muted small" style="margin:10px 0 0">退出会停掉正在跑的任务。</p>', '仍然退出', go, true); else go();
  }

  // ---------- 中栏：标签页 ----------
  // 标签页的类型（内容 1.4.1，第 4 讲 T5；乔淼 10-29 嫌工具、工作流和文件、对话分不清，再改）：颜色只表示类型，不再用工具的分类色——
  // 主页墨色、工作流琥珀、工具青，这三种是「做事的页面」，图标块实心；文件蓝、任务对话紫是「看的内容」，图标块浅底。
  // 同类的标签排在一起、类和类之间一条细线（只改显示的顺序，u.tabs 还是打开的顺序）；选中的标签底下一条类型色
  const TAB_KIND = t => t.id === 'store' || t.triage ? '主页' : t.doc ? '文件' : t.conv ? '任务对话' : t.tool || t.toolEdit ? '工具' : '工作流';
  const TAB_CLS = { '主页': 'home', '工作流': 'wf', '工具': 'tool', '文件': 'file', '任务对话': 'conv' }, TAB_ORDER = Object.keys(TAB_CLS);
  const tabsShown = () => ui().tabs.map((t, i) => [t, i]).sort((a, b) => TAB_ORDER.indexOf(TAB_KIND(a[0])) - TAB_ORDER.indexOf(TAB_KIND(b[0])) || a[1] - b[1]).map(x => x[0]);
  const tk = (cls, icon) => `<span class="tk ${cls}">${icon}</span>`;
  const tkOf = (cls, id, name) => tk(cls, ICON_OF[id] ? I(ICON_OF[id]) : `<i class="g">${esc(glyph(name))}</i>`);
  function tabLabel(t) {
    if (t.id === 'store') return proj() && proj().inbox ? `${tk('home', I('dash'))}<span class="lbl">总览</span>` : `${tk('home', I('grid'))}<span class="lbl">主页</span>`;
    if (t.doc) return `${tk('file', fileIcon(kindOf(t.doc)))}<span class="lbl">${esc(t.doc.split('/').pop())}</span>`;
    if (t.conv) return `${tk('conv', I('chat'))}<span class="lbl">${esc(t.title || '对话')}</span>`;
    if (t.triage) return `${tk('home', I('inbox'))}<span class="lbl">梳理计划</span>`;
    if (t.toolEdit) return `${tk('tool', I('plus'))}<span class="lbl">${t.editId ? '编辑工具' : '添加工具'}</span>`;
    if (t.tool) { const a = toolOf(t.tool); return a ? `${tkOf('tool', a.id, a.name)}<span class="lbl">${esc(a.name)}</span>` : '工具'; }
    const w = wfOf(t.wf); return w ? `${tkOf('wf', w.id, w.name)}<span class="lbl">${esc(w.name)}</span>` : '工作流';
  }
  function renderTabs() {
    const u = ui();
    u.tabs = u.tabs.filter(t => (!t.wf || wfOf(t.wf)) && (!t.tool || toolOf(t.tool))); // 被移除的工作流、工具，标签也跟着关掉
    if (u.tabs.length > 10) u.tabs.splice(1, u.tabs.length - 10); // 标签太多时关掉最早打开的
    if (!u.tabs.some(t => t.id === u.active)) u.active = 'store';
    const cp = proj();
    put($('#ptitle'), cp ? `${I(cp.inbox ? 'dash' : 'folder')}<b title="${esc(cp.inbox ? '' : cp.path)}">${esc(cp.inbox ? 'Dashboard' : cp.name)}</b>` : '');
    put($('#tabs'), tabsShown().map((t, i, a) => `${i && TAB_KIND(t) !== TAB_KIND(a[i - 1]) ? '<span class="tabsep"></span>' : ''}<div class="tab k-${TAB_CLS[TAB_KIND(t)]} ${u.active === t.id ? 'on' : ''} ${t.id === 'store' ? 'store' : ''}" data-tab="${esc(t.id)}" title="${esc(TAB_KIND(t) + (t.doc ? '：' + t.doc : t.conv ? '：' + (t.title || '') : ''))}">${tabLabel(t)}${t.id !== 'store' ? `<span class="x" data-close-tab="${esc(t.id)}">${I('x')}</span>` : ''}</div>`).join(''));
    // 标签多了一排放不下时，选中的那个滚进来（同类排在一起后，新开的标签可能在中间）
    // 主页钉在最左边，挡住的那一截不算看得见
    const tb = $('#tabs'), on = tb.querySelector('.tab.on:not(.store)'), pin = (tb.querySelector('.tab.store') || {}).offsetWidth || 0;
    if (on && (on.offsetLeft < tb.scrollLeft + pin + 12 || on.offsetLeft + on.offsetWidth > tb.scrollLeft + tb.clientWidth)) tb.scrollLeft = on.offsetLeft - pin - (tb.clientWidth - pin - on.offsetWidth) / 2;
    // 右上角：当前标签能做的事
    const t = curTab(), w = t && t.wf && wfOf(t.wf), p = proj();
    let acts = '';
    if (t && t.id === 'store' && p && p.exists) acts = `<button class="ib" data-opendoc="AGENTS.md" title="项目说明">${I('doc')}</button><button class="ib" data-reveal="" title="在访达中打开">${I('folderOpen')}</button>`;
    else if (w) acts = `<button class="ib" data-wfreload="${esc(w.id)}" title="重新载入">${I('refresh')}</button>${w.source === '导入' ? `<button class="ib" data-wfremove="${esc(w.id)}" title="移除">${I('trash')}</button>` : ''}`;
    else if (t && t.conv) acts = `<button class="ib" data-doc-reload title="刷新">${I('refresh')}</button>`;
    else if (t && t.doc) acts = `<button class="ib" data-doc-reload title="刷新">${I('refresh')}</button><button class="ib" data-reveal="${esc(t.doc)}" title="在访达中显示">${I('folderOpen')}</button><button class="ib" data-openext="${esc(t.doc)}" title="用默认程序打开">${I('external')}</button>${B.roughdraft && /\.(md|markdown)$/i.test(t.doc) ? `<button class="ib" data-roughdraft="${esc(t.doc)}" title="用 Roughdraft 批注：批完点「Approve」，自动交给 AI 按批注改">${I('pen')}</button>` : ''}`;
    put($('#tabacts'), acts);
  }
  const boxKey = wf => B.current + ':' + wf;
  function renderPane() {
    const u = ui(), t = u.tabs.find(x => x.id === u.active) || u.tabs[0], inboxBlock = !!(proj() && proj().inbox && (t.wf || t.tool)), isWf = !!t.wf && !inboxBlock;
    $('#pane-main').style.display = isWf ? 'none' : 'block';
    $('#pane-wf').style.display = isWf ? 'block' : 'none';
    if (isWf) ensureWfBox(t.wf);
    // 每个项目的工作流页面各开各的，切项目、切标签都不重载；只显示当前这个
    document.querySelectorAll('.wfbox').forEach(b => b.classList.toggle('on', isWf && b.dataset.key === boxKey(t.wf)));
    if (isWf) return;
    const main = $('#pane-main'), key = B.current + '|' + t.id; // 不同项目可能开着同名的标签（比如都开了 AGENTS.md）
    if (t.doc) { if (main.dataset.tab !== key) renderDoc(t); return; }
    if (t.conv) { if (main.dataset.tab !== key) renderConv(t); return; }
    if (main.dataset.tab === key && main.contains(document.activeElement) && document.activeElement.matches('input,textarea,select')) return; // 正在填，别打断
    const same = main.dataset.tab === key, sc = main.querySelector('.scroll-y'), y = same && sc ? sc.scrollTop : 0;
    if (!same) main.__html = null;
    put(main, `<div class="scroll-y" style="height:100%">${inboxBlock ? inboxOnlyHTML() : t.tool ? toolHTML(t) : t.triage ? triageHTML() : t.toolEdit ? toolEditHTML(t) : storeHTML()}</div>`);
    main.dataset.tab = key;
    const sc2 = main.querySelector('.scroll-y'); if (sc2 && sc2.scrollTop !== y) sc2.scrollTop = y;
  }
  // 工具里有 skill 下拉的：打开时取一次这个项目的 AI 装了哪些 skill
  function loadSkills() {
    const id = B.current;
    api('skills', 'GET', { project: id }).then(list => { S.skills[id] = list; const t = curTab(); if (t && (t.tool || t.toolEdit) && B.current === id) { $('#pane-main').__html = null; $('#pane-main').dataset.tab = ''; renderPane(); } }).catch(() => {});
  }
  function openTab(t) {
    if (t.conv) setTimeout(renderTasks, 0); // 右栏那一条折起来（T5）
    if (t.tool && (toolOf(t.tool) || {}).fields?.some(f => f.type === 'skill') && !S.skills[B.current]) loadSkills();
    if (t.tool && (toolOf(t.tool) || {}).fields?.some(f => f.type === 'skills')) loadSkillCat().then(() => { if (curTab() && curTab().id === t.id) { $('#pane-main').__html = null; renderPane(); } });
    const u = ui(); if (!u.tabs.some(x => x.id === t.id)) u.tabs.push(t);
    u.active = t.id; renderTabs(); renderPane();
  }
  function closeTab(id) {
    const u = ui(), i = u.tabs.findIndex(t => t.id === id); if (i < 0) return;
    const shown = tabsShown(), j = shown.findIndex(x => x.id === id), left = shown[j - 1] || shown[j + 1];
    const t = u.tabs[i]; u.tabs.splice(i, 1);
    if (t.wf) document.querySelectorAll('.wfbox').forEach(b => { if (b.dataset.key === boxKey(t.wf)) b.remove(); });
    if (u.active === id) u.active = (left || u.tabs[0]).id;
    renderTabs(); renderPane();
    if (t.conv) { // T5：对话回到右栏气泡，没发出去的字和附件带过去
      const text = ((S.convDraft || {})[t.conv] || '').trim(), att = (S.convAtt || {})[t.conv] || [];
      if (S.convDraft) delete S.convDraft[t.conv]; if (S.convAtt) delete S.convAtt[t.conv];
      S.expanded = t.conv; renderTasks();
      if (text || att.length) { S.attach = att; openAsk(t.conv); const a = $('#askText'); if (a) a.value = text; drawAtts(); }
    }
  }
  const curTab = () => ui().tabs.find(x => x.id === ui().active);

  // ---------- 应用：工作流和工具 ----------
  // 项目首页的一句开场（10-18 界面升级第 6 步）：只用项目活动记录和工作流进度拼，不编；什么都没做过就不显示
  function openingLine(p, noNext) { // noNext：后面跟着下一步建议时，这里不再说进度
    const last = ((p && p.activity) || [])[0]; if (!last || !last.title) return '';
    const at = new Date(last.ended || last.started || 0), d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const when = !at.getTime() ? '' : at >= d0 ? '今天 ' + at.toTimeString().slice(0, 5) : at >= d0 - 864e5 ? '昨天' : `${at.getMonth() + 1} 月 ${at.getDate()} 日`;
    const st = { failed: '，没做完', stopped: '，停下了', waiting: '，在等你回复', running: '，还在做', queued: '，在排队' }[last.status] || '';
    const w = ((p && p.workflows) || []).find(x => x.id === last.workflow);
    const nx = w ? w.stages.find(s => !s.done) : null;
    const next = !w || noNext ? '' : nx ? ` · ${w.name}下一步是「${nx.name}」` : ` · ${w.name}的 ${w.total} 个阶段都做完了`;
    return `上次做到「${last.title}」${st}${when ? '（' + when + '）' : ''}${next}。`;
  }
  function storeHTML() {
    const p = proj(), used = (p && p.workflows) || [];
    if (p && p.inbox) return dashHTML();
    const cards = (B.workflows || []).map(w => {
      const u = used.find(x => x.id === w.id), done = u ? u.done : 0, n = w.stages.length;
      const okAt = i => !!(u && u.stages[i] && u.stages[i].done), next = w.stages.findIndex((s, i) => !okAt(i));
      const meta = n ? `<div class="meta"><div class="stages ${done === n ? 'full' : ''}">${w.stages.map((s, i) => `<i class="${okAt(i) ? 'ok' : i === next ? 'next' : ''}" title="${esc(s.name)}"></i>`).join('')}</div></div>` : '';
      const where = n ? `<span class="n">${next >= 0 && done ? esc(w.stages[next].name) + ' · ' : ''}${done}/${n}</span>` : '';
      return `<div class="card wf" data-openwf="${esc(w.id)}" title="${esc(w.one || '')}">${wfTile(w, 'lg')}<div class="grow"><div class="top"><b>${esc(w.name)}</b>${where}</div>${meta}</div></div>`;
    }).join('');
    return `<div class="page">
      ${p && !p.inbox && openingLine(p) ? `<div class="opening">${MARK('idle', 'sm')}<span><b>${esc(B.agentName || 'Research Agent')}</b>：${esc(openingLine(p))}</span></div>` : ''}
      <div class="sec">工作流</div>
      <div class="grid">${cards}<div class="card import" data-act="import">${I('upload')}<span>导入</span></div>${(B.tools || []).some(t => t.id === 'wfbuild') ? `<div class="card import" data-opentool="wfbuild" title="把你自己的做事顺序造成一条工作流">${I('wf-build')}<span>造工作流</span></div>` : ''}</div>
      <div class="sec">工具</div>${toolCards()}</div>`;
  }
  // ---------- Dashboard（内容 1.4.1，第 4 讲当众答应 T4）：原来的收件箱。收件箱只留梳理，工具、工作流都不在这里；
  // 页面上放收件箱、各项目近况、所有项目的待办（从右栏挪过来），只用 POPPER 已有的数据，不新造 ----------
  const onDash = () => { const p = proj(), t = curTab(); return !!(p && p.inbox && t && t.id === 'store'); };
  const inboxOnlyHTML = () => `<div class="page"><div class="art">${art('projects')}</div><p class="muted" style="text-align:center;line-height:1.8">收件箱只用来梳理文件。要用工具、跑工作流，在左栏选一个项目，或者点「项目」右边的 + 新建一个。</p></div>`;
  function dashHTML() {
    const ib = inboxProj(), d = S.plan, pl = d && d.plan, files = (S.files || []).filter(f => f.kind !== 'dir' && !f.path.includes('/') && !f.path.startsWith('.'));
    // 收件箱：还没梳理的文件、梳理按钮；上次梳理的计划和结果
    const plan = !pl || !pl.items.length ? '' : pl.applied ? `<div class="dline"><span class="grow small muted">上次梳理的计划已经照着做了${pl.at ? '（' + esc(when(pl.at)) + '）' : ''}。</span><button class="btn small ghost" data-dash-plan>看那份计划</button>${d.canUndo ? '<button class="btn small ghost" data-tri-undo>撤销上次梳理</button>' : ''}</div>`
      : `<div class="dline"><span class="grow small">梳理计划好了：${pl.items.filter(x => x.exists).length} 个文件，每个都写了放哪、为什么。</span><button class="btn small primary" data-dash-plan>查看并照这样做</button></div>`;
    const inbox = `<div class="dsec"><div class="dhead">${I('inbox')}<b>收件箱</b><span class="n">${ib && ib.inboxNew ? ib.inboxNew + ' 个还没梳理' : '没有要梳理的文件'}</span><span class="grow"></span>${ib && ib.inboxNew ? `<button class="btn small primary" data-triage>${I('wand')}一键梳理</button>` : ''}</div>
      ${files.length ? `<div class="dfiles">${files.slice(0, 8).map(f => `<div class="frow" data-file="${esc(f.path)}" title="${esc(f.path)}">${fileIcon(f.kind)}<span class="grow"><span class="nm">${esc(f.path)}</span>${f.mtime ? `<span class="meta">${esc(when(new Date(f.mtime).toISOString()))}</span>` : ''}</span></div>`).join('')}${files.length > 8 ? `<div class="small muted" style="padding:4px 8px">还有 ${files.length - 8} 个</div>` : ''}</div>` : `<div class="small muted dempty">把零散文件拖到左栏的「收件箱」上，就放进来；再点「一键梳理」，AI 给出每个文件放哪。</div>`}
      ${plan}${S.triResult ? `<div class="trires">${S.triResult}</div>` : ''}${!pl && d && d.canUndo ? '<div class="dline"><span class="grow"></span><button class="btn small ghost" data-tri-undo>撤销上次梳理</button></div>' : ''}</div>`;
    // 各项目近况：上次做到哪、下一步（项目首页开场那句话）；有任务在跑、在等你的标出来
    const ps = (B.projects || []).filter(p => !p.inbox && p.exists).map(p => {
      const acts = p.activity || [], wait = acts.filter(a => a.status === 'waiting').length, run = acts.filter(a => ['running', 'stopping', 'queued'].includes(a.status)).length;
      const last = acts[0], w = last && (p.workflows || []).find(x => x.id === last.workflow);
      return `<div class="dproj" data-dash-proj="${esc(p.id)}" title="${esc(p.path)}">${I('folder')}<div class="grow" style="min-width:0"><div class="dpn"><b class="ellipsis">${esc(p.name)}</b>${wait ? `<span class="chip amber">${wait} 件在等你回复</span>` : ''}${run ? `<span class="chip run">${run} 个在跑</span>` : ''}</div><div class="small muted dpl">${esc(openingLine(p) || '还没开始做。')}</div></div>${w && w.total ? `<span class="dbar">${bar(w.done, w.total)}</span>` : ''}</div>`;
    }).join('');
    const projs = `<div class="dsec"><div class="dhead">${I('folder')}<b>各项目近况</b><span class="grow"></span></div>${ps || '<div class="small muted dempty">还没有项目：点左栏「项目」右边的 + 新建一个。</div>'}</div>`;
    return `<div class="page dash">${inbox}${dashTodos()}${projs}</div>`;
  }
  // 所有项目的待办，按项目归在一起；「开始」在它自己的项目里开任务
  function dashTodos() {
    const d = S.todos || { items: [] }, open = d.items.filter(t => t.status !== 'done'), done = d.items.filter(t => t.status === 'done').sort((a, b) => (b.doneAt || '').localeCompare(a.doneAt || ''));
    const order = (B.projects || []).map(p => p.id), groups = new Map();
    for (const t of [...open].sort((a, b) => (order.indexOf(a.project) + 1 || 99) - (order.indexOf(b.project) + 1 || 99))) { if (!groups.has(t.project)) groups.set(t.project, []); groups.get(t.project).push(t); }
    const body = [...groups].map(([pid, list]) => { const p = proj(pid); return `<div class="dtg"><div class="dtgh">${I(p && p.inbox ? 'inbox' : 'folder')}${esc(p ? (p.inbox ? '收件箱' : p.name) : list[0].projectName || '')}<span class="n">${list.length}</span></div>${list.map(t => tdRow(t, true)).join('')}</div>`; }).join('');
    return `<div class="dsec"><div class="dhead">${I('check')}<b>待办</b><span class="n">${open.length}</span><span class="grow"></span></div>
      <div class="tdl">${body}${d.splitting ? `<div class="td muted small">AI 正在拆 ${d.splitting} 段话…</div>` : ''}${!open.length && !d.splitting ? '<div class="small muted dempty">没有待办。在右栏对话气泡里写下要做的事，点「放进待办」，AI 会拆成一条条放到这里。</div>' : ''}
      ${done.length ? `<button class="linkish tdmore" data-td-showdone>${S.tdDone ? '收起' : '已完成 ' + done.length + ' 条'}</button>${S.tdDone ? done.slice(0, 30).map(t => tdRow(t, true)).join('') : ''}` : ''}</div></div>`;
  }
  const CATS = ['找文献', '读文献', '写综述', '研究设计', '数据分析', '写全文', '审稿返修', '我的工具'];
  // 工具分类显示（10-23 乔淼：全摆出来太占地方）：上面「常用」是 pin 了的，下面一排分类，一次只看一类；看哪一类记在这台电脑上
  const TOOLCAT_KEY = 'aiws:toolcat';
  function toolCards() {
    // 「造工作流」不在工具区（乔淼 10-29）：只在上面工作流那一排「导入」旁边
    const tools = (B.tools || []).filter(t => t.id !== 'wfbuild'), cats = [...CATS, ...new Set(tools.map(t => t.cat).filter(c => !CATS.includes(c)))].filter(c => c === '我的工具' || tools.some(t => t.cat === c));
    const pinned = (B.pinnedTools || []).map(id => tools.find(t => t.id === id)).filter(Boolean);
    let cat = ''; try { cat = localStorage.getItem(TOOLCAT_KEY) || ''; } catch {}
    if (!cats.includes(cat)) cat = cats[0];
    const card = t => { const on = pinned.includes(t); return `<div class="card tool" data-opentool="${esc(t.id)}" title="${esc(t.one)}">${toolTile(t)}<b class="grow ellipsis">${esc(t.name)}</b><button class="pinbtn ${on ? 'on' : ''}" data-pintool="${esc(t.id)}" title="${on ? '从常用里拿掉' : '放进常用'}">${I('pin')}</button></div>`; };
    // 「我的工具」这一类：最后是「添加工具」「导入工具」两张卡（10-18）
    const addCards = `<div class="card tool add" data-tool-new title="用一个装好的 skill 造一个工具">${I('plus')}<b class="grow">添加工具</b></div><div class="card tool add" data-tool-import title="导入别人分享的工具文件（.json）">${I('upload')}<b class="grow">导入工具</b></div><div class="card tool add" data-tool-gh title="贴一个 GitHub 链接，装里面的 skill，并批量加成工具">${I('download')}<b class="grow">从 GitHub 装</b></div>`;
    const fav = pinned.length ? `<div class="sub pinned">常用</div><div class="grid tools">${pinned.map(card).join('')}</div>`
      : `<div class="sub pinned">常用</div><div class="pinhint">点工具卡片右上角的图钉，常用的工具就会放到这里。</div>`;
    const tabs = `<div class="tcats">${cats.map(c => `<button class="${c === cat ? 'on' : ''} ${CAT_CLASS[c] || ''}" data-toolcat="${esc(c)}">${esc(c)}<span>${tools.filter(t => t.cat === c).length}</span></button>`).join('')}</div>`;
    const list = tools.filter(t => t.cat === cat);
    return `${fav}${tabs}<div class="grid tools">${list.map(card).join('')}${cat === '我的工具' ? addCards : ''}</div>`;
  }

  // ---------- 工具页 ----------
  const toolVals = (t, a) => { t.vals = t.vals || {}; for (const f of a.fields) if (t.vals[f.key] === undefined) t.vals[f.key] = f.type === 'select' ? f.options[0] || '' : f.def || ''; return t.vals; };
  const toolMissing = (a, v) => a.fields.filter(f => f.required && !String(v[f.key] || '').trim());
  // 快速模式开关：带滑块，放在「执行」旁边（10-14 第三轮反馈：要明显）
  const quickSwitch = (on, attr) => `<label class="qswitch ${on ? 'on' : ''}" title="这一步不停：所有停点由 AI 按它的建议直接决定，最后列出它替你做的决定"><input type="checkbox" ${attr} ${on ? 'checked' : ''}><i></i>快速模式</label>`;
  // ---------- MinerU（内容 1.2.3）：本机工具，POPPER 自己转 PDF。选 PDF（默认 文献/PDF/ 里没转过的）→ 开始 ----------
  const MU_STATE = { new: ['没转过', ''], changed: ['PDF 改过，要重转', 'warn'], done: ['转过了', 'ok'], other: ['有同名文件，不覆盖', 'bad'] };
  // 正在转、排着的（这个项目里还没结束的 MinerU 任务）：不默认勾上，标出来
  const muBusy = () => { const m = new Map(); for (const r of S.runs || []) if (r.local && ['running', 'stopping', 'queued'].includes(r.status)) for (const f of r.local.files || []) m.set(f, r.status === 'queued' ? '排着' : '正在转'); return m; };
  function loadMineru(t) {
    const id = B.current; t.ml = { project: id, loading: true };
    api('mineru/list', 'GET', { project: id }).then(d => { const busy = muBusy(); t.ml = { project: id, data: d }; t.msel = d.items.filter(x => ['new', 'changed'].includes(x.state) && x.path.startsWith('文献/PDF/') && !busy.has(x.path)).map(x => x.path); })
      .catch(err => { t.ml = { project: id, err: err.message }; }).then(() => { if (curTab() === t && B.current === id) { $('#pane-main').__html = null; renderPane(); } });
  }
  function mineruHTML(t, a) {
    if (!t.ml || t.ml.project !== B.current) loadMineru(t);
    const head = `<div class="thead" title="${esc(a.one)}">${toolTile(a, 'lg')}<h1>${esc(a.name)}</h1><span class="grow"></span><button class="btn ghost small" data-mreload>${I('refresh')}刷新</button></div><p class="small muted" style="margin:-4px 0 14px;line-height:1.7">${esc(a.one)}。转好的和 PDF 同名、每页开头标着页码；读文献的 skill 有它就先读它，不用每次重读 PDF。</p>`;
    const ml = t.ml;
    if (!ml || ml.loading) return `<div class="page toolpage">${head}<div class="muted">正在看项目里有哪些 PDF…</div></div>`;
    if (ml.err) return `<div class="page toolpage">${head}<div class="bad">${esc(ml.err)}</div></div>`;
    const d = ml.data, sel = new Set(t.msel || []), busy = muBusy();
    if (!d.installed) return `<div class="page toolpage">${head}<div class="errhelp">${d.problem === 'old' ? `<b>电脑上的 MinerU 是 ${esc(d.version)}，太旧了</b><div>要 4.0 以上。升级办法在「AI学术环境配置 → 大家共用的 → MinerU」，升级完回来点「刷新」。</div>`
      : d.problem === 'nopython' ? `<b>找到了 MinerU，但用不了</b><div>找不到它用的 Python。到「AI学术环境配置 → 大家共用的 → MinerU」点「手动选择」指另一个，或者照「怎么装」重装一份。</div>`
      : `<b>这台电脑上没找到 MinerU</b><div>没装的话，装法在「AI学术环境配置 → 大家共用的 → MinerU」：照着复制几行命令，装好回来点「刷新」。已经装在 conda 或自己的虚拟环境里的，到那里点「手动选择」，找到环境里的 mineru-kit。不装也不影响别的工具。</div>`}</div><div class="tacts"><button class="btn small primary" data-mhow>${d.problem === 'old' ? '怎么升级' : '怎么装'}</button></div></div>`;
    const rows = d.items.map(x => { const [lab, cls] = busy.has(x.path) ? [busy.get(x.path), 'amber'] : MU_STATE[x.state] || [x.state, '']; return `<label class="pickrow"><input type="checkbox" data-mcheck="${esc(x.path)}" ${sel.has(x.path) ? 'checked' : ''}>${fileIcon('pdf')}<span class="grow small ellipsis" title="${esc(x.path)}">${esc(x.path.split('/').pop())}<span class="muted">${x.path.includes('/') ? ' · ' + esc(x.path.slice(0, x.path.lastIndexOf('/'))) : ''}</span></span>${x.state === 'done' ? `<button class="linkish" data-opendoc="${esc(x.out)}">看全文</button>` : ''}<span class="chip ${cls}">${lab}</span></label>`; }).join('');
    return `<div class="page toolpage">${head}
      ${d.items.length ? `<div class="row" style="gap:8px;margin-bottom:6px"><span class="small muted grow">项目里 ${d.items.length} 个 PDF，选了 ${sel.size} 个</span><button class="linkish" data-mall>选上没转过的</button><button class="linkish" data-mnone>全不选</button></div><div class="picklist" style="max-height:none">${rows}</div>`
        : `<div class="muted">项目里还没有 PDF。文献搜索下载的、自己拖进来的 PDF 放在 文献/PDF/，回来点「刷新」。</div>`}
      ${d.models === false ? `<div class="small muted" style="margin-top:10px">模型还没下：第一篇开始前 MinerU 会先下载（${d.tier === 'standard' ? '约 2 GB' : '约 0.8 GB'}），要多等几分钟到半小时。</div>` : ''}
      <div class="tfoot"><span class="grow small muted" title="内存 8 GB 以上用 standard（表格、公式更准），不到 8 GB 用 basic">档位 ${esc(d.tier)}（按这台电脑自动定）· 一篇几十秒到几分钟，转的时候电脑会忙一些</span>
        <button class="btn primary lg" data-mrun ${sel.size ? '' : 'disabled'}>开始转</button></div>
    </div>`;
  }
  function toolHTML(t) {
    if ((toolOf(t.tool) || {}).local === 'mineru') return mineruHTML(t, toolOf(t.tool));
    const a = toolOf(t.tool), v = toolVals(t, a), pins = t.pins = t.pins || [], miss = toolMissing(a, v), p = proj();
    const live = (S.runs || []).find(r => r.tool === a.id && LIVE_ST.includes(r.status));
    const fields = a.fields.map(f => {
      const k = esc(f.key), lab = `<label>${esc(plainLabel(f.label))}${f.required ? '<span class="req">*</span>' : ''}</label>`;
      if (f.type === 'select') return `<div class="field inline">${lab}<select data-tfield="${k}">${f.options.map(o => `<option ${o === v[f.key] ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></div>`;
      if (f.type === 'text') return `<div class="field">${lab}<input type="text" data-tfield="${k}" value="${esc(v[f.key])}" placeholder="${esc(f.placeholder)}"></div>`;
      if (f.type === 'skills') return `<div class="field">${lab}${skillMultiHTML(t, f)}</div>`;
      // skill：下拉里是本机装好的、课程以外的 skill（工坊造的、GitHub 装的）；也能手填
      if (f.type === 'skill') return `<div class="field">${lab}<input type="text" list="skillOpts" data-tfield="${k}" value="${esc(v[f.key])}" placeholder="${esc(f.placeholder)}" autocomplete="off"><datalist id="skillOpts">${(S.skills[B.current] || []).map(n => `<option value="${esc(n)}">`).join('')}</datalist></div>`;
      return `<div class="field">${lab}<textarea rows="3" data-tfield="${k}" placeholder="${esc(f.placeholder)}">${esc(v[f.key])}</textarea></div>`;
    }).join('');
    return `<div class="page toolpage">
      <div class="thead" title="${esc(a.one)}">${toolTile(a, 'lg')}<h1>${esc(a.name)}</h1>${a.source === '我的' ? `<span class="grow"></span><button class="btn ghost small" data-tool-edit="${esc(a.id)}">编辑</button><button class="btn ghost small" data-tool-export="${esc(a.id)}">导出</button><button class="btn ghost small" data-tool-remove="${esc(a.id)}">移除</button>` : ''}</div>
      <div class="form">${fields}
        <div class="field"><label>用哪些文件</label><div class="pins">${pins.map(x => `<span class="chip file" title="${esc(x)}">${fileIcon(kindOf(x))}${esc(x.split('/').filter(Boolean).pop())}<span class="x" data-unpin="${esc(x)}">${I('x')}</span></span>`).join('')}<button class="btn small" data-pin>${I('clip')}${pins.length ? '改选' : '选择文件'}</button>${pins.length ? '' : '<span class="small muted">不选也行，AI 会自己在项目里找</span>'}</div></div>
      </div>
      <div class="tfoot">${live ? `<span class="grow small muted tlive">「${esc(live.title)}」${esc(ST[live.status] || '')}<button class="linkish" data-golive="${esc(live.id)}">去看</button><button class="linkish" data-trun-again title="换了输入或文件，再开一个；设置一模一样的不会重开">换个设置再开一个</button></span>` : '<span class="grow"></span>'}
        ${a.quick ? quickSwitch(v.__quick, 'data-tquick') : ''}
        <button class="btn primary lg" data-trun title="⌘↩" ${miss.length || !p || !p.exists || live || t.sending ? 'disabled' : ''}>${live || t.sending ? '运行中' : '执行'}</button></div>
    </div>`;
  }
  // ---------- 多选 skill（内容 1.4.1，第 4 讲 T3）：「造工作流」的「想用哪些 skill」。选的框和「添加工具」里选 skill 的是同一个（边打字边搜），
  // 也能按用途展开全部勾选；列的是这台电脑上装着的全部 skill（讲师的、GitHub 装的第三方、自己造的），不用先加成 POPPER 的工具。值是一行一个名字 ----------
  const PURPOSES = ['选题', '找文献', '读文献', '写综述', '研究设计', '数据分析', '写全文', '审稿返修', '其他']; // 和 runtime.cjs 的一样
  const skmList = v => String(v || '').split('\n').map(x => x.trim()).filter(Boolean);
  function skillMultiHTML(t, f) {
    const k = esc(f.key), on = skmList(t.vals[f.key]), cat = skillCat(), p = proj(), eng = p && p.engine;
    const notHere = s => eng && ENG_NAME[eng] && !s.engines.includes(eng);
    const chips = on.map(n => { const s = cat.find(x => x.name === n), bad = !s || notHere(s); return `<span class="chip ${bad ? 'warn' : ''}" title="${esc(!s ? (cat.length ? '这台电脑上没找到这个 skill' : '') : `${s.purpose} · ${s.group}${notHere(s) ? ` · 这个项目用的 ${ENG_NAME[eng]} 里没有` : ''}`)}">${esc(n)}<span class="x" data-skm-x="${k}" data-name="${esc(n)}">${I('x')}</span></span>`; }).join('');
    const groups = PURPOSES.map(g => { const list = cat.filter(s => (s.purpose || '其他') === g); return list.length ? `<div class="skg"><div class="skgh">${esc(g)}<span>${list.length}</span></div>${list.map(s => `<label class="skc" title="${esc(s.desc || '')}"><input type="checkbox" data-skm-check="${k}" value="${esc(s.name)}" ${on.includes(s.name) ? 'checked' : ''}><b>${esc(s.name)}</b><span class="muted">${esc(s.group)}${notHere(s) ? ` · ${ENG_NAME[eng]} 里没有` : ''}</span></label>`).join('')}</div>` : ''; }).join('');
    return `<div class="skmulti">${on.length ? `<div class="pins">${chips}</div>` : ''}
      <div class="skpick"><input type="text" data-skmq="${k}" placeholder="打几个字搜：skill 的名字或用途，比如 文献搜索、访谈、清洗数据" autocomplete="off" spellcheck="false"><div class="skres hide"></div></div>
      <details class="skbrowse" ${t.skmOpen ? 'open' : ''}><summary>按用途看全部装着的 skill${cat.length ? `（${cat.length} 个）` : ''}</summary>${cat.length ? `<div class="skgroups">${groups}</div>` : '<div class="small muted" style="padding:8px">正在读取装好的 skill…</div>'}</details></div>`;
  }
  function skmSet(key, names, refocus) {
    const t = curTab(); if (!t || !t.tool) return;
    t.vals[key] = [...new Set(names)].join('\n');
    if (document.activeElement && $('#pane-main').contains(document.activeElement)) document.activeElement.blur();
    const g = $('#pane-main .skgroups'), y = g ? g.scrollTop : 0; // 勾了一个，列表别跳回顶上
    $('#pane-main').__html = null; renderPane();
    const g2 = $('#pane-main .skgroups'); if (g2) g2.scrollTop = y;
    if (refocus) { const q = $(`#pane-main [data-skmq="${key}"]`); if (q) q.focus(); }
  }
  // ---------- 添加 / 编辑自己的工具（10-18）：选一个装好的 skill，填名字和几个输入框，指令自动生成（高级里能改） ----------
  const teKey = i => 'f' + (i + 1);
  function teTemplate(d) {
    const lines = [`请用「${d.skill || '（skill）'}」skill 完成这项工作${d.one ? '：' + d.one : ''}。严格按这个 skill 的步骤、硬约束和输出格式执行；skill 里要停下问我的地方照常停下。`, ''];
    const fl = d.fields.map((f, i) => f.name ? `{{#${teKey(i)}}}- ${f.name}：{{${teKey(i)}}}\n{{/${teKey(i)}}}` : '').join(''); // 填了才出现，一行一个
    if (fl) lines.push(fl);
    lines.push('', '材料在项目里找；下面指定了文件就优先用它们。找不到就停下问我，不要编造。', '做完告诉我：做了什么、写了哪些文件、还有什么要我决定。');
    return lines.join('\n').replace(/\n{3,}/g, '\n\n');
  }
  function toolEditHTML(t) {
    const d = t.draft;
    if (!d) return `<div class="page toolpage"><div class="thead">${I('plus')}<h1>编辑工具</h1></div></div>`;
    const cats = [...new Set([...CATS, ...(B.tools || []).map(x => x.cat)])];
    const rows = d.fields.map((f, i) => `<div class="terow" data-i="${i}"><input type="text" data-tein="name" value="${esc(f.name)}" placeholder="输入框的名字，比如：研究问题">
      <select data-tein="type">${['单行', '多行', '选择'].map(o => `<option ${o === f.type ? 'selected' : ''}>${o}</option>`).join('')}</select>
      <input type="text" data-tein="options" value="${esc(f.options)}" placeholder="选项，用逗号隔开" ${f.type === '选择' ? '' : 'disabled'}>
      <label class="tereq"><input type="checkbox" data-tein="required" ${f.required ? 'checked' : ''}>必填</label><button class="ib sm" data-te-del="${i}" title="删掉这个输入框">${I('x')}</button></div>`).join('');
    const ok = d.skill.trim() && d.name.trim();
    return `<div class="page toolpage">
      <div class="thead">${I('plus')}<h1>${t.editId ? '编辑工具' : '添加工具'}</h1></div>
      <div class="form">
        <div class="field"><label>用哪个 skill<span class="req">*</span></label><div class="skpick"><input type="text" data-te="skill" data-skpick value="${esc(d.skill)}" placeholder="打几个字搜：skill 的名字或用途，比如 验真、访谈、peer review" autocomplete="off" spellcheck="false"><div class="skres hide"></div></div><div class="skinfo">${skillInfo(d.skill)}</div></div>
        <div class="field"><label>名称<span class="req">*</span></label><input type="text" data-te="name" value="${esc(d.name)}" maxlength="30" placeholder="比如：访谈编码"></div>
        <div class="field"><label>一句话</label><input type="text" data-te="one" value="${esc(d.one)}" maxlength="120" placeholder="它做什么"></div>
        <div class="field inline"><label>分类</label><select data-te="cat">${cats.map(c => `<option ${c === d.cat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></div>
        <div class="field"><label title="只写 AI 猜不到、要你告诉它的东西；材料不用做输入框，「用哪些文件」能选">输入框</label><div class="terows">${rows}</div><button class="btn ghost small" data-te-add>${I('plus')}加一个输入框</button></div>
        <details class="field teadv" ${d.tplEdited ? 'open' : ''}><summary title="{{键}} 换成填的值；{{#键}}…{{/键}} 填了才出现。不改就跟着上面自动生成">指令</summary><textarea rows="9" data-te="tpl">${esc(d.tplEdited ? d.tpl : teTemplate(d))}</textarea>${d.tplEdited ? '<button class="linkish" data-te-reset>恢复自动生成</button>' : ''}</details>
      </div>
      <div class="tfoot"><span class="grow"></span><button class="btn ghost" data-te-cancel>取消</button><button class="btn primary lg" data-te-save ${ok ? '' : 'disabled'}>保存</button></div>
    </div>`;
  }
  // ---------- 「用哪个 skill」：边打字边搜（10-23 乔淼：不把所有 skill 塞进下拉）。目录来自 skills/all：两个 AI 的 skills 文件夹、项目里的、Claude Code 插件里的 ----------
  const ENG_NAME = { claude: 'Claude Code', codex: 'Codex' };
  function loadSkillCat() {
    const id = B.current;
    return api('skills/all', 'GET', { project: id }).then(list => { S.skillCat = S.skillCat || {}; S.skillCat[id] = list; const box = $('#pane-main .skinfo'), inp = $('#pane-main [data-skpick]'); if (box && inp) box.innerHTML = skillInfo(inp.value); }).catch(() => {});
  }
  const skillCat = () => (S.skillCat || {})[B.current] || [];
  // 选中的 skill 下面那一行：来自哪里、装在哪个 AI 里、它是做什么的；这个项目用的 AI 里没有就提醒
  function skillInfo(name) {
    name = String(name || '').trim(); if (!name) return '';
    const s = skillCat().find(x => x.name === name);
    if (!s) return skillCat().length ? `<span class="warn">这台电脑上没找到「${esc(name)}」。从下面搜出来的里面选，名字要一字不差。</span>` : '';
    const p = proj(), eng = p && p.engine, miss = eng && ENG_NAME[eng] && !s.engines.includes(eng);
    return `<span class="chip">${esc(s.group)}</span><span class="muted">装在 ${s.engines.map(e => ENG_NAME[e] || e).join('、')}</span>${miss ? `<span class="warn">这个项目用的是 ${ENG_NAME[eng]}，它里面没有这个 skill${s.name.includes(':') ? '（插件里的 skill 只有 Claude Code 能用）' : ''}</span>` : ''}${s.desc ? `<div class="skdesc">${esc(s.desc)}</div>` : ''}`;
  }
  // 每个词都要在名字或说明里出现；名字开头对上的排最前，其次名字里有，再次只在说明里（说明开头就提到的靠前）
  function skillSearch(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean); if (!words.length) return [];
    const score = s => { const n = s.name.toLowerCase(), d = (s.desc || '').toLowerCase(); if (!words.every(w => n.includes(w) || d.includes(w))) return -1; return words.reduce((a, w) => { const at = d.indexOf(w); return a + (n.startsWith(w) ? 4 : n.includes(w) ? 2 : 0) + (at >= 0 && at < 12 ? 1 : 0); }, 0); };
    return skillCat().map(s => [score(s), s]).filter(x => x[0] >= 0).sort((a, b) => b[0] - a[0]).slice(0, 12).map(x => x[1]);
  }
  function skillResults(inp) {
    const box = inp.parentElement.querySelector('.skres'), hits = skillSearch(inp.value);
    box.dataset.i = '0';
    if (!inp.value.trim()) { box.classList.add('hide'); return; }
    box.innerHTML = hits.length ? hits.map((s, i) => `<div class="skrow ${i ? '' : 'on'}" data-skname="${esc(s.name)}"><div class="skhead"><b>${esc(s.name)}</b><span class="chip">${esc(s.group)}</span><span class="muted small">${s.engines.map(e => ENG_NAME[e] || e).join('、')}</span></div>${s.desc ? `<div class="skdesc">${esc(s.desc)}</div>` : ''}</div>`).join('')
      : `<div class="skrow none">${skillCat().length ? '没有匹配的 skill，换个词试试' : '正在读取装好的 skill…'}</div>`;
    box.classList.remove('hide');
  }
  function pickSkill(name) {
    const t = curTab(); if (!t || !t.draft) return;
    const d = t.draft, s = skillCat().find(x => x.name === name), inp = $('#pane-main [data-skpick]');
    d.skill = name; if (inp) { inp.value = name; inp.parentElement.querySelector('.skres').classList.add('hide'); }
    // 「一句话」空着就先用 skill 自己的说明（截短），可以再改
    if (s && s.desc && !d.one.trim()) { d.one = s.desc.replace(/\s+/g, ' ').slice(0, 120); const o = $('#pane-main [data-te="one"]'); if (o) o.value = d.one; }
    if (!d.tplEdited) { const ta = $('#pane-main [data-te="tpl"]'); if (ta) ta.value = teTemplate(d); }
    $('#pane-main .skinfo').innerHTML = skillInfo(name);
    const sv = $('#pane-main [data-te-save]'); if (sv) sv.disabled = !(d.skill.trim() && d.name.trim());
    $('#pane-main').__html = null;
    const nm = $('#pane-main [data-te="name"]'); if (nm && !nm.value) nm.focus();
  }
  function newToolDraft() { return { skill: '', name: '', one: '', cat: '我的工具', fields: [], tpl: '', tplEdited: false }; }
  async function openToolEditor(id) {
    if (!S.skills[B.current]) loadSkills();
    loadSkillCat(); // 每次打开都重读，刚装的 skill 也能搜到
    const tab = { id: 'toolEdit:' + (id || Date.now()), toolEdit: true, editId: id || '', draft: id ? null : newToolDraft() };
    openTab(tab);
    if (id) {
      try {
        const raw = await api('tools/raw', 'GET', { id });
        tab.draft = { skill: raw.skill || '', name: raw['名称'] || '', one: raw['一句话'] || '', cat: raw['分类'] || '我的工具', tpl: raw['指令'] || '', tplEdited: true,
          fields: (raw['输入'] || []).map(x => ({ name: x['名称'] || '', type: x['类型'] === '多行' || x['类型'] === '选择' ? x['类型'] : '单行', options: (x['选项'] || []).join('，'), required: !!x['必填'] })) };
        $('#pane-main').__html = null; renderPane();
      } catch (e) { toast(e.message); }
    }
  }
  async function saveToolDraft(t) {
    const d = t.draft;
    const tool = { 名称: d.name.trim(), 一句话: d.one.trim(), 分类: d.cat, skill: d.skill.trim(), 需要的skill: [d.skill.trim()],
      输入: d.fields.filter(f => f.name.trim()).map((f, i) => ({ 键: teKey(i), 名称: f.name.trim(), 类型: f.type, ...(f.required ? { 必填: true } : {}), ...(f.type === '选择' ? { 选项: f.options.split(/[,，、]/).map(s => s.trim()).filter(Boolean) } : {}) })),
      指令: d.tplEdited ? d.tpl : teTemplate({ ...d, fields: d.fields.filter(f => f.name.trim()) }) };
    try {
      const r = await api('tools/save', 'POST', { tool, id: t.editId }); Object.assign(B, r);
      closeTab(t.id); for (const k in UI) UI[k].tabs = UI[k].tabs.filter(x => x.tool !== r.saved);
      openTab({ id: 'tool:' + r.saved, tool: r.saved }); toast(t.editId ? '改好了' : `加好了「${tool.名称}」`);
    } catch (e) { toast(e.message); }
  }
  const toolPicker = document.createElement('input'); toolPicker.type = 'file'; toolPicker.accept = '.json'; toolPicker.style.display = 'none'; document.body.appendChild(toolPicker);
  toolPicker.addEventListener('change', () => { if (toolPicker.files[0]) importTool(toolPicker.files[0]); toolPicker.value = ''; });
  // 导入工具（内容 1.3.8 起工具文件可以附带 skill）：带了学员这边没装、或不一样的 skill，先弹框确认装进哪些 AI，再导入
  async function importTool(file, replace, install) {
    const json = typeof file === 'string' ? file : await file.text();
    try {
      const r = await api('tools/import', 'POST', { json, replace: !!replace, ...(install !== undefined ? { install, id: install && install.id || (install === false ? importTool.pending : undefined) } : {}) });
      if (r.needInstall) { importTool.pending = r.id; return toolSkillsBox(r, json, replace); }
      Object.assign(B, r); renderAll(); close();
      for (const k in UI) UI[k].tabs = UI[k].tabs.filter(x => x.tool !== r.saved);
      const got = r.installed ? Object.entries(r.installed.installed) : [];
      toast(`${r.replaced ? '已替换' : '已导入'}工具${got.length ? `，装好 ${got.map(([k, v]) => `${k}（${v.map(engineName).join('、')}）`).join('、')}` : ''}${r.installed && r.installed.skipped.length ? `；没装：${r.installed.skipped.join('；')}` : ''}`);
      openTab({ id: 'tool:' + r.saved, tool: r.saved });
    } catch (e) {
      if (e.status === 409 && e.data && e.data.needReplace) return confirmBox(`替换「${esc(e.data.name)}」？`, '', '替换', () => importTool(json, true));
      toast(e.message);
    }
  }
  function toolSkillsBox(r, json, replace) {
    const rows = r.skills.map((s, i) => { const st = ghState(s), done = Object.values(s.where).every(w => w === 'identical');
      return `<div class="ghrow"><label class="ghchk"><input type="checkbox" checked disabled></label><div class="grow"><div class="ghhead"><b>${esc(s.name)}</b>${s.scripts ? `<span class="chip amber" title="里面有可以运行的程序文件，AI 可能会运行它们">带脚本 ${s.scripts}</span>` : ''}<span class="muted small">${fmtSize(s.size)}</span>${done ? '<span class="chip ok">已装好</span>' : st ? `<span class="chip ${st.cls}">${esc(st.label)}</span>` : ''}${st && st.other ? `<label class="small ghover"><input type="checkbox" data-ghover="${i}">覆盖（先备份）</label>` : ''}</div>
        <div class="skdesc">${esc(s.desc || '（SKILL.md 里没写说明）')}</div><details class="ghpre"><summary>看 SKILL.md 开头</summary><pre>${esc(s.preview)}</pre></details></div></div>`; }).join('');
    modal(`导入工具「${esc(r.toolName)}」`, `<p class="small" style="line-height:1.7">这个工具附带了 ${r.skills.length} 个 skill${r.shared.length ? `（另有共用资料 ${esc(r.shared.map(x => x.name).join('、'))}）` : ''}，导入时一起装进你的 AI 程序，执行时就不会缺 skill。</p>
      <div class="ghlist">${rows}</div>
      <div class="ghwarn">${I('alert')}<span>装进去以后 AI 会照着这些 skill 做事，可能运行里面的脚本、联网、读你电脑上的文件。只导入你信得过的人给的工具文件。</span></div>
      <div class="set-row"><span class="grow">装进哪些 AI 程序</span>${r.engines.map(e => `<label class="small ghengs"><input type="checkbox" data-gheng="${esc(e.id)}" checked>${esc(e.name)}</label>`).join('')}</div>
      <div class="mfoot"><button class="btn" data-close>取消</button><span class="grow"></span><button class="btn" id="tsOnly">只导入工具</button><button class="btn primary" id="tsGo">导入并安装</button></div>`, true);
    const pick = sel => [...layer.querySelectorAll(sel)];
    $('#tsOnly').onclick = () => importTool(json, replace, false);
    $('#tsGo').onclick = () => {
      const engineIds = pick('[data-gheng]:checked').map(x => x.dataset.gheng); if (!engineIds.length) return toast('至少选一个 AI 程序');
      $('#tsGo').disabled = true; $('#tsGo').textContent = '正在安装…';
      importTool(json, replace, { id: r.id, engineIds, overwrite: pick('[data-ghover]:checked').map(x => r.skills[+x.dataset.ghover].name) });
    };
  }
  // 导出工具：用的 skill 里有课程以外、这台电脑上找得到的，先问要不要一起打包（内容 1.3.8）
  async function exportTool(id) {
    let p; try { p = await api('tools/pack', 'GET', { id }); } catch (e) { return toast(e.message); }
    if (!p.skills.length) return downloadTool(id, false);
    modal('导出工具', `<label class="set-row" style="cursor:pointer"><input type="checkbox" id="exPack" ${p.tooBig ? 'disabled' : 'checked'}><span class="grow">把 skill 一起打包：${p.skills.map(k => `${esc(k.name)}（${fmtSize(k.size)}，来自 ${esc(k.from)}）`).join('、')}
        <div class="sub2">${p.tooBig ? `加起来 ${fmtSize(p.size)}，超过 20 MB，不能打包，只能导出工具，请让学员另外装 skill` : '学员导入时会一起装上；不勾就和以前一样，只导出工具'}</div></span></label>
      ${p.skipped.length ? `<div class="set-row small muted">带不了：${p.skipped.map(x => `${esc(x.name)}（${esc(x.why)}）`).join('、')}</div>` : ''}
      <div class="mfoot"><button class="btn" data-close>取消</button><button class="btn primary" id="exGo">导出</button></div>`);
    $('#exGo').onclick = () => { const pk = $('#exPack').checked; close(); downloadTool(id, pk); };
  }
  async function downloadTool(id, pack) {
    try {
      const raw = await api('tools/export', 'GET', { id, pack: pack ? '1' : '0' }), blob = new Blob([JSON.stringify(raw, null, 1)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = (raw['名称'] || '工具') + '.json'; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      if (pack) toast('已导出，skill 一起打包在里面');
    } catch (e) { toast(e.message); }
  }
  function removeTool(id) {
    const a = toolOf(id); if (!a) return;
    confirmBox(`移除「${esc(a.name)}」？`, '', '移除', async () => {
      const r = await act('tools/remove', { id }, `已移除「${a.name}」`);
      if (r) { for (const k in UI) UI[k].tabs = UI[k].tabs.filter(x => x.tool !== id); renderAll(); }
    }, true);
  }
  // ---------- 从 GitHub 装 skills（内容 1.3.6，方案 设计/GitHub-skills导入-方案.md）：贴链接 → 看概况和提醒 → 下载列出 → 勾选 → 装进 AI、批量建工具 ----------
  // GitHub 连不上：在浏览器里下 zip，拖进这个窗口（或选文件）；本机文件夹也能拖（App 里拿得到路径）
  const ghPicker = document.createElement('input'); ghPicker.type = 'file'; ghPicker.accept = '.zip,.gz,.tgz'; ghPicker.style.display = 'none'; document.body.appendChild(ghPicker);
  ghPicker.addEventListener('change', () => { if (ghPicker.files[0]) ghLoad({ file: ghPicker.files[0] }); ghPicker.value = ''; });
  const GH = { link: '', info: null, list: null };
  const ghWarn = who => `<div class="ghwarn">${I('alert')}<span>这是${who ? ` <b>${esc(who)}</b> 写的` : ''}第三方 skill，不是课程提供的。装进去以后 AI 会照着它做事，可能运行里面的脚本、联网、读你电脑上的文件。只装你信得过的来源。</span></div>`;
  function openGhImport() {
    GH.info = null; GH.list = null;
    modal('从 GitHub 装 skills', `<div class="ghbox" id="ghBox">
      <div class="ghlink"><input type="text" id="ghLink" placeholder="贴 GitHub 链接：仓库、文件夹或某个 SKILL.md" value="${esc(GH.link)}" autocomplete="off" spellcheck="false"><button class="btn primary" id="ghRead">读取</button></div>
      <div class="small muted ghdrop" id="ghDrop">连不上 GitHub？在浏览器里下载仓库的 zip，拖到这里，或者 <button class="linkish" id="ghPick">选文件</button></div>
      <div id="ghBody"></div></div>`, true);
    const inp = $('#ghLink'); inp.focus();
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') ghInfo(); });
    $('#ghRead').onclick = ghInfo; $('#ghPick').onclick = () => ghPicker.click();
    const box = $('#ghBox');
    box.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); $('#ghDrop').classList.add('drag'); });
    box.addEventListener('dragleave', e => { if (!box.contains(e.relatedTarget)) $('#ghDrop').classList.remove('drag'); });
    box.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation(); $('#ghDrop').classList.remove('drag');
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (f) ghLoad({ file: f });
    });
  }
  const ghBody = html => { const b = $('#ghBody'); if (b) b.innerHTML = html; return b; };
  async function ghInfo() {
    const link = ($('#ghLink') || {}).value || ''; GH.link = link.trim();
    ghBody('<div class="set-row muted">正在读取…</div>');
    let i; try { i = await api('ghskills/info', 'POST', { link: GH.link }); } catch (err) { return ghBody(`<div class="set-row bad">${esc(err.message)}</div>`); }
    GH.info = i;
    const r = i.repo, day = r && r.pushed ? r.pushed.slice(0, 10) : '';
    const facts = r ? [`★ ${r.stars}`, day && `最近更新 ${day}`, r.license ? `许可证 ${r.license}` : '没写许可证', `约 ${r.sizeMB} MB`, r.archived && '已停止维护'].filter(Boolean).join(' · ') : '';
    ghBody(`<div class="set-row"><span class="grow"><b>${esc(r ? r.full : i.label)}</b>${i.sub ? ` <span class="muted">/ ${esc(i.sub)}</span>` : ''}<div class="sub2">${esc(r ? (r.desc ? r.desc + ' · ' : '') + facts : '没取到仓库概况（' + i.error + '），可以直接下载试试')}</div></span></div>
      ${ghWarn(r && r.owner)}
      <div class="mfoot"><button class="btn" data-close>取消</button><button class="btn primary" id="ghGo">下载并列出 skill${r ? `（约 ${r.sizeMB} MB）` : ''}</button></div>`);
    $('#ghGo').onclick = () => ghLoad({ link: GH.link });
  }
  async function ghLoad({ link, file }) {
    ghBody(`<div class="set-row muted">${file ? '正在读压缩包…' : '正在从 GitHub 下载…（大的仓库要等一会儿）'}</div>`);
    let r;
    try {
      const body = { link: link || (GH.info ? GH.link : '') };
      if (file) {
        const from = window.popperHost ? window.popperHost.pathOf(file) : '';
        body.name = file.name;
        if (from) body.from = from;
        else { if (file.size > 28 * 1024 * 1024) throw Error('压缩包太大（超过 28MB），请改贴子文件夹的链接'); body.data = await new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1] || ''); fr.onerror = rej; fr.readAsDataURL(file); }); }
      }
      r = await api('ghskills/load', 'POST', body);
    } catch (err) {
      const zip = GH.info && GH.info.zipUrl;
      return ghBody(`<div class="set-row bad">${esc(err.message)}</div>${err.data && err.data.offline && zip ? `<div class="set-row"><span class="grow small">换个网络再试；或者在浏览器里下载压缩包，下好后拖到这个窗口里</span><a class="btn small" href="${esc(zip)}" target="_blank" rel="noopener">在浏览器里下载</a></div>` : ''}`);
    }
    GH.list = r; ghDrawList();
  }
  // 每个 skill 在各 AI 里的情况合成一个标签：课程同名不装；别处来的同名默认不覆盖（可勾「覆盖」）；上次从这里装的 = 更新
  function ghState(s) {
    const w = Object.values(s.where || {});
    if (!s.ok) return { cls: 'bad', label: '文件夹名不对，装不了', block: true };
    if (w.includes('course')) return { cls: 'bad', label: '和课程 skill 同名，不装', block: true };
    const other = Object.entries(s.where).filter(([, v]) => v === 'other').map(([k]) => engineName(k));
    if (other.length) return { cls: 'amber', label: `${other.join('、')} 里已有别处来的同名 skill`, other: true };
    if (w.length && w.every(x => x === 'identical')) return { cls: 'ok', label: '已装好（一模一样）' };
    if (w.includes('same')) return { cls: 'ok', label: '装过 · 再装就是更新' };
    const same = Object.entries(s.where).filter(([, v]) => v === 'identical').map(([k]) => engineName(k));
    if (same.length) return { cls: 'ok', label: `${same.join('、')} 里已装好` };
    return null;
  }
  function ghDrawList() {
    const r = GH.list, cats = [...new Set([...CATS, ...(B.tools || []).map(x => x.cat)])];
    const rows = r.skills.map((s, i) => { const st = ghState(s);
      return `<div class="ghrow"><label class="ghchk"><input type="checkbox" data-ghsk="${i}" ${st && (st.block || st.other) ? '' : 'checked'} ${st && st.block ? 'disabled' : ''}></label>
        <div class="grow"><div class="ghhead"><b>${esc(s.name)}</b>${st && st.block ? '' : s.hasTool ? '<span class="chip">已有工具</span>' : `<span class="muted small">工具名「${esc(s.toolName)}」</span>`}${s.scripts ? `<span class="chip amber" title="里面有可以运行的程序文件（.py / .sh / .js 等），AI 可能会运行它们">带脚本 ${s.scripts}</span>` : ''}<span class="muted small">${fmtSize(s.size)}</span>${st ? `<span class="chip ${st.cls}">${esc(st.label)}</span>` : ''}${st && st.other ? `<label class="small ghover"><input type="checkbox" data-ghover="${i}">覆盖（先备份）</label>` : ''}</div>
        <div class="skdesc">${esc(s.desc || '（SKILL.md 里没写说明）')}</div><details class="ghpre"><summary>看 SKILL.md 开头</summary><pre>${esc(s.preview)}</pre></details></div></div>`; }).join('');
    ghBody(`<div class="set-row"><span class="grow"><b>${esc(r.label)}</b>${r.sub ? ` <span class="muted">/ ${esc(r.sub)}</span>` : ''}<div class="sub2">找到 ${r.skills.length} 个 skill${r.shared.length ? ` · 共用资料 ${r.shared.map(x => x.name).join('、')}（装任何一个都会一起带上）` : ''}</div></span>
        <button class="linkish" id="ghAll">全选</button><button class="linkish" id="ghNone">全不选</button></div>
      <div class="ghlist">${rows}</div>
      ${ghWarn(GH.info && GH.info.repo && GH.info.repo.owner)}
      <div class="set-row"><span class="grow">装进哪些 AI 程序</span>${r.engines.map(e => `<label class="small ghengs"><input type="checkbox" data-gheng="${esc(e.id)}" checked>${esc(e.name)}</label>`).join('')}</div>
      <div class="set-row"><label class="grow small"><input type="checkbox" id="ghTools" checked> 同时加成「我的工具」，放在分类</label><input type="text" id="ghCat" list="ghCats" value="我的工具" maxlength="20" style="width:140px"><datalist id="ghCats">${cats.map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
      <div class="mfoot"><span class="small muted grow" id="ghN"></span><button class="btn" data-close>取消</button><button class="btn primary" id="ghInstall">安装</button></div>`);
    const count = () => { const n = layer.querySelectorAll('[data-ghsk]:checked').length; $('#ghInstall').disabled = !n || !layer.querySelector('[data-gheng]:checked'); $('#ghInstall').textContent = n ? `安装 ${n} 个` : '安装'; };
    layer.querySelector('.ghlist').addEventListener('change', count); layer.querySelectorAll('[data-gheng]').forEach(x => x.onchange = count); count();
    $('#ghAll').onclick = () => { layer.querySelectorAll('[data-ghsk]:not([disabled])').forEach(x => x.checked = true); count(); };
    $('#ghNone').onclick = () => { layer.querySelectorAll('[data-ghsk]').forEach(x => x.checked = false); count(); };
    $('#ghInstall').onclick = ghInstall;
  }
  async function ghInstall() {
    const r = GH.list, pick = sel => [...layer.querySelectorAll(sel)];
    const names = pick('[data-ghsk]:checked').map(x => r.skills[+x.dataset.ghsk].name), overwrite = pick('[data-ghover]:checked').map(x => r.skills[+x.dataset.ghover].name);
    const engineIds = pick('[data-gheng]:checked').map(x => x.dataset.gheng), makeTools = $('#ghTools').checked, cat = $('#ghCat').value.trim() || '我的工具';
    $('#ghInstall').disabled = true; $('#ghInstall').textContent = '正在安装…';
    let x; try { x = await api('ghskills/install', 'POST', { id: r.id, names, engineIds, overwrite, makeTools, cat }); } catch (err) { toast(err.message); return ghDrawList(); }
    if (x.config) { Object.assign(B, x.config); renderAll(); }
    const n = Object.keys(x.installed).length, li = a => a.map(esc).join('<br>');
    modal(n ? (x.errors.length || x.skipped.length ? '装了一部分' : '装好了') : '没装上', `
      <div class="set-row"><span class="grow">装好的 skill<div class="sub2">${Object.entries(x.installed).map(([k, v]) => `${esc(k)}（${v.map(engineName).join('、')}）`).join('、') || '—'}</div></span><span class="chip ${n ? 'ok' : 'bad'}">${n} 个</span></div>
      ${x.shared.length ? `<div class="set-row"><span class="grow">一起带上的共用资料<div class="sub2">${li(x.shared)}</div></span></div>` : ''}
      ${makeTools ? `<div class="set-row"><span class="grow">加好的工具（分类「${esc(cat)}」）<div class="sub2">${x.tools.map(t => esc(t.name)).join('、') || '—'}${x.toolsSkipped.length ? `<br>没重复建：${li(x.toolsSkipped)}` : ''}</div></span><span class="chip">${x.tools.length} 个</span></div>` : ''}
      ${x.backedUp.length ? `<div class="set-row"><span class="grow">同名的旧版先备份到了收件箱 .工作站/skills备份/<div class="sub2">${li(x.backedUp)}</div></span></div>` : ''}
      ${x.skipped.length ? `<div class="set-row"><span class="grow">没装的<div class="sub2">${li(x.skipped)}</div></span></div>` : ''}
      ${x.errors.length ? `<div class="set-row bad"><span class="grow">出错的<div class="sub2">${li(x.errors)}</div></span></div>` : ''}
      <div class="set-row"><span class="grow small muted">以后要卸载：AI学术环境配置 → AI 程序 → 「第三方 skills」。工具要加输入框，打开工具点「编辑」。</span></div>
      <div class="mfoot"><button class="btn" data-close>关闭</button>${x.tools.length ? '<button class="btn primary" id="ghSee">去看工具</button>' : ''}</div>`);
    const see = $('#ghSee'); if (see) see.onclick = () => { close(); try { localStorage.setItem(TOOLCAT_KEY, cat); } catch {} ui().active = 'store'; renderAll(); };
  }
  // 配置页里管理：按来源列出装过的，能卸载（skill 移进废纸篓 / 回收站，工具挪进「已移除」）
  async function openGhManage() {
    modal('第三方 skills', '<div class="set-row muted">正在读取…</div>', true);
    let r; try { r = await api('ghskills/list'); } catch (err) { return modal('第三方 skills', `<div class="set-row bad">${esc(err.message)}</div>`); }
    const trashName = navigator.platform.startsWith('Win') ? '回收站' : '废纸篓';
    modal('第三方 skills', (r.repos.length ? r.repos.map((x, i) => `<div class="ghrepo"><div class="set-row"><span class="grow"><b>${esc(x.label)}</b><div class="sub2">${x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener">${esc(x.link)}</a> · ` : ''}${esc((x.installedAt || '').slice(0, 10))} 装的${x.commit ? ' · 版本 ' + esc(x.commit) : ''}${x.shared.length ? ' · 共用资料 ' + esc(x.shared.join('、')) : ''}</div></span><button class="btn small" data-ghrm="${i}">卸载全部</button></div>
        ${x.skills.map(s => `<div class="set-row indent"><span class="grow">${esc(s.name)}<div class="sub2">${s.engines.length ? '装在 ' + s.engines.map(engineName).join('、') : '各个 AI 里都没有了'}${s.tool ? ' · 有工具' : ''}</div></span><button class="linkish" data-ghrm="${i}" data-ghone="${esc(s.name)}">卸载</button></div>`).join('')}</div>`).join('')
      : '<div class="set-row muted">还没有装过第三方 skill。主页「我的工具」末尾点「从 GitHub 装」，或者导入带 skill 的工具文件。</div>')
      + `<div class="mfoot"><button class="btn" id="ghmBack">回到配置</button><span class="grow"></span><button class="btn primary" id="ghmNew">从 GitHub 装…</button></div>`, true);
    $('#ghmBack').onclick = openSettings; $('#ghmNew').onclick = openGhImport;
    layer.querySelectorAll('[data-ghrm]').forEach(b => b.onclick = () => {
      const x = r.repos[+b.dataset.ghrm], one = b.dataset.ghone, what = one ? `「${one}」` : `${esc(x.label)} 装的 ${x.skills.length} 个 skill`;
      modal(`卸载${esc(what)}？`, `<p style="line-height:1.7">从各个 AI 程序的 skills 文件夹移进${trashName}，后悔了能从${trashName}拿回来。别处装的同名 skill 不动。</p>
        <label class="small"><input type="checkbox" id="ghmTools" checked> 对应的「我的工具」也一起移除</label>
        <div class="mfoot"><button class="btn" id="ghmNo">取消</button><button class="btn accent" id="ghmOk">卸载</button></div>`);
      $('#ghmNo').onclick = openGhManage;
      $('#ghmOk').onclick = async () => {
        try { const y = await api('ghskills/remove', 'POST', { key: x.key, names: one ? [one] : [], removeTools: $('#ghmTools').checked }); if (y.config) { Object.assign(B, y.config); renderAll(); }
          toast(`移进${trashName} ${y.moved.length} 个${y.tools.length ? `，移除工具 ${y.tools.length} 个` : ''}${y.errors.length ? `；没成的：${y.errors.join('；')}` : ''}`); }
        catch (err) { toast(err.message); }
        openGhManage();
      };
    });
  }
  // 选文件：按文件夹分组，顶上能搜；勾了几个在按钮上显示
  function pickFiles(t) {
    const files = (S.files || []).filter(f => f.kind !== 'dir' && !f.path.startsWith('.')).sort((a, b) => a.path.localeCompare(b.path, 'zh')), on = new Set(t.pins || []);
    const groups = {};
    for (const f of files) { const d = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : ''; (groups[d] = groups[d] || []).push(f); }
    const list = Object.keys(groups).sort((a, b) => a.localeCompare(b, 'zh')).map(d => `<div class="pickgrp">${d ? `<div class="fgrp">${I('folder')}${esc(d)}/</div>` : ''}${groups[d].map(f => `<label class="pickrow" data-name="${esc(f.path.toLowerCase())}"><input type="checkbox" value="${esc(f.path)}" ${on.has(f.path) ? 'checked' : ''}>${fileIcon(f.kind)}<span class="small ellipsis">${esc(f.path.split('/').pop())}</span></label>`).join('')}</div>`).join('');
    modal('用哪些文件', `<div class="picksearch">${I('search')}<input type="text" id="pinQ" placeholder="搜文件名" autocomplete="off"></div><div class="picklist">${list || `<div class="art">${art('files')}</div>`}</div>
      <div class="mfoot"><span class="small muted" id="pinN"></span><span class="grow"></span><button class="btn" data-close>取消</button><button class="btn primary" id="pinOk">好</button></div>`);
    const count = () => { const n = layer.querySelectorAll('.picklist input:checked').length; $('#pinN').textContent = n ? `选了 ${n} 个` : ''; };
    layer.querySelector('.picklist').addEventListener('change', count); count();
    $('#pinQ').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase();
      layer.querySelectorAll('.pickrow').forEach(r => r.classList.toggle('hide', !!q && !r.dataset.name.includes(q)));
      layer.querySelectorAll('.pickgrp').forEach(g => g.classList.toggle('hide', !g.querySelector('.pickrow:not(.hide)')));
    });
    $('#pinQ').focus();
    $('#pinOk').onclick = () => { t.pins = [...layer.querySelectorAll('.picklist input:checked')].map(i => i.value); close(); renderPane(); };
  }
  // 交任务：缺 skill 时先问一句，确认了再带 force 重交
  async function submitRun(body, from) {
    try {
      askNotify();
      const r = await api('runs', 'POST', body);
      // 交出去：一个光点从点的地方飞进右栏的标记（只在这个项目是当前项目时）
      if (from && body.project === B.current) requestAnimationFrame(() => fly(from, $('#r-agent .ag-mk')));
      toast(r.local ? `开始转：${r.title.replace(/^MinerU · /, '')}，进度看右栏` : r.auto && r.chain ? `自动模式开始：共 ${r.chain.n} 个阶段，交给 ${[...new Set(chainEngines(r))].map(engineName).join('、')}` : r.status === 'queued' ? `已排队：${r.title}` : `已交给 ${engineName(r.engine)}`);
      if (body.project === B.current) { S.expanded = r.id; await loadRuns(); }
      refreshProjects(); poll(); return r;
    } catch (e) {
      pushBusy(true); // 没开成：工作流里刚点灰的按钮恢复
      // 这一步正在跑（内容 1.4.1，T1）：不新开，跳到正在跑的那个任务
      if (e.status === 409 && e.data && e.data.busy) {
        S.lastBusy = { id: e.data.busy, wf: body.workflow || '', at: Date.now() };
        toast(e.message);
        if (e.data.busyProject === B.current || await switchProject(e.data.busyProject)) { S.expanded = e.data.busy; await loadRuns(); const t = curTab(); if (t && t.conv && t.conv !== e.data.busy) openConv({ id: e.data.busy, title: e.data.title }); }
        return null;
      }
      if (e.status === 409 && e.data && e.data.missingSkills) {
        // 自动模式各段交给不同的 AI 时，按 AI 分开列（内容 1.3.0）
        const groups = e.data.byEngine && e.data.byEngine.length ? e.data.byEngine : [{ engine: e.data.engine, skills: e.data.missingSkills }];
        return confirmBox('缺少 skill', groups.map(g => `<p class="small muted" style="margin:10px 0 8px">${esc(engineName(g.engine))} 里没找到：</p><div class="row" style="flex-wrap:wrap;gap:6px">${g.skills.map(s => `<span class="chip warn mono">${esc(s)}</span>`).join('')}</div>`).join(''),
          '仍然执行', () => submitRun({ ...body, force: true }, from), true);
      }
      toast(e.message);
    }
  }
  // 点了「执行」马上变灰（T1），交出去了或没交成都恢复；这个工具有任务没结束时按钮写「运行中」，见 toolHTML
  const runTool = (t, from) => { if (t.sending) return; t.sending = true; const b = $('#pane-main [data-trun]'); if (b) { b.disabled = true; b.textContent = '运行中'; } return submitRun({ project: B.current, tool: t.tool, values: t.vals, pins: t.pins || [] }, from || $('[data-trun]')).finally(() => { t.sending = false; $('#pane-main').__html = null; renderPane(); }); };

  // ---------- 文档：在中间打开项目里的文件 ----------
  const fileURL = (pid, rel) => `/__api/file/${B.fileToken}/${encodeURIComponent(pid)}/${rel.split('/').map(encodeURIComponent).join('/')}`;
  const openDoc = rel => { rel = String(rel).replace(/^\/+/, ''); markRead(rel); openTab({ id: 'doc:' + rel, doc: rel }); };
  // 点开就算读过：先改本地的，界面马上变；再告诉后台
  function markRead(rel) {
    const f = (S.files || []).find(x => x.path === rel); if (!f || !f.unread) return;
    f.unread = false; renderFiles(); renderTasks();
    api('files/read', 'POST', { project: B.current, path: rel }).catch(() => {});
  }
  const isUnread = rel => !!((S.files || []).find(x => x.path === rel) || {}).unread;
  const dot = on => on ? '<i class="unread" title="未读"></i>' : '';
  // 小型 Markdown 排版：标题、段落、列表、表格、引用、代码块、粗体斜体、链接
  function md(src) {
    const L = String(src).replace(/\r/g, '').replace(/<!--[\s\S]*?-->\n?/g, '').split('\n'); let out = '', i = 0; // HTML 注释（skill 写的元数据）不显示
    const inl = x => esc(x).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    const row = x => x.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
    const isBlock = x => /^(#{1,6}\s|>|\s*[-*+]\s|\s*\d+[.)]\s|\s*\||```|\s*(-{3,}|\*{3,})\s*$)/.test(x);
    while (i < L.length) {
      const l = L[i]; let m;
      if (/^```/.test(l)) { const b = []; i++; while (i < L.length && !/^```/.test(L[i])) b.push(L[i++]); i++; out += `<pre>${esc(b.join('\n'))}</pre>`; continue; }
      if ((m = l.match(/^(#{1,6})\s+(.*)/))) { out += `<h${m[1].length}>${inl(m[2])}</h${m[1].length}>`; i++; continue; }
      if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { out += '<hr>'; i++; continue; }
      if (/^\s*\|/.test(l) && i + 1 < L.length && /^\s*\|?\s*:?-{2,}/.test(L[i + 1])) {
        const hd = row(l); i += 2; let body = '';
        while (i < L.length && /^\s*\|/.test(L[i])) { body += '<tr>' + row(L[i]).map(c => `<td>${inl(c)}</td>`).join('') + '</tr>'; i++; }
        out += `<table><tr>${hd.map(c => `<th>${inl(c)}</th>`).join('')}</tr>${body}</table>`; continue;
      }
      if (/^>\s?/.test(l)) { const b = []; while (i < L.length && /^>\s?/.test(L[i])) b.push(L[i++].replace(/^>\s?/, '')); out += `<blockquote>${b.map(inl).join('<br>')}</blockquote>`; continue; }
      if (/^\s*[-*+]\s+/.test(l)) { const b = []; while (i < L.length && /^\s*[-*+]\s+/.test(L[i])) b.push(L[i++].replace(/^\s*[-*+]\s+/, '')); out += `<ul>${b.map(x => `<li>${inl(x)}</li>`).join('')}</ul>`; continue; }
      if (/^\s*\d+[.)]\s+/.test(l)) { const b = []; while (i < L.length && /^\s*\d+[.)]\s+/.test(L[i])) b.push(L[i++].replace(/^\s*\d+[.)]\s+/, '')); out += `<ol>${b.map(x => `<li>${inl(x)}</li>`).join('')}</ol>`; continue; }
      if (!l.trim()) { i++; continue; }
      const b = [L[i++]]; while (i < L.length && L[i].trim() && !isBlock(L[i])) b.push(L[i++]);
      out += `<p>${b.map(inl).join('<br>')}</p>`;
    }
    return out;
  }
  function csvTable(text) {
    const rows = text.replace(/\r/g, '').split('\n').filter(x => x.trim()).slice(0, 300).map(r => r.split(','));
    return `<table>${rows.map((r, i) => `<tr>${r.map(c => i ? `<td>${esc(c)}</td>` : `<th>${esc(c)}</th>`).join('')}</tr>`).join('')}</table>${rows.length >= 300 ? '<p class="muted small">前 300 行</p>' : ''}`;
  }
  // PDF.js（content/pdf.min.mjs、pdf.worker.min.mjs，pdfjs-dist 6.3.289）：每页画成一张图，滚到附近才画。
  // 只画页面，不加文字层、链接和表单（不能选中文字）；不许 PDF 里的脚本执行。读不出来就提示用默认程序打开
  let pdfjs = null, curPdf = null;
  async function renderPdf(url, box, scroller) {
    try {
      if (!pdfjs) { pdfjs = await import('/pdf.min.mjs'); pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'; }
      const task = pdfjs.getDocument({ url, isEvalSupported: false, enableXfa: false });
      curPdf = task;
      const doc = await task.promise;
      if (curPdf !== task || !box.isConnected) return;
      const first = (await doc.getPage(1)).getViewport({ scale: 1 });
      const width = Math.min(box.clientWidth - 48, 900), dpr = window.devicePixelRatio || 1;
      box.innerHTML = '';
      const io = new IntersectionObserver(es => es.forEach(e => {
        if (!e.isIntersecting || e.target.dataset.done) return;
        e.target.dataset.done = 1; io.unobserve(e.target);
        doc.getPage(+e.target.dataset.page).then(pg => {
          if (curPdf !== task) return;
          const v = pg.getViewport({ scale: width / pg.getViewport({ scale: 1 }).width * dpr });
          const c = document.createElement('canvas'); c.width = v.width; c.height = v.height;
          c.style.width = width + 'px'; c.style.height = v.height / dpr + 'px';
          e.target.style.height = ''; e.target.replaceChildren(c);
          return pg.render({ canvas: c, canvasContext: c.getContext('2d'), viewport: v }).promise;
        }).catch(() => { e.target.textContent = '这一页画不出来'; });
      }), { root: scroller, rootMargin: '1200px 0px' });
      for (let n = 1; n <= doc.numPages; n++) {
        const d = document.createElement('div'); d.className = 'pdfpage'; d.dataset.page = n;
        d.style.width = width + 'px'; d.style.height = Math.round(width * first.height / first.width) + 'px';
        box.appendChild(d); io.observe(d);
      }
    } catch (e) {
      if (curPdf && box.isConnected) box.innerHTML = `<div class="errbox" style="max-width:520px;margin:40px auto">PDF 显示不出来：${esc(e.message || String(e))}</div>`;
    }
  }
  async function renderDoc(t) {
    const main = $('#pane-main'), rel = t.doc, kind = kindOf(rel), url = fileURL(B.current, rel), name = rel.split('/').pop();
    let body;
    if (kind === 'html') body = `<div class="docbody wide"><iframe class="htmlview" sandbox="allow-scripts allow-popups allow-forms allow-modals" src="${esc(url)}"></iframe></div>`;
    else if (kind === 'image') body = `<div class="docbody" style="text-align:center"><img src="${esc(url)}" style="max-width:100%"></div>`;
    // PDF：Electron 自带的阅读器在 App 里读不出文件（10-11 实测），改用 PDF.js 画在中间
    else if (kind === 'pdf') body = '<div class="docbody wide pdfview"></div>';
    else if (kind === 'docx' || kind === 'other') body = `<div class="empty">${I('file')}<div style="margin:10px 0 14px">${esc(name)}</div><button class="btn" data-openext="${esc(rel)}">${I('external')}用默认程序打开</button></div>`;
    else body = '<div class="docbody md"></div>';
    if (curPdf) { curPdf.destroy(); curPdf = null; }
    main.__html = null; main.dataset.tab = B.current + '|' + t.id;
    // 文件页只用来看文件（T5）：要 AI 改，在右栏跟它说，或者用右上角的「用 rd 批注」
    main.innerHTML = `<div class="docwrap"><div class="kindbar">${tk('file', fileIcon(kind))}<b>文件</b><span class="ellipsis" title="${esc(rel)}">${esc(rel)}</span></div><div class="docscroll">${body}</div></div>`;
    const scroller = main.querySelector('.docscroll');
    if (kind === 'pdf') renderPdf(url, main.querySelector('.pdfview'), scroller);
    if (['md', 'text', 'data'].includes(kind)) {
      try {
        const r = await fetch(url, { credentials: 'same-origin' });
        if (!r.ok) throw Error((await r.json().catch(() => ({}))).error || '读不到这个文件');
        const text = await r.text(), box = main.querySelector('.docbody');
        if (!box || ui().active !== t.id) return;
        box.innerHTML = kind === 'md' ? md(text) : kind === 'data' && /\.csv$/i.test(rel) ? csvTable(text) : `<pre class="plain">${esc(text)}</pre>`;
      } catch (e) { const box = main.querySelector('.docbody'); if (box) box.innerHTML = `<div class="art">${art('missing', true, e.message)}<button class="btn" data-openext="${esc(rel)}">${I('external')}用默认程序打开</button></div>`; }
    }
  }
  const reloadDoc = () => { const main = $('#pane-main'); main.dataset.tab = ''; renderPane(); };
  // AI 回复：去掉工作站约定的结尾标记，按 Markdown 排版
  const replyHTML = text => md(String(text || '').replace(/\s*【(等你回复|完成)】\s*$/, ''));
  // 放大：整个任务对话框搬到中间——每一轮你说的 + AI 的回复，底下是和右栏一样的回复框和按钮（状态变了自动刷新）
  async function renderConv(t) {
    const main = $('#pane-main');
    main.__html = null; main.dataset.tab = B.current + '|' + t.id;
    main.innerHTML = '<div class="docwrap"><div class="docscroll"><div class="docbody md conv"></div></div><div class="convfoot"></div></div>';
    try {
      const [{ turns }, r] = await Promise.all([api(`runs/${t.conv}/conversation`), api(`runs/${t.conv}`)]), box = main.querySelector('.conv');
      if (!box || ui().active !== t.id) return;
      const live = ['running', 'stopping', 'queued'].includes(r.status);
      box.innerHTML = `<div class="conv-head">${sg(r.status)}<h1>${esc(r.title)}</h1><span class="tk conv kindchip">${I('chat')}任务对话</span></div><div class="conv-meta">${esc(engineName(r.engine))}${r.model ? ' · ' + esc(r.model) : ''} · ${esc(ST[r.status] || r.status)}</div>`
        + turns.map((x, i) => `${x.ask ? `<div class="conv-ask">${esc(x.ask)}</div>` : ''}<div class="conv-turn"><div class="conv-n">第 ${i + 1} 轮 · ${esc(when(x.at))}</div>${x.reply ? replyHTML(x.reply) : `<p class="muted">${live && i === turns.length - 1 ? '在跑…' : '（没有回复）'}</p>`}</div>`).join('')
        + ((r.outputs || []).length ? `<div class="conv-n">产出</div><div class="outs">${r.outputs.map(outLink).join('')}</div>` : '');
      main.querySelector('.convfoot').innerHTML = `<div class="tb">${taskActions(r, true)}</div>`;
      const cta = main.querySelector('.convfoot textarea'); if (cta && (S.convDraft || {})[r.id]) cta.value = S.convDraft[r.id]; // 没发出去的字
      drawAtts(r.id);
      const sc = main.querySelector('.docscroll'); sc.scrollTop = sc.scrollHeight;
      tickClocks();
    } catch (e) { const box = main.querySelector('.conv'); if (box) box.innerHTML = `<div class="errbox">${esc(e.message)}</div>`; }
  }
  const openConv = r => openTab({ id: 'conv:' + r.id, conv: r.id, title: r.title });
  // 放大的对话框：任务状态变了一定要刷新（10-24 乔淼：任务做完了，对话框还一直显示「执行中 / 在跑…」，只能手动停——
  // 以前光标在底下回复框里就不刷新）。刷新时把回复框里写了一半的字和光标留住
  async function reloadConvKeep(t) {
    const main = $('#pane-main'), ta = main.querySelector('.convfoot textarea');
    const keep = ta ? { v: ta.value, focus: document.activeElement === ta, a: ta.selectionStart, b: ta.selectionEnd } : null;
    main.dataset.tab = ''; await renderConv(t);
    const nt = keep && main.querySelector('.convfoot textarea');
    if (nt) { nt.value = keep.v; if (keep.focus) { nt.focus(); try { nt.setSelectionRange(keep.a, keep.b); } catch {} } }
  }

  // ---------- 导入 ----------
  const picker = document.createElement('input'); picker.type = 'file'; picker.accept = '.html,.htm'; picker.style.display = 'none'; document.body.appendChild(picker);
  picker.addEventListener('change', () => { if (picker.files[0]) importFile(picker.files[0]); picker.value = ''; });
  async function importFile(file, replace) {
    if (!/\.html?$/i.test(file.name)) return toast('只能导入 .html 文件');
    const html = await file.text();
    try {
      const r = await api('workflows/import', 'POST', { fileName: file.name, html, replace: !!replace });
      Object.assign(B, r); renderAll();
      toast(`${r.replaced ? '已替换' : '已导入'}「${r.imported.name}」`);
      // 替换了的话，各项目里开着的旧页面重新载入
      document.querySelectorAll('.wfbox').forEach(b => { if (b.dataset.wf === r.imported.id) b.remove(); });
      openTab({ id: 'wf:' + r.imported.id, wf: r.imported.id });
    } catch (e) {
      if (e.status === 409 && e.data && e.data.needReplace) return confirmBox(`替换「${esc(e.data.name)}」？`,
        `<p class="muted small" style="margin:10px 0 0">${e.data.oldVersion ? 'v' + esc(e.data.oldVersion) : '旧版'} → ${e.data.version ? 'v' + esc(e.data.version) : '新文件'}</p>`, '替换', () => importFile(file, true));
      toast(e.message);
    }
  }
  function removeWorkflow(w) {
    confirmBox(`移除「${esc(w.name)}」？`, '', '移除', async () => {
      const r = await act('workflows/remove', { id: w.id }, `已移除「${w.name}」`);
      if (r) { document.querySelectorAll('.wfbox').forEach(b => { if (b.dataset.wf === w.id) b.remove(); }); for (const k in UI) UI[k].tabs = UI[k].tabs.filter(t => t.wf !== w.id); renderAll(); }
    }, true);
  }

  // ---------- 工作流：每个项目的每个工作流一个隔离的页面 ----------
  const wfOrigin = id => `http://wf-${id}.localhost:${B.wf.port}`;
  function makeFrame(w, projectId) {
    const fr = document.createElement('iframe');
    fr.className = 'wfview'; fr.dataset.wf = w.id; fr.dataset.proj = projectId;
    // 不给 allow-top-navigation：工作流页面不能把整个窗口跳走。它和工作站不同源，读不到工作站的任何东西
    fr.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads');
    fr.src = `${wfOrigin(w.id)}/?k=${encodeURIComponent(B.wf.token)}&p=${encodeURIComponent(projectId || '')}`;
    return fr;
  }
  function ensureWfBox(id) {
    const key = boxKey(id);
    if ([...document.querySelectorAll('.wfbox')].some(b => b.dataset.key === key)) return;
    const box = document.createElement('div');
    box.className = 'wfbox'; box.dataset.key = key; box.dataset.wf = id;
    box.appendChild(makeFrame(wfOf(id), B.current));
    $('#pane-wf').appendChild(box);
  }
  // 「交给 AI」必须是用户刚在这个工作流里点了（或按了键）：桥（bridge.js）在页面里挡一道，但导入的页面可以绕过桥直接发消息，
  // 所以工作站自己再核对两件事——焦点在这个工作流框里（用户点进去过），并且用户刚有过操作。
  // 「刚有过操作」用浏览器的「用户激活」：用户在框里点击或按键，外面这一层也会被标成激活，约 5 秒内有效，页面自己伪造不了；
  // 只看「点进框的那一刻」不行：用户先在框里填了半天再点「执行」，焦点一直在框里，外面收不到第二次。
  // 老浏览器没有这个接口时退回：焦点进框后 5 秒内。同一个框 2 秒内只收一次，防止页面趁用户打字连发。
  const MAX_CHAIN = 12; // 自动模式最多几段（bridge.js、runtime.cjs 同一个数）
  const wfEnter = new WeakMap(), wfLastRun = new WeakMap();
  window.addEventListener('blur', () => setTimeout(() => { const a = document.activeElement; if (a && a.matches && a.matches('iframe.wfview')) wfEnter.set(a, Date.now()); }, 0));
  function userJustActed(fr) {
    if (document.activeElement !== fr) return false;
    const ua = navigator.userActivation;
    const active = ua ? ua.isActive : Date.now() - (wfEnter.get(fr) || 0) < 5000;
    if (!active || Date.now() - (wfLastRun.get(fr) || 0) < 2000) return false;
    wfLastRun.set(fr, Date.now());
    return true;
  }
  // 工作流页面交来的消息：先核对是哪个框、来源地址对不对
  window.addEventListener('message', async e => {
    const fr = [...document.querySelectorAll('iframe.wfview')].find(f => f.contentWindow === e.source);
    if (!fr || e.origin !== wfOrigin(fr.dataset.wf)) return;
    const id = fr.dataset.wf, d = e.data || {};
    if (d.__aiwsTest) { window.__wfTests[id] = d.results; return; }
    if (d.__aiws !== 1) return;
    if (d.type === 'ready') { chainSent.delete(fr); busySent.delete(fr); pushBusy(); pushSkills(fr); if (S.pendingGo && S.pendingGo.wf === id) { const g = S.pendingGo; S.pendingGo = null; postGo(fr, g); } return pushChain(); } // 页面（重新）载入：把自动模式进度补发一次
    const viaGo = d.type === 'run' && d.nonce && S.goNonce && S.goNonce.n === d.nonce && S.goNonce.wf === id && Date.now() - S.goNonce.at < 15000;
    if (viaGo) S.goNonce = null; // 一次性
    if ((d.type === 'run' || d.type === 'chain') && !viaGo && !userJustActed(fr)) { console.warn('工作流「' + id + '」没经用户点击就要交给 AI，已拦下'); return; }
    if (d.type === 'chain' && Array.isArray(d.steps) && d.steps.length > MAX_CHAIN) return toast(`自动模式最多 ${MAX_CHAIN} 段，这个工作流交来了 ${d.steps.length} 段，没有执行`);
    // 点的位置（框内坐标）换成窗口坐标，飞点从那里出发
    const fr0 = fr.getBoundingClientRect(), pt = d.at && Number.isFinite(d.at.x) && Number.isFinite(d.at.y) ? { x: fr0.left + Math.max(0, Math.min(fr0.width, d.at.x)), y: fr0.top + Math.max(0, Math.min(fr0.height, d.at.y)) } : null;
    if (d.type === 'run' && typeof d.text === 'string') {
      // 任务名：按钮上写的 data-aiws-title，没有就用所在区块的标题，再没有就用按钮上的字
      const title = String(d.title || '').trim() || String(d.label || '').replace(/^[^\p{L}\p{N}]+/u, '').replace(/^执行\s*/, '').replace(/\s*prompt$/i, '').trim() || '执行';
      submitRun({ project: fr.dataset.proj, workflow: id, prompt: d.text, title }, pt);
    }
    // 自动模式：一串阶段，工作站按顺序跑
    if (d.type === 'chain' && Array.isArray(d.steps) && d.steps.length) submitRun({ project: fr.dataset.proj, workflow: id, chain: d.steps.map(x => ({ title: String(x.title || ''), text: String(x.text || ''), ...(x.engine ? { engine: String(x.engine) } : {}) })) }, pt);
    if (d.type === 'open') { if (fr.dataset.proj === B.current) openDoc(String(d.path)); }
  });

  // ---------- 右栏：任务 ----------
  const ORDER = { waiting: 0, failed: 1, running: 2, stopping: 2, queued: 3 };
  const since = iso => { const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000)); return s < 60 ? s + ' 秒' : Math.floor(s / 60) + ' 分 ' + (s % 60) + ' 秒'; };
  async function loadRuns() {
    const id = B.current;
    try { const list = await api('runs', 'GET', { project: id }); if (B.current === id) { S.runs = list; renderTasks(); } } catch {}
  }
  const outLink = f => `<div class="frow" data-file="${esc(f)}" title="${esc(f)}">${fileIcon(kindOf(f))}<span class="grow"><span class="nm">${esc(f.split('/').pop())}</span>${f.includes('/') ? `<span class="meta">${esc(f.slice(0, f.lastIndexOf('/')))}</span>` : ''}</span>${dot(isUnread(f))}</div>`;
  // 出错指引：把常见报错翻成人话，配下一步能点的按钮；原文折叠在下面
  const ERR_HELP = [
    [/没能开始下一阶段/, '自动模式没能接着往下跑', ''],
    [/at capacity|overloaded|\b529\b|try a different model|server.?busy/i, '模型现在太忙', '过几分钟点「重试」；急的话换一个 AI 重做。'],
    [/rate.?limit|\b429\b|usage limit|hit your limit|quota|insufficient|credit|exceeded/i, '额度用完了，或请求太频繁', '等额度恢复后点「重试」；也可以换一个 AI 重做。'],
    [/登录|log ?in|authenticat|api key|token expired|unauthori[sz]ed|\b401\b/i, 'AI 程序没登录或登录过期', '按下面说的重新登录一次，再点「重试」。'],
    [/requires approval|approval policy|审批|被拒|denied|not allowed/i, '工具调用被拦住了', '多半是 Zotero、下载 PDF 这类外部工具没配好：打开「AI学术环境配置」检查，再点「重试」。'],
    [/ENOTFOUND|ECONNRESET|ETIMEDOUT|network|socket hang up|timed? ?out|fetch failed|stream disconnected/i, '网络断了', '检查网络后点「重试」。'],
    [/model is not supported|model_not_found|unknown model|invalid model/i, '这个模型用不了', '换一个 AI 重做，或在 AI 程序自己的设置里换默认模型。'],
    [/没找到可用的|找不到它/, 'AI 程序找不到了', '打开「AI学术环境配置」点「重新检测」，再点「重试」。']
  ];
  // 「安装」装不进去（出错，或 AI 最后写了「装不进去：」）：复制安装指令，到 Claude Code / Codex 客户端里手动装（乔淼 10-21）
  const INSTALL_OF = { '安装我的 skills 库': 'course', '安装文献数据库检索 skills': 'search', '安装 scansci-pdf': 'scansci', '安装 pandoc': 'pandoc', '安装 Zotero 服务': 'zotero' };
  const installWhat = r => { const m = /^环境配置 · (安装[^·]+?)(?: · .*)?$/.exec(r.title || ''); return m ? INSTALL_OF[m[1].trim()] : null; };
  const stuckHTML = r => installWhat(r) && (r.status === 'failed' || /装不进去/.test(r.lastMessage || ''))
    ? `<div class="tacts"><span class="grow small muted">装不进去？打开 ${esc(engineName(r.engine))} 客户端，粘贴指令手动安装</span><button class="btn small" data-copyinst="${esc(r.id)}">复制安装指令</button></div>` : '';
  function errHTML(r) {
    const raw = String(r.error || ''), [friendly, orig] = raw.includes('\n\n原始信息：') ? raw.split('\n\n原始信息：') : r.local ? [raw, ''] : ['', raw]; // 本机任务的报错本来就是人话
    const hit = (r.local ? null : ERR_HELP.find(([re]) => re.test(raw))) || [null, r.status === 'stopped' ? '已停止' : r.local ? '没转完' : 'AI 程序报错了', r.local ? '点「重试」接着转：已经转好的会跳过，不会重转。' : '先点「重试」；同样的错再出现，换一个 AI 重做，或把下面的原文发给老师。'];
    // 自动模式里「这一段做完、下一段没开起来」：要换的是下一段的 AI，按钮叫「换 X 接着跑」，只换下一段（内容 1.3.0）
    const blocked = r.chainBlocked && r.chain, cur = blocked ? chainEngines(r)[r.chain.i] || r.engine : r.engine;
    const cands = r.local ? [] : (B.engines || []).filter(e => e.id !== cur && e.version && e.enabled && (!isFake(e.id) || B.dev));
    const other = cands.find(e => isFake(e.id) === isFake(cur)) || cands[0];
    const otherTip = r.auto && r.chain ? (blocked ? '只把下一段交给它，后面各段还用原来分好的 AI' : '只把这一段交给它重做，后面各段还用原来分好的 AI') : '';
    return `<div class="errhelp"><b>${esc(hit[1])}</b><div>${esc(friendly || hit[2])}</div></div>
      <div class="tacts"><button class="btn small" data-retry="${esc(r.id)}">${I('refresh')}重试</button>${other ? `<button class="btn small ghost" data-retry="${esc(r.id)}" data-engine="${esc(other.id)}"${otherTip ? ` title="${otherTip}"` : ''}>换 ${esc(other.name)} ${blocked ? '接着跑' : '重做'}</button>` : ''}<span class="grow"></span><button class="ib sm" data-help title="AI学术环境配置">${I('sliders')}</button></div>
      ${orig ? `<details class="errraw"><summary>原始信息</summary><div class="errbox">${esc(orig)}</div></details>` : ''}`;
  }
  // 任务的回复和按钮：右栏展开时、中间放大时共用（放大时消息在上面的对话里，这里不再重复）
  function taskActions(r, big) {
    // 只在中间「放大」时用（T5）：输入框和右栏气泡同一套——能拖文件、粘贴截图、带附件标签、放进待办
    const replyBox = (ph, quick) => `<div class="askwrap convask"><div class="atts hide"></div><div class="askbox"><textarea rows="3" data-reply-text="${esc(r.id)}" placeholder="${ph}（可以拖文件进来、粘贴截图）"></textarea><button class="send" data-reply="${esc(r.id)}" title="发出去（⌘↩）">${I('send')}</button></div>
        <div class="askfoot">${quick ? `<button class="btn small" data-quick="${esc(r.id)}">好，继续</button>` : ''}<span class="grow"></span>${quick ? `<button class="linkish" data-stop="${esc(r.id)}">结束</button>` : ''}<button class="btn small primary tdput" data-conv-todo="${esc(r.id)}" title="交给 AI 把这段话拆成几条待办（只拆、不做），放进 Dashboard 的「待办」">${I('plus')}放进待办</button></div></div>`;
    const promptLink = r.turns ? `<button class="linkish" data-prompt="${esc(r.id)}">指令</button>` : '';
    const msg = !big && r.lastMessage ? `<div class="reply-msg md">${replyHTML(r.lastMessage)}</div>` : '';
    if (r.status === 'queued') return `<div class="tacts"><span class="grow small muted">${r.waitingFor ? '等「' + esc(r.waitingFor) + '」' : ''}</span><button class="btn small" data-stop="${esc(r.id)}">取消</button></div>`;
    if (r.status === 'running' || r.status === 'stopping') return `<div class="tacts"><span class="grow small muted" data-since="${esc(r.startedAt || r.createdAt)}"></span>${promptLink}<button class="btn small" data-stop="${esc(r.id)}">${I('stop')}停止</button></div>`;
    // 右栏里不放回复框（10-18 第三轮）：回复、追问都在 Research Agent 的对话气泡里；中间「放大」的对话框照旧有回复框
    // 「安装」停下来说装不进去（10-21 Windows：AI 没写【完成】就停在「等你回复」）：也给「复制安装指令」
    if (r.status === 'waiting') return big ? `${stuckHTML(r)}${replyBox('回复', true)}${promptLink ? `<div class="tacts">${promptLink}</div>` : ''}`
      : `${msg}${(r.lastOutputs || []).length ? `<div class="outs">${r.lastOutputs.map(outLink).join('')}</div>` : ''}${stuckHTML(r)}<div class="tacts"><button class="btn small" data-quick="${esc(r.id)}">好，继续</button><button class="btn small ghost" data-askfor="${esc(r.id)}">回复</button><span class="grow"></span>${promptLink}<button class="linkish" data-stop="${esc(r.id)}">结束</button></div>`;
    if (r.local) return `${r.status === 'failed' || r.status === 'stopped' ? errHTML(r) : ''}${msg}${!big && (r.outputs || []).length ? `<div class="outs">${r.outputs.map(outLink).join('')}</div>` : ''}<div class="tacts">${promptLink}<span class="grow"></span><button class="linkish" data-clear="${esc(r.id)}" title="从列表里拿掉（记录还在）">清除</button></div>`; // 本机任务：没有追问 / 接着做
    return `${r.status === 'failed' ? errHTML(r) : ''}${msg}${['done', 'failed'].includes(r.status) ? stuckHTML(r) : ''}${!big && (r.outputs || []).length ? `<div class="outs">${r.outputs.map(outLink).join('')}</div>` : ''}${big ? replyBox(r.status === 'done' ? '追问' : '接着做', false) : ''}<div class="tacts">${big ? '' : `<button class="btn small ghost" data-askfor="${esc(r.id)}">${r.status === 'done' ? '追问' : '接着做'}</button>`}${promptLink}<span class="grow"></span><button class="linkish" data-clear="${esc(r.id)}" title="从列表里拿掉（记录还在）">清除</button></div>`;
  }
  // 放大到中间的任务（T5）：右栏这一条折起来，只写「已在中间打开」，点一下跳过去；气泡要对它说话也跳到中间
  const convTabOf = id => ui().tabs.find(t => t.conv === id);
  function goConv(id) { const t = convTabOf(id); if (!t) return false; ui().active = t.id; renderTabs(); renderPane(); setTimeout(() => { const ta = $('#pane-main .convfoot textarea'); if (ta) ta.focus(); }, 300); return true; }
  function taskHTML(r) {
    if (convTabOf(r.id)) return `<div class="task mid ${esc(r.status)}" data-mk="t:${esc(r.id)}" data-ms="${esc(r.status)}:mid"><div class="th" data-goconv="${esc(r.id)}" title="这个任务的对话在中间开着，点一下过去">${sg(r.status)}<span class="grow ellipsis">${esc(r.title)}</span><span class="st mid">已在中间打开</span></div></div>`;
    const open = S.expanded === r.id;
    let body = '';
    if (open) body = `<div class="tmeta"><span class="grow">${r.auto && r.chain ? `<span class="autotag" title="自动模式：这一阶段做完自动开下一个${r.chainLeft ? '，后面还有 ' + r.chainLeft + ' 个' : ''}${chainMulti(r) ? '。每段用的 AI：' + chainEngines(r).map((e, i) => (i + 1) + ' ' + esc(engineName(e))).join('，') : ''}">自动 ${r.chain.i}/${r.chain.n}</span>` : ''}${r.local ? '本机 · 不经过 AI' : esc(engineName(r.engine))}${r.model ? ' · ' + esc(r.model) : ''}${r.turns > 1 ? ' · 第 ' + r.turns + ' 轮' : ''} · ${esc(when(r.createdAt))}</span>${r.turns ? `<button class="ib sm" data-conv="${esc(r.id)}" title="放大">${I('expand')}</button>` : ''}</div>` + taskActions(r, false);
    // 右边：做完显示时间；在跑显示已用时；其余显示状态字
    const right = ['done', 'stopped'].includes(r.status) ? `<span class="t">${esc(when(r.endedAt || r.createdAt))}</span>`
      : r.status === 'running' && !open ? `<span class="st running" data-since-short="${esc(r.startedAt || r.createdAt)}"></span>`
      : `<span class="st ${esc(r.status)}">${ST[r.status] || r.status}</span>`;
    return `<div class="task ${open ? 'open' : ''} ${esc(r.status)}" data-mk="t:${esc(r.id)}" data-ms="${esc(r.status)}"><div class="th" data-expand="${esc(r.id)}">${sg(r.status)}<span class="grow ellipsis" title="${esc(r.title)}">${esc(r.title)}</span>${r.auto && r.chain ? `<span class="autotag sm"${chainMulti(r) ? ` title="这一段交给 ${esc(engineName(r.engine))}"` : ''}>${r.chain.i}/${r.chain.n}${chainMulti(r) ? ' · ' + esc(engineName(r.engine)) : ''}</span>` : ''}${right}</div>${open ? `<div class="tb">${body}</div>` : ''}</div>`;
  }
  const sinceShort = iso => { const s = Math.max(0, Math.round((Date.now() - new Date(iso)) / 1000)); return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); };
  // ---------- 右栏顶部：这个项目的 AI（星芒标记 + 名字 + 一句当前状态 + AI 程序 · 模型）。句子只由真实状态拼出来 ----------
  const MARK = (st, cls = '') => `<span class="mark ${cls}" data-state="${st}"><i class="halo"></i><i class="star"></i><span class="orbit"><i></i></span><svg class="ov" viewBox="0 0 40 40"><path class="pen" d="M12 23c3-5 5-5 8 0s5 5 8 0"/><path class="chk" d="M12.5 20.5l5 5 10-11"/><path class="err" d="M20 13v8M20 26.5v.2"/></svg></span>`;
  const modelOf = p => { const e = (B.engines || []).find(x => x.id === p.engine) || {}; return p.model || e.model || (e.defaults || {}).model || ''; };
  function agentState(p) {
    const e = (B.engines || []).find(x => x.id === p.engine);
    if (e && e.checking) return { st: 'idle', say: `正在找 ${e.name}…`, cls: '' };
    if (e && !e.version) return { st: 'error', say: `没找到 ${e.name}`, cls: 'bad', tip: e.missingHint || '' };
    const runs = [...(S.runs || [])].sort((x, y) => y.createdAt.localeCompare(x.createdAt)), of = s => runs.filter(r => s.includes(r.status));
    const w = of(['waiting']), go = of(['running', 'stopping']), q = of(['queued']);
    if (w.length) return { st: 'wait', say: (w.length > 1 ? `有 ${w.length} 件事要你定` : '有件事要你定') + ' · ' + w[0].title, cls: 'warn' };
    if (go.length) {
      const st = (go[0].steps || []), cur = [...st].reverse().find(s => s.status === 'running') || st[st.length - 1];
      const more = (go.length > 1 ? ` · 同时在做 ${go.length} 个` : '') + (q.length ? ` · 后面还排着 ${q.length} 个` : '');
      return { st: cur && cur.status === 'running' && cur.kind === 'write' ? 'write' : 'think', say: (!cur ? `在做 ${go[0].title}` : cur.status === 'running' ? `在${cur.label} ${cur.target}` : /^(读|写|改|用|查|运行|取|找|搜|转)$/.test(cur.label) ? `刚${cur.label}完 ${cur.target}` : `${cur.label} ${cur.target}`) + more, run: go[0] };
    }
    if (q.length) return { st: 'queued', say: `排着 ${q.length} 个任务，马上开始` };
    const last = runs[0];
    if (last && last.status === 'failed') { const hit = ERR_HELP.find(([re]) => re.test(String(last.error || ''))); return { st: 'error', say: `${last.title} 没做完` + (hit ? ' · ' + hit[1] : ''), cls: 'bad' }; }
    if (last && last.status === 'done' && Date.now() - new Date(last.endedAt || last.createdAt) < 30 * 60e3) {
      const n = (last.outputs || []).length; return { st: 'done', say: (n ? `写好了 ${n} 个文件` : '做完了') + ' · ' + last.title };
    }
    return { st: 'idle', say: '随时可以开始。' };
  }
  const STEP_IC = { read: 'doc', write: 'write-paper', run: 'sliders', web: 'search', skill: 'skill-shop', agent: 'chat', mcp: 'clip', deny: 'stop', tool: 'grid' };
  function feedHTML(run) {
    const steps = (run && run.steps) || []; if (!steps.length && !(run && run.todo)) return '';
    const shown = steps.slice(-4);
    const todo = run.todo && run.todo.total ? `<div class="todo" title="${run.local ? '转了几篇 / 共几篇' : 'AI 自己列的待办'}"><span>${run.local ? '进度' : '待办'}</span><span class="segs">${Array.from({ length: run.todo.total }, (_, i) => `<i class="${i < run.todo.done ? 'd' : ''}"></i>`).join('')}</span><span>${run.todo.done} / ${run.todo.total}</span></div>` : '';
    return todo + `<ul class="feed">${shown.map((s, i) => `<li class="${s.status} ${i < shown.length - 2 ? 'old' : ''}" data-mk="s:${esc(s.id)}" data-ms="${esc(s.status)}" ${s.path ? `data-path="${esc(s.path)}"` : ''} title="${esc(s.label + ' ' + s.target)}"><span class="ic">${I(STEP_IC[s.kind] || 'grid')}</span><span class="tx">${esc(s.label)} <code>${esc(s.target)}</code></span>${s.status === 'done' ? '<svg class="ok" viewBox="0 0 14 14"><path d="M3 7.3l2.6 2.6L11 4.4"/></svg>' : s.status === 'failed' ? '<span class="no">!</span>' : ''}</li>`).join('')}</ul>`;
  }
  // 5 小时额度：这个 AI 程序最近一次报的（Claude Code 跑任务时报；Codex 读本机会话记录）。过了重置时间就不显示
  function quotaHTML(engine, run) {
    const q = (run && run.quota) || (B.quota || {})[engine];
    if (!q || (q.resetsAt && q.resetsAt < Date.now())) return '';
    const at = q.resetsAt ? new Date(q.resetsAt).toTimeString().slice(0, 5) : '';
    const hot = q.status !== 'ok' || (q.pct != null && q.pct >= 80);
    const txt = q.pct != null ? `${q.pct}%${at ? ' · ' + at + ' 重置' : ''}` : q.status === 'limit' ? `用完了${at ? ' · ' + at + ' 恢复' : ''}` : q.status === 'warn' ? `快用完了${at ? ' · ' + at + ' 重置' : ''}` : `正常${at ? ' · ' + at + ' 重置' : ''}`;
    const ago = q.at ? Math.round((Date.now() - q.at) / 60e3) : 0;
    return `<div class="quota ${hot ? 'hot' : ''}" title="${ago > 1 ? ago + ' 分钟前读到的' : '刚读到的'}"><span>5 小时额度</span>${q.pct != null ? `<span class="qbar"><i style="width:${Math.min(100, q.pct)}%"></i></span>` : '<span class="grow"></span>'}<span>${esc(txt)}</span></div>`;
  }
  // 等你回复：从 AI 最后那段话里摘出问它的部分（最后一个带问号的段落起），编号选项做成快捷回答
  function questionOf(text) {
    const paras = String(text || '').replace(/【等你回复】\s*$/, '').trim().split(/\n\s*\n/).map(s => s.trim()).filter(Boolean);
    let i = paras.length - 1;
    for (let k = paras.length - 1; k >= Math.max(0, paras.length - 4); k--) if (/[？?]/.test(paras[k])) { i = k; break; }
    const q = paras.slice(Math.max(0, i)).join('\n');
    const opts = [...q.matchAll(/^\s*(?:[-*]\s*)?(?:([0-9A-D])[.)、．）]|（([0-9一二三四])）)\s*(.+)$/gm)].map(m => ({ key: m[1] || m[2], text: m[3].replace(/[*`#]/g, '').trim() })).slice(0, 4);
    return { q: q.replace(/[*`#>]/g, '').replace(/\|/g, ' ').trim(), opts };
  }
  function questionHTML(run) {
    if (!run || (run.auto && !run.autoGaveUp)) return ''; // 自动模式里的问题工作站会替你回
    const { q, opts } = questionOf(run.lastMessage);
    if (!q) return '';
    const btns = opts.length ? opts.map(o => `<button class="chip" data-qreply="${esc(run.id)}" data-text="${esc('选 ' + o.key + '：' + o.text)}" title="${esc(o.text)}">${esc(o.key)}. ${esc(o.text.length > 14 ? o.text.slice(0, 14) + '…' : o.text)}</button>`).join('')
      : `<button class="chip" data-quick="${esc(run.id)}">好，继续</button>`;
    return `<div class="qcard"><div class="qtx" title="${esc(q)}">${esc(q)}</div><div class="qacts">${btns}<span class="grow"></span><button class="linkish" data-qopen="${esc(run.id)}">回复…</button></div></div>`;
  }
  // 做完：产出一张张落下，几秒后收起（S.deliver 由轮询在任务刚变成「完成」时设）
  function deliverHTML() {
    const d = S.deliver; if (!d || Date.now() > d.until) return '';
    const r = (S.runs || []).find(x => x.id === d.id); if (!r || r.status !== 'done') return '';
    const files = (r.lastOutputs && r.lastOutputs.length ? r.lastOutputs : r.outputs || []).filter(f => !/^\.工作站\//.test(f));
    if (!files.length) return '';
    return `<div class="dlv">${files.slice(0, 5).map((f, i) => `<div class="dcard" data-file="${esc(f)}" style="animation-delay:${i * 70}ms" title="${esc(f)}">${fileIcon(kindOf(f))}<span class="nm">${esc(f.split('/').pop())}</span><span class="sub">${esc(f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '')}</span></div>`).join('')}${files.length > 5 ? `<div class="dmore">还有 ${files.length - 5} 个</div>` : ''}</div>`;
  }
  function renderAgent() {
    const box = $('#r-agent'), p = proj();
    if (!box) return;
    if (!p || !p.exists) { put(box, ''); return; }
    const a = agentState(p), e = (B.engines || []).find(x => x.id === p.engine), m = modelOf(p);
    // 骨架只在名字变了才重写；标记、句子、动作流各自一块，互不连累（标记重写会让旋转从头开始）
    put(box, `<div class="agent"><div class="ahd"><span class="ag-mk"></span><div class="who"><div class="anm">${esc(B.agentName || 'Research Agent')}</div><div class="ag-say"></div></div><button class="abub" data-askopen title="跟 ${esc(B.agentName || 'Research Agent')} 说">${I('chat')}</button></div><div class="ag-meta"></div><div class="ag-feed"></div><div class="ag-ask"></div></div>`);
    put(box.querySelector('.ag-mk'), MARK(a.st));
    put(box.querySelector('.ag-say'), `<div class="say ${a.cls || ''}" data-mk="say" data-ms="${esc(a.say)}" title="${esc(a.tip || a.say)}">${esc(a.say)}</div>`);
    put(box.querySelector('.ag-meta'), `<div class="ameta"><button class="engpick" data-engpick title="这个项目用哪个 AI 程序、哪个模型">${esc(e ? e.name : p.engine)} · ${esc(m || '默认')} ▾</button>${p.engineWas ? `<span class="small muted" title="这个项目原来选的 AI 程序在「AI学术环境配置」里停用了">原来用 ${esc(engineName(p.engineWas))}，已停用</span>` : ''}</div>${quotaHTML(p.engine, a.run)}`);
    const waitRun = a.st === 'wait' ? [...(S.runs || [])].filter(r => r.status === 'waiting').sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0] : null;
    // 自动模式：第几段 / 共几段的分段条；工作站替你回了一次问题，闪一行字
    const ar = [...(S.runs || [])].filter(r => r.auto && r.chain && ['running', 'stopping', 'waiting', 'queued'].includes(r.status)).sort((x, y) => y.createdAt.localeCompare(x.createdAt))[0];
    // 每一格悬停：第几段、用哪个 AI；整条用了不止一个 AI 时，下面一行写「这一段 / 下一段」交给谁（内容 1.3.0）
    const ce = ar ? chainEngines(ar) : [], nextE = ar && ce[ar.chain.i];
    const seg = ar ? `<div class="chainbar" title="自动跑完：第 ${ar.chain.i} / ${ar.chain.n} 段">${Array.from({ length: ar.chain.n }, (_, i) => `<i class="${i + 1 < ar.chain.i ? 'done' : i + 1 === ar.chain.i ? 'now' : ''}" title="第 ${i + 1} 段 · ${esc(engineName(ce[i]))}"></i>`).join('')}</div>`
      + (chainMulti(ar) ? `<div class="chainwho small muted">这一段：${esc(engineName(ar.engine))}${nextE ? ' · 下一段：' + esc(engineName(nextE)) : ''}</div>` : '') : '';
    if (ar) {
      const k = ar.id + ':' + (ar.autoReplies || 0), was = S.autoRepSeen; S.autoRepSeen = k;
      // 同一段回答次数变多了；或者刚开的一段第一次看到时就已经替你回过（问和回都在两次轮询之间）
      const fresh = (!was || was.split(':')[0] !== ar.id) && (ar.autoReplies || 0) > 0 && Date.now() - new Date(ar.createdAt) < 15000;
      if ((was && was.split(':')[0] === ar.id && was !== k) || fresh) { S.flashUntil = Date.now() + 2600; setTimeout(renderAgent, 2700); }
    }
    const flash = S.flashUntil && Date.now() < S.flashUntil ? '<div class="aflash">我替你回了：按我的判断继续，决定都记在这一段末尾</div>' : '';
    const body = a.run ? feedHTML(a.run) : waitRun ? questionHTML(waitRun) : deliverHTML() || suggestHTML(suggest(p));
    put(box.querySelector('.ag-feed'), seg + flash + body);
    // 记下最近写过的文件：任务刚结束、动作流已经收起时，新文件从标记飞进文件栏
    if (a.run) S.lastWrites = new Set((a.run.steps || []).filter(s => s.kind === 'write' && s.path).map(s => s.path));
    fx(box, p.id);
    drawAsk();
  }
  // ---------- 收件箱一键梳理（10-18 第三轮）：AI 看一遍写计划 → 你在「梳理计划」里改、点「照这样做」→ 工作站搬文件、排后续工具，可撤销 ----------
  const inboxProj = () => (B.projects || []).find(p => p.inbox);
  async function loadPlan() { try { S.plan = await api('inbox/plan', 'GET'); } catch { S.plan = null; } loadTodos(); renderAgent(); if (curTab() && (curTab().triage || onDash())) renderPane(); }
  async function startTriage(from) {
    const ib = inboxProj(); if (!ib) return;
    if (B.current !== ib.id && !(await switchProject(ib.id))) return;
    try {
      askNotify(); const r = await api('inbox/triage', 'POST', {});
      if (from) requestAnimationFrame(() => fly(from, $('#r-agent .ag-mk')));
      toast(r.status === 'queued' ? '已排队：梳理收件箱' : `已交给 ${engineName(r.engine)}：梳理收件箱`); S.expanded = r.id; loadRuns(); refreshProjects(); poll();
    } catch (e) { toast(e.message); }
  }
  // 「去哪个文件夹」的选项跟着选的项目变（内容 1.3.2）：这个项目现有的文件夹，论文项目再加「文件放哪」那几个
  function folderOpts(pid, cur) {
    const d = S.plan || {}, p = (d.projects || []).find(q => q.id === pid);
    const list = [...new Set([...(p && p.folders ? p.folders : d.folders || []), cur].filter(Boolean))];
    return `<option value="">项目根目录</option>${list.map(f => `<option ${f === cur ? 'selected' : ''}>${esc(f)}</option>`).join('')}`;
  }
  // 梳理出来的要做的事：内容 1.3.3 起统一放「待办」（todos.cjs；1.4.1 起在 Dashboard），这里只说一句
  function todoHTML(pl) {
    const n = (pl.todos || []).length; if (!n) return '';
    return `<div class="trih"><span class="muted small">还理出 ${n} 件要做的事，放在 Dashboard 的「待办」里${pl.applied ? '' : '；相关文件要先「照这样做」放好才能开始'}。</span></div>`;
  }
  const TRASH = navigator.platform.startsWith('Win') ? '回收站' : '废纸篓', NOFOLDER = ['keep', 'archive', 'trash'];
  function triageHTML() {
    const d = S.plan, pl = d && d.plan, ib = inboxProj();
    const head = `<div class="phead"><h1>梳理计划</h1></div>`;
    const undo = d && d.canUndo ? `<button class="btn ghost small" data-tri-undo>撤销上次梳理</button>` : '';
    const res = S.triResult ? `<div class="trires">${S.triResult}</div>` : '';
    if (!pl || !pl.items.length) return `<div class="page">${head}${res}<div class="trifoot">${ib && ib.inboxNew ? `<button class="btn" data-triage>${I('wand')}一键梳理（${ib.inboxNew} 个新文件）</button>` : ''}${undo}</div></div>`;
    const ps = d.projects || [], news = [...new Set(pl.items.map(x => x.project).filter(v => v.startsWith('new:')))];
    const rows = pl.items.map((x, i) => {
      const opt = (v, l) => `<option value="${esc(v)}" ${x.project === v ? 'selected' : ''}>${esc(l)}</option>`;
      // 不用了（内容 1.3.10）：归档到 收件箱/已归档/（以后不再梳理），或移进废纸篓；都能「撤销上次梳理」
      const tgt = `<select data-tri-proj ${x.exists && !pl.applied ? '' : 'disabled'}>${opt('keep', '留在收件箱')}${ps.map(p => opt(p.id, p.name)).join('')}${news.map(v => opt(v, '新建项目「' + v.slice(4) + '」')).join('')}<option disabled>──────</option>${opt('archive', '不用了 · 归档')}${opt('trash', '不用了 · 移进' + TRASH)}</select>`;
      const fol = `<select data-tri-folder ${x.exists && !pl.applied && !NOFOLDER.includes(x.project) ? '' : 'disabled'}>${folderOpts(x.project, x.folder)}</select>`;
      // 「PDF 入库」只给 PDF / epub：用 Zotero 服务入库，分类名 = 项目名，留在收件箱的进「收件箱」分类（10-23）
      const fl = !/\.(pdf|epub)$/i.test(x.file) ? '' : Object.entries(d.follow || {}).map(([k, l]) => `<label class="tfl" title="用 Zotero 服务入库，放进和项目同名的分类；留在收件箱的放进「收件箱」分类"><input type="checkbox" data-tri-follow value="${esc(k)}" ${x.follow.includes(k) ? 'checked' : ''} ${x.exists && !pl.applied ? '' : 'disabled'}>${esc(l)}</label>`).join('');
      return `<div class="tri ${x.exists ? '' : 'gone'}" data-tri="${i}" data-name="${esc(x.file)}"><div class="tr1">${fileIcon(kindOf(x.file))}<b class="ellipsis" title="${esc(x.file)}">${esc(x.file)}</b>${x.kind ? `<span class="chip">${esc(x.kind)}</span>` : ''}${x.exists ? '' : '<span class="chip">已不在收件箱</span>'}</div>
        <div class="tr2"><span class="lab">去</span>${tgt}${fol}<span class="grow"></span>${fl}</div>${x.reason ? `<div class="tr3">${esc(x.reason)}</div>` : ''}</div>`;
    }).join('');
    const foot = pl.applied ? `<div class="trifoot"><span class="muted small">这份计划已经执行过了。</span>${undo}${ib && ib.inboxNew ? `<button class="btn" data-triage>${I('wand')}再梳理一次（${ib.inboxNew} 个新文件）</button>` : ''}</div>`
      : `<div class="trifoot"><button class="btn" data-tri-apply>照这样做</button>${undo}<span class="muted small" title="比如：第 3 个是导师的批注，放进投稿测试">不满意就点右边的对话气泡跟 ${esc(B.agentName || 'Research Agent')} 说</span></div>`;
    return `<div class="page">${head}${res}<div class="tris">${rows}</div>${foot}${todoHTML(pl)}</div>`;
  }
  async function applyTriage() {
    const items = [...document.querySelectorAll('#pane-main .tri')].filter(r => !r.classList.contains('gone')).map(r => ({
      file: r.dataset.name, project: r.querySelector('[data-tri-proj]').value, folder: r.querySelector('[data-tri-folder]').value,
      follow: [...r.querySelectorAll('[data-tri-follow]:checked')].map(c => c.value) }));
    try {
      const r = await api('inbox/apply', 'POST', { items }); Object.assign(B, r.config);
      S.triResult = [r.moved.length ? `移走了 ${r.moved.length} 个：${r.moved.map(m => esc(m.to)).join('、')}` : '', r.kept.length ? `留在收件箱 ${r.kept.length} 个` : '', (r.archived || []).length ? `归档了 ${r.archived.length} 个（在收件箱的「已归档」文件夹里，以后梳理不再看）` : '', (r.trashed || []).length ? `移进${r.trashName} ${r.trashed.length} 个${r.trashUndo ? '' : `（要找回去${r.trashName}里还原）`}` : '', r.queued.length ? `排上了后续动作：${r.queued.map(esc).join('、')}` : '', r.errors.length ? `<span class="bad">没做成：${r.errors.map(esc).join('；')}</span>` : ''].filter(Boolean).join('<br>');
      toast(`梳理好了：移走 ${r.moved.length} 个${(r.archived || []).length ? `，归档 ${r.archived.length} 个` : ''}${(r.trashed || []).length ? `，移进${r.trashName} ${r.trashed.length} 个` : ''}${r.queued.length ? '，排了 ' + r.queued.length + ' 个后续任务' : ''}`);
      renderAll(); loadFiles(); await loadPlan(); poll();
    } catch (e) { toast(e.message); }
  }
  async function undoTriage() {
    try { const r = await api('inbox/undo', 'POST', {}); Object.assign(B, r.config); S.triResult = `撤销了：${r.back.length} 个文件回到收件箱${r.errors.length ? `<br><span class="bad">${r.errors.map(esc).join('；')}</span>` : ''}`; toast(`撤销了 ${r.back.length} 个`); renderAll(); loadFiles(); await loadPlan(); }
    catch (e) { toast(e.message); }
  }
  // ---------- 下一步建议（10-18 第三轮）：只按真实状态和规则算，不让 AI 猜；点了按钮才动 AI ----------
  const DISMISS = (() => { try { return JSON.parse(localStorage.getItem('aiws:dismiss') || '{}'); } catch { return {}; } })();
  const today = () => new Date().toISOString().slice(0, 10);
  function suggest(p) {
    if (!p || !p.exists) return null;
    const runs = [...(S.runs || [])].sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    if (runs.some(r => ['running', 'stopping', 'queued', 'waiting'].includes(r.status))) return null;
    if (p.inbox) { // 收件箱：有没执行的梳理计划 → 去看；有新文件 → 一键梳理
      const pl = S.plan && S.plan.plan, n = pl && !pl.applied ? pl.items.filter(x => x.exists).length : 0;
      const s = n ? { key: 'plan:' + pl.at, text: `梳理计划好了：${n} 个文件，每个都写了放哪、为什么${pl.todos && pl.todos.length ? `；还理出 ${pl.todos.length} 件要做的事` : ''}。`, btn: '查看并执行', act: { type: 'plan' } }
        : p.inboxNew ? { key: 'triage:' + p.inboxNew, text: `收件箱里有 ${p.inboxNew} 个新文件，要我看一遍、给出每个放哪吗？`, btn: '一键梳理', act: { type: 'triage' } } : null;
      return s && !DISMISS[p.id + ':' + s.key] ? s : null;
    }
    const files = (S.files || []).map(f => f.path), has = re => files.some(f => re.test(f));
    const wfs = p.workflows || [], last = (p.activity || [])[0];
    const wfName = id => ((B.workflows || []).find(w => w.id === id) || {}).name || id;
    let s = null;
    if (last && last.status === 'failed' && runs[0] && runs[0].status === 'failed') s = { key: 'retry:' + runs[0].id, text: `「${runs[0].title}」没做完，要再试一次吗？`, btn: '重试', act: { type: 'retry', id: runs[0].id } };
    // 刚做完的任务下好了 PDF（文献搜索、PDF 入库、取全文……），装了 MinerU 的提醒转成全文（内容 1.2.5，乔淼 10-24；只提醒，不自动转）
    if (!s && B.mineru && runs[0] && runs[0].status === 'done' && !runs[0].local) {
      const stem = f => f.split('/').pop().replace(/\.pdf$/i, ''), done = new Set(files.filter(f => /^文献\/全文\/[^/]+\.md$/.test(f)).map(f => f.split('/').pop().replace(/\.md$/, '')));
      const fresh = (runs[0].outputs || []).filter(f => /^文献\/PDF\/[^/]+\.pdf$/i.test(f) && !done.has(stem(f)));
      if (fresh.length) s = { key: 'mineru:' + runs[0].id, text: `刚下好的 ${fresh.length} 篇 PDF 还没转成全文。用 MinerU 转一下，以后读这几篇更准、更省额度。`, btn: '用 MinerU 转', act: { type: 'tool', id: 'mineru' } };
    }
    if (p.kind && p.kind !== 'paper') { // 学员交付 / 公众号 / 备课 / 通用（内容 1.3.5）：各用一套，不推论文
      if (!s) s = kindSuggest(p);
      return s && !DISMISS[p.id + ':' + s.key] ? s : null;
    }
    const w = !s && (wfs.find(x => last && x.id === last.workflow) || wfs.find(x => x.done > 0));
    if (!s && w) {
      const i = w.stages.findIndex(st => !st.done);
      if (i >= 0) s = { key: 'next:' + w.id + ':' + i, text: `${w.name}的下一步是「${w.stages[i].name}」。`, btn: '去做', act: { type: 'go', wf: w.id, stage: i } };
      else if (w.id === 'paper' || w.id === 'review-article') {
        const base = w.id === 'paper' ? '写作/全文初稿.md' : '写作/综述文章初稿.md';
        s = { key: 'diag:' + w.id, text: `${w.name}的 ${w.total} 个阶段都做完了。${w.id === 'paper' ? '全文初稿' : '综述文章初稿'}有了，下一步可以做投稿前的初稿诊断。`, btn: '开始诊断', act: { type: 'go', wf: 'submission', stage: 0, preset: { 'd-base': base }, run: true } };
      } else if (w.id === 'submission') s = { key: 'ledger', text: '投稿包好了。收到审稿意见后，用「审稿意见台账」逐条拆开。', btn: '打开审稿意见台账', act: { type: 'tool', id: 'review-ledger' } };
    }
    if (!s && !wfs.length) {
      if (has(/(^|\/)(文献清单|参考文献|references?)[^/]*\.(md|txt|csv|bib|ris)$/i)) s = { key: 'verify', text: '项目里有文献清单，可以先验真，再取 PDF 入库。', btn: '打开文献验真', act: { type: 'tool', id: 'verify' } };
      else if (has(/^(写作|05_全文初稿)\/[^/]+\.(md|docx?)$/i)) s = { key: 'diag0', text: `项目里有稿子了，可以用「${wfName('submission')}」先做一次初稿诊断。`, btn: '去初稿诊断', act: { type: 'go', wf: 'submission', stage: 0 } };
      else s = { key: 'start', text: `从选题开始：「${wfName('paper')}」第一步。`, btn: '去选题', act: { type: 'go', wf: 'paper', stage: 0 } };
    }
    // 框架里没有课程的工作流和工具：建议要打开的那个不在，就不提
    if (s && s.act && ((s.act.type === 'tool' && !toolOf(s.act.id)) || (s.act.type === 'go' && !(B.workflows || []).some(w => w.id === s.act.wf)))) s = null;
    if (s && DISMISS[p.id + ':' + s.key]) return null;
    return s;
  }
  // 按项目类型的建议（内容 1.3.5，方案 设计/下一步建议-按项目类型-方案.md）：线索由运行时数好（suggest/facts），这里挑第一条
  // 没在待办里、没点过「不用了」的；按钮打开对应的「我的工具」并填好学员、文件（这台电脑上没有那个工具就不出）
  async function loadFacts() { const p = proj(); if (!p || p.inbox || !p.kind || p.kind === 'paper') return; try { (S.facts = S.facts || {})[p.id] = await api('suggest/facts', 'GET', { project: p.id }); renderAgent(); } catch {} }
  function kindSuggest(p) {
    const facts = ((S.facts || {})[p.id] || {}).items || [], tools = id => !!toolOf(id);
    const inTodo = f => ((S.todos || {}).items || []).some(t => t.status !== 'done' && (t.files || []).some(x => x === f || x.endsWith('/' + f.split('/').pop())));
    const ok = s => s && !DISMISS[p.id + ':' + s.key];
    const base = f => f.split('/').pop();
    for (const x of facts) {
      let s = null;
      if (x.type === 'transcript' && tools('miao-1v1')) s = { key: 'tr:' + x.file, text: `${x.student} 的 1v1 逐字稿还没整理：${base(x.file)}。`, btn: '整理', act: { type: 'tool', id: 'miao-1v1', vals: { student: x.student }, pins: [x.file] } };
      else if (x.type === 'newdoc' && tools('miao-rp')) s = { key: 'doc:' + x.file, text: `${x.student} 文件夹里来了新稿子：${base(x.file)}。`, btn: '批注', act: { type: 'tool', id: 'miao-rp', vals: { student: x.student }, pins: [x.file] },
        ...(tools('miao-presub') ? { alt: { btn: 'Pre-submission review', act: { type: 'tool', id: 'miao-presub', vals: { student: x.student }, pins: [x.file] } } } : {}) };
      else if (x.type === 'gzhdata' && tools('miao-fupan')) s = { key: 'gzhdata:' + x.n, text: `数据表现里有 ${x.n} 份新的发布数据，可以复盘了。`, btn: '复盘', act: { type: 'tool', id: 'miao-fupan' } };
      else if (x.type === 'gzhtranscript' && tools('miao-gzh')) s = { key: 'gzhtr:' + x.name, text: `有一份新的直播转录稿还没写过公众号：${x.name}。`, btn: '写成公众号', act: { type: 'tool', id: 'miao-gzh', pins: [x.file] } };
      else if (x.type === 'kefupan' && tools('miao-kefupan')) s = { key: 'kfp:' + x.file, text: `${x.where} 的逐字稿到了，还没复盘。`, btn: '课后复盘', act: { type: 'tool', id: 'miao-kefupan', vals: { which: x.where }, pins: [x.file] } };
      if (ok(s) && !(x.file && inTodo(x.file))) return s;
    }
    if (p.kind === 'gzh' && (B.workflows || []).some(w => w.id === 'content-engine')) { // 都没有：要出一篇吗（按周提醒）
      const wk = Math.floor((Date.now() - new Date(2026, 0, 5)) / (7 * 864e5)), s = { key: 'gzhweek:' + wk, text: '这周要出一篇公众号吗？', btn: '打开公众号出品', act: { type: 'go', wf: 'content-engine', stage: 0 } };
      if (ok(s)) return s;
    }
    if (p.kind === 'general') { // 通用：这个项目在待办里还有没开始的事
      const left = ((S.todos || {}).items || []).filter(t => t.project === p.id && t.status === 'todo');
      if (left.length) return { key: 'todo:' + left[0].id, text: `待办里还有 ${left.length} 件：${left[0].title}`, btn: '开始', act: { type: 'todo', id: left[0].id } };
    }
    return null;
  }
  const suggestHTML = (s, cls = '') => s ? `<div class="sugg ${cls}"><span class="stx">${esc(s.text)}</span><span class="sacts"><button class="btn small" data-sugg-go>${esc(s.btn)}</button>${s.alt ? `<button class="btn small ghost" data-sugg-alt>${esc(s.alt.btn)}</button>` : ''}${s.act ? `<button class="btn small ghost" data-sugg-todo title="先不做，放进 Dashboard 的「待办」，想做的时候点「开始」">放进待办</button>` : ''}<button class="linkish" data-sugg-x="${esc(s.key)}">不用了</button></span></div>` : '';
  const postGo = (fr, g) => { try { fr.contentWindow.postMessage({ __aiws: 1, type: 'go', stage: g.stage, preset: g.preset || null, nonce: g.nonce || '' }, wfOrigin(g.wf)); } catch {} };
  async function runSuggest(from) {
    const p = proj(), s = suggest(p); if (!s) return;
    return runAct(s.act, from);
  }
  // 建议放进待办（内容 1.3.4）：存建议的动作，「开始」时照原样做；放进去了这条建议就不再提
  async function suggestToTodo() {
    const p = proj(), s = suggest(p); if (!p || !s) return;
    try { S.todos = await api('todos/add', 'POST', { title: s.text, project: p.id, act: s.act }); dismissSuggest(s.key); renderTodos(); toast('放进 Dashboard 的待办了，想做的时候点「开始」'); }
    catch (err) { toast(err.message); }
  }
  // 建议的动作：重试、打开工具、梳理收件箱、看梳理计划、打开工作流那一阶段（可直接执行）
  async function runAct(a, from) {
    if (a.type === 'retry') { try { const r = await api(`runs/${a.id}/retry`, 'POST', {}); toast(r.status === 'queued' ? '已排队' : `已交给 ${engineName(r.engine)}`); afterTask(); } catch (err) { toast(err.message); } return; }
    if (a.type === 'tool') { // 可以带预填（学员、文件）：已经开着这个工具页就把值填进去
      const u = ui(), old = u.tabs.find(x => x.id === 'tool:' + a.id);
      if (old && (a.vals || a.pins)) { old.vals = { ...(old.vals || {}), ...(a.vals || {}) }; if (a.pins) old.pins = a.pins; $('#pane-main').__html = null; }
      return openTab(old || { id: 'tool:' + a.id, tool: a.id, ...(a.vals ? { vals: { ...a.vals } } : {}), ...(a.pins ? { pins: [...a.pins] } : {}) });
    }
    if (a.type === 'todo') return startTodo(a.id, from);
    if (a.type === 'triage') return startTriage(from);
    if (a.type === 'plan') { await loadPlan(); return openTab({ id: 'triage', triage: true }); }
    // 工作流：打开它，跳到那一阶段；直接执行的带一个一次性 nonce（工作站只认自己刚发的这个）
    const g = { wf: a.wf, stage: a.stage, preset: a.preset, nonce: a.run ? Math.random().toString(36).slice(2) + Date.now().toString(36) : '' };
    if (g.nonce) { S.goNonce = { n: g.nonce, wf: a.wf, at: Date.now() }; if (from) requestAnimationFrame(() => fly(from, $('#r-agent .ag-mk'))); }
    const fr = [...document.querySelectorAll('iframe.wfview')].find(f => f.dataset.wf === a.wf && f.dataset.proj === B.current);
    openTab({ id: 'wf:' + a.wf, wf: a.wf });
    if (fr) postGo(fr, g); else S.pendingGo = g; // 框还没载入：等它说 ready 再发
  }
  // 「不用了」「放进待办」：这条建议以后都不再提（内容 1.3.4，乔淼 10-26；以前只当天不提）。记的值是哪天点的，有记录就不提
  function dismissSuggest(key) { const p = proj(); if (!p) return; DISMISS[p.id + ':' + key] = today(); try { localStorage.setItem('aiws:dismiss', JSON.stringify(DISMISS)); } catch {} renderAgent(); renderPane(); }
  // ---------- 对话气泡（10-18 第三轮，取代右栏底部常驻的「跟 AI 说」）：任何时候只有这一个地方跟 AI 说话 ----------
  // 有任务在等你回复 → 回复它；指定了某个任务（点了「回复 / 追问 / 接着做」）→ 对它说；刚做完一个 → 可以接着它说或开新任务；否则开新任务
  function askMode() {
    const runs = [...(S.runs || [])].sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    const tgt = S.askTarget && runs.find(r => r.id === S.askTarget);
    if (tgt && tgt.status === 'waiting') return { kind: 'reply', run: tgt };
    const w = runs.find(r => r.status === 'waiting'); if (w && !tgt) return { kind: 'reply', run: w };
    const busy = runs.some(r => ['running', 'stopping', 'queued', 'waiting'].includes(r.status));
    if (tgt && ['done', 'failed', 'stopped'].includes(tgt.status)) return { kind: 'new', follow: busy ? null : tgt, forced: true };
    const last = runs.find(r => ['done', 'failed', 'stopped'].includes(r.status) && r.sessionId);
    return { kind: 'new', follow: !busy && last && Date.now() - new Date(last.endedAt || last.createdAt) < 2 * 3600e3 ? last : null };
  }
  function openAsk(target) {
    if (target && goConv(target)) return; // 这个任务在中间开着：到中间的回复框说
    S.askOpen = true; S.askTarget = target || null; S.askSig = null;
    if (target) { const m = askMode(); S.amode = m.follow && m.follow.id === target ? 'follow' : S.amode; }
    drawAsk(); const ta = $('#askText'); if (ta) ta.focus();
  }
  function closeAsk() { S.askOpen = false; S.askTarget = null; S.amode = 'new'; S.askSig = null; S.attach = []; drawAsk(); }
  // ---------- 气泡里的附件（内容 1.3.5，乔淼 10-26）：拖文件进来、粘贴截图。App 里拖进来的用原位置；拿不到位置的存进项目「附件/」 ----------
  // 发出去时在指令末尾列出完整路径，AI 自己打开（Claude Code、Codex 都能直接看图片）
  // 中间「放大」的对话框也能放附件（内容 1.4.1，T5）：host 是 'right'（右栏气泡）或任务 id（中间那个任务的回复框）
  const attList = (host = 'right') => host === 'right' ? (S.attach = S.attach || []) : ((S.convAtt = S.convAtt || {})[host] = S.convAtt[host] || []);
  const attachNote = (host = 'right') => attList(host).length ? `\n\n附件（先打开看这些文件；图片直接看图）：\n${attList(host).map(a => '- ' + a.path).join('\n')}` : '';
  function drawAtts(host = 'right') {
    const box = host === 'right' ? $('#r-agent .atts') : $('#pane-main .convfoot .atts'); if (!box) return;
    const list = attList(host);
    box.innerHTML = list.map((a, i) => `<span class="att" title="${esc(a.path)}">${fileIcon(kindOf(a.name))}<span class="ellipsis">${esc(a.name)}</span><button class="x" data-att-x="${i}" data-att-host="${esc(host)}" title="拿掉">×</button></span>`).join('') + (S.attBusy ? `<span class="att muted">放进来…</span>` : '');
    box.classList.toggle('hide', !list.length && !S.attBusy);
  }
  async function addAttach(files, host = 'right') {
    const p = proj(); if (!p || !p.exists) return toast('先选一个项目');
    if (host === 'right' && !S.askOpen) openAsk();
    const list = attList(host); S.attBusy = (S.attBusy || 0) + files.length; drawAtts(host);
    for (const f of files) {
      try {
        const from = window.popperHost ? window.popperHost.pathOf(f) : '';
        if (!from && f.size > 25 * 1024 * 1024) throw Error('超过 25MB，请先放进项目文件夹，再在对话里说文件名');
        const name = f.name && f.name !== 'image.png' ? f.name : `截图-${new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)}.${(f.type.split('/')[1] || 'png').replace('jpeg', 'jpg')}`;
        const body = from ? { id: p.id, name, from } : { id: p.id, name, data: await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(f); }) };
        const r = await api('projects/attach', 'POST', body);
        list.push({ path: r.path, name: r.path.split(/[\\/]/).pop() });
        if (r.copied && p.id === B.current) loadFiles();
      } catch (err) { toast(`${f.name || '图片'}：${err.message}`); }
      S.attBusy--; drawAtts(host);
    }
    const ta = host === 'right' ? $('#askText') : $('#pane-main .convfoot textarea'); if (ta) ta.focus();
  }
  function drawAsk() {
    const box = $('#r-agent .ag-ask'); if (!box) return;
    const btn = $('#r-agent [data-askopen]'); if (btn) btn.classList.toggle('on', !!S.askOpen);
    if (!S.askOpen) { if (box.innerHTML) box.innerHTML = ''; S.askSig = null; return; }
    const m = askMode(), fol = m.follow && S.amode === 'follow';
    const tgt = m.kind === 'reply' ? m.run : fol ? m.follow : null, mid = tgt && convTabOf(tgt.id);
    const sig = B.current + ':' + m.kind + ':' + (m.run ? m.run.id : '') + ':' + (m.follow ? m.follow.id : '') + ':' + S.amode + ':' + (mid ? 'mid' : '');
    if (sig === S.askSig && box.innerHTML) return; // 没变就不重画（保住正在打的字和光标）
    S.askSig = sig;
    const old = $('#askText'), val = old ? old.value : '';
    const short = s => s.length > 16 ? s.slice(0, 16) + '…' : s;
    if (mid) { // 气泡里写了一半的字和附件，搬到中间的回复框
      if (val.trim() || (S.attach || []).length) {
        S.convDraft = S.convDraft || {}; S.convDraft[tgt.id] = [(S.convDraft[tgt.id] || '').trim(), val.trim()].filter(Boolean).join('\n'); attList(tgt.id).push(...(S.attach || [])); S.attach = [];
        const cta = curTab() && curTab().conv === tgt.id && $('#pane-main .convfoot textarea'); if (cta) { cta.value = S.convDraft[tgt.id]; drawAtts(tgt.id); }
      }
      box.innerHTML = `<div class="askwrap">${m.follow && m.kind !== 'reply' ? `<div class="amode"><button data-amode="new">开新任务</button><button class="on" data-amode="follow">接着「${esc(short(m.follow.title))}」</button></div>` : ''}<div class="small muted ibnote">「${esc(short(tgt.title))}」的对话在中间开着，在那里${m.kind === 'reply' ? '回复' : '接着说'}。<button class="linkish" data-goconv="${esc(tgt.id)}">去中间</button></div></div>`; return; }
    const head = m.kind === 'reply' ? `<div class="amode"><span>回复「${esc(short(m.run.title))}」</span></div>`
      : m.follow ? `<div class="amode"><button class="${fol ? '' : 'on'}" data-amode="new">开新任务</button><button class="${fol ? 'on' : ''}" data-amode="follow" title="${esc(m.follow.title)}">接着「${esc(short(m.follow.title))}」</button></div>` : '';
    box.innerHTML = `<div class="askwrap">${head}<div class="atts hide"></div><div class="askbox"><textarea id="askText" rows="2" placeholder="${m.kind === 'reply' ? '回复…' : fol ? '追问…' : '跟 ' + esc(B.agentName || 'Research Agent') + ' 说…'}"></textarea><button class="send" data-ask-go title="发出去（回车）">${I('send')}</button></div>${m.kind === 'reply' || fol ? '' : `<div class="askfoot"><button class="btn small primary tdput" data-ask-todo title="交给 AI 把这段话拆成几条待办（只拆、不做），放进 Dashboard 的「待办」">${I('plus')}放进待办</button></div>`}</div>`;
    const ta = $('#askText'); ta.value = val; ta.placeholder += '（可以拖文件进来、粘贴截图）';
    if (inboxNewAsk(m)) box.querySelector('.askwrap').insertAdjacentHTML('beforeend', `<div class="small muted ibnote">收件箱只用来梳理，不在这里开新任务。要做事，先在左栏选一个项目（或<button class="linkish" data-dash-new>新建项目</button>）；也可以写下来点「放进待办」，以后在项目里开始。</div>`);
    drawAtts();
  }
  const inboxNewAsk = m => !!(proj() && proj().inbox && m.kind === 'new' && !(m.follow && S.amode === 'follow')); // 收件箱里只能回复、接着梳理那个任务说，不开新任务（T4）
  async function sendAsk(from) {
    const ta = $('#askText'); let text = ta ? ta.value.trim() : '';
    if (!text && (S.attach || []).length) text = '先看一下这些附件，告诉我是什么、要我做什么之前先问我。';
    if (S.attBusy) return toast('附件还在放进来，等一下');
    if (!text) { if (ta) ta.focus(); return; }
    const title = '跟 AI 说：' + (text.length > 14 ? text.slice(0, 14) + '…' : text); text += attachNote();
    const m = askMode(), target = m.kind === 'reply' ? m.run : m.follow && S.amode === 'follow' ? m.follow : null;
    if (inboxNewAsk(m)) return toast('收件箱里不开新任务：先选一个项目或新建项目；也可以点「放进待办」');
    try {
      if (target) { replied(await api(`runs/${target.id}/reply`, 'POST', { text })); requestAnimationFrame(() => fly(from, $('#r-agent .ag-mk'))); afterTask(); }
      else { const r = await submitRun({ project: B.current, prompt: text, free: true, title }, from); if (!r) return; }
      ta.value = ''; closeAsk();
    } catch (err) { toast(err.message); }
  }
  // ---------- 「待办」（内容 1.3.3，todos.cjs；1.4.1 起从右栏挪到 Dashboard）：所有项目的放一起；梳理来的、气泡里拆的都在这；「开始」= 在它的项目里单独开一个对话 ----------
  async function loadTodos() { try { S.todos = await api('todos', 'GET'); } catch { return; } renderTodos(); }
  async function splitTodo(from) {
    const ta = $('#askText'), text = ta ? ta.value.trim() : ''; if (!text) { if (ta) ta.focus(); return; }
    if (S.attBusy) return toast('附件还在放进来，等一下');
    try {
      askNotify(); const r = await api('todos/split', 'POST', { text: text + attachNote(), project: B.current }); S.todos = { items: r.items, splitting: r.splitting };
      requestAnimationFrame(() => fly(from, $('#r-agent .ag-mk'))); toast('交给 AI 整理了，整理好会放进 Dashboard 的「待办」'); ta.value = ''; closeAsk(); loadRuns(); poll(); renderTodos();
    } catch (err) { toast(err.message); }
  }
  const TD_ST = { todo: '', doing: '进行中', waiting: '等你回复', stuck: '没做完', started: '已开始 · 做完了自己勾', done: '' };
  // 一条待办（Dashboard 里按项目归组，不再重复写项目名）
  const tdRow = (t, grouped) => `<div class="td ${esc(t.status)}" data-mk="td:${esc(t.id)}" data-ms="${esc(t.status)}"><input type="checkbox" data-td-done="${esc(t.id)}" ${t.status === 'done' ? 'checked' : ''} title="${t.status === 'done' ? '取消打勾' : '手动打勾（做完了）'}">
      <span class="grow tdx"><span class="tt" title="${esc(t.prompt || t.title)}">${esc(t.title)}</span><span class="tm">${[grouped && t.status !== 'done' ? '' : esc(t.projectName), t.from ? esc(t.from.label) : '', TD_ST[t.status] ? '<b>' + TD_ST[t.status] + '</b>' : ''].filter(Boolean).join(' · ')}</span></span>
      ${t.status === 'done' ? (t.run ? `<button class="linkish" data-td-open="${esc(t.run)}" data-td-proj="${esc(t.project)}">看</button>` : '')
        : t.run && t.status !== 'stuck' ? `<button class="linkish" data-td-open="${esc(t.run)}" data-td-proj="${esc(t.project)}">去看</button>`
        : t.act ? `<button class="btn small" data-td-start="${esc(t.id)}">${t.status === 'started' ? '再开' : '开始'}</button>`
        : t.wait ? `<button class="btn small" disabled title="相关文件还在收件箱：先在「梳理计划」里点「照这样做」">开始</button>` : `<button class="btn small" data-td-start="${esc(t.id)}">${t.status === 'stuck' ? '重开' : '开始'}</button>`}
      <button class="ib sm tdel" data-td-del="${esc(t.id)}" title="删掉这条">×</button></div>`;
  // 右栏不再放待办（T4）：都在 Dashboard。待办变了、正开着 Dashboard 就重画
  function renderTodos() {
    const box = $('#r-todo'); if (box && box.innerHTML) box.innerHTML = '';
    if (onDash()) renderPane();
  }
  // 开始一条待办：建议放进来的照原样做（先切到它的项目）；别的在它的项目里单独开一个任务
  function startTodo(id, b) {
    const t = ((S.todos || {}).items || []).find(x => x.id === id);
    if (t && t.act) return (async () => { if (B.current !== t.project && !(await switchProject(t.project))) return; await runAct(t.act, b); try { S.todos = await api('todos/started', 'POST', { id: t.id }); } catch {} renderTodos(); })();
    if (b) b.disabled = true;
    return api('todos/start', 'POST', { id }).then(r => { S.todos = { items: r.items, splitting: r.splitting }; toast(`开始了：${r.run.title}（${(B.projects || []).find(p => p.id === r.project)?.name || ''}）`); if (r.project === B.current) loadRuns(); poll(); renderTodos(); }, err => { toast(err.message); renderTodos(); });
  }
  function TODO_CLICK(e) {
    const g = sel => e.target.closest(sel);
    let b;
    if ((b = g('[data-td-start]'))) { startTodo(b.dataset.tdStart, b); return true; }
    if ((b = g('[data-td-del]'))) { api('todos/remove', 'POST', { id: b.dataset.tdDel }).then(r => { S.todos = r; renderTodos(); }, err => toast(err.message)); return true; }
    if ((b = g('[data-td-open]'))) { (async () => { if (B.current !== b.dataset.tdProj && !(await switchProject(b.dataset.tdProj))) return; S.expanded = b.dataset.tdOpen; loadRuns(); })(); return true; }
    if (g('[data-td-showdone]')) { S.tdDone = !S.tdDone; renderTodos(); return true; }
    return false;
  }
  function engineMenu(anchor) {
    const p = proj(); if (!p) return;
    const items = [];
    for (const e of (B.engines || []).filter(x => x.version && x.enabled && (!isFake(x.id) || B.dev))) { // 只列启用了的（内容 1.2.0）
      items.push({ head: e.name });
      const cur = p.engine === e.id ? (p.model || '') : null;
      items.push({ label: '默认' + (e.model || (e.defaults || {}).model ? `（${esc(e.model || e.defaults.model)}）` : ''), on: cur === '', run: () => pickEngine(e.id, '') });
      for (const m of (e.models || [])) items.push({ label: esc(m), on: cur === m, run: () => pickEngine(e.id, m) });
    }
    if (!items.length) return toast('没找到可用的 AI 程序，打开「AI学术环境配置」看看');
    menu(anchor, items);
  }
  function pickEngine(engine, model) {
    const p = proj(); if (!p) return;
    if (engine !== p.engine) delete S.skills[B.current];
    act('projects/update', { id: B.current, engine, model }, `之后交给 ${engineName(engine)}${model ? ' · ' + model : ''}`);
  }
  // 排序：等你回复 › 出错 › 执行中 › 排队 › 其余按时间
  function renderTasks() {
    renderAgent(); renderTodos();
    const box = $('#r-tasks'), a = document.activeElement;
    if (a && box.contains(a) && a.matches('textarea')) return; // 正在写回复，别打断
    const engines = (B.engines || []), p = proj(), eng = engines.find(e => p && e.id === p.engine);
    const list = [...S.runs].sort((x, y) => (ORDER[x.status] ?? 9) - (ORDER[y.status] ?? 9) || y.createdAt.localeCompare(x.createdAt));
    // 没有任务：这个项目的 AI 程序没找到就画「未连接」，否则画「没有任务」
    const empty = ''; // 没有任务、AI 程序没找到：上面的 AI 卡片会说
    const ended = list.filter(r => ['done', 'failed', 'stopped'].includes(r.status)).length;
    put(box, `<div class="rsec"><div class="rh"><b>任务</b>${ended ? `<button class="linkish" data-clear-all title="把已经结束的任务从列表里拿掉（记录还在）">清除</button>` : ''}</div>
      ${list.slice(0, 8).map(taskHTML).join('')}${empty}</div>`);
    fx(box, B.current);
    tickClocks();
  }
  // 计时只由这里填：写进 HTML 的话每次重画内容都不一样，put() 就会整块重写、吞掉点击
  function tickClocks() {
    document.querySelectorAll('[data-since]').forEach(el => { el.textContent = since(el.dataset.since); });
    document.querySelectorAll('[data-since-short]').forEach(el => { el.textContent = sinceShort(el.dataset.sinceShort); });
  }
  setInterval(tickClocks, 1000);

  // ---------- 提醒：任务停下来问你、做完、出错时，弹一下（App 里是系统通知） ----------
  const seen = new Map(); // 任务 id → 上次看到的状态
  let notifyAsked = false;
  function askNotify() { if (!notifyAsked && 'Notification' in window && Notification.permission === 'default') { notifyAsked = true; Notification.requestPermission().catch(() => {}); } }
  function announce(r) {
    const p = proj(r.project), what = r.status === 'waiting' ? '等你回复' : r.status === 'done' ? '完成' : '出错了';
    toast(`${r.title} · ${what}${p && r.project !== B.current ? '（' + p.name + '）' : ''}`);
    if ('Notification' in window && Notification.permission === 'granted' && (document.hidden || !document.hasFocus())) {
      const n = new Notification(`${r.title} · ${what}`, { body: (p ? p.name + '：' : '') + (r.status === 'failed' ? (r.error || '') : (r.lastMessage || '')).slice(0, 120) });
      n.onclick = async () => { window.focus(); await switchProject(r.project); S.expanded = r.id; loadRuns(); n.close(); };
    }
  }
  // 有任务在跑或排队时每 2 秒看一次所有项目；状态变了就提醒、刷新左栏和文件
  let pollTimer = null;
  function poll() {
    if (pollTimer) return;
    const tick = async () => {
      let all; try { all = await api('runs', 'GET'); } catch { return; }
      S.allRuns = all;
      let changed = false; const changedProjects = new Set();
      for (const r of all) {
        const before = seen.get(r.id);
        if (before !== undefined && before !== r.status) changedProjects.add(r.project);
        const autoAnswer = r.auto && r.status === 'waiting' && !r.autoGaveUp; // 自动模式里的「等你回复」工作站会替你回，不打扰
        const midChain = r.auto && r.status === 'done' && r.chainLeft; // 自动模式中间的阶段做完不提醒，整条跑完才提醒
        if (before !== undefined && before !== r.status && r.status === 'done' && r.project === B.current && !midChain) { S.deliver = { id: r.id, until: Date.now() + 7000 }; setTimeout(renderAgent, 7100); }
        if (before !== undefined && before !== r.status) { changed = true; if (['waiting', 'done', 'failed'].includes(r.status) && before !== 'stopping' && !autoAnswer && !midChain) announce(r); }
        seen.set(r.id, r.status);
      }
      if (changed && proj() && proj().inbox) loadPlan();
      if (changed) { loadTodos(); loadFacts(); }
      if (changed) { api('quota', 'GET').then(q => { B.quota = q; renderAgent(); }).catch(() => {}); refreshProjects(); loadFiles(); pushFilesToWorkflows(changedProjects); const t = curTab(); if (t && t.conv) reloadConvKeep(t); else if (t && t.doc && !$('#pane-main').contains(document.activeElement)) reloadDoc(); else if (t && t.tool && (toolOf(t.tool) || {}).local === 'mineru') { t.ml = null; renderPane(); } }
      S.runs = all.filter(r => r.project === B.current);
      // 在跑的任务写完一个文件：马上刷新文件栏（不等任务结束），新文件从动作流飞进去
      const wsig = S.runs.flatMap(r => (r.steps || []).filter(s => s.kind === 'write' && s.status === 'done').map(s => s.id)).join(',');
      if (wsig && wsig !== S.writeSig) loadFiles(); S.writeSig = wsig;
      if (Date.now() - (S.quotaAt || 0) > 10000) { S.quotaAt = Date.now(); api('quota', 'GET').then(q => { B.quota = q; renderAgent(); }).catch(() => {}); }
      renderTasks(); pushChain(); pushBusy();
      if (!all.some(r => ['running', 'stopping', 'queued'].includes(r.status))) { clearInterval(pollTimer); pollTimer = null; }
    };
    pollTimer = setInterval(tick, 2000); tick();
  }
  // 手机远程（内容 1.3.16）：手机上开始的工作流阶段待办交给这个窗口做（工作流的指令在窗口里的工作流页面拼）。每 3 秒问一次，也让后台知道窗口开着
  async function remoteActs() {
    let r; try { r = await api('todos/remote-acts', 'GET'); } catch { return; }
    for (const x of r.acts || []) {
      let run = '', busy = false;
      if (B.current === x.project || await switchProject(x.project)) {
        const before = new Set((S.allRuns || []).map(y => y.id)), t0 = Date.now();
        await runAct(x.act); toast('手机上开始了一件待办');
        // 等工作流页面开出任务（最多 20 秒）；开不出来多半是这一步要选、要填东西，或者缺 skill 弹了确认框。
        // 这一步本来就在跑（T1）：不新开，把在跑的那个报给手机
        for (let i = 0; i < 20 && !run; i++) {
          await new Promise(res => setTimeout(res, 1000));
          if (S.lastBusy && S.lastBusy.at >= t0 && S.lastBusy.wf === x.act.wf) { run = S.lastBusy.id; busy = true; break; }
          try { const all = await api('runs', 'GET'); run = (all.find(y => !before.has(y.id) && y.project === x.project && y.workflow === x.act.wf) || {}).id || ''; } catch {}
        }
      }
      try { await api('todos/remote-result', 'POST', { key: x.key, run, busy }); } catch {}
    }
    if ((r.acts || []).length) { loadTodos(); poll(); }
  }
  setInterval(remoteActs, 3000);
  // 自动模式进度发给开着的工作流页面（阶段条变「电路」、跑完扫光 + 汇总，见 bridge.js 的 aiws:chain）。内容没变不重发
  const chainSent = new WeakMap();
  function chainState(proj, wf) {
    const runs = (S.allRuns || []).filter(r => r.project === proj && r.workflow === wf && r.auto && r.chain).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    const r = runs[0]; if (!r) return { active: false };
    if (['running', 'stopping', 'waiting', 'queued'].includes(r.status)) return { active: true, i: r.chain.i, n: r.chain.n, status: r.status, title: r.title, engine: engineName(r.engine), engines: chainEngines(r).map(engineName) };
    if (r.status === 'done' && r.chain.i === r.chain.n && Date.now() - new Date(r.endedAt || r.createdAt) < 10 * 60e3) {
      const all = runs.slice(0, r.chain.n), first = all[all.length - 1] || r;
      const files = new Set(all.flatMap(x => x.outputs || []).filter(f => !/^\.工作站\//.test(f)));
      return { active: false, finished: true, id: r.id, summary: { n: r.chain.n, ms: new Date(r.endedAt || r.createdAt) - new Date(first.startedAt || first.createdAt),
        tokens: all.reduce((s, x) => s + ((x.usage && x.usage.input) || 0) + ((x.usage && x.usage.output) || 0), 0), files: files.size, replies: all.reduce((s, x) => s + (x.autoReplies || 0), 0) } };
    }
    return { active: false, stopped: r.status === 'failed' || r.status === 'stopped', i: r.chain.i, n: r.chain.n };
  }
  function pushChain(force) {
    for (const f of document.querySelectorAll('iframe.wfview')) {
      const st = chainState(f.dataset.proj, f.dataset.wf), key = JSON.stringify(st);
      if (!force && chainSent.get(f) === key) continue;
      chainSent.set(f, key);
      try { f.contentWindow.postMessage({ __aiws: 1, type: 'chain', state: st }, wfOrigin(f.dataset.wf)); } catch {}
    }
  }
  // 这个项目的 AI 装着的 skill（内容 1.4.1，T2 第 4 条）：页面载入时发给它，造工作流造出来的「这一步用哪个 skill」下拉框用。只给名字和用途
  function pushSkills(fr) {
    const pid = fr.dataset.proj, p = proj(pid), eng = p && p.engine;
    api('skills/all', 'GET', { project: pid }).then(list => {
      S.skillCat = S.skillCat || {}; S.skillCat[pid] = list;
      const skills = list.filter(s => !ENG_NAME[eng] || s.engines.includes(eng)).slice(0, 400).map(s => ({ name: s.name, purpose: s.purpose || '其他' }));
      try { fr.contentWindow.postMessage({ __aiws: 1, type: 'skills', skills }, wfOrigin(fr.dataset.wf)); } catch {}
    }).catch(() => {});
  }
  // 哪几步还没结束（内容 1.4.1，T1）：发给开着的工作流页面，桥把对得上的「执行」按钮灰掉、标「运行中」，结束了恢复（见 bridge.js 的 busy）
  const busySent = new WeakMap();
  function pushBusy(force) {
    for (const f of document.querySelectorAll('iframe.wfview')) {
      const titles = [...new Set((S.allRuns || []).filter(r => r.project === f.dataset.proj && r.workflow === f.dataset.wf && LIVE_ST.includes(r.status)).map(r => r.title))].sort(), key = titles.join('\n');
      if (!force && busySent.get(f) === key) continue;
      busySent.set(f, key);
      try { f.contentWindow.postMessage({ __aiws: 1, type: 'busy', titles }, wfOrigin(f.dataset.wf)); } catch {}
    }
  }
  // 任务状态变了：把这些项目最新的文件清单发给开着的工作流页面（阶段条变绿、「自动跑完」从没做完的阶段开始，见 bridge.js）
  async function pushFilesToWorkflows(ids) {
    for (const id of ids) {
      const frs = [...document.querySelectorAll('iframe.wfview')].filter(f => f.dataset.proj === id);
      if (!frs.length) continue;
      let files; try { files = (await api('projects/files', 'GET', { id })).slice(0, 500).map(f => f.path); } catch { continue; }
      for (const f of frs) try { f.contentWindow.postMessage({ __aiws: 1, type: 'files', files }, wfOrigin(f.dataset.wf)); } catch {}
    }
  }
  async function refreshProjects() { try { Object.assign(B, await api('projects')); renderLeft(); renderAgent(); if (!curTab()?.wf && !curTab()?.doc) renderPane(); } catch {} } // renderAgent：「下一步」建议看 B.mineru（启动时 MinerU 可能还没查完）

  // ---------- 右栏：文件 ----------
  async function loadFiles() {
    const id = B.current; S.filesOf = id;
    try { const list = await api('projects/files', 'GET', { id }); if (S.filesOf === id) { S.files = list; renderFiles(); if (onDash()) renderPane(); } } catch (e) { S.files = []; renderFiles(); }
  }
  // 折叠状态（文件区、各文件夹）按项目记在浏览器里
  const FOLD = (() => { try { return JSON.parse(localStorage.getItem('aiws:fold') || '{}'); } catch { return {}; } })();
  const setFold = (k, v) => { if (v) FOLD[k] = 1; else delete FOLD[k]; try { localStorage.setItem('aiws:fold', JSON.stringify(FOLD)); } catch {} };
  function renderFiles() {
    const p = proj(), files = S.files || [], box = $('#l-files');
    if (!box) return;
    const shut = !!FOLD['files:' + B.current];
    let list = '';
    if (!p || !p.exists || shut) list = '';
    // 收件箱（Dashboard 下面一级）只列还没梳理的：最上层的文件，新的在前；不分「最近 / 全部」
    else if (p.inbox) list = files.filter(f => f.kind !== 'dir' && !f.path.includes('/') && !f.path.startsWith('.')).sort((a, b) => b.mtime - a.mtime).map(f => fileRow(f, f.path, '')).join('') || '<div class="small muted fempty">没有要梳理的文件。把零散文件拖到这里就放进来。</div>';
    else if (S.fileMode === 'recent') list = files.filter(f => f.kind !== 'dir').sort((a, b) => b.mtime - a.mtime).slice(0, 6).map(f => fileRow(f, f.path.split('/').pop(), f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '')).join('');
    else {
      const g = {};
      for (const f of files) { if (f.kind === 'dir' && !f.path.slice(0, -1).includes('/')) continue; const top = f.path.includes('/') ? f.path.split('/')[0] + '/' : ''; (g[top] = g[top] || []).push(f); }
      list = Object.keys(g).sort().map(k => { const fold = k && FOLD['dir:' + B.current + ':' + k]; return (k ? `<div class="fgrp ${fold ? 'shut' : ''}" data-fgrp="${esc(k)}">${I('chev')}<span>${esc(k)}</span><span class="n">${g[k].length}</span></div>` : '') + (fold ? '' : g[k].map(f => fileRow(f, k ? f.path.slice(k.length) : f.path, '')).join('')); }).join('');
    }
    put(box, `<div class="fhead"><button class="ftog ${shut ? 'shut' : ''}" data-ftoggle title="${shut ? '展开' : '收起'}">${I('chev')}<span>${p && p.inbox ? '收件箱' : '文件'}</span></button>${p && p.inbox && p.inboxNew ? `<span class="ibadge" title="还没梳理的文件">${p.inboxNew}</span><button class="ib sm" data-triage title="一键梳理：Research Agent 看一遍，给出每个文件放哪的计划">${I('wand')}</button>` : ''}<span class="grow"></span>${shut ? '' : `${p && p.inbox ? '' : `<div class="seg"><button class="${S.fileMode === 'recent' ? 'on' : ''}" data-fmode="recent">最近</button><button class="${S.fileMode === 'all' ? 'on' : ''}" data-fmode="all">全部</button></div>`}<button class="ib sm" data-act="refresh-files" title="刷新">${I('refresh')}</button>`}</div>${list}`);
    const { entered } = fx(box, B.current + ':' + S.fileMode) || { entered: [] };
    // AI 刚写出的文件：从动作流里那一步飞进文件栏
    for (const row of entered) { const src = [...document.querySelectorAll('#r-agent .feed li[data-path]')].find(li => li.dataset.path === row.dataset.file) || (S.lastWrites && S.lastWrites.has(row.dataset.file) ? $('#r-agent .ag-mk') : null); if (src) { row.style.visibility = 'hidden'; fly(src, row, row.dataset.file.split('/').pop()).then(() => { row.style.visibility = ''; row.classList.remove('fx-enter'); void row.offsetWidth; row.classList.add('fx-enter'); }); } }
  }
  const fileRow = (f, name, where) => `<div class="frow" data-file="${esc(f.path)}" data-mk="f:${esc(f.path)}" data-ms="${esc(String(f.mtime || ''))}" title="${esc(f.path)}">${fileIcon(f.kind)}<span class="grow"><span class="nm">${esc(name)}</span>${where || f.mtime ? `<span class="meta">${esc(where)}${where && f.mtime ? ' · ' : ''}${f.mtime ? esc(when(new Date(f.mtime).toISOString())) : ''}</span>` : ''}</span>${dot(f.unread)}</div>`;

  // 左栏宽度可以拖（220–360px），记在浏览器里
  (() => {
    const set = w => document.documentElement.style.setProperty('--w-left', Math.max(220, Math.min(360, Math.round(w))) + 'px');
    try { const w = +localStorage.getItem('aiws:wleft'); if (w) set(w); } catch {}
    const g = $('#lgrip'); if (!g) return;
    g.addEventListener('mousedown', e => {
      e.preventDefault(); document.body.classList.add('resizing');
      const mv = ev => set(ev.clientX), up = () => { document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up); document.body.classList.remove('resizing');
        try { localStorage.setItem('aiws:wleft', parseInt(getComputedStyle(document.documentElement).getPropertyValue('--w-left'))); } catch {} };
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    });
    g.addEventListener('dblclick', () => { set(240); try { localStorage.removeItem('aiws:wleft'); } catch {} });
  })();
  function renderAll() { renderLeft(); renderTabs(); renderPane(); renderTasks(); renderFiles(); }
  async function switchProject(id) {
    if (id === B.current) return true;
    const r = await act('projects/current', { id }); if (r) { S.runs = []; S.expanded = null; renderTasks(); loadFiles(); loadRuns(); loadFacts(); if (proj() && proj().inbox) loadPlan(); }
    return !!r;
  }

  // ---------- ⌘K 命令面板：搜项目、工作流、工具、当前项目的文件 ----------
  // ↑↓ 选、回车打开、tab 换范围、esc 关。焦点在工作流页面里时按键到不了这里（工作流页面是隔离的）
  const K = { q: '', scope: 'all', sel: 0, items: [] };
  const SCOPES = [['all', '全部'], ['project', '项目'], ['app', '工具'], ['file', '文件']];
  function cmdkData() {
    const files = (S.files || []).filter(f => f.kind !== 'dir' && !f.path.startsWith('.'));
    const P0 = (B.projects || []).filter(p => p.exists || p.inbox).map(p => ({ scope: 'project', group: '项目', name: p.inbox ? '收件箱' : p.name, meta: p.id === B.current ? '当前' : '', tile: `<span class="tile sm">${I(p.inbox ? 'inbox' : 'folder')}</span>`, run: () => switchProject(p.id) }));
    const toolItem = (t, group) => ({ scope: 'app', group, name: t.name, meta: group === '工具' ? t.cat || '' : '', tile: toolTile(t, 'sm'), run: () => openTab({ id: 'tool:' + t.id, tool: t.id }) });
    const W = (B.workflows || []).map(w => ({ scope: 'app', group: '工作流', name: w.name, meta: '', tile: wfTile(w, 'sm'), run: () => openTab({ id: 'wf:' + w.id, wf: w.id }) }))
      .concat((B.tools || []).filter(t => t.id === 'wfbuild').map(t => toolItem(t, '工作流'))); // 造工作流跟着工作流走，不算工具
    const T = (B.tools || []).filter(t => t.id !== 'wfbuild').map(t => toolItem(t, '工具'));
    const F = files.sort((a, b) => b.mtime - a.mtime).map(f => ({ scope: 'file', group: '文件', name: f.path.split('/').pop(), hay: f.path, meta: f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '', tile: `<span class="tile sm">${fileIcon(f.kind)}</span>`, run: () => openDoc(f.path) }));
    return { P0, W, T, F };
  }
  function cmdkResults() {
    const { P0, W, T, F } = cmdkData(), q = K.q.trim().toLowerCase();
    const hit = it => !q || it.name.toLowerCase().includes(q) || (it.hay || '').toLowerCase().includes(q);
    const all = [...P0, ...W, ...T, ...F];
    const counts = { all: q ? all.filter(hit).length : all.length };
    for (const [s] of SCOPES.slice(1)) counts[s] = all.filter(it => it.scope === s && hit(it)).length;
    let groups;
    if (!q && K.scope === 'all') groups = [['最近', F.slice(0, 4)], ['工作流', W], ['工具', T]]; // 刚打开：最近的文件 + 工作流 + 工具
    else {
      const cap = K.scope === 'all' ? 6 : 60, pick = list => list.filter(it => (K.scope === 'all' || it.scope === K.scope) && hit(it)).slice(0, cap);
      groups = [['项目', pick(P0)], ['工作流', pick(W)], ['工具', pick(T)], ['文件', pick(F)]];
    }
    groups = groups.filter(g => g[1].length);
    return { groups, counts };
  }
  const markHit = name => {
    const q = K.q.trim(), i = q ? name.toLowerCase().indexOf(q.toLowerCase()) : -1;
    return i < 0 ? esc(name) : esc(name.slice(0, i)) + `<mark>${esc(name.slice(i, i + q.length))}</mark>` + esc(name.slice(i + q.length));
  };
  function cmdkDraw() {
    const box = layer.querySelector('.cmdk'); if (!box) return;
    const { groups, counts } = cmdkResults();
    K.items = groups.flatMap(g => g[1]);
    K.sel = Math.max(0, Math.min(K.sel, K.items.length - 1));
    let n = -1;
    box.querySelector('.cmdk-scope').innerHTML = SCOPES.map(([s, label]) => `<button data-kscope="${s}" class="${K.scope === s ? 'on' : ''}">${label}<i>${counts[s]}</i></button>`).join('');
    box.querySelector('.cmdk-list').innerHTML = K.items.length
      ? groups.map(([g, list]) => `<div class="cmdk-g">${esc(g)}</div>` + list.map(it => { n++; return `<div class="cmdk-it ${n === K.sel ? 'on' : ''}" data-kit="${n}">${it.tile}<span class="nm">${markHit(it.name)}</span><span class="meta">${esc(it.meta)}</span><span class="keycap">↩</span></div>`; }).join('')).join('')
      : `<div class="art">${art('search')}</div>`;
    const on = box.querySelector('.cmdk-it.on'); if (on) on.scrollIntoView({ block: 'nearest' });
  }
  function cmdkOpen() {
    if (layer.querySelector('.cmdk')) return close();
    if (layer.innerHTML) return; // 开着弹窗或菜单时不叠
    Object.assign(K, { q: '', scope: 'all', sel: 0 });
    layer.innerHTML = `<div class="cmdk-back" data-close></div><div class="cmdk" role="dialog" aria-label="命令面板">
      <div class="cmdk-in">${I('search')}<input id="cmdkQ" aria-label="搜索" placeholder="搜索" autocomplete="off" spellcheck="false"><span class="keycap">esc</span></div>
      <div class="cmdk-scope"></div><div class="cmdk-list"></div>
      <div class="cmdk-foot"><span><span class="keycap">↑↓</span>选择</span><span><span class="keycap">↩</span>打开</span><span><span class="keycap">tab</span>切换范围</span></div></div>`;
    const q = $('#cmdkQ');
    q.addEventListener('input', () => { K.q = q.value; K.sel = 0; cmdkDraw(); });
    q.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); K.sel = (K.sel + (e.key === 'ArrowDown' ? 1 : -1) + K.items.length) % Math.max(1, K.items.length); cmdkDraw(); }
      else if (e.key === 'Tab') { e.preventDefault(); const i = SCOPES.findIndex(s => s[0] === K.scope); K.scope = SCOPES[(i + (e.shiftKey ? SCOPES.length - 1 : 1)) % SCOPES.length][0]; K.sel = 0; cmdkDraw(); }
      else if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); cmdkRun(K.sel); }
    });
    const box = layer.querySelector('.cmdk');
    box.addEventListener('click', e => {
      const s = e.target.closest('[data-kscope]'); if (s) { K.scope = s.dataset.kscope; K.sel = 0; cmdkDraw(); q.focus(); return; }
      const it = e.target.closest('[data-kit]'); if (it) cmdkRun(+it.dataset.kit);
    });
    box.addEventListener('mousemove', e => { const it = e.target.closest('[data-kit]'); if (it && +it.dataset.kit !== K.sel) { K.sel = +it.dataset.kit; layer.querySelectorAll('.cmdk-it').forEach(x => x.classList.toggle('on', x === it)); } });
    cmdkDraw(); q.focus();
    if (!S.files.length) loadFiles().then(() => { if (layer.querySelector('.cmdk')) cmdkDraw(); });
  }
  function cmdkRun(i) { const it = K.items[i]; if (!it) return; close(); it.run(); }
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); cmdkOpen(); }
  });

  // ---------- 事件 ----------
  $('#left').addEventListener('click', async e => {
    const more = e.target.closest('[data-more]'); if (more) { e.stopPropagation(); return projectMenu(more, proj(more.dataset.more)); }
    const a = e.target.closest('[data-act]');
    if (a && a.dataset.act === 'add') return addMenu(a);
    if (a && a.dataset.act === 'settings') return openSettings();
    if (a && a.dataset.act === 'upd-apply') return api('update/apply', 'POST', {}).then(() => toast('正在更新……')).catch(err => toast(err.message));
    if (a && a.dataset.act === 'upd-shell') return api('update/download-shell', 'POST', {}).catch(err => toast(err.message));
    if (a && a.dataset.act === 'upd-restart') return modal(`新版本 ${esc((S.mupd || {}).ready || '')} 已下好`, `<p style="line-height:1.7;margin:0">关掉 POPPER 窗口再打开，就是新版本了。有 AI 任务在跑的话，等它做完再关。</p><div class="mfoot"><span class="grow"></span><button class="btn" data-close>好</button></div>`);
    if (a && a.dataset.act === 'upd-err') return checkUpdateNow();
    const tg = e.target.closest('[data-triage]'); if (tg) { e.stopPropagation(); return startTriage(tg); }
    // 文件区（在当前项目里面，要先于「点项目」处理）
    const fl = e.target.closest('[data-file]'); if (fl) return openDoc(fl.dataset.file);
    const fm = e.target.closest('[data-fmode]'); if (fm) { S.fileMode = fm.dataset.fmode; return renderFiles(); }
    if (a && a.dataset.act === 'refresh-files') return loadFiles();
    if (e.target.closest('[data-ftoggle]')) { setFold('files:' + B.current, !FOLD['files:' + B.current]); return renderFiles(); }
    const fg = e.target.closest('[data-fgrp]'); if (fg) { const k = 'dir:' + B.current + ':' + fg.dataset.fgrp; setFold(k, !FOLD[k]); return renderFiles(); }
    if (e.target.closest('#l-files')) return;
    const of = e.target.closest('[data-of]');
    if (of) {
      if (!(await switchProject(of.dataset.of))) return;
      if (of.dataset.openwf) return openTab({ id: 'wf:' + of.dataset.openwf, wf: of.dataset.openwf });
    }
    const c = e.target.closest('[data-proj]'); if (c) switchProject(c.dataset.proj);
  });
  $('#bar').addEventListener('click', e => {
    const x = e.target.closest('[data-close-tab]'); if (x) return closeTab(x.dataset.closeTab);
    const t = e.target.closest('[data-tab]'); if (t) { ui().active = t.dataset.tab; renderTabs(); renderPane(); return; }
    const rm = e.target.closest('[data-wfremove]'); if (rm) return removeWorkflow(wfOf(rm.dataset.wfremove));
    const rl = e.target.closest('[data-wfreload]');
    if (rl) { const box = [...document.querySelectorAll('.wfbox')].find(b => b.dataset.key === boxKey(rl.dataset.wfreload)); if (box) { const old = box.querySelector('iframe'); old.replaceWith(makeFrame(wfOf(rl.dataset.wfreload), old.dataset.proj)); } return; }
    if (e.target.closest('[data-doc-reload]')) return reloadDoc();
    common(e);
  });
  // Roughdraft 批完以后（10-24 乔淼：网页关了，任务其实开在那个项目里，没人告诉她）：每 3 秒问一次，开了任务就弹提示、跳到那个项目、展开那个任务
  const RD_WATCH = {};
  function watchRoughdraft(project, rel) {
    const key = project + ':' + rel; clearInterval(RD_WATCH[key]);
    const until = Date.now() + 3 * 3600e3;
    RD_WATCH[key] = setInterval(async () => {
      if (Date.now() > until) return clearInterval(RD_WATCH[key]);
      let st; try { st = await api('files/roughdraft-status', 'GET', { project, path: rel }); } catch { return; }
      if (!st || st.status === 'watching' || st.status === 'none') return;
      clearInterval(RD_WATCH[key]);
      const name = rel.split('/').pop();
      if (st.status === 'nothing') return toast(`「${name}」批完了，但文件里没有批注，没交给 AI`);
      if (st.status === 'failed') return toast(st.msg || 'Roughdraft 批注没交上');
      try { if ('Notification' in window && Notification.permission === 'granted') new Notification('批注收到了', { body: `「${name}」已交给 ${engineName(st.engine)} 按批注改` }); } catch {}
      toast(`批注收到了：「${name}」${st.queued ? '排上队了' : '已交给 ' + engineName(st.engine)}，按批注改`);
      if (B.current !== project) { try { Object.assign(B, await api('projects/current', 'POST', { id: project })); renderAll(); } catch {} }
      S.expanded = st.runId; loadRuns(); refreshProjects(); poll();
    }, 3000);
  }
  // 中间和上方都有的：打开项目说明、在访达中显示、用默认程序打开
  function common(e) {
    const od = e.target.closest('[data-opendoc]'); if (od) return openDoc(od.dataset.opendoc), true;
    const r = e.target.closest('[data-reveal]'); if (r) return api('projects/reveal', 'POST', { id: B.current, path: r.dataset.reveal }).catch(err => toast(err.message)), true;
    // Roughdraft 批注（10-23）：在浏览器里打开；点了「Approve」，有批注就自动交给 AI 按批注改
    const rd = e.target.closest('[data-roughdraft]'); if (rd) return api('files/roughdraft', 'POST', { project: B.current, path: rd.dataset.roughdraft }).then(() => { askNotify(); toast('已在浏览器里用 Roughdraft 打开。批注完点右上角「Approve」（改过字就是「I\'m done」），网页会自己关掉，回到这里就能看到 AI 按批注改的任务'); watchRoughdraft(B.current, rd.dataset.roughdraft); }).catch(err => toast(err.message)), true;
    const ox = e.target.closest('[data-openext]'); if (ox) return api('files/open-external', 'POST', { project: B.current, path: ox.dataset.openext }).then(() => markRead(ox.dataset.openext)).catch(err => toast(err.message)), true;
    return false;
  }
  // Dashboard 和收件箱提示里的：新建项目（气泡里那句）、看梳理计划、进项目（T4）
  function dashClick(e) {
    if (e.target.closest('[data-dash-new]')) return newProject(), true;
    if (e.target.closest('[data-dash-plan]')) return loadPlan().then(() => openTab({ id: 'triage', triage: true })), true;
    const dp = e.target.closest('[data-dash-proj]'); if (dp) return switchProject(dp.dataset.dashProj), true;
    return false;
  }
  $('#pane-main').addEventListener('click', async e => {
    if (e.target.closest('[data-act="import"]')) return picker.click();
    if (dashClick(e) || TODO_CLICK(e)) return;
    const dfl = e.target.closest('.dash [data-file]'); if (dfl) return openDoc(dfl.dataset.file);
    const sg = e.target.closest('[data-sugg-go]'); if (sg) return runSuggest(sg); // 项目首页开场句后面的「下一步」按钮
    if (e.target.closest('[data-sugg-todo]')) return suggestToTodo();
    if (e.target.closest('[data-sugg-alt]')) { const s = suggest(proj()); return s && s.alt && runAct(s.alt.act); }
    if (e.target.closest('[data-tool-new]')) return openToolEditor();
    if (e.target.closest('[data-tool-import]')) return toolPicker.click();
    if (e.target.closest('[data-tool-gh]')) return openGhImport();
    const tep = e.target.closest('[data-tool-edit]'); if (tep) return openToolEditor(tep.dataset.toolEdit);
    const tex = e.target.closest('[data-tool-export]'); if (tex) return exportTool(tex.dataset.toolExport);
    const trm = e.target.closest('[data-tool-remove]'); if (trm) return removeTool(trm.dataset.toolRemove);
    const ct = curTab();
    if (ct && ct.toolEdit && ct.draft) {
      const d = ct.draft, rerender = () => { if (document.activeElement && $('#pane-main').contains(document.activeElement)) document.activeElement.blur(); $('#pane-main').__html = null; renderPane(); };
      if (e.target.closest('[data-te-add]')) { d.fields.push({ name: '', type: '单行', options: '', required: false }); rerender(); const ins = document.querySelectorAll('#pane-main [data-tein="name"]'); if (ins.length) ins[ins.length - 1].focus(); return; }
      const del = e.target.closest('[data-te-del]'); if (del) { d.fields.splice(+del.dataset.teDel, 1); return rerender(); }
      if (e.target.closest('[data-te-reset]')) { d.tplEdited = false; return rerender(); }
      if (e.target.closest('[data-te-cancel]')) return closeTab(ct.id);
      if (e.target.closest('[data-te-save]')) return saveToolDraft(ct);
    }
    if (e.target.closest('[data-tri-apply]')) return applyTriage();
    if (e.target.closest('[data-tri-undo]')) return undoTriage();
    const tgp = e.target.closest('[data-triage]'); if (tgp) return startTriage(tgp);
    if (curTab()?.conv && await taskClick(e)) return;
    const df = e.target.closest('.convfoot [data-file], .conv [data-file]'); if (df) return openDoc(df.dataset.file);
    const c = e.target.closest('[data-openwf]'); if (c) return openTab({ id: 'wf:' + c.dataset.openwf, wf: c.dataset.openwf });
    const pt = e.target.closest('[data-pintool]'); if (pt) { const on = pt.classList.contains('on'); try { Object.assign(B, await api('tools/pin', 'POST', { id: pt.dataset.pintool, pinned: !on })); renderPane(); } catch (err) { toast(err.message); } return; }
    const tc = e.target.closest('[data-toolcat]'); if (tc) { try { localStorage.setItem(TOOLCAT_KEY, tc.dataset.toolcat); } catch {} return renderPane(); }
    const ot = e.target.closest('[data-opentool]'); if (ot) return openTab({ id: 'tool:' + ot.dataset.opentool, tool: ot.dataset.opentool });
    const tt = curTab();
    if (tt && tt.tool) {
      if (e.target.closest('[data-pin]')) return pickFiles(tt);
      const up = e.target.closest('[data-unpin]'); if (up) { tt.pins = (tt.pins || []).filter(x => x !== up.dataset.unpin); return renderPane(); }
      const sx = e.target.closest('[data-skm-x]'); if (sx) return skmSet(sx.dataset.skmX, skmList(tt.vals[sx.dataset.skmX]).filter(n => n !== sx.dataset.name));
      const sb = e.target.closest('.skbrowse summary'); if (sb) { tt.skmOpen = !sb.parentElement.open; $('#pane-main').__html = null; return; }
      if (e.target.closest('[data-trun]')) return runTool(tt, e.target.closest('[data-trun]'));
      if (e.target.closest('[data-trun-again]')) { if (toolMissing(toolOf(tt.tool), tt.vals).length) return toast('先把带 * 的填上'); return runTool(tt, e.target.closest('[data-trun-again]')); }
      const gl = e.target.closest('[data-golive]'); if (gl) { S.expanded = gl.dataset.golive; return renderTasks(); }
      if (e.target.closest('[data-mreload]')) { tt.ml = null; return renderPane(); }
      if (e.target.closest('[data-mhow]')) return api('env').then(env => howToInstall(null, env.mineru.problem === 'old' ? { name: 'MinerU', install: env.mineru.upgrade } : { name: 'MinerU', install: env.mineru.install })).catch(err => toast(err.message));
      if (e.target.closest('[data-mall]') && tt.ml && tt.ml.data) { const busy = muBusy(); tt.msel = tt.ml.data.items.filter(x => ['new', 'changed'].includes(x.state) && !busy.has(x.path)).map(x => x.path); $('#pane-main').__html = null; return renderPane(); }
      if (e.target.closest('[data-mnone]')) { tt.msel = []; $('#pane-main').__html = null; return renderPane(); }
      const mr = e.target.closest('[data-mrun]'); if (mr) return submitRun({ project: B.current, tool: tt.tool, files: tt.msel || [] }, mr).then(r => { if (r) { tt.ml = null; renderPane(); } });
    }
    if (common(e)) return;
    const ax = e.target.closest('[data-att-x]'); if (ax) { attList(ax.dataset.attHost).splice(+ax.dataset.attX, 1); return drawAtts(ax.dataset.attHost); }
  });
  // 输入框：⌘/Ctrl + 回车 发送；工具页里 ⌘/Ctrl + 回车 = 执行
  document.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey)) return;
    const btn = e.target.matches && e.target.matches('textarea') && e.target.parentElement.querySelector('.send');
    if (btn) { e.preventDefault(); btn.click(); return; }
    const t = curTab(), run = $('#pane-main [data-trun]');
    if (t && t.tool && run && !run.disabled && !layer.innerHTML) { e.preventDefault(); run.click(); }
  });
  // 工具页的输入：记在标签页上，不重画（免得打断输入），只更新「执行」按钮
  // 「用哪个 skill」的搜索结果：方向键挑、回车选、Esc 收起；点一下也行（用 mousedown，免得输入框先失焦把列表收掉）
  $('#pane-main').addEventListener('keydown', e => {
    if (!e.target.matches('[data-skpick],[data-skmq]')) return;
    const box = e.target.parentElement.querySelector('.skres'), rows = [...box.querySelectorAll('.skrow[data-skname]')];
    if (e.key === 'Escape') { box.classList.add('hide'); return; }
    if (box.classList.contains('hide') || !rows.length) return;
    let i = +box.dataset.i || 0;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); i = (i + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length; rows.forEach((r, k) => r.classList.toggle('on', k === i)); box.dataset.i = i; rows[i].scrollIntoView({ block: 'nearest' }); }
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); const key = e.target.dataset.skmq; if (key) skmSet(key, [...skmList(curTab().vals[key]), rows[i].dataset.skname], true); else pickSkill(rows[i].dataset.skname); }
  });
  $('#pane-main').addEventListener('mousedown', e => {
    const r = e.target.closest('.skrow[data-skname]'); if (!r) return; e.preventDefault();
    const q = r.closest('.skpick').querySelector('[data-skmq]'); if (q) return skmSet(q.dataset.skmq, [...skmList(curTab().vals[q.dataset.skmq]), r.dataset.skname], true);
    pickSkill(r.dataset.skname);
  });
  $('#pane-main').addEventListener('focusout', e => { if (e.target.matches && e.target.matches('[data-skpick],[data-skmq]')) setTimeout(() => { const b = e.target.parentElement && e.target.parentElement.querySelector('.skres'); if (b) b.classList.add('hide'); }, 150); });
  $('#pane-main').addEventListener('focusin', e => { if (e.target.matches && e.target.matches('[data-skpick],[data-skmq]') && e.target.value.trim()) skillResults(e.target); });
  $('#pane-main').addEventListener('input', e => {
    if (e.target.matches('.convfoot textarea[data-reply-text]')) { (S.convDraft = S.convDraft || {})[e.target.dataset.replyText] = e.target.value; return; }
    const ct = curTab();
    if (ct && ct.toolEdit && ct.draft) { // 添加 / 编辑工具的表单：值记进草稿
      const d = ct.draft, te = e.target.closest('[data-te]'), ti = e.target.closest('[data-tein]');
      if (e.target.matches('[data-skpick]')) { skillResults(e.target); $('#pane-main .skinfo').innerHTML = skillInfo(e.target.value); }
      if (te) { if (te.dataset.te === 'tpl') { d.tpl = te.value; d.tplEdited = true; } else { d[te.dataset.te] = te.value; if (!d.tplEdited) { const ta = $('#pane-main [data-te="tpl"]'); if (ta) ta.value = teTemplate(d); } } }
      if (ti) {
        const row = d.fields[+ti.closest('.terow').dataset.i], k = ti.dataset.tein;
        row[k] = k === 'required' ? ti.checked : ti.value;
        if (k === 'type') { const o = ti.closest('.terow').querySelector('[data-tein="options"]'); if (o) o.disabled = ti.value !== '选择'; }
        if (!d.tplEdited) { const ta = $('#pane-main [data-te="tpl"]'); if (ta) ta.value = teTemplate(d); }
      }
      const sv = $('#pane-main [data-te-save]'); if (sv) sv.disabled = !(d.skill.trim() && d.name.trim());
      $('#pane-main').__html = null;
      return;
    }
    if (e.target.matches('[data-skmq]')) return skillResults(e.target);
    const f = e.target.closest('[data-tfield]'), t = curTab(); if (!f || !t || !t.tool) return;
    t.vals[f.dataset.tfield] = f.value;
    const miss = toolMissing(toolOf(t.tool), t.vals), p = proj();
    $('#pane-main [data-trun]').disabled = !!miss.length || !p || !p.exists || !!t.sending || (S.runs || []).some(r => r.tool === t.tool && LIVE_ST.includes(r.status));
    $('#pane-main').__html = null; // 页面上的值和记下的不一样了，下次重画要真的写
  });
  $('#pane-main').addEventListener('change', e => {
    if (e.target.matches('[data-td-done]')) { api('todos/done', 'POST', { id: e.target.dataset.tdDone, done: e.target.checked }).then(r => { S.todos = r; renderTodos(); }, err => toast(err.message)); return; }
    if (e.target.matches('[data-tri-proj]')) { const f = e.target.closest('.tri').querySelector('[data-tri-folder]'); if (f) { f.disabled = NOFOLDER.includes(e.target.value); f.innerHTML = folderOpts(e.target.value, ''); } }
    const t = curTab(); if (!t || !t.tool) return;
    const sc = e.target.closest('[data-skm-check]'); if (sc) { t.skmOpen = true; const cur = skmList(t.vals[sc.dataset.skmCheck]); return skmSet(sc.dataset.skmCheck, sc.checked ? [...cur, sc.value] : cur.filter(n => n !== sc.value)); }
    const mc = e.target.closest('[data-mcheck]'); if (mc) { const s = new Set(t.msel || []); if (mc.checked) s.add(mc.dataset.mcheck); else s.delete(mc.dataset.mcheck); t.msel = [...s]; $('#pane-main').__html = null; return renderPane(); }
    const f = e.target.closest('select[data-tfield]'); if (f) { t.vals[f.dataset.tfield] = f.value; $('#pane-main').__html = null; }
    if (e.target.matches('[data-tquick]')) { t.vals.__quick = e.target.checked; e.target.closest('.qswitch').classList.toggle('on', e.target.checked); $('#pane-main').__html = null; }
  });
  // 拖文件进来导入：拖到「主页」任何地方都行
  window.addEventListener('dragover', e => { e.preventDefault(); const c = $('#pane-main .import'); if (c) c.classList.add('drag'); if (curTab()?.conv) $('#pane-main').classList.add('drag'); });
  window.addEventListener('dragleave', e => { if (!e.relatedTarget) { const c = $('#pane-main .import'); if (c) c.classList.remove('drag'); $('#pane-main').classList.remove('drag'); } });
  // 中间是任务对话时（T5）：拖进来的文件当这个任务的附件，和右栏气泡一样（以前提示「拖到主页导入」）；文件夹不收
  const droppedFiles = e => {
    const items = [...(e.dataTransfer.items || [])].filter(i => i.kind === 'file');
    const dirs = items.filter(i => { const en = i.webkitGetAsEntry && i.webkitGetAsEntry(); return en && en.isDirectory; });
    if (dirs.length) toast('文件夹不能当附件：拖文件进来，或者在对话里说文件夹的位置');
    return items.filter(i => !dirs.includes(i)).map(i => i.getAsFile()).filter(Boolean);
  };
  window.addEventListener('drop', e => {
    e.preventDefault(); const c = $('#pane-main .import'); if (c) c.classList.remove('drag'); $('#pane-main').classList.remove('drag');
    const ct = curTab(); if (ct && ct.conv && e.dataTransfer && e.target.closest && e.target.closest('#pane-main')) { const files = droppedFiles(e); if (files.length) addAttach(files, ct.conv); return; }
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if (!f) return;
    if (ui().active !== 'store') return toast('拖到「主页」导入');
    if (/\.json$/i.test(f.name)) return importTool(f);
    importFile(f);
  });
  // 回复交出去了；这个项目在跑的已经满了，回复先排队（内容 1.3.9）
  const replied = r => { if (r && r.status === 'queued') toast(`这个项目同时在跑的已经有 ${B.parallel || 3} 个，回复排上队了`); };
  // 任务按钮（右栏和中间放大的对话框共用）：停止、好继续、重试、放大、看指令、回复
  const afterTask = () => { loadRuns(); refreshProjects(); poll(); const t = curTab(); if (t && t.conv) reloadDoc(); };
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {}
    const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select();
    const ok = document.execCommand('copy'); t.remove(); return ok;
  }
  async function taskClick(e) {
    const ci = e.target.closest('[data-copyinst]'); if (ci) {
      const r = (S.allRuns || []).find(x => x.id === ci.dataset.copyinst) || (S.runs || []).find(x => x.id === ci.dataset.copyinst);
      if (r) copyInstall(installWhat(r), r.engine);
      return true;
    }
    const st = e.target.closest('[data-stop]'); if (st) { try { await api(`runs/${st.dataset.stop}/stop`, 'POST', {}); afterTask(); } catch (err) { toast(err.message); } return true; }
    const sg = e.target.closest('[data-sugg-go]'); if (sg) { runSuggest(sg); return true; }
    if (e.target.closest('[data-sugg-todo]')) { suggestToTodo(); return true; }
    if (e.target.closest('[data-sugg-alt]')) { const s = suggest(proj()); if (s && s.alt) runAct(s.alt.act); return true; }
    const sx = e.target.closest('[data-sugg-x]'); if (sx) { dismissSuggest(sx.dataset.suggX); return true; }
    const cl = e.target.closest('[data-clear]'); if (cl) { try { await api('runs/clear', 'POST', { id: cl.dataset.clear }); if (S.expanded === cl.dataset.clear) S.expanded = null; afterTask(); } catch (err) { toast(err.message); } return true; }
    if (e.target.closest('[data-clear-all]')) { try { const r = await api('runs/clear', 'POST', { project: B.current }); toast(`清除了 ${r.cleared} 个任务（记录还在）`); afterTask(); } catch (err) { toast(err.message); } return true; }
    const qr = e.target.closest('[data-qreply]'); if (qr) { try { replied(await api(`runs/${qr.dataset.qreply}/reply`, 'POST', { text: qr.dataset.text })); afterTask(); } catch (err) { toast(err.message); } return true; }
    const qo = e.target.closest('[data-qopen]'); if (qo) { openAsk(qo.dataset.qopen); return true; }
    const af = e.target.closest('[data-askfor]'); if (af) { openAsk(af.dataset.askfor); return true; }
    const qk = e.target.closest('[data-quick]'); if (qk) { try { replied(await api(`runs/${qk.dataset.quick}/reply`, 'POST', { text: '好，继续' })); afterTask(); } catch (err) { toast(err.message); } return true; }
    const rt = e.target.closest('[data-retry]');
    if (rt) {
      try {
        const r = await api(`runs/${rt.dataset.retry}/retry`, 'POST', { engine: rt.dataset.engine || '' }); S.expanded = r.id;
        toast(r.status === 'queued' ? '已排队' : `已交给 ${engineName(r.engine)}`);
        const t = curTab(); if (t && t.conv && t.conv !== r.id) { closeTab(t.id); openConv(r); }
        afterTask();
      } catch (err) { toast(err.message); }
      return true;
    }
    if (e.target.closest('[data-help]')) { openSettings(); return true; }
    const cv = e.target.closest('[data-conv]'); if (cv) { const r = S.runs.find(x => x.id === cv.dataset.conv); if (r) openConv(r); return true; }
    const pr = e.target.closest('[data-prompt]'); if (pr) { try { const r = await api(`runs/${pr.dataset.prompt}/prompt`, 'GET', { turn: 1 }); modal('指令', `<pre class="prompt">${esc(r.text)}</pre>`, true); } catch (err) { toast(err.message); } return true; }
    const rp = e.target.closest('[data-reply]');
    if (rp) {
      const id = rp.dataset.reply, ta = rp.closest('.askbox').querySelector('textarea'); let text = ta ? ta.value.trim() : '';
      if (S.attBusy) { toast('附件还在放进来，等一下'); return true; }
      if (!text && attList(id).length) text = '先看一下这些附件，告诉我是什么、要我做什么之前先问我。';
      if (!text) { if (ta) ta.focus(); return true; }
      try { ta.blur(); replied(await api(`runs/${id}/reply`, 'POST', { text: text + attachNote(id) })); ta.value = ''; if (S.convDraft) delete S.convDraft[id]; if (S.convAtt) delete S.convAtt[id]; drawAtts(id); afterTask(); } catch (err) { toast(err.message); }
      return true;
    }
    const ct = e.target.closest('[data-conv-todo]');
    if (ct) {
      const id = ct.dataset.convTodo, ta = $('#pane-main .convfoot textarea'), text = ta ? ta.value.trim() : '';
      if (!text) { if (ta) ta.focus(); return true; }
      if (S.attBusy) { toast('附件还在放进来，等一下'); return true; }
      try { askNotify(); const r = await api('todos/split', 'POST', { text: text + attachNote(id), project: B.current }); S.todos = { items: r.items, splitting: r.splitting }; toast('交给 AI 整理了，整理好会放进 Dashboard 的「待办」'); ta.value = ''; if (S.convDraft) delete S.convDraft[id]; if (S.convAtt) delete S.convAtt[id]; drawAtts(id); loadRuns(); poll(); }
      catch (err) { toast(err.message); }
      return true;
    }
    return false;
  }
  $('#right').addEventListener('change', e => {
    if (e.target.matches('[data-td-done]')) { api('todos/done', 'POST', { id: e.target.dataset.tdDone, done: e.target.checked }).then(r => { S.todos = r; renderTodos(); }, err => toast(err.message)); return; }
  });
  $('#right').addEventListener('click', async e => {
    if (dashClick(e)) return; // 气泡里「收件箱不开新任务」那句的「新建项目」
    { const x = e.target.closest('[data-att-x]'); if (x) { attList(x.dataset.attHost).splice(+x.dataset.attX, 1); drawAtts(x.dataset.attHost); return; } }
    const gc = e.target.closest('[data-goconv]'); if (gc) return goConv(gc.dataset.goconv);
    const ex = e.target.closest('[data-expand]'); if (ex) { S.expanded = S.expanded === ex.dataset.expand ? null : ex.dataset.expand; return renderTasks(); }
    if (await taskClick(e)) return;
    const f = e.target.closest('[data-file]'); if (f) return openDoc(f.dataset.file);
    if (e.target.closest('[data-ask-go]')) return sendAsk(e.target.closest('[data-ask-go]'));
    if (e.target.closest('[data-ask-todo]')) return splitTodo(e.target.closest('[data-ask-todo]'));
    if (e.target.closest('[data-askopen]')) return S.askOpen ? closeAsk() : openAsk();
    const am = e.target.closest('[data-amode]'); if (am) { S.amode = am.dataset.amode; drawAsk(); const ta = $('#askText'); if (ta) ta.focus(); return; }
    const ep = e.target.closest('[data-engpick]'); if (ep) return engineMenu(ep);
    const m = e.target.closest('[data-fmode]'); if (m) { S.fileMode = m.dataset.fmode; return renderFiles(); }
    const a = e.target.closest('[data-act]'); if (a && a.dataset.act === 'refresh-files') return loadFiles();
  });
  // 回到窗口时重新读一遍项目和文件（用户可能在访达里改了东西）；内容没变就不动页面
  window.addEventListener('focus', () => { refreshProjects(); loadFiles(); loadUpd(); });
  // App 启动 8 秒后自己查一次更新、之后每 6 小时一次（app/main.cjs）；这边跟着读状态
  setTimeout(loadUpd, 1000); setTimeout(loadUpd, 15000); setInterval(loadUpd, 30 * 60 * 1000);

  if (B.contentError) $('#banner').innerHTML = `<div class="banner">${B.contentError.recovered ? '新内容加载失败，已退回 App 自带的版本：' : '内容加载失败：'}${esc(B.contentError.message)}</div>`;
  renderAll(); loadFiles(); loadRuns(); loadTodos(); loadFacts(); if (proj() && proj().inbox) loadPlan();
  // AI 程序在后台检测（内容 1.1.7 起，启动不再等它）：还在查就过一会儿再取一次配置，最多等 20 秒
  (function waitEngines(n) {
    if (!(B.engines || []).some(e => e.checking) || n > 50) return;
    setTimeout(async () => { try { Object.assign(B, await api('config')); renderAll(); } catch {} waitEngines(n + 1); }, 400);
  })(0);
  // 把文件拖到左栏的收件箱或某个项目上：复制进那个文件夹最上层（10-22 起项目也行，原来只有收件箱）。
  // App 里拿得到文件路径就由工作站直接复制、不限大小；拿不到（日常版、旧外壳）读成 base64 传，每个最大 25MB。
  // 把文件夹拖到项目栏空白处：这个文件夹变成项目（和「打开文件夹…」一样，只加 .工作站/，不动原有文件）。
  // 要知道文件夹在电脑上的路径，得靠外壳 1.1.0 起的 popperHost；旧外壳、日常版（浏览器窗口）里没有，提示用「打开文件夹…」
  const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes('Files');
  const projZone = () => $('#left .scroll');
  $('#left').addEventListener('dragover', e => {
    if (!hasFiles(e)) return;
    const ib = e.target.closest('.proj:not(.gone)'), zone = e.target.closest('#left .scroll, #left .lhead');
    if (!ib && !zone) return;
    e.preventDefault(); e.stopPropagation();
    if (ib) { document.querySelectorAll('#left .proj.drop').forEach(x => x !== ib && x.classList.remove('drop')); ib.classList.add('drop'); projZone()?.classList.remove('drop'); } else projZone()?.classList.add('drop');
  });
  $('#left').addEventListener('dragleave', e => {
    const ib = e.target.closest('.proj'); if (ib && !ib.contains(e.relatedTarget)) ib.classList.remove('drop');
    if (!e.relatedTarget || !$('#left').contains(e.relatedTarget)) projZone()?.classList.remove('drop');
  });
  $('#left').addEventListener('drop', async e => {
    projZone()?.classList.remove('drop');
    const ib = e.target.closest('.proj');
    if (!ib && e.target.closest('#left .scroll, #left .lhead') && hasFiles(e)) { e.preventDefault(); e.stopPropagation(); return dropFolders(e); }
    if (!ib) return; e.preventDefault(); e.stopPropagation(); ib.classList.remove('drop');
    const p = (B.projects || []).find(x => x.id === ib.dataset.proj);
    if (!p || !p.exists) return toast('这个项目的文件夹找不到了');
    const where = p.inbox ? '收件箱' : `「${p.name}」`;
    // 文件夹分出来（要在 await 之前取，拖放数据过后就读不到了）：项目里不收文件夹
    const items = [...(e.dataTransfer.items || [])].filter(i => i.kind === 'file');
    const isDir = items.map(i => { const en = i.webkitGetAsEntry && i.webkitGetAsEntry(); return !!(en && en.isDirectory); });
    const files = items.map(i => i.getAsFile()).filter((f, k) => f && !isDir[k]);
    if (isDir.some(Boolean)) toast(`文件夹不能拖进${where}：拖到项目栏空白处会变成一个新项目；要放进这个项目，请在访达里拖进它的文件夹`);
    let n = 0;
    for (const f of files) {
      const from = window.popperHost ? window.popperHost.pathOf(f) : '';
      if (!from && f.size > 25 * 1024 * 1024) { toast(`${f.name} 超过 25MB，请在访达里直接放进${where}文件夹`); continue; }
      try {
        const body = from ? { id: p.id, name: f.name, from } : { id: p.id, name: f.name, data: await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(f); }) };
        await api('projects/upload', 'POST', body); n++;
      } catch (err) { toast(`${f.name}：${err.message}`); }
    }
    if (n) { toast(`${n} 个文件放进了${where}${p.inbox ? '' : '（在项目最上层）'}`); refreshProjects(); if (p.id === B.current) loadFiles(); }
  });
  async function dropFolders(e) {
    const items = [...(e.dataTransfer.items || [])].filter(i => i.kind === 'file');
    const dirs = items.filter(i => { const en = i.webkitGetAsEntry && i.webkitGetAsEntry(); return en && en.isDirectory; }).map(i => i.getAsFile()).filter(Boolean);
    if (!dirs.length) return toast('拖文件夹进来新建项目；文件请拖到收件箱');
    if (!window.popperHost) return toast('这个版本还不能拖文件夹，用「项目 +」→「打开文件夹…」');
    let n = 0;
    for (const f of dirs) {
      const dir = window.popperHost.pathOf(f);
      if (!dir) { toast(`${f.name}：拿不到文件夹位置，用「打开文件夹…」`); continue; }
      try { Object.assign(B, await api('projects/open', 'POST', { dir })); n++; } catch (err) { toast(`${f.name}：${err.message}`); }
    }
    if (n) { renderAll(); loadFiles(); loadRuns(); toast(n > 1 ? `加了 ${n} 个项目` : '项目加好了'); }
  }
  // 气泡附件：拖到右栏 AI 卡（气泡没开就打开）、在输入框里粘贴图片 / 文件
  $('#r-agent').addEventListener('dragover', e => { if ([...(e.dataTransfer.types || [])].includes('Files')) { e.preventDefault(); e.stopPropagation(); $('#r-agent').classList.add('drag'); } });
  $('#r-agent').addEventListener('dragleave', e => { if (!e.relatedTarget || !$('#r-agent').contains(e.relatedTarget)) $('#r-agent').classList.remove('drag'); });
  $('#r-agent').addEventListener('drop', e => {
    const items = [...(e.dataTransfer.items || [])].filter(i => i.kind === 'file'); if (!items.length) return;
    e.preventDefault(); e.stopPropagation(); $('#r-agent').classList.remove('drag');
    const dirs = items.filter(i => { const en = i.webkitGetAsEntry && i.webkitGetAsEntry(); return en && en.isDirectory; });
    if (dirs.length) toast('文件夹不能当附件：拖文件进来，或者在对话里说文件夹的位置');
    addAttach(items.filter(i => !dirs.includes(i)).map(i => i.getAsFile()).filter(Boolean));
  });
  $('#pane-main').addEventListener('paste', e => {
    const id = e.target.matches && e.target.matches('.convfoot textarea[data-reply-text]') && e.target.dataset.replyText; if (!id) return;
    const files = [...(e.clipboardData && e.clipboardData.files || [])]; if (!files.length) return;
    e.preventDefault(); addAttach(files, id);
  });
  $('#right').addEventListener('paste', e => {
    if (e.target.id !== 'askText') return;
    const files = [...(e.clipboardData && e.clipboardData.files || [])]; if (!files.length) return;
    e.preventDefault(); addAttach(files);
  });
  // 对话气泡：回车发出去（Shift+回车换行），Esc 收起
  $('#right').addEventListener('keydown', e => {
    if (e.target.id !== 'askText') return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendAsk($('#r-agent [data-ask-go]')); }
    if (e.key === 'Escape') closeAsk();
  });
  api('runs', 'GET').then(all => { S.allRuns = all; for (const r of all) seen.set(r.id, r.status); if (all.some(r => ['running', 'stopping', 'queued'].includes(r.status))) poll(); }).catch(() => {});
})();
