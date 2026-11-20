# 第五阶段周记

> 按「今天做了什么 / 卡在哪 / 怎么解决 / 明天做什么」四段式记录，周末整理成文。
> 任务书要求把「抓包 3 条请求」和「CORS 报错原文」写进周记，分别在 D1、D3。

---

## D1 · 静态页面 + 第一次抓包

**今天做了什么**

- 定选题：待办清单。理由：它天然能串起后面五个任务（列表 → 接口 → 联调 → 对话 → 工具调用），
  不像个人主页那样到任务 4 之后没有数据可操作。
- 写 `index.html`：`header / nav / main / section / footer` 五个语义标签，
  两个 Tab（清单、AI 助手）用 `role="tablist"`。
- 写 `style.css`：全局 `box-sizing: border-box`，断点 640px。
- Tab 切换、表单校验（空标题不让提交）用原生 JS。
- 用 `data:` 内联 favicon，避免浏览器自动请求 `/favicon.ico` 在 Console 留一条红字。

**卡在哪**

- 375px 出现横向滚动条。`document.documentElement.scrollWidth` 是 402，比 375 多 27px。
- 找不到是谁撑宽的，DevTools 里逐个元素看 `outline` 也没头绪。

**怎么解决**

- 排查思路：先在控制台执行 `[...document.querySelectorAll('*')].filter(el => el.getBoundingClientRect().right > 375)`，
  一眼定位到 `input[type=date]` —— 它有一个浏览器给的最小宽度。
- 修：给 `.field-date` 加 `flex: 0 1 150px` + `min-width: 0`（flex 子项默认 `min-width: auto`，
  内容撑不下就会溢出，这是最容易忽略的一条）。
- 复测：`scrollWidth === 375`，截图存 `docs/evidence/05-mobile-list.png`。

**抓包（任务书要求写进周记）**

| # | 请求 | 方法 | 状态码 | 耗时 | 说明 |
|---|---|---|---|---|---|
| 1 | `/` | GET | 200 | 8 ms | 页面主文档 |
| 2 | `/style.css` | GET | 200 | 3 ms | 渲染阻塞资源 |
| 3 | `/api/items` | GET | 200 | 6 ms | 自己写的 fetch，拉列表 |

另外故意访问 `/not-exist`，返回 **404**（`public/404.html`，不是 200 的软 404）。

**明天做什么**

接口：建表、GET/POST/DELETE，统一 `{code,data,msg}`，少传字段要 400。

---

## D2 · 三个接口 + 数据落盘

**今天做了什么**

- `server/db.js`：用 Node 24 内置的 `node:sqlite` 建 `items` 表，开 WAL。
  没用 `better-sqlite3`，因为它在免费容器里要编译原生模块，容易装不上。
- `server/routes/items.js`：GET 列表 / POST 新增 / PUT 更新 / DELETE 删除，参数逐个校验。
- 统一返回 `{code, data, msg}`；全局错误处理兜底，永远回 JSON。
- `catchAsync` 包住 async 路由：Express 4 不会捕获 async 里的 rejection，
  不包的话一次数据库异常就能把进程带走。

**卡在哪**

- 不传截止日期，接口返回 400。查了半天以为是前端没传字段，实际是后端
  `parseDue` 漏了 `undefined` 分支（`undefined !== null`）。
- 这个 bug 是 `npm test` 抓出来的，不是我肉眼看出来的。

**怎么解决**

- `if (raw === undefined || raw === null || raw === '') return null;`
- 顺手补了 14 条测试：创建、缺字段、格式错、更新、删除、404、统计、SSE 全链路。
- 结果：`tests 14 / pass 14 / fail 0`。

**重启验证落盘**

```
POST /api/items {"title":"落盘测试"}  → id 12
Ctrl+C 重启
GET /api/items                        → 仍然能看到 id 12
```

**明天做什么**

前端接真接口，故意撞一次 CORS 并把报错原文存下来。

---

## D3 · 前后端联调 + CORS 事故

**今天做了什么**

- 前端把写死的数组删掉，改成 `fetch('/api/items')`，列表、统计都来自接口。
- 加三态：骨架屏（loading）、空清单（empty）、错误 + 重试（error）。
- 后端加 `?fail=1` 开发开关，用来单独让列表接口 500，截错误态。
- 前端加 `API_BASE` 配置（`public/config.js` + 地址栏 `?api=` 覆盖）。

**卡在哪（CORS 报错原文，任务书要求写进周记）**

前端单独跑在 5055，后端 3100：

```
Access to fetch at 'http://127.0.0.1:3100/api/items' from origin 'http://127.0.0.1:5055'
has been blocked by CORS policy: Response to preflight request doesn't pass access control check:
No 'Access-Control-Allow-Origin' header is present on the requested resource.
```

**怎么解决**

- 先用 `curl -i -X OPTIONS ... -H "Origin: http://127.0.0.1:5055"` 确认服务端确实没回 `Access-Control-Allow-Origin`。
- 原因：fetch 带了 `Content-Type: application/json`，触发预检；服务端白名单里没有 5055。
- 修：`ALLOWED_ORIGINS` 加上前端来源，服务端统一处理，不动浏览器设置。
- 修完 Console 干净，图片存 `11-cors-error.png` / `12-cors-fixed.png`。

**明天做什么**

接大模型：后端转发、SSE 流式、停止生成、上下文与错误提示。

---

## D4 · 流式对话

**今天做了什么**

- `/api/chat`：读 `.env` 里的 Key，转发到 DeepSeek，`stream: true`，原样 forward。
- 前端用 `getReader()` 逐块读，追加到气泡，带打字机光标。
- 「停止生成」：前端 AbortController；后端 `res.on('close')` 感知断开，abort 上游。
- 上下文：`Map<sessionId, messages>`，超长丢最早的，系统提示词固定在最前。
- 错误翻译：401 → Key 无效、402 → 余额不足、429 → 限流、超时 → 人话。

**卡在哪**

- 前端只收到 `meta` 和 `aborted`，一个字都没有。
- 用 curl 直接打接口是正常的，说明问题在「连接生命周期」的判断上。

**怎么解决**

- 定位：`req.on('close')` 在**请求体读完**时就触发，不是连接断开才触发。
- 修：改听 `res.on('close')`，并且只在 `!res.writableEnded` 时 abort。
- 复测：正常请求 `meta → delta… → done`；点停止 → `aborted`，上游真的断。

**明天做什么**

工具调用：`add_item` / `query_items` / `complete_item`，两轮循环 + 前端调试面板。

---

## D5 · 工具调用（全天只干这个）

**今天做了什么**

- `server/ai/tools.js`：三个工具的 JSON Schema，description 写到「什么时候必须调用」。
- `server/ai/agent.js`：两轮循环——模型返回 `tool_calls` → 真的执行 → `role: "tool"` 回填 →
  再请求一次拿自然语言总结；最多 3 轮，防死循环。
- 前端工具卡片 + 「工具调用记录」面板，显示函数名、参数、执行结果。
- 失败预算：坏 JSON 不抛异常，作为失败结果回填，让模型自己改。

**卡在哪**

- 「我还有哪些没做完」被识别成「标记完成」，返回「没找到包含『我还有哪些没』的条目」。
- 本质是意图判断的优先级写反了：`做完` 命中了完成分支。

**怎么解决**

- 先判查询再判完成；加否定词（没做完/未完成/还没 → 查询 + `done:0`）；
- 关键词提取去掉「把/帮我/查一下」这类指令词。
- 复测三句话：查询 → 4 条；搜索 → 2 条；完成 → 状态真的变了。
- 这个 case 直接写进事故记录，答辩第 3 问就用它。

**明天做什么**

整合：一个页面、一套接口、一个库、一个 AI，README 六项写全，录屏。

---

## D6 · 整合与交付

**今天做了什么**

- 清单页和 AI 页合成一个页面，两个 Tab，同一个 `index.html`。
- README 六项：简介、技术栈、本地运行（含环境变量示例）、功能截图、已知问题、目录结构。
- 证据包整理：11 张截图 + 5 条事故 + 抓包记录 + 接口文档 + 这份周记。
- 干净环境彩排：删 `node_modules` → 照 README 走 → 计时 6 分 40 秒跑起来。
- 2 分钟录屏练了 2 遍（脚本见 README 第 12 节）。

**卡在哪**

- 截图脚本要启动浏览器，在这台机器的受限环境里一直 `spawn EPERM`。
- 换思路：不用浏览器自动化，先用无头 Edge 验证能不能跑；确认是权限问题后，
  截图脚本单独用管理员权限跑一次，产物进 `docs/evidence/`，不参与 CI。

**怎么解决**

- `scripts/screenshots.mjs` 用 `puppeteer-core` + 本机 Edge，不下载 Chromium（省 150MB）。
- 一次跑完 10 张图，并且顺手断言了「Console 无报错」「375px scrollWidth === 375」。

**明天做什么**

答辩：过一遍三问，重点讲 CORS、`req.on('close')`、工具选错这三处。

---

## 本周复盘（三句话）

1. **接口层的可选字段最容易被忽略**：`undefined`、`null`、`''` 三者的区别，靠测试才能兜住。
2. **流式接口的坑都在「连接生命周期」上**：缓冲（`X-Accel-Buffering`）、预检（CORS）、
   断开感知（`res.on('close')`），三件事各踩一次。
3. **工具调用能不能成，取决于 description 写得够不够「像给人看的说明书」**，
   而不是模型有多聪明。
