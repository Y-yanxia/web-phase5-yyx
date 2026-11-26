// ============================================================
// 一句话清单 · 前端主逻辑（原生 JS，无框架）
// 分工：状态 -> 渲染 -> 事件，三层不互相调用，方便一段段讲清楚。
// ============================================================
//
// 这个文件是什么：整个前端的唯一入口，index.html 末尾用 <script type="module"> 引入。
//   是 module 就默认 defer，所以执行到这里时 DOM 一定已经就绪，不用再等 DOMContentLoaded。
// 它负责两件事：
//   1) 调 /api/items 系列接口，把清单画成 <li>（增删改查都在这一页完成）；
//   2) 调 /api/chat 的 SSE 流，把模型的文字和工具调用一段段贴进聊天气泡。
// 和谁配合：config.js 先放好 window.__API_BASE__，这里拼成 API_BASE 再去 fetch；
//   index.html 提供下面 els 表里那些 id；class 名则交给 style.css。
// 读法建议：state（数据）→ renderList（怎么画）→ sendMessage（怎么收流）。

// API 地址三级兜底：?api= 临时覆盖 > config.js 里的 window.__API_BASE__ > 同源。
//   这样「本地由后端托管静态页」和「前端 Pages + 后端 Render」共用同一份代码。
// 末尾 replace 去掉多余的斜杠，避免拼出 //api/items 这种路径（有的代理会 404）。
const params = new URLSearchParams(location.search);
const API_BASE = (
  params.get('api') ||
  window.__API_BASE__ ||
  (location.protocol === 'file:' ? 'http://localhost:3000' : location.origin)
).replace(/\/+$/, '');

// 全局状态：界面永远是它的渲染结果，不要在别处偷偷改 DOM。
// 约定：接口回来了先更新 state，再调 renderList() / renderStats()。
// 字段逐个说明（下面每行一个）：
const state = {
  // 当前要显示的条目。注意它已经带上了筛选和搜索条件，不是「全部数据」
  items: [],
  // 统计数字（全部/已完成/未完成）来自独立接口，故意不受筛选影响：筛到「已完成」也能看到还剩几件
  stats: { total: 0, done: 0, pending: 0 },
  // 当前筛选：'all' | 'pending' | 'done'，和工具条上 .chip.is-active 的那个按钮一一对应
  filter: 'all',
  // 搜索关键词（已 trim），输入后防抖 280ms 才更新
  query: '',
  // 首屏/重载中：为 true 时画骨架屏，请求结束后一律回到 false
  loading: true,
  // 加载失败的文案；非空时优先画错误态（GitHub Pages 上会被换成部署提示）
  error: null,
  // 后端报告的 AI 模式：'live' 真模型 / 'mock' 离线演示；null 表示还没问出来
  aiMode: null,
  // 后端连不上：为 true 时锁住聊天输入框，免得用户点了才看到报错
  offline: false,
  // 会话 id：存在 localStorage 里，刷新页面后模型还能记得前面聊过什么
  sessionId: getSessionId(),
  // 是否正在流式接收回答：用来挡重复发送，也决定「停止生成」按钮的显隐
  streaming: false,
  // 本次请求的 AbortController：点停止时 abort()，catch 里靠 AbortError 区分「主动停」和真出错
  controller: null,
};

// 一次性把要操作的节点抓出来：后面只用 els.xxx，DOM 改了 id 这里会立刻报错，好排查。
// 这张表就是 index.html 里 id 的清单，两边要一起改。
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

// 会话 id 由前端自己生成并长期保存：后端只拿它当 key，不需要登录体系。
// crypto.randomUUID 在非 https 的局域网地址上可能没有，所以留了 Math.random 的降级。
function getSessionId() {
  let sid = localStorage.getItem('onelist.sid');
  if (!sid) {
    sid = `s-${(crypto.randomUUID?.() || Math.random().toString(36)).slice(0, 12)}`;
    localStorage.setItem('onelist.sid', sid);
  }
  return sid;
}

// 拼 HTML 前必须转义：itemHtml 用的是模板字符串，而标题是用户输入，
// 不转义就等于允许别人往列表里塞 <img onerror=...>（XSS）。
// 外面的 String(str) 是兜住 null / undefined，避免拼出 "null" 或直接报错。
const escapeHtml = (str) =>
  String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// 手工拼本地日期，而不是 toISOString().slice(0, 10)：
// toISOString 是 UTC，东八区早上 8 点前会算成「昨天」，逾期判断就会错一天。
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// 把截止日期翻译成「今天到期 / 已逾期 / 截止 x」，并给出对应的状态类名。
// 日期是 YYYY-MM-DD，直接按字符串比较就是按时间比较（字典序 = 时间序），省掉 Date 解析。
function dueLabel(due, done) {
  if (!due) return null;
  // 已完成的事项不再提示「逾期」——那只会制造噪音
  if (done) return { text: `截止 ${due}`, cls: '' };
  const today = todayISO();
  if (due === today) return { text: '今天到期', cls: 'is-today' };
  if (due < today) return { text: `已逾期 ${due}`, cls: 'is-overdue' };
  return { text: `截止 ${due}`, cls: '' };
}

// 自定义错误类型：上层 catch 一次，就能同时处理「网络不通」「HTTP 失败」「业务码非 0」；
// status 记下 HTTP 状态（网络层失败记 0），以后要细分时用得上；message 本身就能直接展示给人看。
class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

// GitHub Pages 只有静态文件，后端没部署时给它一句能照做的提示，而不是干巴巴的「连不上」
// 只有静态托管时才有值，其他地方是 null —— 所以判断「是不是静态托管」用 if (STATIC_HOST_HINT) 就够。
const STATIC_HOST_HINT = location.hostname.endsWith('github.io')
  ? '线上后端还没部署：GitHub Pages 只能放静态页。本地 npm start 可完整运行，部署步骤见 docs/deploy.md'
  : null;

// 所有接口的唯一出口：拼地址、统一判错、统一把 body.data 拆出来。
// 为什么抛 ApiError 而不是返回 { ok: false }：
//   1) 调用方用 try/catch 天然分出「成功」和「失败」两条路，不用每个调用点都写 if；
//   2) 后端给的中文 msg 直接进 Error，catch 里 alert / 显示出来就是人话；
//   3) 自定义类方便以后按 err.name / err.status 细分（现在只用 message）。
// headers 统一写死 JSON：写接口都收 JSON，省得每个调用点重复写；
//   ...options 放在后面，个别调用要覆写 method / body 时能盖掉默认值。
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
  // 可能解析不出东西：后端 500 时返回的也许是 HTML 错误页而不是 JSON，
  // 所以 .json() 要 catch 成 null，交给下面的判断统一报「请求失败」。
  const body = await res.json().catch(() => null);
  // 三个条件缺一不可：HTTP 状态 ok、body 真的解析出来了、业务码是 0。
  // 为什么不能只看 res.ok：后端约定「出错也回 HTTP 200，靠 code 区分」，
  // 只看状态码会把失败当成功，最后返回一个 undefined 给上层。
  if (!res.ok || !body || body.code !== 0) {
    throw new ApiError(body?.msg || `请求失败（HTTP ${res.status}）`, res.status);
  }
  return body.data;
}

/* ----------------------------- 清单渲染 ----------------------------- */

// 统计条和 Tab 角标一起刷：数字用 textContent 写，不走 innerHTML（更快，也不会误解析标签）。
// 注意 Tab 角标显示的是「未完成」数而不是全部 —— 角标是提醒你还有几件事没做。
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

// 一条任务 → 一段 HTML 字符串。为什么拼字符串而不是 createElement：
// 一批几十条时一次 innerHTML 写进去更快，代码也短；代价是每个用户字段都必须 escapeHtml。
// li 上的 data-id 是给事件委托定位用的；按钮上的 data-action 决定点下去是「勾选」还是「删除」；
// 勾选框是 button + role="checkbox" + aria-checked，因为要完全自定义外观（见 style.css 的 .check）。
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

// 画「空 / 错误」这类状态块。参数：title 标题、desc 说明、
// actionText 按钮文案（不传就不显示按钮）、onAction 按钮回调、kind 样式后缀。
// 按钮监听用 { once: true }：只点一次，避免手快连点发两次请求。
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

// 只在「静态托管且请求失败」时被 renderList 调用，替代普通的错误态。
// GitHub Pages 上没有后端时，别只丢一句错误，直接给「怎么把它跑起来」
function showStaticHostState() {
  els.listState.hidden = false;
  els.listState.className = 'state state-info';
  els.listState.innerHTML = `
    <h3>线上后端还没部署</h3>
    <p>GitHub Pages 只能托管静态文件，清单接口和 AI 需要一个 Node 服务。三步在本地跑起来：</p>
    <ol class="steps">
      <li><code>git clone https://github.com/Y-yanxia/web-phase5-yyx.git</code></li>
      <li><code>npm install</code> 然后 <code>npm start</code></li>
      <li>浏览器打开 <code>http://localhost:3000</code></li>
    </ol>
    <p class="state-links">
      <a class="btn btn-primary btn-sm" href="https://github.com/Y-yanxia/web-phase5-yyx" target="_blank" rel="noopener">看源码</a>
      <a class="btn btn-ghost btn-sm" href="https://github.com/Y-yanxia/web-phase5-yyx/blob/main/docs/deploy.md" target="_blank" rel="noopener">部署步骤</a>
    </p>`;
}

// 渲染清单。四种状态按优先级判断，顺序不能换：
//   1) loading —— 正在请求，先画骨架屏，哪怕上次有数据也别露旧的（会被误当成新结果）；
//   2) error   —— 请求失败，画错误 + 重试；
//   3) 空列表  —— 请求成功但 0 条，还要再分「筛没了」和「本来就没有」；
//   4) 正常    —— 有数据，整块重画。
// 注意 error 必须排在空列表前面：失败时 items 已被清空，先判空会显示「清单还是空的」，
// 用户会以为数据丢了，而不是以为网络坏了。
function renderList() {
  els.list.innerHTML = '';

  // 一、loading：先画骨架屏，绝不显示上一轮的旧数据。
  if (state.loading) {
    els.listState.hidden = true;
    els.list.innerHTML = '<li class="skeleton"><ul class="skeleton"><li></li><li></li><li></li></ul></li>';
    // 骨架屏放在 state 容器里更好控制高度，这里用简单的三行占位
    // 注意：上面写进 list 的骨架马上会被清掉，真正显示的是下面 listState 里的这份。
    // 为什么放 listState：list 是 ul，里层再塞一个 <ul> 会让读屏多读出一层不存在的嵌套列表。
    els.list.innerHTML = '';
    els.listState.hidden = false;
    els.listState.className = 'state';
    els.listState.innerHTML = '<ul class="skeleton"><li></li><li></li><li></li></ul>';
    return;
  }

  // 二、error：请求失败。必须排在「空列表」前面 —— 否则用户看到的是「清单还是空的」，
  // 会以为数据全丢了，而实际上是网络问题。
  if (state.error) {
    // GitHub Pages 上没有后端，给「重试」按钮只会再失败一次，不如直接给部署步骤。
    if (STATIC_HOST_HINT) {
      showStaticHostState();
      return;
    }
    showState({
      title: '加载失败了',
      desc: state.error,
      actionText: '重试',
      onAction: () => {
        loadItems();
        loadMeta(); // 顺便把 AI 面板的连接状态也刷一次
      },
      kind: 'error',
    });
    return;
  }

  // 三、空列表：请求成功，但一条都没有。
  if (state.items.length === 0) {
    els.listState.hidden = false;
    els.listState.className = 'state';
    // 同样是空，原因不同，用户该做的事也不同：
    // 筛选/搜索导致的空 → 提示换条件；真的一条都没有 → 引导去添加，或者去找 AI。
    const isFiltering = state.filter !== 'all' || state.query;
    els.listState.innerHTML = isFiltering
      ? `<h3>没有匹配的任务</h3><p>换个筛选条件，或者清空搜索词试试。</p>`
      : `<h3>清单还是空的</h3><p>在上面输入框加一条，或去「AI 助手」说一句「帮我加一条明天交实验报告」。</p>`;
    return;
  }

  // 四、正常渲染：一次 innerHTML 拼完，比逐条 append 快，也不用单独清理旧节点。
  els.listState.hidden = true;
  els.list.innerHTML = state.items.map(itemHtml).join('');
}

// 拉清单：带着当前筛选和搜索条件请求后端，再整块重渲染。
// 增删改之后都重新拉，而不是在本地数组上改：后端才是唯一真相（id、创建时间都由它生成）。
async function loadItems() {
  state.loading = true;
  state.error = null;
  renderList();

  // 把筛选和搜索翻译成后端认识的查询参数（done=0/1、q=关键词）。
  // 筛选和搜索是真的打到后端，不是前端过滤：数据量大了也不用一次全拉回来。
  const query = new URLSearchParams();
  if (state.filter === 'pending') query.set('done', '0');
  if (state.filter === 'done') query.set('done', '1');
  if (state.query) query.set('q', state.query);
  const qs = query.toString();

  // 让 loading 态至少停留 250ms，否则本地瞬间返回，截图和肉眼都看不见
  const started = Date.now();
  try {
    // 列表和统计是两个接口，并发发出去，省掉一个来回的时间。
    const [data, stats] = await Promise.all([
      api(`/api/items${qs ? `?${qs}` : ''}`),
      api('/api/items/stats'),
    ]);
    state.items = data.items;
    state.stats = stats;
  } catch (err) {
    // 失败时把 items 清空：留着旧数据会让人以为「加载成功了但内容变了」。
    state.error = STATIC_HOST_HINT || err.message;
    state.items = [];
  } finally {
    // finally 里才关 loading：成功、失败都要退出骨架屏，否则会永远卡在加载态。
    const wait = Math.max(0, 250 - (Date.now() - started));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    state.loading = false;
    renderList();
    renderStats();
  }
}

/* ----------------------------- 清单交互 ----------------------------- */

// 新增表单：前端先做一次空值校验（快，不浪费请求），后端再做最终校验（安全）。
// preventDefault 是必须的：不拦的话浏览器会整页提交刷新，前端状态全丢。
els.form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const title = els.title.value.trim();
  els.formError.hidden = true;

  // 空标题在本地就拦掉，不用往服务器跑一趟；顺手把焦点送回输入框，好接着敲。
  if (!title) {
    els.formError.textContent = '任务内容不能为空';
    els.formError.hidden = false;
    els.title.focus();
    return;
  }

  // 请求期间禁用按钮并改文案：防手快连点重复创建，也让人知道「点了，正在办」。
  els.addBtn.disabled = true;
  els.addBtn.textContent = '添加中…';
  try {
    const payload = { title };
    // 只有填了日期才带 due 字段；空字符串传过去反而可能被当成非法日期。
    if (els.due.value) payload.due = els.due.value;
    await api('/api/items', { method: 'POST', body: JSON.stringify(payload) });
    els.form.reset();
    els.title.focus();
    // 重新拉列表而不是本地 push：id 和创建时间都是后端生成的，本地造不出来。
    await loadItems();
  } catch (err) {
    els.formError.textContent = err.message;
    els.formError.hidden = false;
  } finally {
    els.addBtn.disabled = false;
    els.addBtn.textContent = '添加';
  }
});

// 列表点击 —— 事件委托。为什么绑在 ul 上而不是每个按钮：
//   ul 的内容每次渲染都整块 innerHTML 重建，绑在 li / 按钮上的监听会跟着一起消失，
//   得重新绑一遍；绑在 ul 上，点击冒泡上来，一条监听就管住所有条目（含以后新渲染的）。
els.list.addEventListener('click', async (e) => {
  // closest 从点击目标往上找：点到里面的 svg / path 也能命中按钮；找不到就说明点的不是这些按钮，直接忽略。
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  // 从 li[data-id] 上取 id：比解析 DOM 文案可靠，也不怕标题里有数字。
  const li = btn.closest('li[data-id]');
  if (!li) return;
  const id = li.dataset.id;

  // 删除：不可撤销，所以先 confirm，并且把标题带上——只问「确定吗？」用户根本不知道删的是哪条。
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

  // 勾选：旧值从 aria-checked 读，保证「界面显示什么就按什么算」，不用另外维护一份状态。
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

// 筛选按钮：切 .is-active 只是视觉，真正生效的是 state.filter —— 改完立刻重新请求。
// data-filter 的取值必须和 state.filter 的三种取值对齐，否则请求参数会漏掉。
document.querySelectorAll('.chip').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach((c) => c.classList.remove('is-active'));
    chip.classList.add('is-active');
    state.filter = chip.dataset.filter;
    loadItems();
  });
});

// 搜索防抖 280ms：每敲一个字就发请求会把接口打满，结果也会一直闪；
// 停下来再查，体感反而更快。定时器存在外层，连续输入才能清掉上一次。
let searchTimer;
els.search.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = els.search.value.trim();
    loadItems();
  }, 280);
});

/* ----------------------------- Tab 切换 ----------------------------- */

// 切面板：显示/隐藏两个 section，同步 Tab 的选中态和 aria-selected。
// 为什么用 hidden 属性而不是内联 display:none：语义清楚，样式统一交给 CSS 的 [hidden]；
// 为什么用 replaceState 而不是 pushState：切 Tab 不算一次历史记录，
// 否则用户按后退键只会在两个 Tab 之间来回跳，而不是退出页面。
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

// 两个 Tab 各绑一次点击；显隐全交给 switchTab，这里只转发 data-tab。
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => switchTab(tab.dataset.tab));
});

/* ----------------------------- AI 对话 ----------------------------- */

// 判断用户是不是「本来就贴着底部」。为什么要判断：
// 用户正往上翻历史时，新来一段文字就把页面拉到底，会抢走他的阅读位置。
function nearBottom(el) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

// 滚到底。force = true 用在「自己发消息」「工具卡片出现」这种必须看到的时刻；
// 其余情况只在用户原本贴着底部时才滚。80px 容差是为了不跟 1~2px 的抖动较劲。
function scrollMessages(force = false) {
  const el = els.messages;
  if (force || nearBottom(el)) el.scrollTop = el.scrollHeight;
}

// 往对话区追加一个气泡，返回 { wrap, body }，方便后面增量改文字。
// 用 textContent 而不是 innerHTML：模型输出是不可信内容，textContent 天然免疫 HTML 注入。
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

// 画一张「工具调用」卡片：先显示函数名 + 参数 + 执行中，结果回来再回填（见 setToolResult）。
// malformed 表示参数连 JSON 都没解析出来，直接用红边卡片标出来，别让它看起来像成功。
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

// 把卡片里的「执行中…」换成结果。只有 ok 明确为 false 才算失败：
// 后端少给个字段就满屏红字，比漏报更烦人。
function setToolResult(card, result) {
  const el = card.querySelector('.tool-result');
  if (!el) return;
  const ok = result?.ok !== false;
  el.style.color = ok ? 'var(--ok)' : 'var(--danger)';
  el.textContent = ok
    ? `→ ${result?.summary || '执行成功'}`
    : `→ 失败：${result?.error || '未知错误'}`;
}

// 调试面板记一条调用。prepend 是为了最新的在最上面，不用滚到底就能看到。
// 返回这个 li，等 tool_result 回来时原地更新，而不是再插一条。
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
// 具体做法：只改状态图标，再在末尾追加一行结果，条目个数始终不变。
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

// 对话错误显示在输入区上方，和气泡分开：历史消息不会被错误文案污染。
function showChatError(msg) {
  els.chatError.textContent = msg;
  els.chatError.hidden = false;
}

// 隐藏错误提示（每次发送前调用）。
function clearChatError() {
  els.chatError.hidden = true;
}

// 把 SSE 字节流拆成一条条 JSON 事件
// 为什么按「空行」切：SSE 规定事件之间用一个空行分隔，后端每发一条就写 data: {...} 再补两个换行，
//   所以空行是唯一可靠的事件边界（不能按行拆：一个事件可以占多行）。
// 为什么要 buffer：网络分片不按事件切 —— 一次 read() 可能只给半个事件，也可能是 1.5 个。
//   攒在 buffer 里，只处理「已经完整到达」的部分，剩下的留给下一轮，半截 JSON 才不会去送 parse。
// 为什么要 try/catch：心跳 / 注释行不是 JSON，解析失败跳过即可，不能让一行坏数据打断整条流。
// TextDecoder 的 { stream: true } 同理：一个汉字的 UTF-8 字节可能被切在两个分片里，
//   流式解码会把它攒到下一片再输出，否则中文会变成乱码。
async function readSse(res, onEvent) {
  // 流式读取：reader 按网络分片给数据，不保证和事件边界对齐。
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    // 只要 buffer 里还有完整事件（能找到空行），就一条条处理掉。
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      // 一个事件可能有多行 data:，逐行扫，只认 data: 开头；空 payload 直接跳过。
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

// 发一句话给 AI，并把流式回答画进气泡。这是前端最复杂的一段，按顺序看：
//   1) 挡掉重复发送、挡掉后端不可用；
//   2) 用户消息立刻上屏，再挂一个空助手气泡等文字流进来；
//   3) fetch + SSE，逐条处理 delta / tool_call / tool_result / error / aborted；
//   4) finally 收尾：解锁按钮、删掉空气泡、重新拉清单（AI 可能改了数据）。
async function sendMessage(text) {
  // 正在生成时再点发送会得到两路流，互相覆盖气泡；离线时发出去必然失败，
  // 所以直接 return，连 fetch 都不发。
  if (state.streaming || state.offline) return;
  const message = text.trim();
  if (!message) return;

  // 每次发送先清掉上一条错误提示，否则旧错误会一直挂在输入框下面。
  clearChatError();
  addMessage('user', message);
  els.chatInput.value = '';
  autoGrow();

  // 当前正在追加文字的气泡。模型「先说一句 → 调工具 → 再说结果」时，
  // 工具卡片插在中间，后面的文字要落到新气泡里，阅读顺序才对。
  let assistant = addMessage('assistant', '');
  assistant.wrap.classList.add('is-typing');

  // 先切到「生成中」：按钮和输入框的可用状态全由这几个标志决定，
  // 好处是收尾时不会漏掉哪个控件没复位（统一在 finally 里改）。
  state.streaming = true;
  state.controller = new AbortController();
  els.sendBtn.disabled = true;
  els.stopBtn.hidden = false;
  els.chatInput.disabled = true;

  // 用 id 做 key：tool_call 和 tool_result 是两条独立事件，只能靠 id 配对，
  // 才能找回「刚才为这个调用画的那张卡」。
  const toolCards = new Map();
  let gotError = false;

  try {
    // 这里不用 api()：要读 res.body 的流、要能 abort、还要看 content-type。
    // signal 传进去之后，abort() 会让这个 fetch 以 AbortError 结束。
    const res = await fetch(`${API_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: state.sessionId, message }),
      signal: state.controller.signal,
    });

    // 不是 event-stream 就说明后端在报错（返回的是 JSON），
    // 这时按普通接口解析出 msg，比干等一个永远不来的流要好。
    if (!res.ok || !res.headers.get('content-type')?.includes('text/event-stream')) {
      const body = await res.json().catch(() => null);
      throw new ApiError(body?.msg || `请求失败（HTTP ${res.status}）`, res.status);
    }

    // 事件回调：delta 追加文字，tool_call / tool_result 画卡片，error / aborted 收尾。
    // 之所以用回调而不是逐条 await，是因为读流本身是持续进行的，回调更直观。
    await readSse(res, (evt) => {
      switch (evt.type) {
        // 增量文字：直接追加到当前气泡，不要每来一段就重建 DOM（会闪，也会丢滚动位置）。
        case 'delta':
          assistant.body.textContent += evt.text;
          scrollMessages();
          break;
        // 模型要调工具了：画一张卡片 + 记一条调试，先存进 Map 等结果回来。
        case 'tool_call': {
          const card = addToolCard(evt.name, evt.args, evt.malformed);
          const debugLi = pushDebug({ name: evt.name, args: evt.args });
          toolCards.set(evt.id, { card, debugLi });
          // 说完再干：
          // 为什么必须拆气泡：工具卡片是独立元素、插在当前气泡后面，
          // 若继续往旧气泡追加文字，文字就会跑到卡片下面，读起来像「先看到工具、再说结论」。
          if (assistant.body.textContent.trim()) {
            assistant.wrap.classList.remove('is-typing');
            assistant = addMessage('assistant', '');
            assistant.wrap.classList.add('is-typing');
          }
          scrollMessages(true);
          break;
        }
        // 结果回来了：按 id 找到那张卡，原地把「执行中…」换成结果，
        // 同时把调试面板里对应那条从 ⏳ 改成 ✅ / ❌。
        case 'tool_result': {
          const found = toolCards.get(evt.id);
          if (found) {
            setToolResult(found.card, evt.result);
            resolveDebug(found.debugLi, evt.result);
          }
          scrollMessages(true);
          break;
        }
        // 业务错误（模型调工具失败、DeepSeek 报错）：当前气泡变红，底部再给一条提示。
        case 'error':
          gotError = true;
          assistant.wrap.classList.add('msg-error');
          assistant.body.textContent = evt.msg || '出错了';
          showChatError(evt.msg || '出错了');
          break;
        // 后端收到 abort 后回的事件；和下面 catch 里的 AbortError 是两条路径，都要给提示。
        case 'aborted':
          assistant.body.textContent += '\n\n（已停止生成）';
          break;
        default:
          break;
      }
    });
  } catch (err) {
    // AbortError 是「用户点了停止」，不是故障：补一句说明就行，不要标红。
    if (err.name === 'AbortError') {
      assistant.body.textContent += '\n\n（已停止生成）';
    } else {
      gotError = true;
      assistant.wrap.classList.add('msg-error');
      assistant.body.textContent = err.message || '网络异常';
      showChatError(err.message || '网络异常');
    }
  } finally {
    // finally 一定会执行：成功、出错、手动停止都从这里收尾，
    // 所以「解锁按钮」这类必须做的事不要写在 try 里。
    assistant.wrap.classList.remove('is-typing');
    // 只调了工具、没留一句话的空白气泡，直接删掉，别让界面出现空气泡
    // 但 gotError 例外：错误气泡本身就是提示，删了用户只剩底部一行小字。
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

// 点发送按钮和按回车最终都走 submit，所以真正发消息的逻辑只有 sendMessage 一份。
els.chatForm.addEventListener('submit', (e) => {
  e.preventDefault();
  sendMessage(els.chatInput.value);
});

// 停止生成：abort 会让 fetch 抛 AbortError，由 sendMessage 的 catch 负责提示。
// 当前没有请求时 controller 是 null，?. 保证不会报错。
els.stopBtn.addEventListener('click', () => {
  state.controller?.abort();
});

// Enter 发送、Shift+Enter 换行。isComposing 必须判断：
// 中文输入法选词时按 Enter 是「确认候选词」，不拦一下会把半句话发出去。
els.chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendMessage(els.chatInput.value);
  }
});

// 输入框随内容长高：先把 height 归 auto 再读 scrollHeight，否则它只会变高不会变矮
// （scrollHeight 会被上一次设的 height 撑住）。120 是上限，和 CSS 的 max-height 对齐。
function autoGrow() {
  els.chatInput.style.height = 'auto';
  els.chatInput.style.height = `${Math.min(els.chatInput.scrollHeight, 120)}px`;
}
els.chatInput.addEventListener('input', autoGrow);

// 清空会话：先请求后端删掉上下文，再清空两侧 DOM。
// 后端失败也无所谓（会话本来就可能不存在），界面照样清 —— 用户要的只是「重新开始」。
// 清完补一句提示，否则面板空着会让人以为坏了。
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

// 问后端「AI 现在什么模式」，顺带决定要不要锁住输入框。
// 调用时机有两个：启动时一次；清单加载失败后点「重试」时再来一次。
async function loadMeta() {
  try {
    const meta = await api('/api/chat/meta');
    // 三个地方一起显示同一个事实：Tab 上的圆点、聊天标题下的说明、页脚。
    state.aiMode = meta.mode;
    const live = meta.mode === 'live';
    els.aiModeText.textContent = live
      ? `已接入 ${meta.model} · 支持工具调用`
      : `离线演示模式（未配置 API Key，规则模拟）`;
    els.aiDot.className = `dot ${live ? 'is-live' : 'is-mock'}`;
    els.footMode.textContent = live ? `AI：${meta.model}` : 'AI：离线演示模式';
    // 后端恢复后把输入框解禁（用户点了「重试」时走这里）
    state.offline = false;
    els.chatInput.disabled = false;
    els.chatInput.placeholder = '说一句话，例如：帮我加一条明天交实验报告';
    els.sendBtn.disabled = false;
    els.sendBtn.title = '';
  } catch {
    // 连不上后端时直接锁住输入框：点了才报错体验很差
    // 按钮能点用户就会点，然后拿到一句冷冰冰的网络错误；不如一开始就禁掉，把原因写在标题下面。
    state.offline = true;
    els.aiDot.className = 'dot';
    els.aiModeText.textContent = STATIC_HOST_HINT ? '后端未部署：静态托管只放页面' : '无法连接后端，请检查 API 地址';
    els.footMode.textContent = STATIC_HOST_HINT ? '后端未部署（见 docs/deploy.md）' : '后端未连接';
    els.chatInput.disabled = true;
    els.chatInput.placeholder = '后端未连接，先按上面的步骤把服务跑起来';
    els.sendBtn.disabled = true;
    els.sendBtn.title = '后端未连接';
  }
}

// 启动：地址栏带 #ai（switchTab 写进去的）就先切到 AI 面板，刷新后还停在原处。
// 两个加载并行发起、互不 await：AI 状态查不到不该拖住清单的显示。
if (location.hash === '#ai') switchTab('ai');
loadItems();
loadMeta();
