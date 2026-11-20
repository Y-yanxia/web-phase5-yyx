// DeepSeek 的流式客户端：只做一件事——把上游 SSE 拆成「文字增量」和「工具调用」两样东西。
import { config } from '../config.js';

const TIMEOUT_MS = config.requestTimeoutMs;

export class AiError extends Error {
  constructor(message, { status = 502, code = 'AI_ERROR' } = {}) {
    super(message);
    this.name = 'AiError';
    this.status = status;
    this.code = code;
  }
}

// 把上游各种失败翻译成人话：任务4「错误要说人话」的落点
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
export async function streamCompletion({ messages, tools, signal, onDelta }) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
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
    if (err.name === 'AbortError') throw new AiError('生成已停止', { status: 499, code: 'AI_ABORTED' });
    throw new AiError(`连不上模型服务：${err.message}`, { status: 502, code: 'AI_NETWORK' });
  }

  if (!res.ok) {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    const detail = await res.text().catch(() => '');
    // 把上游原始错误打到服务端日志，但不把 Key 或堆栈透给前端
    console.error('[ai] upstream error', res.status, detail.slice(0, 500));
    throw translateStatus(res.status);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let finishReason = '';
  const calls = new Map(); // index -> { id, name, args }

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE 以空行分隔事件；只处理以 data: 开头的行
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);

        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;

          let json;
          try {
            json = JSON.parse(payload);
          } catch {
            continue; // 半包数据，等下一次 read 拼完整
          }

          const choice = json.choices?.[0];
          if (!choice) continue;
          const delta = choice.delta ?? {};

          if (typeof delta.content === 'string' && delta.content) {
            content += delta.content;
            onDelta?.(delta.content);
          }

          // 工具调用是分片下发的：name 只来一次，arguments 一段段拼
          for (const tc of delta.tool_calls ?? []) {
            const idx = tc.index ?? 0;
            if (!calls.has(idx)) calls.set(idx, { id: '', name: '', args: '' });
            const acc = calls.get(idx);
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name += tc.function.name;
            if (tc.function?.arguments) acc.args += tc.function.arguments;
          }

          if (choice.finish_reason) finishReason = choice.finish_reason;
        }
      }
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    reader.releaseLock?.();
  }

  return { content, toolCalls: [...calls.values()], finishReason };
}
