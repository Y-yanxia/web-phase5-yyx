// ============================================================
// 一句话清单 · 前端主逻辑（原生 JS，无框架）
// 分工：状态 -> 渲染 -> 事件，三层不互相调用，方便一段段讲清楚。
// ============================================================

const params = new URLSearchParams(location.search);
const API_BASE = (
  params.get('api') ||
  window.__API_BASE__ ||
  (location.protocol === 'file:' ? 'http://localhost:3000' : location.origin)
).replace(/\/+$/, '');

const state = {
  items: [],
  stats: { total: 0, done: 0, pending: 0 },
  filter: 'all',
  query: '',
  loading: true,
  error: null,
  aiMode: null,
  sessionId: getSessionId(),
  streaming: false,
  controller: null,
};

const $ = (id) => document.getElementById(id);
const els = {
  list: $('list'),
  listState: $('listState'),
  form: $('addForm'),
  title: $('titleInput'),
  due: $('dueInput'),
  addBtn: $('addBtn'),
  formError: $('formError'),
  search: $('searchInput'),
  stats: { total: $('statTotal'), pending: $('statPending'), done: $('statDone') },
  tabCount: $('tabCount'),
  heroSub: $('heroSub'),
  messages: $('messages'),
  chatForm: $('chatForm'),
  chatInput: $('chatInput'),
  sendBtn: $('sendBtn'),
  stopBtn: $('stopBtn'),
  chatError: $('chatError'),
  aiModeText: $('aiModeText'),
  aiDot: $('aiDot'),
  footMode: $('footMode'),
  debugList: $('debugList'),
  resetChat: $('resetChat'),
};

/* ----------------------------- 小工具 ----------------------------- */

function getSessionId() {
  let sid = localStorage.getItem('onelist.sid');
  if (!sid) {
    sid = `s-${(crypto.randomUUID?.() || Math.random().toString(36)).slice(0, 12)}`;
    localStorage.setItem('onelist.sid', sid);
  }
  return sid;
}

const escapeHtml = (str) =>
  String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function dueLabel(due, done) {
  if (!due) return null;
  // 已完成的事项不再提示「逾期」——那只会制造噪音
  if (done) return { text: `截止 ${due}`, cls: '' };
  const today = todayISO();
  if (due === today) return { text: '今天到期', cls: 'is-today' };
  if (due < today) return { text: `已逾期 ${due}`, cls: 'is-overdue' };
  return { text: `截止 ${due}`, cls: '' };
}

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// GitHub Pages 只有静态文件，后端没部署时给它一句能照做的提示，而不是干巴巴的「连不上」
const STATIC_HOST_HINT = location.hostname.endsWith('github.io')
  ? '线上后端还没部署：GitHub Pages 只能放静态页。本地 npm start 可完整运行，部署步骤见 docs/deploy.md'
  : null;

async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch {
    throw new ApiError('连不上服务器，请确认后端已启动（或线上地址是否填对）', 0);
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || body.code !== 0) {
    throw new ApiError(body?.msg || `请求失败（HTTP ${res.status}）`, res.status);
  }
  return body.data;
}

/* ----------------------------- 清单渲染 ----------------------------- */

function renderStats() {
  const { total, pending, done } = state.stats;
  els.stats.total.textContent = total;
  els.stats.pending.textContent = pending;
  els.stats.done.textContent = done;
  els.tabCount.textContent = pending;
  els.heroSub.textContent = total
    ? `还有 ${pending} 件没做完${done ? `，已经完成 ${done} 件` : ''}。`
    : '添加第一条任务，或者切到「AI 助手」直接说一句话。';
}

function itemHtml(item) {
  const due = dueLabel(item.due, item.done);
  return `
    <li class="item ${item.done ? 'is-done' : ''}" data-id="${item.id}">
      <button class="check" type="button" role="checkbox" aria-checked="${Boolean(item.done)}"
        aria-label="${item.done ? '标记为未完成' : '标记为已完成'}" data-action="toggle">✓</button>
      <div class="item-main">
        <p class="item-title">${escapeHtml(item.title)}</p>
        <p class="item-meta">
          ${due ? `<span class="due ${due.cls}">${escapeHtml(due.text)}</span>` : ''}
          <span>#${item.id}</span>
          <span>${escapeHtml(item.created_at || '')}</span>
        </p>
      </div>
      <div class="item-actions">
        <button class="icon-btn" type="button" data-action="delete" aria-label="删除「${escapeHtml(item.title)}」" title="删除">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
          </svg>
        </button>
      </div>
    </li>`;
}

function showState({ title, desc, actionText, onAction, kind }) {
  els.listState.hidden = false;
  els.listState.innerHTML = `
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(desc)}</p>
    ${actionText ? `<button class="btn btn-ghost btn-sm" type="button" data-retry>${escapeHtml(actionText)}</button>` : ''}`;
  els.listState.className = `state state-${kind || 'info'}`;
  const btn = els.listState.querySelector('[data-retry]');
  if (btn) btn.addEventListener('click', onAction, { once: true });
}

function renderList() {
  els.list.innerHTML = '';

  if (state.loading) {
    els.listState.hidden = true;
    els.list.innerHTML = '<li class="skeleton"><ul class="skeleton"><li></li><li></li><li></li></ul></li>';
    // 骨架屏放在 state 容器里更好控制高度，这里用简单的三行占位
    els.list.innerHTML = '';
    els.listState.hidden = false;
    els.listState.className = 'state';
    els.listState.innerHTML = '<ul class="skeleton"><li></li><li></li><li></li></ul>';
    return;
  }

  if (state.error) {
    showState({
      title: '加载失败了',
      desc: state.error,
      actionText: '重试',
      onAction: () => loadItems(),
      kind: 'error',
    });
    return;
  }

  if (state.items.length === 0) {
    els.listState.hidden = false;
    els.listState.className = 'state';
    const isFiltering = state.filter !== 'all' || state.query;
    els.listState.innerHTML = isFiltering
      ? `<h3>没有匹配的任务</h3><p>换个筛选条件，或者清空搜索词试试。</p>`
      : `<h3>清单还是空的</h3><p>在上面输入框加一条，或去「AI 助手」说一句「帮我加一条明天交实验报告」。</p>`;
    return;
  }

  els.listState.hidden = true;
  els.list.innerHTML = state.items.map(itemHtml).join('');
}

async function loadItems() {
  state.loading = true;
  state.error = null;
  renderList();

  const query = new URLSearchParams();
  if (state.filter === 'pending') query.set('done', '0');
  if (state.filter === 'done') query.set('done', '1');
  if (state.query) query.set('q', state.query);
  const qs = query.toString();

  // 让 loading 态至少停留 250ms，否则本地瞬间返回，截图和肉眼都看不见
  const started = Date.now();
  try {
    const [data, stats] = await Promise.all([
      api(`/api/items${qs ? `?${qs}` : ''}`),
      api('/api/items/stats'),
    ]);
    state.items = data.items;
    state.stats = stats;
  } catch (err) {
    state.error = STATIC_HOST_HINT || err.message;
    state.items = [];
  } finally {
    const wait = Math.max(0, 250 - (Date.now() - started));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    state.loading = false;
    renderList();
    renderStats();
  }
}

/* ----------------------------- 清单交互 ----------------------------- */

els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = els.title.value.trim();
  els.formError.hidden = true;

  if (!title) {
    els.formError.textContent = '任务内容不能为空';
    els.formError.hidden = false;
    els.title.focus();
    return;
  }

  els.addBtn.disabled = true;
  els.addBtn.textContent = '添加中…';
  try {
    const payload = { title };
    if (els.due.value) payload.due = els.due.value;
    await api('/api/items', { method: 'POST', body: JSON.stringify(payload) });
    els.form.reset();
    els.title.focus();
    await loadItems();
  } catch (err) {
    els.formError.textContent = err.message;
    els.formError.hidden = false;
  } finally {
    els.addBtn.disabled = false;
    els.addBtn.textContent = '添加';
  }
});

els.list.addEventListener('click', async (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const li = btn.closest('li[data-id]');
  if (!li) return;
  const id = li.dataset.id;

  if (btn.dataset.action === 'delete') {
    const title = li.querySelector('.item-title')?.textContent ?? '这条任务';
    if (!confirm(`确定删除「${title}」吗？`)) return;
    try {
      await api(`/api/items/${id}`, { method: 'DELETE' });
      await loadItems();
    } catch (err) {
      alert(err.message);
    }
    return;
  }

  if (btn.dataset.action === 'toggle') {
    const done = btn.getAttribute('aria-checked') === 'true' ? 0 : 1;
    try {
      await api(`/api/items/${id}`, { method: 'PATCH', body: JSON.stringify({ done }) });
      await loadItems();
    } catch (err) {
      alert(err.message);
    }
  }
});

document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    state.filter = chip.dataset.filter;
    loadItems();
  });
});

let searchTimer;
els.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = els.search.value.trim();
    loadItems();
  }, 280);
});

/* ----------------------------- Tab 切换 ----------------------------- */

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });
  const listPanel = $('panel-list');
  const aiPanel = $('panel-ai');
  listPanel.hidden = name !== 'list';
  aiPanel.hidden = name !== 'ai';
  listPanel.classList.toggle('is-active', name === 'list');
  aiPanel.classList.toggle('is-active', name === 'ai');
  if (name === 'ai') els.chatInput.focus();
  // 记住当前面板，刷新后还停在原处
  history.replaceState(null, '', name === 'ai' ? '#ai' : location.pathname);
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

/* ----------------------------- AI 对话 ----------------------------- */

function nearBottom(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function scrollMessages(force = false) {
  const el = els.messages;
  if (force || nearBottom(el)) el.scrollTop = el.scrollHeight;
}

function addMessage(role, text = '') {
  const wrap = document.createElement('div');
  wrap.className = `msg msg-${role}`;
  const body = document.createElement('div');
  body.className = 'msg-body';
  body.textContent = text;
  wrap.appendChild(body);
  els.messages.appendChild(wrap);
  scrollMessages(true);
  return { wrap, body };
}

function addToolCard(name, args, malformed) {
  const card = document.createElement('div');
  card.className = `tool-card${malformed ? ' is-failed' : ''}`;
  const argText = typeof args === 'string' ? args : JSON.stringify(args ?? {});
  card.innerHTML = `
    <span class="tool-line"><span class="tool-name">🔧 ${escapeHtml(name)}</span>(${escapeHtml(argText)})</span>
    <span class="tool-line tool-result">执行中…</span>`;
  els.messages.appendChild(card);
  scrollMessages(true);
  return card;
}

function setToolResult(card, result) {
  const el = card.querySelector('.tool-result');
  if (!el) return;
  const ok = result?.ok !== false;
  el.style.color = ok ? 'var(--ok)' : 'var(--danger)';
  el.textContent = ok
    ? `→ ${result?.summary || '执行成功'}`
    : `→ 失败：${result?.error || '未知错误'}`;
}

function pushDebug({ name, args }) {
  const empty = els.debugList.querySelector('.debug-empty');
  if (empty) empty.remove();
  const li = document.createElement('li');
  li.className = 'debug-item';
  const argText = typeof args === 'string' ? args : JSON.stringify(args ?? {});
  li.innerHTML = `<span class="dbg-status">⏳</span> <b>${escapeHtml(name)}</b>(${escapeHtml(argText)})`;
  els.debugList.prepend(li);
  return li;
}

// 同一条调用记录原地更新状态，而不是再插一条——否则一次调用看起来像调了两次
function resolveDebug(li, result) {
  if (!li) return;
  const ok = result?.ok !== false;
  const status = li.querySelector('.dbg-status');
  if (status) status.textContent = ok ? '✅' : '❌';
  const tail = document.createElement('span');
  tail.className = ok ? 'tool-ok' : '';
  tail.style.color = ok ? '' : 'var(--danger)';
  tail.textContent = ` → ${result?.summary || result?.error || 'ok'}`;
  li.appendChild(tail);
}

function showChatError(msg) {
  els.chatError.textContent = msg;
  els.chatError.hidden = false;
}

function clearChatError() {
  els.chatError.hidden = true;
}

// 把 SSE 字节流拆成一条条 JSON 事件
async function readSse(res, onEvent) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        try {
          onEvent(JSON.parse(payload));
        } catch {
          /* 忽略心跳等非 JSON 内容 */
        }
      }
    }
  }
}

async function sendMessage(text) {
  if (state.streaming) return;
  const message = text.trim();
  if (!message) return;

  clearChatError();
  addMessage('user', message);
  els.chatInput.value = '';
  autoGrow();

  // 当前正在追加文字的气泡。模型「先说一句 → 调工具 → 再说结果」时，
  // 工具卡片插在中间，后面的文字要落到新气泡里，阅读顺序才对。
  let assistant = addMessage('assistant', '');
  assistant.wrap.classList.add('is-typing');

  state.streaming = true;
  state.controller = new AbortController();
  els.sendBtn.disabled = true;
  els.stopBtn.hidden = false;
  els.chatInput.disabled = true;

  const toolCards = new Map();
  let gotError = false;

  try {
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId, message }),
      signal: state.controller.signal,
    });

    if (!res.ok || !res.headers.get('content-type')?.includes('text/event-stream')) {
      const body = await res.json().catch(() => null);
      throw new ApiError(body?.msg || `请求失败（HTTP ${res.status}）`, res.status);
    }

    await readSse(res, (evt) => {
      switch (evt.type) {
        case 'delta':
          assistant.body.textContent += evt.text;
          scrollMessages();
          break;
        case 'tool_call': {
          const card = addToolCard(evt.name, evt.args, evt.malformed);
          const debugLi = pushDebug({ name: evt.name, args: evt.args });
          toolCards.set(evt.id, { card, debugLi });
          // 说完再干：
          if (assistant.body.textContent.trim()) {
            assistant.wrap.classList.remove('is-typing');
            assistant = addMessage('assistant', '');
            assistant.wrap.classList.add('is-typing');
          }
          scrollMessages(true);
          break;
        }
        case 'tool_result': {
          const found = toolCards.get(evt.id);
          if (found) {
            setToolResult(found.card, evt.result);
            resolveDebug(found.debugLi, evt.result);
          }
          scrollMessages(true);
          break;
        }
        case 'error':
          gotError = true;
          assistant.wrap.classList.add('msg-error');
          assistant.body.textContent = evt.msg || '出错了';
          showChatError(evt.msg || '出错了');
          break;
        case 'aborted':
          assistant.body.textContent += '\n\n（已停止生成）';
          break;
        default:
          break;
      }
    });
  } catch (err) {
    if (err.name === 'AbortError') {
      assistant.body.textContent += '\n\n（已停止生成）';
    } else {
      gotError = true;
      assistant.wrap.classList.add('msg-error');
      assistant.body.textContent = err.message || '网络异常';
      showChatError(err.message || '网络异常');
    }
  } finally {
    assistant.wrap.classList.remove('is-typing');
    // 只调了工具、没留一句话的空白气泡，直接删掉，别让界面出现空气泡
    if (!assistant.body.textContent.trim() && !gotError) assistant.wrap.remove();
    state.streaming = false;
    state.controller = null;
    els.sendBtn.disabled = false;
    els.stopBtn.hidden = true;
    els.chatInput.disabled = false;
    els.chatInput.focus();
    scrollMessages(true);
    // AI 可能改了数据，回到清单时重新拉一次
    loadItems();
  }
}

els.chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  sendMessage(els.chatInput.value);
});

els.stopBtn.addEventListener('click', () => {
  state.controller?.abort();
});

els.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendMessage(els.chatInput.value);
  }
});

function autoGrow() {
  els.chatInput.style.height = 'auto';
  els.chatInput.style.height = `${Math.min(els.chatInput.scrollHeight, 120)}px`;
}
els.chatInput.addEventListener('input', autoGrow);

els.resetChat.addEventListener('click', async () => {
  if (state.streaming) return;
  try {
    await api(`/api/chat/session/${encodeURIComponent(state.sessionId)}`, { method: 'DELETE' });
  } catch {
    /* 会话在后端不存在也无所谓 */
  }
  els.messages.innerHTML = '';
  els.debugList.innerHTML = '<li class="debug-empty">还没有工具调用</li>';
  addMessage('assistant', '会话已清空，重新开始吧。');
});

/* ----------------------------- 启动 ----------------------------- */

async function loadMeta() {
  try {
    const meta = await api('/api/chat/meta');
    state.aiMode = meta.mode;
    const live = meta.mode === 'live';
    els.aiModeText.textContent = live
      ? `已接入 ${meta.model} · 支持工具调用`
      : `离线演示模式（未配置 API Key，规则模拟）`;
    els.aiDot.classList.toggle('is-mock', !live);
    els.footMode.textContent = live ? `AI：${meta.model}` : 'AI：离线演示模式';
  } catch {
    els.aiModeText.textContent = STATIC_HOST_HINT ? '后端未部署：静态托管只放页面' : '无法连接后端，请检查 API 地址';
    els.footMode.textContent = STATIC_HOST_HINT ? '后端未部署（见 docs/deploy.md）' : '后端未连接';
  }
}

if (location.hash === '#ai') switchTab('ai');
loadItems();
loadMeta();
