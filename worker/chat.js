// Worker 里的对话：SSE 流式 + 两轮工具循环 + D1 存历史
//
// 在链路里的位置：index.js 的 POST /api/chat → runAgent → streamCompletion 打 DeepSeek
// → executeTool 改 D1 → 结果边收边推给浏览器。
// 与 Express 版的差异：
//   1. 没有 res.write，用 TransformStream 造一条「写得进、读得出」的管道；
//   2. 断开信号不是 res.on('close')，而是 request.signal，浏览器断开时 Worker 能收到 abort；
//   3. 历史不在进程内存里，每次请求都要先去 D1 读、结束再写回去。
import { loadHistory, appendMessages, trimHistory, clearHistory } from './db.js';
import { TOOL_DEFINITIONS, executeTool } from './tools.js';

// 这段是模型的「岗位说明」：不写死「必须调工具」，它就只回一句「好的已记下」而不写库
const SYSTEM_PROMPT = `你是「一句话清单」的智能助手，帮用户管理他的待办清单。

规则：
1. 用户要新增任务、查询清单、把任务标记完成时，必须调用对应工具，不要只用文字答应。
2. 调用工具前不需要征求同意，直接调用；工具返回后用一句简短中文总结结果。
3. 不要编造条目 id、标题或数量，一切以工具返回的数据为准。
4. 用户只是闲聊时正常回答，不要滥用工具。
5. 回复控制在 3 句话以内，语气自然，不要输出 Markdown 标题。`;

// 模型不知道今天几号，不喂这个基准，「明天」「周五」会被它算到错误日期上
function currentDatePrompt(now = new Date()) {
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const weekday = '日一二三四五六'[now.getDay()];
  return `当前日期：${iso}（周${weekday}）。凡是「今天/明天/后天/周五」这类相对日期，先按这个基准换算成 YYYY-MM-DD 再传给工具，不要自己猜。`;
}

// 调一次 DeepSeek 流式接口：边读边把增量交给 onDelta，最后汇总成整段内容 + 工具调用
async function streamCompletion(env, { messages, signal, onDelta }) {
  const res = await fetch(`${env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // Key 只在服务端出现，永远不进浏览器
      Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
    },
    body: JSON.stringify({
      model: env.DEEPSEEK_MODEL || 'deepseek-chat',
      messages,
      // 把三个工具的 schema 一起发过去，模型才知道自己能调什么
      tools: TOOL_DEFINITIONS,
      tool_choice: 'auto',
      // 待办场景要稳不要创意，温度调低，同样的输入更容易复现
      temperature: 0.2,
      // 不开流式，前端就要干等十几秒才见到第一个字
      stream: true,
    }),
    // signal 一断，上游请求跟着断：用户点了「停止」就不再烧 token
    signal,
  });

  if (!res.ok) {
    // 先把 body 读掉，别让连接悬着；错误码翻译成人话，前端能直接贴给用户看
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
  // 网络给的 chunk 会把一行 JSON 从中间劈开，所以先攒 buffer，凑够一个 \n\n 才解析
  let buffer = '';
  let content = '';
  const calls = new Map();

  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    // stream: true 让多字节中文在跨 chunk 被切开时也不会解成乱码
    buffer += decoder.decode(value, { stream: true });
    let boundary;
    // SSE 一条事件以空行（\n\n）结束：只处理完整事件，剩下的留在 buffer 等下一块
    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      for (const line of chunk.split('\n')) {
        // 只认 data: 行；event:/id:/retry: 和心跳注释都跳过
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        // [DONE] 是结束哨兵不是 JSON，解析前先排掉
        if (!payload || payload === '[DONE]') continue;
        let json;
        // 坏一行不影响整条流：解析失败就跳过这块，宁可少一个 token 也别把请求搞挂
        try { json = JSON.parse(payload); } catch { continue; }
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;
        if (typeof delta.content === 'string' && delta.content) {
          content += delta.content;
          // 收到就推：攒着等生成完再发，就失去流式的意义了
          onDelta?.(delta.content);
        }
        // 工具调用是分片来的：第一片只有 id/name，arguments 后面几十片慢慢拼
        // 用 index 归组，同一个工具的所有碎片会落进同一个 Map 槽
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

// 「用户说一句 → 模型决定调不调工具 → 调完再总结」的完整编排，历史读写都在这里
async function runAgent(env, { sessionId, message, signal, send }) {
  const limit = Number(env.HISTORY_LIMIT || 8);
  // 无状态：上一轮对话只能从 D1 里捞，捞不到就当新会话
  const history = await loadHistory(env, sessionId, limit);

  // 顺序有讲究：system 打头、历史居中、本轮用户消息压尾，这是 chat 接口的要求
  const working = [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\n${currentDatePrompt()}` },
    ...history.map(({ role, content }) => ({ role, content })),
    { role: 'user', content: message },
  ];

  let reply = '';
  // 最多三轮：防止模型反复调工具停不下来，把 token 和延迟一起烧光
  const MAX_ROUNDS = 3;

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    // 每轮都是一次完整的流式请求，onDelta 直接把增量推给前端
    const { content, toolCalls } = await streamCompletion(env, {
      messages: working,
      signal,
      onDelta: (t) => send({ type: 'delta', text: t }),
    });

    // 没有 tool_calls 就是最终回答，收工
    if (!toolCalls.length) {
      reply = content;
      break;
    }

    // 把这一轮的「调用意图」原样塞回上下文，否则下一轮模型不知道工具已经调过
    working.push({
      role: 'assistant',
      content: content || '',
      tool_calls: toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })),
    });

    for (const call of toolCalls) {
      let args = {};
      let parseError = null;
      // arguments 是模型现写的字符串，可能不是合法 JSON，这里必须自己兜住
      try {
        args = call.args ? JSON.parse(call.args) : {};
      } catch (err) {
        parseError = err.message;
      }

      // 先发 tool_call，前端能立刻显示「正在新增…」，而不是干等最终回复
      send({ type: 'tool_call', id: call.id, name: call.name, args: parseError ? call.args : args, malformed: Boolean(parseError) });

      // 解析失败就把错误当工具结果喂回去，模型下一轮会自己纠正参数
      const result = parseError
        ? { ok: false, error: `arguments 不是合法 JSON（${parseError}），请只输出 JSON 对象` }
        : await executeTool(env, call.name, args);

      send({ type: 'tool_result', id: call.id, name: call.name, result });
      // 工具结果用 role:'tool' + tool_call_id 回填，模型才分得清是哪次调用的返回
      working.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }

    // 最后一轮还在调工具：不再给机会，回一句人话解释，别让用户等到空回复
    if (round === MAX_ROUNDS - 1) {
      reply = content || '工具调用次数过多，我先停一下。你可以把需求说得再具体一点。';
    }
  }

  // 只落库「用户说了什么 + 最终回复」：中间的工具往返不存，历史体积才可控
  await appendMessages(env, sessionId, [
    { role: 'user', content: message },
    { role: 'assistant', content: reply || '（无回复）' },
  ]);
  // 写完立刻裁一次，保证下一轮 loadHistory 拿到的永远是最新的 N 条
  await trimHistory(env, sessionId, limit);

  return reply;
}

// POST /api/chat：校验入参 → 造一条 SSE 流马上返回 → 后台任务慢慢往里写
export async function handleChat(request, env, url) {
  // body 不是合法 JSON 就当成空对象，下面统一按「缺 message」处理
  const body = await request.json().catch(() => null);
  const message = (body?.message || '').trim();
  // 没有 sessionId 就发个临时 id：本次能跑通，只是没有多轮上下文
  const sessionId = (body?.sessionId || '').trim() || `anon-${Date.now()}`;

  // 空消息不浪费一次模型调用，在开流之前就用普通 JSON 拒掉
  if (!message) {
    return Response.json({ code: 40001, data: null, msg: '缺少必填字段：message' }, { status: 400 });
  }
  // 限长 2000：别让人拿超长 prompt 刷 token，也避免上下文预算瞬间爆掉
  if (message.length > 2000) {
    return Response.json({ code: 40002, data: null, msg: 'message 最长 2000 个字符' }, { status: 400 });
  }
  // 没配 Key 是服务端配置问题，直接 500 说清楚，别让前端在流里等一条 error
  if (!env.DEEPSEEK_API_KEY) {
    return Response.json(
      { code: 50001, data: null, msg: '服务端未配置 DEEPSEEK_API_KEY' },
      { status: 500 }
    );
  }

  // TransformStream = 可写的入口 + 可读的出口，一对孪生流：
  // 后台任务往 writer 写，readable 立刻当 Response body 交给浏览器，
  // 写一块就传一块，不用等整个回答生成完 —— 这就是 Worker 里做 SSE 的原理。
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();

  // 每条事件 = data: 一行 JSON + 一个空行（SSE 规定的分隔）；
  // 末尾 .catch(() => {}) 不能省：用户关页面后管道已断，write 会 reject，
  // 不吞掉就是一个没人处理的 Promise 拒绝，日志刷满还可能拖累后续请求
  const send = (obj) => writer.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`)).catch(() => {});
  const startedAt = Date.now();

  // 故意不 await：fetch handler 必须马上把 Response 交出去，
  // 真正干活的是这个后台任务，它写完才 close 管道
  (async () => {
    try {
      // 第一帧先报身份：真模型 / 模型名 / session，前端据此决定要不要显示「AI 思考中」
      await send({ type: 'meta', sessionId, mode: 'live', model: env.DEEPSEEK_MODEL || 'deepseek-chat' });
      const reply = await runAgent(env, { sessionId, message, signal: request.signal, send });
      // done 带上耗时和字数，前端可以显示「用时 3.2s / 128 字」
      await send({ type: 'done', elapsedMs: Date.now() - startedAt, chars: (reply || '').length });
    } catch (err) {
      // 用户点「停止生成」会 abort request.signal：这不是错误，单独发 aborted 事件
      if (request.signal?.aborted) {
        await send({ type: 'aborted', elapsedMs: Date.now() - startedAt });
      } else {
        console.error('[chat]', err);
        // 异常也必须变成一条 error 事件，否则前端只看到流莫名断掉，不知道发生了什么
        await send({ type: 'error', code: 'AI_ERROR', msg: err.message || '模型调用失败' });
      }
    } finally {
      // 必须 close：关掉 writable 端，readable 那头才会读到 EOF，前端读取循环才能结束；
      // 不关这条流就永久挂起、请求最后被超时掐掉；管道已断时 close 也会 reject，一并吞掉
      await writer.close().catch(() => {});
    }
  })();

  // 响应头三件套：声明 SSE、禁缓存、禁中间层缓冲；
  // 少了 X-Accel-Buffering，反代可能把流攒成一大块再发，流式就名存实亡了
  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
    },
  });
}

// DELETE /api/chat/session/:id 的处理：Worker 没有内存 Map 可清，清的是 D1 历史表
export async function handleResetSession(env, sessionId) {
  await clearHistory(env, sessionId);
  return Response.json({ code: 0, data: null, msg: '已重置会话' });
}
