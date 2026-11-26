/**
 * DeepSeek 流式客户端：发一次 /chat/completions，把上游 SSE 拆成文字增量和工具调用。
 * 链路位置：agent.liveAgent -> 这里 -> api.deepseek.com。
 * 只做协议转换，不碰数据库。
 * 对外导出：AiError 类 + streamCompletion()。
 * 坑：工具调用的 arguments 是分片下发的，必须按 index 累积后再解析，不能每片都 parse。
 */
// DeepSeek 的流式客户端：只做一件事——把上游 SSE 拆成「文字增量」和「工具调用」两样东西。
import { config } from '../config.js';

// 超时从配置读，测试里可以调小，不用改代码
const TIMEOUT_MS = config.requestTimeoutMs;

// 统一的 AI 异常：路由层只认 code/message，不用关心是网络错还是上游 HTTP 错
export class AiError extends Error {
  constructor(message, { status = 502, code = 'AI_ERROR' } = {}) {
    super(message);
    this.name = 'AiError';
    this.status = status;
    this.code = code;
  }
}

// 把上游各种失败翻译成人话：任务4「错误要说人话」的落点
// 401/402/429 是最常见的三种，其余统一归到 AI_UPSTREAM
function translateStatus(status) {
  switch (status) {
    case 401:
      return new AiError('模型 Key 无效或已过期，请检查 DEEPSEEK_API_KEY', { status: 502, code: 'AI_AUTH' });
    case 402:
      return new AiError('模型账户余额不足，请到开放平台充值后再试', { status: 502, code: 'AI_BALANCE' });
    case 429:
      return new AiError('请求太频繁被限流了，等几秒再发一次', { status: 502, code: 'AI_RATE_LIMIT' });
    default:
      return new AiError(`模型服务返回 ${status}，请稍后重试`, { status: 502, code: 'AI_UPSTREAM' });
  }
}

/**
 * 发起一次带工具定义的流式对话。
 * @returns {Promise<{content: string, toolCalls: Array<{id:string,name:string,args:string}>, finishReason: string}>}
 */
// 只负责协议层：把上游流拆成 content 增量和 toolCalls，业务编排在 agent 里
export async function streamCompletion({ messages, tools, signal, onDelta }) {
  // 自己再造一个 controller：外部取消和超时都要汇到 fetch 的唯一 signal 上
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  // once: true，abort 之后监听器自动摘掉，不会一直挂在外部 signal 上
  signal?.addEventListener('abort', onAbort, { once: true });
  // 兜底超时：模型卡住不吐字也要按配置超时主动断，不能无限等
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${config.deepseek.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.deepseek.apiKey}`,
      },
      body: JSON.stringify({
        model: config.deepseek.model,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.2, // 工具调用要稳，不要发挥
        stream: true,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    // fetch 抛错基本只有两种：网络不通，或者被 abort 掉了
    if (err.name === 'AbortError') throw new AiError('生成已停止', { status: 499, code: 'AI_ABORTED' });
    throw new AiError(`连不上模型服务：${err.message}`, { status: 502, code: 'AI_NETWORK' });
  }

  if (!res.ok) {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    // 非 2xx 时上游会给一段 JSON 错误说明，读出来只打服务端日志
    const detail = await res.text().catch(() => '');
    // 把上游原始错误打到服务端日志，但不把 Key 或堆栈透给前端
    console.error('[ai] upstream error', res.status, detail.slice(0, 500));
    throw translateStatus(res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  // 跨 chunk 的半包靠 buffer 兜着，凑够一个空行才算一个完整事件
  let buffer = '';
  let content = '';
  let finishReason = '';
  // 以 index 为 key 累积：一轮可能有多个工具调用，分片还会穿插
  const calls = new Map(); // index -> { id, name, args }

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      // stream: true 很关键：一个汉字的 3 个字节可能跨两次 read
      buffer += decoder.decode(value, { stream: true });

      // SSE 以空行分隔事件；只处理以 data: 开头的行
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          // [DONE] 是结束标记不是 JSON；空 payload 是心跳，直接跳过
          if (!payload || payload === '[DONE]') continue;

          let json;
          // 解析失败也不能崩：跳过这一条，别为一条坏数据毁掉整轮对话
          try {
            json = JSON.parse(payload);
          } catch {
            continue; // 半包数据，等下一次 read 拼完整
          }

          const choice = json.choices?.[0];
          if (!choice) continue;
          // delta 可能只带角色、只带心跳，缺字段都当正常情况
          const delta = choice.delta ?? {};

          if (typeof delta.content === 'string' && delta.content) {
            // 文字增量边收边回调，前端的打字机效果就靠它
            content += delta.content;
            onDelta?.(delta.content);
          }

          // 工具调用是分片下发的：name 只来一次，arguments 一段段拼
          for (const tc of delta.tool_calls ?? []) {
            const idx = tc.index ?? 0;
            if (!calls.has(idx)) calls.set(idx, { id: '', name: '', args: '' });
            const acc = calls.get(idx);
            // id 只在该工具调用的第一片里出现，后面都是空
            if (tc.id) acc.id = tc.id;
            // name 通常一次到齐，但协议允许分片，所以也用 += 而不是 =
            if (tc.function?.name) acc.name += tc.function.name;
            // arguments 是 JSON 字符串，分片边界可能把它拦腰截断，必须拼完再 parse
            if (tc.function?.arguments) acc.args += tc.function.arguments;
          }

          // finish_reason 一般是 stop / tool_calls / length，记下来方便排查
          if (choice.finish_reason) finishReason = choice.finish_reason;
        }
      }
    }
  } finally {
    // 无论正常结束还是中途抛错，都要清定时器、摘监听、释放 reader
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock?.();
  }

  // Map 保持插入顺序，工具调用顺序和模型下发顺序一致
  return { content, toolCalls: [...calls.values()], finishReason };
}
