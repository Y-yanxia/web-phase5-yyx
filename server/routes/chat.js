/**
 * 对话路由：把一次提问变成一条 SSE 流。
 * 事件有 meta/delta/tool_call/tool_result/done/error/aborted。
 * 链路位置：前端 POST /api/chat -> 这里开流 -> agent.runAgent
 * -> deepseek/tools -> 逐条 write 给前端。
 * 对外导出：chatRouter（GET /meta、DELETE /session/:id、POST /）。
 * 坑：SSE 一旦 flushHeaders 就不能再改状态码，
 * 出错只能发 error 事件；断开要 abort 上游，别让模型继续烧 token。
 */
// 任务4 的服务端入口：SSE 流式转发。
// 关键点：Key 只在这里出现（来自环境变量），前端永远拿不到。
import { Router } from 'express';
import { runAgent, resetSession } from '../ai/agent.js';
import { AiError } from '../ai/deepseek.js';
import { config } from '../config.js';
import { badRequest } from '../lib/errors.js';

// 对话 Router：/meta 和 /session 两个辅助接口，外加主接口 POST /
export const chatRouter = Router();

// 单条消息长度上限，超了直接 400，不进模型
const MAX_MESSAGE = 2000;

// 所有 SSE 事件都从这里出去：连接已关就直接返回 false，绝不抛异常
function writeEvent(res, payload) {
  if (res.writableEnded || res.destroyed) return false;
  try {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    return true;
  } catch (err) {
    // 浏览器关页面 / 点停止后，socket 已销毁，继续写会抛 ERR_STREAM_DESTROYED。
    // 这类错误不该把进程带走，记一行日志就够。
    console.warn('[chat] 客户端已断开，忽略后续写入：', err.code || err.message);
    return false;
  }
}

// 前端启动时读一下：当前是真模型还是离线演示模式
// 顺便给出模型名和历史条数，前端不用再写死一份
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

// 重置会话：只清服务端内存里的上下文，前端点「新对话」时调
chatRouter.delete('/session/:id', (req, res) => {
  resetSession(String(req.params.id));
  res.json({ code: 0, data: null, msg: '已重置会话' });
});

// POST /api/chat  { "sessionId": "s-xxx", "message": "帮我加一条明天交实验报告" }
// 主接口：校验入参 -> 开 SSE -> 交给 agent 编排 -> 把过程事件逐条写给前端
chatRouter.post('/', async (req, res) => {
  const { sessionId, message } = req.body ?? {};

  // 参数错就普通 JSON 400：流还没开，没必要用 SSE 报错
  if (typeof message !== 'string' || !message.trim()) {
    return res.status(400).json({ code: 40001, data: null, msg: '缺少必填字段：message' });
  }
  // 长度限制防刷：超长输入白烧 token，也拖慢工具轮次
  if (message.length > MAX_MESSAGE) {
    return res.status(400).json({
      code: 40002,
      data: null,
      msg: `message 最长 ${MAX_MESSAGE} 个字符`,
    });
  }
  // 没带 sessionId 就生成一个匿名 id：本次请求照样能跑，只是下次接不上
  const sid = (typeof sessionId === 'string' && sessionId.trim()) || `anon-${Date.now()}`;

  // SSE 三件套：内容类型、禁用缓冲、禁用缓存
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // charset=utf-8 不能省：不写的话中文可能被浏览器按 latin-1 解成乱码
  // no-transform 让压缩中间件别动流；keep-alive 让长连接别 30 秒就被掐
  // Nginx / Render 反代默认会缓冲 SSE，这一行让它别插手
  res.setHeader('X-Accel-Buffering', 'no');
  // 先把响应头推出去：fetch 的 body 要等第一批数据才可读，否则前端一直转圈
  res.flushHeaders?.();

  // 每个请求一个 AbortController：用户断开或上游超时都靠它取消
  const controller = new AbortController();
  // [讲解点] SSE 是单向的：用户点「停止生成」时，浏览器只是断开连接，
  // 服务端必须感知断开并 abort 上游请求，否则模型还在烧 token。
  // 注意监听的是 res 的 close 而不是 req 的 close：Node 里 req 的 close
  // 在「请求体读完」时就会触发，用它当断开信号会把每个请求都误杀。
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  // 15 秒一次注释心跳（前端会忽略注释行），防止代理把空闲连接收掉
  const heartbeat = setInterval(() => {
    if (!res.writableEnded) res.write(': ping\n\n');
  }, 15_000);

  // 包一下：事件写失败只返回 false，不打断后面 done / finally 的收尾
  const send = (evt) => writeEvent(res, evt);
  // 记开始时间，done 事件里回传耗时，前端能显示「用时 x 秒」
  const startedAt = Date.now();

  try {
    // 第一条一定是 meta：前端据此切到「生成中」，并显示当前模式和会话 id
    send({ type: 'meta', sessionId: sid, mode: config.aiMode, model: config.aiMode === 'mock' ? 'rule-based-demo' : config.deepseek.model });
    // 真正的模型调用 / 工具执行都在 agent 里，这里只负责开流、转发和收尾
    const { reply } = await runAgent({ sessionId: sid, message: message.trim(), signal: controller.signal, send });
    // 收尾事件：带上耗时和字数，前端用它结束 loading
    send({ type: 'done', elapsedMs: Date.now() - startedAt, chars: (reply ?? '').length });
  } catch (err) {
    if (controller.signal.aborted) {
      // 用户主动停止：不算错误，但要给前端一个明确事件
      // 单独发 aborted，前端好把「生成中」状态停掉
      send({ type: 'aborted', elapsedMs: Date.now() - startedAt });
    } else if (err instanceof AiError) {
      // AiError 的 message 已经是人话，直接透传给前端
      send({ type: 'error', code: err.code, msg: err.message });
    } else if (err instanceof Error && err.name === 'AbortError') {
      // 上游 fetch 被 abort 时抛的是 DOMException，名字也是 AbortError
      send({ type: 'aborted' });
    } else {
      // 未预期错误：日志留全量，前端只看到一句笼统提示
      console.error('[chat] unexpected', err);
      send({ type: 'error', code: 'INTERNAL', msg: '服务内部出错了，请稍后重试' });
    }
  } finally {
    // 不管成功、失败还是中断，都要清心跳并关流，否则定时器和连接一起泄漏
    clearInterval(heartbeat);
    if (!res.writableEnded) res.end();
  }
});
