// 任务4 的服务端入口：SSE 流式转发。
// 关键点：Key 只在这里出现（来自环境变量），前端永远拿不到。
import { Router } from 'express';
import { runAgent, resetSession } from '../ai/agent.js';
import { AiError } from '../ai/deepseek.js';
import { config } from '../config.js';
import { badRequest } from '../lib/errors.js';

export const chatRouter = Router();

const MAX_MESSAGE = 2000;

function writeEvent(res, payload) {
  if (res.writableEnded) return false;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  return true;
}

// 前端启动时读一下：当前是真模型还是离线演示模式
chatRouter.get('/meta', (_req, res) => {
  res.json({
    code: 0,
    data: {
      mode: config.aiMode,
      model: config.aiMode === 'mock' ? 'rule-based-demo' : config.deepseek.model,
      historyLimit: config.historyLimit,
    },
    msg: 'ok',
  });
});

chatRouter.delete('/session/:id', (req, res) => {
  resetSession(String(req.params.id));
  res.json({ code: 0, data: null, msg: '已重置会话' });
});

// POST /api/chat  { "sessionId": "s-xxx", "message": "帮我加一条明天交实验报告" }
chatRouter.post('/', async (req, res) => {
  const { sessionId, message } = req.body ?? {};

  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ code: 40001, data: null, msg: '缺少必填字段：message' });
  }
  if (message.length > MAX_MESSAGE) {
    return res.status(400).json({
      code: 40002,
      data: null,
      msg: `message 最长 ${MAX_MESSAGE} 个字符`,
    });
  }
  const sid = (typeof sessionId === 'string' && sessionId.trim()) || `anon-${Date.now()}`;

  // SSE 三件套：内容类型、禁用缓冲、禁用缓存
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Nginx / Render 反代默认会缓冲 SSE，这一行让它别插手
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const controller = new AbortController();
  // [讲解点] SSE 是单向的：用户点「停止生成」时，浏览器只是断开连接，
  // 服务端必须感知断开并 abort 上游请求，否则模型还在烧 token。
  // 注意监听的是 res 的 close 而不是 req 的 close：Node 里 req 的 close
  // 在「请求体读完」时就会触发，用它当断开信号会把每个请求都误杀。
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 15_000);

  const send = (evt) => writeEvent(res, evt);
  const startedAt = Date.now();

  try {
    send({ type: 'meta', sessionId: sid, mode: config.aiMode, model: config.aiMode === 'mock' ? 'rule-based-demo' : config.deepseek.model });
    const { reply } = await runAgent({ sessionId: sid, message: message.trim(), signal: controller.signal, send });
    send({ type: 'done', elapsedMs: Date.now() - startedAt, chars: (reply ?? '').length });
  } catch (err) {
    if (controller.signal.aborted) {
      // 用户主动停止：不算错误，但要给前端一个明确事件
      send({ type: 'aborted', elapsedMs: Date.now() - startedAt });
    } else if (err instanceof AiError) {
      send({ type: 'error', code: err.code, msg: err.message });
    } else if (err instanceof Error && err.name === 'AbortError') {
      send({ type: 'aborted' });
    } else {
      console.error('[chat] unexpected', err);
      send({ type: 'error', code: 'INTERNAL', msg: '服务内部出错了，请稍后重试' });
    }
  } finally {
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
});
