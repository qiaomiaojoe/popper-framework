// 「桥」：工作站送出每个工作流页面时，插在 <head> 最前面的这段脚本（下面 CTX 的值由运行时换成当前项目等信息）。
// 它做四件事，工作流本身一行不用改：
// 1. 把「复制」按钮改成「执行」；
// 2. 截下按钮要复制的那段指令，交给工作站（工作站在前面加上项目信息，再交给 AI）；
// 3. 在工作站里替换工作流声明过的说明文字（说明块里的「工作站文案」）；
// 4. 提供 window.AIWS：当前项目、run(指令)、chain(一串指令，自动模式)、open(路径)、skills（这个项目的 AI 装着的 skill），给想接得更紧的工作流用；
//    engines / engine：自动模式每段能选哪些 AI（只有名字）、这个项目用的哪个，chain 的每段可以带 engine（内容 1.3.0）；
//    任务跑完后工作站会发来新的文件清单，AIWS.project.files 原地更新，并发出 aiws:files 事件。
// 工作流页面和工作站不同源，只能通过 postMessage 说话；工作站那边会核对消息来自哪个工作流。
(function () {
  'use strict';
  var CTX = __CTX__;
  function post(m) { m.__aiws = 1; try { parent.postMessage(m, CTX.parentOrigin); } catch (e) {} }

  // ---------- 记下最近一次点的按钮：截到的指令必须来自用户刚点的按钮 ----------
  var last = { label: '', title: '', at: 0, x: 0, y: 0, el: null };
  // 按钮交出去的任务叫什么：按钮上写的 data-aiws-title，没有就用所在区块的标题
  function btnTitle(b) {
    var sec = b.closest('[data-aiws-section],section,.panel'), h = sec && sec.querySelector('h1,h2,h3');
    return b.getAttribute('data-aiws-title') || (h && h.innerText.trim().slice(0, 60)) || '';
  }
  document.addEventListener('click', function (e) {
    if (!e.isTrusted) return; // 页面自己用脚本「点」的不算
    var b = e.target && e.target.closest && e.target.closest('button,a,[role=button]');
    if (!b) return;
    // x、y：点的位置（框内坐标），工作站拿它画「交出去」的飞点
    last = { label: (b.innerText || '').trim().slice(0, 60), title: btnTitle(b), at: Date.now(), x: Math.round(e.clientX), y: Math.round(e.clientY), el: b };
  }, true);

  // ---------- 这一步在跑（内容 1.4.1）：点了「执行」的按钮马上变灰；工作站发来还没结束的任务名，对得上的按钮灰着、标「运行中」，结束了恢复 ----------
  // 只动桥自己灰掉的按钮（页面本来就灰着的不碰）；交出去 10 秒还没被工作站认成「在跑」（比如缺 skill 的确认框点了取消），自己恢复
  var busy = [], held = [], name = (CTX.workflow && CTX.workflow.name) || '';
  var isBusyTitle = function (t) { if (!t) return false; for (var i = 0; i < busy.length; i++) if (busy[i] === t || busy[i] === name + ' · ' + t || busy[i].slice(-(t.length + 3)) === ' · ' + t) return true; return false; };
  function hold(b, sure) {
    if (!b || b.tagName !== 'BUTTON') return;
    if (!b.hasAttribute('data-aiws-busy')) { if (b.disabled) return; b.disabled = true; b.setAttribute('data-aiws-busy', ''); }
    for (var i = 0; i < held.length; i++) if (held[i].b === b) { if (sure) held[i].sure = true; return; }
    held.push({ b: b, at: Date.now(), sure: !!sure });
  }
  function release() {
    for (var i = held.length - 1; i >= 0; i--) {
      var h = held[i], on = h.b.isConnected && isBusyTitle(btnTitle(h.b));
      if (on) { h.sure = true; continue; }
      if (!h.sure && Date.now() - h.at < 10000) continue; // 刚交出去，工作站还没开出任务
      h.b.disabled = false; h.b.removeAttribute('data-aiws-busy'); held.splice(i, 1);
    }
  }
  function markBusy() {
    if (!document.body) return;
    if (busy.length) { var bs = document.body.querySelectorAll('button'); for (var i = 0; i < bs.length; i++) if (/执行|复制/.test(bs[i].textContent) && isBusyTitle(btnTitle(bs[i]))) hold(bs[i], true); }
    release();
  }
  setInterval(release, 2000);
  document.addEventListener('DOMContentLoaded', function () {
    var st = document.createElement('style');
    st.textContent = 'button[data-aiws-busy]{opacity:.55!important;cursor:progress!important}button[data-aiws-busy]::after{content:" · 运行中"}';
    (document.head || document.documentElement).appendChild(st);
  });
  var recent = function () { return Date.now() - last.at < 5000; }; // 有的按钮先生成再复制，留几秒余量
  var lastSent = { text: '', at: 0 };
  function capture(text) {
    text = String(text || '');
    if (text.trim().length < 20 || !recent()) return false; // 太短的多半不是指令（比如一个文件名）；不是刚点按钮触发的不截
    if (lastSent.text === text && Date.now() - lastSent.at < 5000) return true; // 页面复制失败时会再走一遍旧式复制，同一段别交两次
    lastSent = { text: text, at: Date.now() };
    post({ type: 'run', text: text, title: last.title, label: last.label, at: { x: last.x, y: last.y } });
    hold(last.el);
    last.at = 0;
    return true;
  }

  // ---------- 截剪贴板：现代写法（navigator.clipboard）和旧式写法（execCommand('copy')）都截 ----------
  try {
    if (window.Clipboard && Clipboard.prototype.writeText) {
      var original = Clipboard.prototype.writeText;
      Clipboard.prototype.writeText = function (t) { return capture(t) ? Promise.resolve() : original.apply(this, arguments); };
    }
  } catch (e) {}
  try {
    if (!navigator.clipboard) Object.defineProperty(navigator, 'clipboard', { configurable: true,
      value: { writeText: function (t) { capture(t); return Promise.resolve(); }, readText: function () { return Promise.resolve(''); } } });
  } catch (e) {}
  var originalExec = Document.prototype.execCommand;
  Document.prototype.execCommand = function (cmd) {
    if (String(cmd).toLowerCase() === 'copy') {
      var el = document.activeElement;
      var t = el && typeof el.value === 'string' && el.selectionEnd > el.selectionStart ? el.value.slice(el.selectionStart, el.selectionEnd) : String(document.getSelection() || '');
      if (capture(t)) return true;
    }
    return originalExec.apply(this, arguments);
  };

  // ---------- 改字：按钮上的「复制」→「执行」；工作流声明过的说明文字按它给的对照替换 ----------
  var BUTTON = [[/复制到剪贴板/g, '执行'], [/复制/g, '执行']];
  var TEXTS = (CTX.texts || []).filter(function (p) { return p && p[0]; });
  function rewrite(node, pairs) {
    var v = node.nodeValue, x = v;
    for (var i = 0; i < pairs.length; i++) x = typeof pairs[i][0] === 'string' ? x.split(pairs[i][0]).join(pairs[i][1]) : x.replace(pairs[i][0], pairs[i][1]);
    if (x !== v) node.nodeValue = x; // 只在有变化时写，免得和观察器互相触发
  }
  function relabel() {
    if (!document.body) return;
    var bs = document.body.querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) {
      var b = bs[i];
      if (!/复制/.test(b.textContent) || /导出/.test(b.textContent)) continue;
      var w = document.createTreeWalker(b, NodeFilter.SHOW_TEXT), n;
      while ((n = w.nextNode())) rewrite(n, BUTTON);
      if (/复制/.test(b.title)) b.title = b.title.replace(/复制/g, '执行');
    }
    if (!TEXTS.length) return;
    var tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT), t;
    while ((t = tw.nextNode())) {
      var p = t.parentElement;
      if (!p || p.closest('textarea,pre,code,script,style,[contenteditable],button')) continue; // 指令原文、输入框不碰
      rewrite(t, TEXTS);
    }
  }
  // 用定时器而不是 requestAnimationFrame：页面不可见时浏览器会暂停后者
  var pending = false;
  new MutationObserver(function () {
    if (pending) return; pending = true;
    setTimeout(function () { pending = false; relabel(); markBusy(); }, 30);
  }).observe(document, { childList: true, subtree: true, characterData: true });
  document.addEventListener('DOMContentLoaded', relabel);

  // ---------- 给工作流用的接口 ----------
  var MAX_CHAIN = 12; // 自动模式最多几段；工作站（ui.js）和运行时（runtime.cjs）也卡同一个数
  window.AIWS = {
    project: CTX.project, workflow: CTX.workflow, agentName: CTX.agentName || 'Research Agent', autoState: null,
    engines: CTX.engines || [], engine: CTX.engine || '',
    // 这个项目的 AI 装着的 skill（内容 1.4.1）：[{ name, purpose }]，页面载入后工作站发来，原地更新并发 aiws:skills 事件
    skills: [],
    // 不经过剪贴板直接交给工作站。必须由用户点击触发，页面不能自己偷偷发
    // （这里只是先挡一道；工作站收到消息后自己还会核对用户刚碰过这个工作流，见 ui.js）
    run: function (text, opt) {
      var active = navigator.userActivation ? navigator.userActivation.isActive : recent();
      if (!active && !recent()) return false;
      post({ type: 'run', text: String(text), title: (opt && opt.title) || last.title, label: last.label, at: { x: last.x, y: last.y } });
      if (recent()) hold(last.el);
      return true;
    },
    // 自动模式：一串任务交给工作站按顺序跑（上一个做完才开下一个）。同样必须由用户点击触发
    chain: function (steps, opt) {
      var active = navigator.userActivation ? navigator.userActivation.isActive : recent();
      if (!active && !recent()) return false;
      if (!steps || !steps.length || steps.length > MAX_CHAIN) return false; // 超过上限整条不收，免得悄悄少跑几段
      post({ type: 'chain', steps: steps.map(function (x) { return { title: String(x.title || '').slice(0, 60), text: String(x.text || ''), engine: String(x.engine || '').slice(0, 40) }; }), title: (opt && opt.title) || '', at: { x: last.x, y: last.y } });
      return true;
    },
    open: function (p) { post({ type: 'open', path: String(p) }); },
    // 工作站点了「下一步」建议、要这一阶段直接执行（10-18）：工作站发来一次性的 nonce，页面拼好指令带着它交回去。
    // 不要求在页面里点击（用户是在工作站里点的），工作站只认它自己刚发出去、15 秒内的那个 nonce
    runFor: function (nonce, text, opt) { if (!nonce) return false; post({ type: 'run', text: String(text), title: (opt && opt.title) || '', nonce: String(nonce) }); return true; }
  };
  // 任务跑完、项目里文件变了：工作站发来新的文件清单。原地更新 AIWS.project.files（工作流里存着的引用跟着变），
  // 再发一个 aiws:files 事件，工作流听到后重算阶段条等。只认工作站（父窗口）发来的
  window.addEventListener('message', function (e) {
    var d = e.data;
    // 自动模式进度（10-18）：第几段 / 共几段、状态、这一段的任务名；整条跑完时带汇总。存在 AIWS.autoState，发 aiws:chain 事件
    // 跳到某个阶段（下一步建议）：stage = 说明块「阶段」里的序号；preset = 预填的输入；nonce = 要直接执行
    if (e.source === parent && e.origin === CTX.parentOrigin && d && d.__aiws === 1 && d.type === 'go' && typeof d.stage === 'number') {
      try { window.dispatchEvent(new CustomEvent('aiws:go', { detail: { stage: d.stage, preset: d.preset && typeof d.preset === 'object' ? d.preset : null, nonce: d.nonce ? String(d.nonce) : '' } })); } catch (err) {}
      return;
    }
    if (e.source === parent && e.origin === CTX.parentOrigin && d && d.__aiws === 1 && d.type === 'skills' && Array.isArray(d.skills)) {
      var sk = window.AIWS.skills; sk.length = 0;
      for (var j = 0; j < d.skills.length && j < 400; j++) if (d.skills[j] && d.skills[j].name) sk.push({ name: String(d.skills[j].name).slice(0, 80), purpose: String(d.skills[j].purpose || '其他').slice(0, 20) });
      try { window.dispatchEvent(new Event('aiws:skills')); } catch (err) {}
      return;
    }
    if (e.source === parent && e.origin === CTX.parentOrigin && d && d.__aiws === 1 && d.type === 'busy' && Array.isArray(d.titles)) {
      busy = d.titles.slice(0, 50).map(String); markBusy();
      try { window.dispatchEvent(new CustomEvent('aiws:busy', { detail: { titles: busy.slice() } })); } catch (err) {}
      return;
    }
    if (e.source === parent && e.origin === CTX.parentOrigin && d && d.__aiws === 1 && d.type === 'chain' && d.state && typeof d.state === 'object') {
      window.AIWS.autoState = d.state;
      try { window.dispatchEvent(new CustomEvent('aiws:chain', { detail: d.state })); } catch (err) {}
      return;
    }
    if (e.source !== parent || e.origin !== CTX.parentOrigin || !d || d.__aiws !== 1 || d.type !== 'files' || !Array.isArray(d.files) || !CTX.project) return;
    var list = CTX.project.files; list.length = 0;
    for (var i = 0; i < d.files.length && i < 500; i++) list.push(String(d.files[i]));
    try { window.dispatchEvent(new Event('aiws:files')); } catch (err) {}
  });
  window.addEventListener('load', function () { post({ type: 'ready', title: document.title }); });
})();
