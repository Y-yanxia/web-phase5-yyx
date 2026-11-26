// Cloudflare Worker 入口：把 server/ 的 Express 路由 1:1 搬到 fetch handler
//
// 在链路里的位置：浏览器 → 这里的 fetch() → db.js / chat.js → D1 或 DeepSeek。
// 没有 Express 的中间件栈，所以 CORS、JSON 解析、404、错误兜底全挤在这一个函数里。
// 与 Express 版的差异：
//   1. 无状态——每个请求可能落在不同 isolate，任何东西都不能缓存在模块变量里；
//   2. D1 是异步的——每个数据操作都要 await，判断顺序也得先查后判；
//   3. 没有 app.use——路由靠手写 if 匹配，漏 catch 的异常会变成 CF 的 1101 页面，
//      所以所有分支都包在同一个 try 里，保证任何情况都回一个 JSON 信封。
import {
  listItems, getItem, createItem, updateItem, deleteItem, getStats,
} from './db.js';
import { handleChat, handleResetSession } from './chat.js';

const MAX_TITLE = 200;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// 成功响应统一 { code: 0, data, msg }，和 Express 版同一个信封，前端不用分辨后端
const ok = (data, msg = 'ok') => Response.json({ code: 0, data, msg });
// 失败只多带一个 HTTP 状态码：status 给浏览器和监控看，code 给前端代码判断
const fail = (status, code, msg) => Response.json({ code, data: null, msg }, { status });

// 校验失败在深处直接 throw，外层一个 catch 统一转 400，省得每层都判返回值
class BadRequest extends Error {
  constructor(msg, code = 40001) {
    super(msg);
    this.code = code;
  }
}

/* ---------------- 校验（和 Express 版一致） ---------------- */

// /api/items/abc 要是 400 而不是 500：先确认是正整数，再让它进 SQL
function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new BadRequest(`路径参数 id 不合法：${raw}`, 40002);
  return id;
}

// title 是唯一必填字段：缺字段、非字符串、trim 后为空，全算 40001
function parseTitle(raw) {
  if (raw === undefined || raw === null) throw new BadRequest('缺少必填字段：title', 40001);
  if (typeof raw !== 'string') throw new BadRequest('title 必须是字符串', 40001);
  const title = raw.trim();
  if (!title) throw new BadRequest('缺少必填字段：title', 40001);
  if (title.length > MAX_TITLE) throw new BadRequest(`title 最长 ${MAX_TITLE} 个字符`, 40003);
  return title;
}

// due 可选：不传就存 NULL；传了就必须是 YYYY-MM-DD，不信任前端的日期控件
function parseDue(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new BadRequest('due 必须是 YYYY-MM-DD 格式的字符串', 40004);
  const due = raw.trim();
  if (!DATE_RE.test(due)) throw new BadRequest('due 必须是 YYYY-MM-DD 格式，例如 2026-11-25', 40004);
  return due;
}

// 前端/模型可能传 true、1、'1'，这里统一收敛成 0|1，入库前就把类型钉死
function parseDone(raw) {
  if (raw === true || raw === 1 || raw === '1') return 1;
  if (raw === false || raw === 0 || raw === '0') return 0;
  throw new BadRequest('done 只能是 0 或 1', 40005);
}

/* ---------------- CORS ---------------- */

// 逐请求算 CORS 头：白名单来自环境变量 ALLOWED_ORIGINS（逗号分隔，'*' 表示全放）
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const h = {
    // 预检结果让浏览器缓存一天，正常请求能少打一半 OPTIONS
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Accept',
    'Access-Control-Max-Age': '86400',
    // Vary: Origin 是在告诉 CDN/浏览器缓存「这份响应随 Origin 变」；
    // 少了它，A 站拿到的响应可能被缓存后原样喂给 B 站，跨域就时灵时不灵
    Vary: 'Origin',
  };
  // 命中白名单才回显具体 Origin，不回 '*'，以后要带 Cookie 也不用改协议
  if (origin && (allowed.includes('*') || allowed.includes(origin))) {
    h['Access-Control-Allow-Origin'] = origin;
  }
  return h;
}

/* ---------------- 路由 ---------------- */

export default {
  // Worker 的唯一入口：一个函数接住所有方法、所有路径
  async fetch(request, env) {
    const url = new URL(request.url);
    // 先算好 CORS，后面的预检、正常响应、错误响应都要贴同一份
    const cors = corsHeaders(request, env);

    // 预检直接 204，不进业务逻辑：少一次 D1 往返，也少一条日志噪音
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    // Response.json 造出来的头是全新的，CORS 得重新贴一遍；
    // 传 res.body 而不是先读成字符串，SSE 才是真流式、不会攒完再吐
    const wrap = (res) => {
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      return new Response(res.body, { status: res.status, headers });
    };

    try {
      const { pathname } = url;
      const parts = pathname.split('/').filter(Boolean); // ['api','items','3']

      // 健康检查顺带 await 一次 getStats：D1 绑定挂了这里就 500，不会假装还活着
      if (pathname === '/api/health') {
        const stats = await getStats(env);
        return wrap(ok({ status: 'up', mode: 'live', runtime: 'cloudflare-worker', stats }));
      }

      // 前端启动时读一次：是不是真模型、用的哪个 model、历史保留几条
      if (pathname === '/api/chat/meta') {
        return wrap(ok({
          mode: 'live',
          model: env.DEEPSEEK_MODEL || 'deepseek-chat',
          historyLimit: Number(env.HISTORY_LIMIT || 8),
          runtime: 'cloudflare-worker',
        }));
      }

      // 对话是 SSE：chat.js 返回一个还没写完的流，这里只负责把 CORS 贴上
      if (pathname === '/api/chat' && request.method === 'POST') {
        const res = await handleChat(request, env, url);
        return wrap(res);
      }

      // DELETE /api/chat/session/:id：Worker 没内存可清，清的是 D1 的历史表
      if (parts[0] === 'api' && parts[1] === 'chat' && parts[2] === 'session' && request.method === 'DELETE') {
        return wrap(await handleResetSession(env, decodeURIComponent(parts[3] || '')));
      }

      if (parts[0] === 'api' && parts[1] === 'items') {
        // /api/items
        if (parts.length === 2) {
          if (request.method === 'GET') {
            // done 不传就是全部；q 截到 50 字、limit 交给 db 层夹紧，防止被一次拉全表
            const doneRaw = url.searchParams.get('done');
            const done = doneRaw === null || doneRaw === '' ? null : parseDone(doneRaw);
            const items = await listItems(env, {
              done,
              q: (url.searchParams.get('q') || '').slice(0, 50),
              limit: url.searchParams.get('limit'),
            });
            return wrap(ok({ items, total: items.length }));
          }
          if (request.method === 'POST') {
            // Worker 没有 express.json，body 解析失败只能自己 catch 成 40010
            const body = await request.json().catch(() => null);
            if (!body) throw new BadRequest('请求体不是合法 JSON', 40010);
            const item = await createItem(env, { title: parseTitle(body.title), due: parseDue(body.due) });
            return wrap(ok(item, '创建成功'));
          }
        }

        // /api/items/stats
        // 必须排在 /:id 前面，否则 "stats" 会先被 parseId 当成非法 id 判 400
        if (parts[2] === 'stats' && request.method === 'GET') {
          return wrap(ok(await getStats(env)));
        }

        // /api/items/:id
        if (parts.length === 3) {
          const id = parseId(parts[2]);
          if (request.method === 'GET') {
            const item = await getItem(env, id);
            if (!item) return wrap(fail(404, 40401, '条目不存在'));
            return wrap(ok(item));
          }
          if (request.method === 'PUT' || request.method === 'PATCH') {
            const body = await request.json().catch(() => null);
            if (!body) throw new BadRequest('请求体不是合法 JSON', 40010);
            // 只把「真的传了」的字段放进 patch：undefined = 没提，保留原值
            const patch = {};
            if (body.title !== undefined) patch.title = parseTitle(body.title);
            if (body.done !== undefined) patch.done = parseDone(body.done);
            if (body.due !== undefined) patch.due = parseDue(body.due);
            // 一个字段都没传是客户端 bug：明确 400，别静默回 200 让人以为改了
            if (Object.keys(patch).length === 0) throw new BadRequest('至少要传 title、done、due 中的一个字段', 40006);
            const item = await updateItem(env, id, patch);
            if (!item) return wrap(fail(404, 40401, '条目不存在'));
            return wrap(ok(item, '更新成功'));
          }
          if (request.method === 'DELETE') {
            // 返回被删掉的那一整条，前端能直接拿标题做「已删除」提示
            const removed = await deleteItem(env, id);
            if (!removed) return wrap(fail(404, 40401, '条目不存在'));
            return wrap(ok(removed, '删除成功'));
          }
        }
      }

      // 还是 /api/* 说明路径写错了：必须是 JSON 404，不能掉进 HTML 错误页
      if (pathname.startsWith('/api')) {
        return wrap(fail(404, 40400, `接口不存在：${request.method} ${pathname}`));
      }

      // 其余路径：这个 Worker 只提供接口，页面在 GitHub Pages 上
      return wrap(Response.json({ code: 404, data: null, msg: '这是 API 服务，页面在 GitHub Pages 上' }, { status: 404 }));
    } catch (err) {
      // 校验错误是预期内的 400；其余一律 500，且只回笼统文案，
      // 免得把堆栈、SQL、env 这类内部信息漏给调用方
      if (err instanceof BadRequest) return wrap(fail(400, err.code, err.message));
      console.error('[worker]', err);
      return wrap(fail(500, 50000, '服务器内部错误'));
    }
  },
};
