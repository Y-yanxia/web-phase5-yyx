/**
 * 智能体编排：管会话历史、拼 prompt、调模型、执行工具、把结果回填再总结。
 * 链路位置：routes/chat.js -> runAgent() -> deepseek.js。
 * 工具执行走 tools.js，两边都由 agent 串起来。
 * 这一层只做编排：模型负责「说」，真正改数据库的是 tools.js。
 * 对外导出：runAgent、getSession、resetSession、resetAllSessions、
 * currentDatePrompt、SYSTEM_PROMPT。
 * 坑：会话只存在进程内存，重启就清空；工具最多跑 3 轮，防止模型来回调烧光 token。
 */
// 任务4 + 任务5 的编排层：
// 维护会话上下文 -> 调模型 -> 模型要调工具就真的执行 -> 把结果回填 -> 再问一轮拿自然语言总结。
import { streamCompletion } from './deepseek.js';
import { TOOL_DEFINITIONS, executeTool } from './tools.js';
import { listItems } from '../db.js';
import { config } from '../config.js';

// 系统提示词是行为约束：必须调工具、不许编数据、回复要短
export const SYSTEM_PROMPT = `你是「一句话清单」的智能助手，帮用户管理他的待办清单。

规则：
1. 用户要新增任务、查询清单、把任务标记完成时，必须调用对应工具，不要只用文字答应。
2. 调用工具前不需要征求同意，直接调用；工具返回后用一句简短中文总结结果。
3. 不要编造条目 id、标题或数量，一切以工具返回的数据为准。
4. 用户只是闲聊时正常回答，不要滥用工具。
5. 回复控制在 3 句话以内，语气自然，不要输出 Markdown 标题。`;

// 模型不知道「今天是几号」，不告诉它就会把「明天」算成 2026-06-11（真实踩过）。
// 每次请求现算一遍，跨天也不会错。
// 返回一段能直接拼进 system 的中文说明；now 参数只为测试时固定日期
export function currentDatePrompt(now = new Date()) {
  // 手动拼本地日期：toISOString() 是 UTC，早上 8 点前会算成前一天
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  // getDay() 返回 0=周日，所以字符串按「日一二三四五六」排
  const weekday = '日一二三四五六'[now.getDay()];
  return `当前日期：${iso}（周${weekday}）。凡是「今天/明天/后天/周五」这类相对日期，先按这个基准换算成 YYYY-MM-DD 再传给工具，不要自己猜。`;
}

// sessionId -> { messages, updatedAt }；进程内存即可，重启后历史清空是预期行为
const sessions = new Map();
// 2 小时没说话就算过期；3 轮是工具循环上限，再多基本是模型在打转
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const MAX_ROUNDS = 3;

// 读某个会话的历史：没有就返回空数组，调用方不用判空
export function getSession(sessionId) {
  return sessions.get(sessionId)?.messages ?? [];
}

// 删一个会话：DELETE /api/chat/session/:id 走这里
export function resetSession(sessionId) {
  sessions.delete(sessionId);
}

// 全清：测试用例之间调用，避免上下文串味
export function resetAllSessions() {
  sessions.clear();
}

// 惰性清理：每次写会话前顺手扫一遍过期项，省一个后台定时器
function pruneSessions() {
  const now = Date.now();
  for (const [id, s] of sessions) {
    if (now - s.updatedAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

// 超长截断：保留 system + 最近 N 条（N = historyLimit），最早的先丢
// 实际历史里只有 user/assistant，system 是每轮现拼的，不用特别保留
function trimHistory(messages) {
  const keep = config.historyLimit;
  return messages.length <= keep ? messages : messages.slice(messages.length - keep);
}

// 存一轮问答：user 和 assistant 必须成对写入，否则下一轮上下文会错位
function saveTurn(sessionId, userText, assistantText) {
  // 先 prune 再写：过期会话不会一直占内存
  pruneSessions();
  const prev = sessions.get(sessionId)?.messages ?? [];
  const next = trimHistory([
    ...prev,
    { role: 'user', content: userText },
    { role: 'assistant', content: assistantText },
  ]);
  sessions.set(sessionId, { messages: next, updatedAt: Date.now() });
}

// 可中断的 sleep：演示模式逐字吐字用，用户点停止要立刻抛 AbortError
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

// 演示模式拼回复用的星期表，下标和 Date.getDay() 对齐（0=周日）
const WEEKDAY = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

// 演示模式的日期猜测：只认常见说法，猜不出就返回 null
function guessDue(text) {
  const now = new Date();
  // 用 setDate 加天数会自动跨月跨年，比手算 30 天靠谱
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
  // 「周五」没说是哪一周，演示模式简单按明天算，真模式交给模型换算
  if (/周[一二三四五六日天]/.test(text)) return addDays(1);
  // 也认「2026-11-25」「2026/11/25」「2026年11月25日」三种写法
  const exact = text.match(/(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (exact) {
    const [, y, m, d] = exact;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }
  return null;
}

// 从自然语言里剥掉指令词，剩下的当标题
function extractTitle(text) {
  return text
    .replace(/^(帮我|请|麻烦你?|给我|把|将)/, '')
    .replace(/(加|记|新增|添加|建)(一?条|一下|个)?/, '')
    .replace(/^(提醒我|别忘了我?|记得)/, '')
    .replace(/[。.!！?？~～\s]+$/, '')
    .trim();
}

// 离线演示模式：用正则代替模型做决策，事件序列和真实模式保持一致
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
    // 把「完成了」这类动词剥掉，剩下的就是关键词
    const keyword = extractTitle(
      text.replace(/(我)?(已经)?(完成|做完|搞定|勾掉|办完|弄完)(了|啦)?/g, '').replace(/[的了]/g, '')
    );
    decided.push({ name: 'complete_item', args: { keyword: keyword || text } });
  } else if (decided.length === 0 && isQuery) {
    // done 三态：明确说已完成传 1，说没做完传 0，其余问法查全部
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
    // 新增：标题剥掉指令词，日期用 guessDue 猜，猜不出就不带 due
    const title = extractTitle(text);
    const args = { title: title || text };
    const due = guessDue(text);
    if (due) args.due = due;
    decided.push({ name: 'add_item', args });
  }

  if (decided.length === 0) {
    // 一句都匹配不上就当闲聊，给个能力介绍，不瞎调工具
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
  // 工具调用是真的：演示模式也真的写库，只是「选哪个工具」换成规则判断
  for (const call of decided) {
    const id = `mock_${Math.random().toString(36).slice(2, 8)}`;
    // 事件形状和真模式对齐：前端同一套代码就能渲染两种模式
    send({ type: 'tool_call', id, name: call.name, args: call.args });
    await sleep(180, signal);
    // 这里真的执行：新增/完成都会立刻落到数据库
    const result = executeTool(call.name, call.args);
    send({ type: 'tool_result', id, name: call.name, result });
    outputs.push({ call, result });
  }

  // 根据工具真实返回组织自然语言，模型这一层在演示模式下是「规则拼装」
  const lines = outputs.map(({ call, result }) => {
    if (!result.ok) return `没办成：${result.error}`;
    if (call.name === 'add_item') {
      // 有截止日期就顺带算出星期，用户少算一次
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

// 真实模式：最多 3 轮「模型要工具 -> 本地执行 -> 结果回填」，直到模型给出纯文本
async function liveAgent({ messages, signal, send }) {
  // 复制一份再改：会话历史要等这一轮成功收尾才写回
  const working = [...messages];

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const { content, toolCalls } = await streamCompletion({
      messages: working,
      tools: TOOL_DEFINITIONS,
      signal,
      // 文字增量直接转成 delta 事件，前端边收边渲染
      onDelta: (t) => send({ type: 'delta', text: t }),
    });

    // 没有工具调用 = 模型在正常回答，本轮结束
    if (!toolCalls.length) return content;

    // 必须把 assistant 的 tool_calls 原样回填，下一轮模型才知道在等哪些结果
    working.push({
      role: 'assistant',
      content: content || '',
      tool_calls: toolCalls.map((c) => ({
        id: c.id,
        type: 'function',
        // 回填的是原始字符串，不是解析后的对象，格式必须和模型给的一致
        function: { name: c.name, arguments: c.args },
      })),
    });

    for (const call of toolCalls) {
      let args = {};
      let parseError = null;
      // 模型生成的 arguments 偶尔带 Markdown 代码块或直接截断，必须兜住
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
        // 坏参数就把原始字符串发出去，前端能直接看到问题
        args: parseError ? call.args : args,
        malformed: Boolean(parseError),
      });

      // 坏 JSON 不抛异常，而是当成一次失败的工具结果回填，让模型自己改
      const result = parseError
        ? { ok: false, error: `arguments 不是合法 JSON（${parseError}），请只输出 JSON 对象` }
        : executeTool(call.name, args);

      send({ type: 'tool_result', id: call.id, name: call.name, result });
      // tool 消息必须带 tool_call_id，和上面的 tool_calls 一一对应
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

  // 理论上到不了：每轮循环都会 return，这里只是兜底
  return '我这边处理超时了，请重试一次。';
}

/**
 * 跑一轮完整对话。send(event) 负责把事件写进 SSE。
 */
// 统一入口：mock 走规则，live 走真模型；两条路都要把这一轮存进历史
export async function runAgent({ sessionId, message, signal, send }) {
  // 历史只带 user/assistant 文本，上一轮的工具明细不跨轮保留，省 token
  const history = getSession(sessionId);

  // 演示模式：不联网，回复也逐字发 delta，前端体验一致
  if (config.aiMode === 'mock') {
    const reply = await mockAgent({ message, history, signal, send });
    // 演示模式的回复也要入历史，否则「我刚才说了什么」答不上来
    saveTurn(sessionId, message, reply);
    return { mode: 'mock', reply };
  }

  const messages = [
    // system 每轮现拼：日期会变，历史里存的那份早过期了
    { role: 'system', content: `${SYSTEM_PROMPT}\n\n${currentDatePrompt()}` },
    ...history.map(({ role, content }) => ({ role, content })),
    { role: 'user', content: message },
  ];

  const reply = await liveAgent({ messages, signal, send });
  // 存的是最终自然语言回复，工具中间结果不进历史
  saveTurn(sessionId, message, reply || '（无回复）');
  return { mode: 'live', reply };
}
