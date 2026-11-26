// D1 数据层：和 server/db.js 保持同样的语义，只是全部变成 async。
//
// 在链路里的位置：index.js 的路由和 chat.js 的 agent 都只调这里，SQL 不外泄。
// 与 Express 版的差异：
//   - node:sqlite 是同步的（stmt.all() 直接给数组），D1 走网络，必须 await；
//   - 没有可复用的 db 句柄做事务，只能 prepare().bind().all()/first()/run() 链式调；
//   - 忘了 await 不会报错，只会拿到一个 Promise，后面取值全是 undefined，最难查。
// 时间戳统一交给 SQLite 的 datetime('now','localtime')，和建表默认值同源
const nowSql = "datetime('now', 'localtime')";

// 列表页：done / q / limit 三个可选条件，拼出 WHERE 后用位置参数 ... 绑定
export async function listItems(env, { done = null, q = '', limit = 200 } = {}) {
  // limit 是唯一要拼进 SQL 的部分（LIMIT 不吃字符串绑定），所以先夹到 1..500
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const where = [];
  const binds = [];
  // 只有 0/1 才加条件；传 'abc' 之类就当没传，列表页不该因为参数脏就白屏
  if (done === 0 || done === 1) {
    where.push('done = ?');
    binds.push(done);
  }
  if (q) {
    where.push('title LIKE ?');
    binds.push(`%${q}%`);
  }
  const sql = `SELECT id, title, done, due, created_at FROM items
               ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY done ASC, id DESC LIMIT ${lim}`;
  // all() 一次拿回全部行，返回 { results, success, meta }，行在 results 里
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  // 出口统一成 0|1 / null，和 Express 版的 normalize 一致，前端不用二次判断
  return (results || []).map((row) => ({ ...row, done: row.done ? 1 : 0, due: row.due ?? null }));
}

// 单条：first() 查不到时 resolve 成 null（不抛错），路由层就靠这个 null 回 404
export async function getItem(env, id) {
  const row = await env.DB.prepare(
    'SELECT id, title, done, due, created_at FROM items WHERE id = ?'
  ).bind(id).first();
  return row ? { ...row, done: row.done ? 1 : 0, due: row.due ?? null } : null;
}

// 新增：INSERT ... RETURNING 一次往返就把整行拿回来，省掉「插入再查」的第二趟
// 这里用 first() 而不是 run()，因为 RETURNING 有结果集
export async function createItem(env, { title, due = null }) {
  const row = await env.DB.prepare(
    `INSERT INTO items (title, done, due) VALUES (?, 0, ?)
     RETURNING id, title, done, due, created_at`
  ).bind(String(title).trim(), due ? String(due).trim() : null).first();
  return row ? { ...row, done: row.done ? 1 : 0, due: row.due ?? null } : null;
}

// 部分更新：patch 里 undefined 表示「这轮没提这个字段」，要原样保留
// 先读后写不是原子操作，但 D1 单语句没有事务 API，这个项目里够用
export async function updateItem(env, id, patch = {}) {
  const current = await getItem(env, id);
  // 查不到直接 null，让路由回 404，别先 UPDATE 一次再说
  if (!current) return null;

  const next = {
    title: patch.title !== undefined ? String(patch.title).trim() : current.title,
    done: patch.done !== undefined ? (patch.done ? 1 : 0) : current.done,
    due: patch.due !== undefined ? (patch.due ? String(patch.due).trim() : null) : current.due,
  };
  // run() 只回 { success, meta }，拿不到行，所以后面还要再查一次
  await env.DB.prepare('UPDATE items SET title = ?, done = ?, due = ? WHERE id = ?')
    .bind(next.title, next.done, next.due, current.id)
    .run();
  // 直接返回 Promise 交给上层 await，不用在这里再多写一个 await
  return getItem(env, current.id);
}

// 删除：先取出来再删，把删掉的那条原样返回，前端能做「已删除 xxx」的提示
export async function deleteItem(env, id) {
  const current = await getItem(env, id);
  if (!current) return null;
  await env.DB.prepare('DELETE FROM items WHERE id = ?').bind(current.id).run();
  return current;
}

// 统计：COALESCE 兜住空表时 SUM 返回 NULL 的情况，保证永远是三个数字
export async function getStats(env) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN done = 1 THEN 1 ELSE 0 END), 0) AS done,
            COALESCE(SUM(CASE WHEN done = 0 THEN 1 ELSE 0 END), 0) AS pending
     FROM items`
  ).first();
  return row || { total: 0, done: 0, pending: 0 };
}

/* ---------------- 对话历史 ----------------
   Worker 是无状态的：同一个会话的上下文只能落 chat_messages 表。
   Express 版放进程内 Map 就行，这一版必须每次请求先查库、写完再落库。*/

// 取最近 limit 条：先按 id 倒序取，再把数组 reverse 回正序，模型要的是从旧到新
export async function loadHistory(env, sessionId, limit) {
  const { results } = await env.DB.prepare(
    'SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?'
  ).bind(sessionId, limit).all();
  // 取最近 N 条后要按时间正序还原
  return (results || []).reverse();
}

// 一次写多条：DB.batch() 是一个事务、一次网络往返，比逐条 await 快也稳
export async function appendMessages(env, sessionId, messages) {
  // 语句只 prepare 一次，只是每次 bind 的参数不同
  const stmt = env.DB.prepare(
    'INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)'
  );
  const batch = messages.map((m) => stmt.bind(sessionId, m.role, String(m.content)));
  // 空数组别发请求：D1 的 batch 传空会直接报错
  if (batch.length) await env.DB.batch(batch);
}

// 裁剪历史：只保留最近 keep 条，避免 token 越滚越贵
export async function trimHistory(env, sessionId, keep) {
  // NOT IN 子查询挑出「旧的那批」一次性删掉，不用先查 id 再拼 IN 列表
  await env.DB.prepare(
    `DELETE FROM chat_messages
     WHERE session_id = ?
       AND id NOT IN (SELECT id FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?)`
  ).bind(sessionId, sessionId, keep).run();
}

// 重置会话：前端点「新对话」时清掉这个 session 的全部历史
export async function clearHistory(env, sessionId) {
  await env.DB.prepare('DELETE FROM chat_messages WHERE session_id = ?').bind(sessionId).run();
}
