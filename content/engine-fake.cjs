'use strict';
// 开发用的「假 AI」：只在开发模式里出现。不调用任何真 AI、不花额度，用来测「执行 → 任务 → 活动记录」这条链路。
// 收到指令后过一会儿回一句话，并把收到的指令原文存进工作目录的 .工作站/假AI-收到的指令.txt，方便核对工作站交出去的是什么。
// 指令里有「【测试：失败】」模拟出错、「【测试：满载】」模拟模型满载（重试时恢复）、「【测试：长回复】」回一段 Markdown；「【测试：慢】」多等几秒（方便测停止、排队）；「【测试：问我】」停下来问你；「【测试：写文件】」在项目里写一个文件；「【测试：多步】」像真 AI 一样一步步报动作（读、用 skill、待办、查 Zotero、写文件、额度），测右栏的实时动作流。
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

module.exports = {
  id: 'fake', name: '测试用假 AI', binTitle: '（不需要选择程序）',
  locate: () => ({ best: { version: '开发用 · 不花额度', label: '开发模式自带', path: '' }, tried: [] }),
  models: () => [],
  skillDirs: () => [], // 假 AI 什么 skill 都没有：用来测「缺少 skill」的提示
  hasMcp: () => false,
  missingHint: '',
  start(bin, { cwd, prompt, sessionId, emit, onExit }) {
    const child = { exitCode: null, timer: null, onExit };
    const id = sessionId || 'fake-' + crypto.randomBytes(4).toString('hex');
    const delay = /【测试：慢】/.test(prompt) ? 8000 : 1200;
    emit({ kind: 'session', id, model: 'fake' });
    // 【测试：多步】：每 0.9 秒报一个动作（开始 → 做完），最后写一个文件、报一次额度，再照常收尾
    if (/【测试：多步】/.test(prompt)) {
      const f = path.join(cwd, '假AI多步-' + Date.now() + '.md');
      const plan = [
        { type: 'read', text: 'Read ' + path.join(cwd, 'AGENTS.md') },
        { type: 'skill', text: 'manuscript-diagnosis' },
        { type: 'todo_list', todos: [{ text: '读稿', completed: true }, { text: '诊断', completed: false }, { text: '写诊断', completed: false }] },
        { type: 'mcp_tool_call', text: 'zotero · zotero_search_items' },
        { type: 'command_execution', text: 'sed -n 1,80p ' + path.join(cwd, '写作', '全文初稿.md') },
        { type: 'todo_list', todos: [{ text: '读稿', completed: true }, { text: '诊断', completed: true }, { text: '写诊断', completed: false }] },
        { type: 'file_change', files: [{ path: f, kind: 'add' }], write: true }
      ];
      let i = 0;
      const tick = () => {
        if (child.exitCode !== null) return;
        if (i === plan.length) { i++; child.timer = setTimeout(tick, 2500); return; } // 写完文件后像真 AI 一样再收个尾
        if (i < plan.length) {
          const s = plan[i], sid = 'fs' + i++, { write, ...item } = s;
          emit({ kind: 'item', item: { id: sid, status: s.type === 'todo_list' ? 'completed' : 'in_progress', ...item } });
          child.timer = setTimeout(() => {
            if (write) try { fs.writeFileSync(f, '# 假 AI 多步测试写的文件\n'); } catch {}
            if (s.type !== 'todo_list') emit({ kind: 'item', item: { id: sid, status: 'completed', ...item } });
            child.timer = setTimeout(tick, 400);
          }, 900);
          return;
        }
        emit({ kind: 'quota', quota: { status: 'ok', pct: 41, resetsAt: Date.now() + 2 * 3600e3, at: Date.now() } });
        emit({ kind: 'item', item: { id: 'm1', type: 'agent_message', status: 'completed', text: '（假 AI）多步测试做完了。\n\n【完成】' } });
        emit({ kind: 'usage', usage: { input: 0, output: 0, cached: 0 } });
        child.exitCode = 0; onExit(0);
      };
      child.timer = setTimeout(tick, 600);
      return child;
    }
    child.timer = setTimeout(() => {
      try { fs.mkdirSync(path.join(cwd, '.工作站'), { recursive: true }); fs.writeFileSync(path.join(cwd, '.工作站', '假AI-收到的指令.txt'), prompt); } catch {}
      if (/【测试：失败】/.test(prompt)) { emit({ kind: 'error', message: '（假 AI）按要求模拟出错' }); child.exitCode = 1; return onExit(1); }
      if (/【测试：满载】/.test(prompt) && !/中断了/.test(prompt)) { emit({ kind: 'error', message: 'Selected model is at capacity. Please try a different model.' }); child.exitCode = 1; return onExit(1); }
      // 收件箱梳理的指令（里面要求写 .工作站/梳理计划.json）：按文件名胡乱分一下，写一份计划（测梳理流程）
      if (/\.工作站\/梳理计划\.json/.test(prompt)) try {
        const files = ((prompt.split('【要梳理的新文件】')[1] || '').split('【我的项目】')[0].match(/^- (.+)$/gm) || []).map(s => s.slice(2).trim());
        const pid = (prompt.match(/\[id:([^\]]+)\]/) || [])[1] || 'keep';
        const items = files.map((n, i) => /文献|ref|清单/i.test(n) ? { file: n, kind: '文献清单', project: pid, folder: '文献/', reason: '（假 AI）文件名像文献清单', follow: [] }
          : /\.pdf$/i.test(n) ? { file: n, kind: '论文PDF', project: pid, folder: '文献/PDF/', reason: '（假 AI）是 PDF', follow: ['pdfzotero'] }
          : i % 2 ? { file: n, kind: '其他', project: 'keep', folder: '', reason: '（假 AI）看不出属于哪个项目', follow: [] }
          : { file: n, kind: '笔记', project: 'new:假AI建议的新项目', folder: '写作/', reason: '（假 AI）像一个新课题', follow: [] });
        fs.mkdirSync(path.join(cwd, '.工作站'), { recursive: true });
        fs.writeFileSync(path.join(cwd, '.工作站', '梳理计划.json'), JSON.stringify({ items }, null, 2));
      } catch {}
      // 【测试：写文件】在项目里写一个文件（测产出识别）；【测试：问我】停下来问你（测「等你回复」）
      if (/【测试：写文件】/.test(prompt)) try { fs.writeFileSync(path.join(cwd, '假AI写的-' + Date.now() + '.md'), '# 假 AI 写的测试文件\n'); } catch {}
      const long = /【测试：长回复】/.test(prompt) ? '\n\n## 阶段 1 结果\n\n| # | 文献 | 状态 |\n|---|---|---|\n| 1 | Kelchtermans 2009 | **已验真** |\n| 2 | Day 2018 | 可疑 |\n\n- 第一条\n- 第二条，带 `代码`\n\n> 引用一段' : '';
      const ask = /【测试：问我】/.test(prompt) && !/^(好|继续)/.test(prompt.trim());
      emit({ kind: 'item', item: { id: 'm1', type: 'agent_message', status: 'completed', text: `（假 AI）收到指令，共 ${prompt.length} 字。第一行是：${prompt.split('\n')[0].slice(0, 60)}` + long + (ask ? '\n\n第一段做完了。要按这个方向接着做吗？\n【等你回复】' : '\n\n【完成】') } });
      emit({ kind: 'usage', usage: { input: 0, output: 0, cached: 0 } });
      child.exitCode = 0; onExit(0);
    }, delay);
    return child;
  },
  stop(child) { if (child && child.exitCode === null) { clearTimeout(child.timer); child.exitCode = 143; child.onExit(143); } },
  friendlyError: msg => msg
};
