// 任务4 + 任务5 的编排层：
// 维护会话上下文 -> 调模型 -> 模型要调工具就真的执行 -> 把结果回填 -> 再问一轮拿自然语言总结。
import { streamCompletion } from './deepseek.js';
import { TOOL_DEFINITIONS, executeTool } from './tools.js';
import { listItems } from '../db.js';
import { config } from '../config.js';

export const SYSTEM_PROMPT = `你是「一句话清单」的智能助手，帮用户管理他的待办清单。

规则：
1. 用户要新增任务、查询清单、把任务标记完成时，必须调用对应工具，不要只用文字答应。
2. 调用工具前不需要征求同意，直接调用；工具返回后用一句简短中文总结结果。
3. 不要编造条目 id、标题或数量，一切以工具返回的数据为准。
4. 用户只是闲聊时正常回答，不要滥用工具。
5. 回复控制在 3 句话以内，语气自然，不要输出 Markdown 标题。`;

// 模型不知道「今天是几号」，不告诉它就会把「明天」算成 2026-06-11（真实踩过）。
// 每次请求现算一遍，跨天也不会错。
export function currentDatePrompt(now = new Date()) {
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const weekday = '日一二三四五六'[now.getDay()];
  return `当前日期：${iso}（周${weekday}）。凡是「今天/明天/后天/周五」这类相对日期，先按这个基准换算成 YYYY-MM-DD 再传给工具，不要自己猜。`;
}

// sessionId -> { messages, updatedAt }；进程内存即可，重启后历史清空是预期行为
const sessions = new Map();
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_ROUNDS = 3;

export function getSession(sessionId) {
  return sessions.get(sessionId)?.messages ?? [];
}

export function resetSession(sessionId) {
  sessions.delete(sessionId);
}

export function resetAllSessions() {
  sessions.clear();
}

function pruneSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.updatedAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

// 超长截断：保留 system + 最近 N 条（N = historyLimit），最早的先丢
function trimHistory(messages) {
  const keep = config.historyLimit;
  return messages.length <= keep ? messages : messages.slice(messages.length - keep);
}

function saveTurn(sessionId, userText, assistantText) {
  pruneSessions();
  const prev = sessions.get(sessionId)?.messages ?? [];
  const next = trimHistory([
    ...prev,
    { role: 'user', content: userText },
    { role: 'assistant', content: assistantText },
  ]);
  sessions.set(sessionId, { messages: next, updatedAt: Date.now() });
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      },
      { once: true }
    );
  });

/* ------------------------------------------------------------------ */
/* 离线演示模式：没有 Key 时用规则模拟「模型决定调哪个工具」            */
/* ------------------------------------------------------------------ */

const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

function guessDue(text) {
  const now = new Date();
  const addDays = (n) => {
    const d = new Date(now);
    d.setDate(d.getDate() + n);
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${d.getFullYear()}-${mm}-${dd}`;
  };
  if (/大后天/.test(text)) return addDays(3);
  if (/后天/.test(text)) return addDays(2);
  if (/明天|明日/.test(text)) return addDays(1);
  if (/今天|今晚/.test(text)) return addDays(0);
  if (/周[一二三四五六日天]/.test(text)) return addDays(1);
  const exact = text.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (exact) {
    const [, y, m, d] = exact;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

function extractTitle(text) {
  return text
    .replace(/^(帮我|请|麻烦你?|给我|把|将)/, '')
    .replace(/(加|记|新增|添加|建)(一?条|一下|个)?/, '')
    .replace(/^(提醒我|别忘了我?|记得)/, '')
    .replace(/[。.!！?？~～\s]+$/, '')
    .trim();
}

async function mockAgent({ message, history = [], signal, send }) {
  const text = message.trim();
  const decided = [];

  // 上下文能力：演示模式也要能回答「我刚才说了什么」，
  // 否则任务 4「连续 3 轮上下文」在没 Key 的时候就完全失效。
  if (/(我刚才|刚才我|第一句|上一句|我说了什么|前面说)/.test(text)) {
    const first = history.find((m) => m.role === 'user');
    const last = [...history].reverse().find((m) => m.role === 'user');
    const reply = first
      ? `你第一条说的是「${first.content}」，最近一条是「${last.content}」。目前共 ${history.filter((m) => m.role === 'user').length} 轮对话。`
      : '这是我们的第一句对话，我还没有上文可以引用。';
    for (const ch of reply) {
      await sleep(12, signal);
      send({ type: 'delta', text: ch });
    }
    return reply;
  }

  // 「把它勾掉」这类代词，靠当前清单里最新的未完成项来消解
  if (/^(把它|把它给|这个|它)(勾掉|完成|做完|标记)/.test(text)) {
    const target = listItems({ done: 0 })[0];
    if (target) decided.push({ name: 'complete_item', args: { keyword: target.title } });
    else decided.push({ name: 'query_items', args: { done: 0 } });
  }

  // 先判「查」再判「完成」：否则「我还有哪些没做完」会被「做完」两个字骗去调 complete_item
  const isQuery =
    /(还有|有哪些|多少|查一下|查查|看看|清单|列表|待办|还剩)/.test(text) ||
    /(没做完|没完成|未完成|还没)/.test(text);
  const isComplete = !isQuery && /(完成|做完|搞定|勾掉|办完|弄完)/.test(text);

  if (decided.length === 0 && isComplete) {
    const keyword = extractTitle(
      text.replace(/(我)?(已经)?(完成|做完|搞定|勾掉|办完|弄完)(了|啦)?/g, '').replace(/[的了]/g, '')
    );
    decided.push({ name: 'complete_item', args: { keyword: keyword || text } });
  } else if (decided.length === 0 && isQuery) {
    const done = /(已完成|做完的|完成的|已经做完)/.test(text)
      ? 1
      : /(没做完|没完成|未完成|还没|还剩)/.test(text)
        ? 0
        : null;
    const args = done === null ? {} : { done };
    const kwByVerb = text.match(/(?:查一下|查查|看看|搜索|找一?下)(.+)$/);
    const kwByAbout = text.match(/关于(.+?)(的|$)/);
    const keyword = (kwByVerb?.[1] || kwByAbout?.[1] || '').replace(/[。.!！?？\s]/g, '');
    if (keyword) args.keyword = keyword;
    decided.push({ name: 'query_items', args });
  } else if (decided.length === 0 && /(加|记|新增|添加|提醒|别忘|备忘)/.test(text)) {
    const title = extractTitle(text);
    const args = { title: title || text };
    const due = guessDue(text);
    if (due) args.due = due;
    decided.push({ name: 'add_item', args });
  }

  if (decided.length === 0) {
    const reply = '我可以帮你记待办、查清单、把做完的勾掉。比如直接说「帮我加一条明天交实验报告」。';
    for (const ch of reply) {
      await sleep(12, signal);
      send({ type: 'delta', text: ch });
    }
    return reply;
  }

  // 模拟模型先"思考"要调工具：发一小段引出语
  const lead = '好的，我来处理。';
  for (const ch of lead) {
    await sleep(10, signal);
    send({ type: 'delta', text: ch });
  }
  send({ type: 'delta', text: '\n' });

  const outputs = [];
  for (const call of decided) {
    const id = `mock_${Math.random().toString(36).slice(2, 8)}`;
    send({ type: 'tool_call', id, name: call.name, args: call.args });
    await sleep(180, signal);
    const result = executeTool(call.name, call.args);
    send({ type: 'tool_result', id, name: call.name, result });
    outputs.push({ call, result });
  }

  // 根据工具真实返回组织自然语言，模型这一层在演示模式下是「规则拼装」
  const lines = outputs.map(({ call, result }) => {
    if (!result.ok) return `没办成：${result.error}`;
    if (call.name === 'add_item') {
      const due = result.data.due ? `，截止 ${result.data.due}（${WEEKDAY[new Date(result.data.due).getDay()]}）` : '';
      return `已经记下了 #${result.data.id}「${result.data.title}」${due}。`;
    }
    if (call.name === 'query_items') {
      const { total, items } = result.data;
      if (total === 0) return '清单目前是空的，要不要先加一条？';
      const head = items
        .slice(0, 5)
        .map((it) => `${it.done ? '✅' : '⬜'} #${it.id} ${it.title}`)
        .join('；');
      return `一共 ${total} 条：${head}${total > 5 ? ' ……' : ''}`;
    }
    return result.summary;
  });

  const reply = lines.join('\n');
  for (const ch of reply) {
    await sleep(12, signal);
    send({ type: 'delta', text: ch });
  }
  return reply;
}

/* ------------------------------------------------------------------ */
/* 真实模式：两轮工具循环                                              */
/* ------------------------------------------------------------------ */

async function liveAgent({ messages, signal, send }) {
  const working = [...messages];

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const { content, toolCalls } = await streamCompletion({
      messages: working,
      tools: TOOL_DEFINITIONS,
      signal,
      onDelta: (t) => send({ type: 'delta', text: t }),
    });

    if (!toolCalls.length) return content;

    working.push({
      role: 'assistant',
      content: content || '',
      tool_calls: toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        function: { name: c.name, arguments: c.args },
      })),
    });

    for (const call of toolCalls) {
      let args = {};
      let parseError = null;
      try {
        args = call.args ? JSON.parse(call.args) : {};
      } catch (err) {
        parseError = err.message;
      }

      // 前端调试面板靠这个事件看见「模型想调什么、传了什么」
      send({
        type: 'tool_call',
        id: call.id,
        name: call.name,
        args: parseError ? call.args : args,
        malformed: Boolean(parseError),
      });

      // 坏 JSON 不抛异常，而是当成一次失败的工具结果回填，让模型自己改
      const result = parseError
        ? { ok: false, error: `arguments 不是合法 JSON（${parseError}），请只输出 JSON 对象` }
        : executeTool(call.name, args);

      send({ type: 'tool_result', id: call.id, name: call.name, result });
      working.push({
        role: 'tool',
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }

    // 最后一轮如果模型还在要工具，就不再给机会，避免死循环烧钱
    if (round === MAX_ROUNDS - 1) {
      return content || '工具调用次数过多，我先停一下。你可以把需求说得再具体一点。';
    }
  }

  return '我这边处理超时了，请重试一次。';
}

/**
 * 跑一轮完整对话。send(event) 负责把事件写进 SSE。
 */
export async function runAgent({ sessionId, message, signal, send }) {
  const history = getSession(sessionId);

  if (config.aiMode === 'mock') {
    const reply = await mockAgent({ message, history, signal, send });
    saveTurn(sessionId, message, reply);
    return { mode: 'mock', reply };
  }

  const messages = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\n${currentDatePrompt()}` },
    ...history.map(({ role, content }) => ({ role, content })),
    { role: 'user', content: message },
  ];

  const reply = await liveAgent({ messages, signal, send });
  saveTurn(sessionId, message, reply || '（无回复）');
  return { mode: 'live', reply };
}
