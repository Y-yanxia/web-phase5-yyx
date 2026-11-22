// Cloudflare Worker 入口：把 server/ 的 Express 路由 1:1 搬到 fetch handler
import {
  listItems, getItem, createItem, updateItem, deleteItem, getStats,
} from './db.js';
import { handleChat, handleResetSession } from './chat.js';

const MAX_TITLE = 200;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ok = (data, msg = 'ok') => Response.json({ code: 0, data, msg });
const fail = (status, code, msg) => Response.json({ code, data: null, msg }, { status });

class BadRequest extends Error {
  constructor(msg, code = 40001) {
    super(msg);
    this.code = code;
  }
}

/* ---------------- 校验（和 Express 版一致） ---------------- */

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw new BadRequest(`路径参数 id 不合法：${raw}`, 40002);
  return id;
}

function parseTitle(raw) {
  if (raw === undefined || raw === null) throw new BadRequest('缺少必填字段：title', 40001);
  if (typeof raw !== 'string') throw new BadRequest('title 必须是字符串', 40001);
  const title = raw.trim();
  if (!title) throw new BadRequest('缺少必填字段：title', 40001);
  if (title.length > MAX_TITLE) throw new BadRequest(`title 最长 ${MAX_TITLE} 个字符`, 40003);
  return title;
}

function parseDue(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw new BadRequest('due 必须是 YYYY-MM-DD 格式的字符串', 40004);
  const due = raw.trim();
  if (!DATE_RE.test(due)) throw new BadRequest('due 必须是 YYYY-MM-DD 格式，例如 2026-11-25', 40004);
  return due;
}

function parseDone(raw) {
  if (raw === true || raw === 1 || raw === '1') return 1;
  if (raw === false || raw === 0 || raw === '0') return 0;
  throw new BadRequest('done 只能是 0 或 1', 40005);
}

/* ---------------- CORS ---------------- */

function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const h = {
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Accept',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (origin && (allowed.includes('*') || allowed.includes(origin))) {
    h['Access-Control-Allow-Origin'] = origin;
  }
  return h;
}

/* ---------------- 路由 ---------------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }

    const wrap = (res) => {
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(cors)) headers.set(k, v);
      return new Response(res.body, { status: res.status, headers });
    };

    try {
      const { pathname } = url;
      const parts = pathname.split('/').filter(Boolean); // ['api','items','3']

      if (pathname === '/api/health') {
        const stats = await getStats(env);
        return wrap(ok({ status: 'up', mode: 'live', runtime: 'cloudflare-worker', stats }));
      }

      if (pathname === '/api/chat/meta') {
        return wrap(ok({
          mode: 'live',
          model: env.DEEPSEEK_MODEL || 'deepseek-chat',
          historyLimit: Number(env.HISTORY_LIMIT || 8),
          runtime: 'cloudflare-worker',
        }));
      }

      if (pathname === '/api/chat' && request.method === 'POST') {
        const res = await handleChat(request, env, url);
        return wrap(res);
      }

      if (parts[0] === 'api' && parts[1] === 'chat' && parts[2] === 'session' && request.method === 'DELETE') {
        return wrap(await handleResetSession(env, decodeURIComponent(parts[3] || '')));
      }

      if (parts[0] === 'api' && parts[1] === 'items') {
        // /api/items
        if (parts.length === 2) {
          if (request.method === 'GET') {
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
            const body = await request.json().catch(() => null);
            if (!body) throw new BadRequest('请求体不是合法 JSON', 40010);
            const item = await createItem(env, { title: parseTitle(body.title), due: parseDue(body.due) });
            return wrap(ok(item, '创建成功'));
          }
        }

        // /api/items/stats
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
            const patch = {};
            if (body.title !== undefined) patch.title = parseTitle(body.title);
            if (body.done !== undefined) patch.done = parseDone(body.done);
            if (body.due !== undefined) patch.due = parseDue(body.due);
            if (Object.keys(patch).length === 0) throw new BadRequest('至少要传 title、done、due 中的一个字段', 40006);
            const item = await updateItem(env, id, patch);
            if (!item) return wrap(fail(404, 40401, '条目不存在'));
            return wrap(ok(item, '更新成功'));
          }
          if (request.method === 'DELETE') {
            const removed = await deleteItem(env, id);
            if (!removed) return wrap(fail(404, 40401, '条目不存在'));
            return wrap(ok(removed, '删除成功'));
          }
        }
      }

      if (pathname.startsWith('/api')) {
        return wrap(fail(404, 40400, `接口不存在：${request.method} ${pathname}`));
      }

      return wrap(Response.json({ code: 404, data: null, msg: '这是 API 服务，页面在 GitHub Pages 上' }, { status: 404 }));
    } catch (err) {
      if (err instanceof BadRequest) return wrap(fail(400, err.code, err.message));
      console.error('[worker]', err);
      return wrap(fail(500, 50000, '服务器内部错误'));
    }
  },
};
