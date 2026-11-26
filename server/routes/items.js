/**
 * 清单 CRUD 路由：/api/items 下的列表、统计、详情、新增、更新、删除。
 * 链路位置：app.js 挂前缀 -> 这里校验入参 -> db.js 落库 -> ok() 统一回包。
 * 对外导出：itemsRouter（一个 Express Router 实例）。
 * 坑：每个 handler 都要 asyncHandler；参数先校验再碰数据库，400 和 500 不能混。
 */
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

// 独立 Router：前缀由 app.js 挂，这里只写 '/' 和 '/:id'
export const itemsRouter = Router();

// 标题长度上限和日期格式都收紧在常量里，改规则只改一处
const MAX_TITLE = 200;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// id 只认正整数：'abc'、'0'、'-1' 一律 400，别让脏值落到 SQL
function parseId(raw) {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw badRequest(`路径参数 id 不合法：${raw}`, 40002);
  return id;
}

// 三态要分开：undefined/null 是「没传」，'' 或全空格是「传了空值」，都按 400 报
function parseTitle(raw) {
  if (raw === undefined || raw === null) throw badRequest('缺少必填字段：title', 40001);
  if (typeof raw !== 'string') throw badRequest('title 必须是字符串', 40001);
  // trim 之后再判空，避免用户只敲空格就建出一条空任务
  const title = raw.trim();
  if (!title) throw badRequest('缺少必填字段：title', 40001);
  if (title.length > MAX_TITLE) throw badRequest(`title 最长 ${MAX_TITLE} 个字符`, 40003);
  return title;
}

// 校验截止日期：只接受 YYYY-MM-DD，没传等于「没有截止日期」（合法）
function parseDue(raw) {
  // 没传 due 是合法的（无截止日期），传错格式才报 400
  // undefined/null/'' 都算「没填」：前端清空日期框发过来的就是 ''
  if (raw === undefined || raw === null || raw === '') return null;
  if (typeof raw !== 'string') throw badRequest('due 必须是 YYYY-MM-DD 格式的字符串', 40004);
  const due = raw.trim();
  if (!DATE_RE.test(due)) throw badRequest('due 必须是 YYYY-MM-DD 格式，例如 2026-11-25', 40004);
  return due;
}

// done 兼容布尔、数字和字符串：勾选框可能发 true，也可能发 1 或 '1'
function parseDone(raw) {
  if (raw === true || raw === 1 || raw === '1') return 1;
  if (raw === false || raw === 0 || raw === '0') return 0;
  throw badRequest('done 只能是 0 或 1', 40005);
}

// GET /api/items?done=0&q=实验&limit=50
// 列表：done 不传或空串=全部，q 是标题模糊匹配，limit 交给 db 层夹范围
itemsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    // 联调演示开关：?fail=1 让「只有列表」进 500，前端才能单独截 error 态
    if (req.query.fail === '1' && config.allowDevFail) {
      throw new AppError('演示开关：列表接口故意失败（?fail=1）', { status: 500, code: 50001 });
    }
    // 空串是前端「全部」选项的原始值，转成 null 才能走 SQL 的不过滤分支
    const done =
      req.query.done === undefined || req.query.done === ''
        ? null
        : parseDone(req.query.done);
    const items = listItems({
      done,
      // 关键词截到 50 字：再长也没意义，还容易把 LIKE 拖慢
      q: (req.query.q ?? '').toString().slice(0, 50),
      // 不在这里转数字，db 层统一兜底并夹到 1~500
      limit: req.query.limit,
    });
    ok(res, { items, total: items.length });
  })
);

// 统计：总数/已完成/未完成，主页顶部那行数字就靠它
// 注意顺序：/stats 必须写在 /:id 前面，否则 stats 会被当成一个 id
itemsRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => ok(res, getStats()))
);

// 详情：查不到直接 404，不返回 data: null 让前端自己猜
itemsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const item = getItem(parseId(req.params.id));
    if (!item) throw notFound('条目不存在', 40401);
    ok(res, item);
  })
);

// POST /api/items  body: { "title": "交实验报告", "due": "2026-11-25" }
// 新增：title 必填、due 可选；成功返回带 id 和 created_at 的完整条目
itemsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    // 表单或纯文本请求进来时 req.body 是 undefined，这里兜成空对象
    const body = req.body ?? {};
    // 故意先校验再落库：少传 title 必须是 400 + 人话，而不是 500 + 堆栈
    const title = parseTitle(body.title);
    const due = parseDue(body.due);
    // db 层用 RETURNING 一次拿回整行，不用插完再查一次
    const item = createItem({ title, due });
    ok(res, item, '创建成功');
  })
);

// PUT /api/items/:id  body: { "title"?: string, "done"?: 0|1, "due"?: "YYYY-MM-DD"|null }
// PATCH 是同一段逻辑的别名：前端勾选「完成」时只发 { done: 1 }，语义更贴切
// 更新：只处理确实传了的字段，一个字段都没传就 400
const updateHandler = asyncHandler(async (req, res) => {
  const id = parseId(req.params.id);
  const body = req.body ?? {};
  const patch = {};

  // patch 里只放「明确传了」的字段，undefined 的字段不进来，db 层就不会覆盖
  if (body.title !== undefined) patch.title = parseTitle(body.title);
  if (body.done !== undefined) patch.done = parseDone(body.done);
  if (body.due !== undefined) patch.due = parseDue(body.due);

  // 空 body 不算成功：大概率是前端写错了，报 400 比静默更新更好定位
  if (Object.keys(patch).length === 0) {
    throw badRequest('至少要传 title、done、due 中的一个字段', 40006);
  }

  const item = updateItem(id, patch);
  // db 层返回 null 说明 id 不存在，这时才 404，和参数错误分开
  if (!item) throw notFound('条目不存在', 40401);
  ok(res, item, '更新成功');
});

// 两个动词共用一个 handler：语义不同，字段合并规则一样（前端勾选用 PATCH）
itemsRouter.put('/:id', updateHandler);
itemsRouter.patch('/:id', updateHandler);

// 删除：返回被删除的整条数据，重复删除拿到 404
itemsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const removed = deleteItem(parseId(req.params.id));
    if (!removed) throw notFound('条目不存在', 40401);
    ok(res, removed, '删除成功');
  })
);
