// D1 数据层：和 server/db.js 保持同样的语义，只是全部变成 async。
const nowSql = "datetime('now', 'localtime')";

export async function listItems(env, { done = null, q = '', limit = 200 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 200, 1), 500);
  const where = [];
  const binds = [];
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
  const { results } = await env.DB.prepare(sql).bind(...binds).all();
  return (results || []).map((row) => ({ ...row, done: row.done ? 1 : 0, due: row.due ?? null }));
}

export async function getItem(env, id) {
  const row = await env.DB.prepare(
    'SELECT id, title, done, due, created_at FROM items WHERE id = ?'
  ).bind(id).first();
  return row ? { ...row, done: row.done ? 1 : 0, due: row.due ?? null } : null;
}

export async function createItem(env, { title, due = null }) {
  const row = await env.DB.prepare(
    `INSERT INTO items (title, done, due) VALUES (?, 0, ?)
     RETURNING id, title, done, due, created_at`
  ).bind(String(title).trim(), due ? String(due).trim() : null).first();
  return row ? { ...row, done: row.done ? 1 : 0, due: row.due ?? null } : null;
}

export async function updateItem(env, id, patch = {}) {
  const current = await getItem(env, id);
  if (!current) return null;

  const next = {
    title: patch.title !== undefined ? String(patch.title).trim() : current.title,
    done: patch.done !== undefined ? (patch.done ? 1 : 0) : current.done,
    due: patch.due !== undefined ? (patch.due ? String(patch.due).trim() : null) : current.due,
  };
  await env.DB.prepare('UPDATE items SET title = ?, done = ?, due = ? WHERE id = ?')
    .bind(next.title, next.done, next.due, current.id)
    .run();
  return getItem(env, current.id);
}

export async function deleteItem(env, id) {
  const current = await getItem(env, id);
  if (!current) return null;
  await env.DB.prepare('DELETE FROM items WHERE id = ?').bind(current.id).run();
  return current;
}

export async function getStats(env) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS total,
            COALESCE(SUM(CASE WHEN done = 1 THEN 1 ELSE 0 END), 0) AS done,
            COALESCE(SUM(CASE WHEN done = 0 THEN 1 ELSE 0 END), 0) AS pending
     FROM items`
  ).first();
  return row || { total: 0, done: 0, pending: 0 };
}

/* ---------------- 对话历史 ---------------- */

export async function loadHistory(env, sessionId, limit) {
  const { results } = await env.DB.prepare(
    'SELECT role, content FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?'
  ).bind(sessionId, limit).all();
  // 取最近 N 条后要按时间正序还原
  return (results || []).reverse();
}

export async function appendMessages(env, sessionId, messages) {
  const stmt = env.DB.prepare(
    'INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)'
  );
  const batch = messages.map((m) => stmt.bind(sessionId, m.role, String(m.content)));
  if (batch.length) await env.DB.batch(batch);
}

export async function trimHistory(env, sessionId, keep) {
  // 只保留最近 keep 条，避免 token 越滚越贵
  await env.DB.prepare(
    `DELETE FROM chat_messages
     WHERE session_id = ?
       AND id NOT IN (SELECT id FROM chat_messages WHERE session_id = ? ORDER BY id DESC LIMIT ?)`
  ).bind(sessionId, sessionId, keep).run();
}

export async function clearHistory(env, sessionId) {
  await env.DB.prepare('DELETE FROM chat_messages WHERE session_id = ?').bind(sessionId).run();
}
