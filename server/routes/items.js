// 任务2：清单的增删改查接口。
// 验收重点不是「能跑」，而是「出错时也返回 JSON、服务不崩」。
import { Router } from 'express';
import { asyncHandler, ok } from '../lib/http.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { config } from '../config.js';
import {
  listItems,
  getItem,
  createItem,
  updateItem,
  deleteItem,
  getStats,
} from '../db.js';

export const itemsRouter = Router();

const MAX_TITLE = 200;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw badRequest(`路径参数 id 不合法：${raw}`, 40002);
  return id;
}

function parseTitle(raw) {
  if (raw === undefined || raw === null) throw badRequest('缺少必填字段：title', 40001);
  if (typeof raw !== 'string') throw badRequest('title 必须是字符串', 40001);
  const title = raw.trim();
  if (!title) throw badRequest('缺少必填字段：title', 40001);
  if (title.length > MAX_TITLE) throw badRequest(`title 最长 ${MAX_TITLE} 个字符`, 40003);
  return title;
}

function parseDue(raw) {
  // 没传 due 是合法的（无截止日期），传错格式才报 400
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw badRequest('due 必须是 YYYY-MM-DD 格式的字符串', 40004);
  const due = raw.trim();
  if (!DATE_RE.test(due)) throw badRequest('due 必须是 YYYY-MM-DD 格式，例如 2026-11-25', 40004);
  return due;
}

function parseDone(raw) {
  if (raw === true || raw === 1 || raw === '1') return 1;
  if (raw === false || raw === 0 || raw === '0') return 0;
  throw badRequest('done 只能是 0 或 1', 40005);
}

// GET /api/items?done=0&q=实验&limit=50
itemsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    // 联调演示开关：?fail=1 让「只有列表」进 500，前端才能单独截 error 态
    if (req.query.fail === '1' && config.allowDevFail) {
      throw new AppError('演示开关：列表接口故意失败（?fail=1）', { status: 500, code: 50001 });
    }
    const done =
      req.query.done === undefined || req.query.done === ''
        ? null
        : parseDone(req.query.done);
    const items = listItems({
      done,
      q: (req.query.q ?? '').toString().slice(0, 50),
      limit: req.query.limit,
    });
    ok(res, { items, total: items.length });
  })
);

itemsRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => ok(res, getStats()))
);

itemsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const item = getItem(parseId(req.params.id));
    if (!item) throw notFound('条目不存在', 40401);
    ok(res, item);
  })
);

// POST /api/items  body: { "title": "交实验报告", "due": "2026-11-25" }
itemsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    // 故意先校验再落库：少传 title 必须是 400 + 人话，而不是 500 + 堆栈
    const title = parseTitle(body.title);
    const due = parseDue(body.due);
    const item = createItem({ title, due });
    ok(res, item, '创建成功');
  })
);

// PUT /api/items/:id  body: { "title"?: string, "done"?: 0|1, "due"?: "YYYY-MM-DD"|null }
// PATCH 是同一段逻辑的别名：前端勾选「完成」时只发 { done: 1 }，语义更贴切
const updateHandler = asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const body = req.body ?? {};
  const patch = {};

  if (body.title !== undefined) patch.title = parseTitle(body.title);
  if (body.done !== undefined) patch.done = parseDone(body.done);
  if (body.due !== undefined) patch.due = parseDue(body.due);

  if (Object.keys(patch).length === 0) {
    throw badRequest('至少要传 title、done、due 中的一个字段', 40006);
  }

  const item = updateItem(id, patch);
  if (!item) throw notFound('条目不存在', 40401);
  ok(res, item, '更新成功');
});

itemsRouter.put('/:id', updateHandler);
itemsRouter.patch('/:id', updateHandler);

itemsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const removed = deleteItem(parseId(req.params.id));
    if (!removed) throw notFound('条目不存在', 40401);
    ok(res, removed, '删除成功');
  })
);
