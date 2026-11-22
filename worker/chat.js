// Worker 里的对话：SSE 流式 + 两轮工具循环 + D1 存历史
import { loadHistory, appendMessages, trimHistory, clearHistory } from './db.js';
import { TOOL_DEFINITIONS, executeTool } from './tools.js';

const SYSTEM_PROMPT = `你是「一句话清单」的智能助手，帮用户管理他的待办清单。

规则：
1. 用户要新增任务、查询清单、把任务标记完成时，必须调用对应工具，不要只用文字答应。
2. 调用工具前不需要征求同意，直接调用；工具返回后用一句简短中文总结结果。
3. 不要编造条目 id、标题或数量，一切以工具返回的数据为准。
4. 用户只是闲聊时正常回答，不要滥用工具。
5. 回复控制在 3 句话以内，语气自然，不要输出 Markdown 标题。`;

function currentDatePrompt(now = new Date()) {
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const weekday = '日一二三四五六'[now.getDay()];
  return `当前日期：${iso}（周${weekday}）。凡是「今天/明天/后天/周五」这类相对日期，先按这个基准换算成 YYYY-MM-DD 再传给工具，不要自己猜。`;
}

async function streamCompletion(env, { messages, signal, onDelta }) {
  const res = await fetch(`${env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.DEEPSEEK_MODEL || 'deepseek-chat',
      messages,
      tools: TOOL_DEFINITIONS,
      tool_choice: 'auto',
      temperature: 0.2,
      stream: true,
    }),
    signal,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    const map = {
      401: '模型 Key 无效或已过期，请检查 DEEPSEEK_API_KEY',
      402: '模型账户余额不足，请到开放平台充值后再试',
      429: '请求太频繁被限流了，等几秒再发一次',
    };
    throw new Error(map[res.status] || `模型服务返回 ${res.status}，请稍后重试`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const calls = new Map();

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary;
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let json;
        try { json = JSON.parse(payload); } catch { continue; }
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;
        if (typeof delta.content === 'string' && delta.content) {
          content += delta.content;
          onDelta?.(delta.content);
        }
        for (const tc of delta.tool_calls || []) {
          const idx = tc.index ?? 0;
          if (!calls.has(idx)) calls.set(idx, { id: '', name: '', args: '' });
          const acc = calls.get(idx);
          if (tc.id) acc.id = tc.id;
          if (tc.function?.name) acc.name += tc.function.name;
          if (tc.function?.arguments) acc.args += tc.function.arguments;
        }
      }
    }
  }

  return { content, toolCalls: [...calls.values()] };
}

async function runAgent(env, { sessionId, message, signal, send }) {
  const limit = Number(env.HISTORY_LIMIT || 8);
  const history = await loadHistory(env, sessionId, limit);

  const working = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\n${currentDatePrompt()}` },
    ...history.map(({ role, content }) => ({ role, content })),
    { role: 'user', content: message },
  ];

  let reply = '';
  const MAX_ROUNDS = 3;

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const { content, toolCalls } = await streamCompletion(env, {
      messages: working,
      signal,
      onDelta: (t) => send({ type: 'delta', text: t }),
    });

    if (!toolCalls.length) {
      reply = content;
      break;
    }

    working.push({
      role: 'assistant',
      content: content || '',
      tool_calls: toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })),
    });

    for (const call of toolCalls) {
      let args = {};
      let parseError = null;
      try {
        args = call.args ? JSON.parse(call.args) : {};
      } catch (err) {
        parseError = err.message;
      }

      send({ type: 'tool_call', id: call.id, name: call.name, args: parseError ? call.args : args, malformed: Boolean(parseError) });

      const result = parseError
        ? { ok: false, error: `arguments 不是合法 JSON（${parseError}），请只输出 JSON 对象` }
        : await executeTool(env, call.name, args);

      send({ type: 'tool_result', id: call.id, name: call.name, result });
      working.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }

    if (round === MAX_ROUNDS - 1) {
      reply = content || '工具调用次数过多，我先停一下。你可以把需求说得再具体一点。';
    }
  }

  await appendMessages(env, sessionId, [
    { role: 'user', content: message },
    { role: 'assistant', content: reply || '（无回复）' },
  ]);
  await trimHistory(env, sessionId, limit);

  return reply;
}

export async function handleChat(request, env, url) {
  const body = await request.json().catch(() => null);
  const message = (body?.message || '').trim();
  const sessionId = (body?.sessionId || '').trim() || `anon-${Date.now()}`;

  if (!message) {
    return Response.json({ code: 40001, data: null, msg: '缺少必填字段：message' }, { status: 400 });
  }
  if (message.length > 2000) {
    return Response.json({ code: 40002, data: null, msg: 'message 最长 2000 个字符' }, { status: 400 });
  }
  if (!env.DEEPSEEK_API_KEY) {
    return Response.json(
      { code: 50001, data: null, msg: '服务端未配置 DEEPSEEK_API_KEY' },
      { status: 500 }
    );
  }

  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  const send = (obj) => writer.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)).catch(() => {});
  const startedAt = Date.now();

  (async () => {
    try {
      await send({ type: 'meta', sessionId, mode: 'live', model: env.DEEPSEEK_MODEL || 'deepseek-chat' });
      const reply = await runAgent(env, { sessionId, message, signal: request.signal, send });
      await send({ type: 'done', elapsedMs: Date.now() - startedAt, chars: (reply || '').length });
    } catch (err) {
      if (request.signal?.aborted) {
        await send({ type: 'aborted', elapsedMs: Date.now() - startedAt });
      } else {
        console.error('[chat]', err);
        await send({ type: 'error', code: 'AI_ERROR', msg: err.message || '模型调用失败' });
      }
    } finally {
      await writer.close().catch(() => {});
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

export async function handleResetSession(env, sessionId) {
  await clearHistory(env, sessionId);
  return Response.json({ code: 0, data: null, msg: '已重置会话' });
}
