# 抓包记录（F12 → Network）

> 任务书要求：记录 3 条请求 —— 页面主文档、一个 CSS 或 JS、一次自己写的 fetch；
> 并故意请求一个不存在的地址，确认 404 的形态。要求写清各自的方法、状态码、耗时。

## 1. 抓包环境

- 时间：2026-11-20 17:37
- 页面：`http://127.0.0.1:3100/`（本地 Express 托管静态页，与后端同源）
- 浏览器：Edge 157，DevTools → Network，勾选 Disable cache
- 操作：刷新页面 → 等列表加载完 → 地址栏输错路径

## 2. 三条请求

| # | 请求 | 方法 | 状态码 | 耗时 | 说明 |
|---|---|---|---|---|---|
| 1 | `/` | GET | 200 | 8 ms | 页面主文档（HTML 骨架），由 `express.static` 返回 |
| 2 | `/style.css` | GET | 200 | 3 ms | 渲染阻塞资源，`maxAge=1h`，二次访问走缓存 |
| 3 | `/api/items?` | GET | 200 | 6 ms | 自己写的 `fetch`：页面加载后拉列表 |
| 4 | `/api/items/stats` | GET | 200 | 2 ms | 与列表并行发出的第二个 fetch（`Promise.all`） |
| 5 | `/not-exist` | GET | **404** | 4 ms | 故意制造的坏地址 |

> 第 3 条是本项目「自己写的 fetch」，代码在 `public/app.js` 的 `loadItems()`：
> `fetch(\`${API_BASE}/api/items\`)` → 判断 `res.ok` → `res.json()` → 判断 `body.code === 0` → 渲染。

## 3. 请求/响应长什么样

**第 1 条（主文档）**

```
GET / HTTP/1.1
Host: 127.0.0.1:3100
Accept: text/html,application/xhtml+xml

HTTP/1.1 200 OK
Content-Type: text/html; charset=UTF-8
Cache-Control: public, max-age=3600
```

**第 2 条（CSS）** 与主文档同源，`Content-Type: text/css; charset=UTF-8`。

**第 3 条（自己写的 fetch）**

```
GET /api/items? HTTP/1.1
Accept: */*
Content-Type: application/json

HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{"code":0,"data":{"items":[…],"total":6},"msg":"ok"}
```

**第 5 条（404）**

```
GET /not-exist HTTP/1.1

HTTP/1.1 404 Not Found
Content-Type: text/html; charset=UTF-8
```

返回的是 `public/404.html`，**状态码是 404 而不是 200**。
这一点是特意改过的：最初的实现把未知路径回落到 `index.html` 并返回 200，也就是「软 404」，
测试脚本和搜索引擎都会把它当成功页面。改动见 `server/app.js` 第 8 段中间件。

接口侧的 404 形状不同（JSON），这样调用方不用解析 HTML：

```
GET /api/not-exist

HTTP/1.1 404 Not Found
Content-Type: application/json; charset=utf-8

{"code":40400,"data":null,"msg":"接口不存在：GET /api/not-exist"}
```

## 4. 十分钟复现步骤

1. `npm start`，浏览器打开 <http://localhost:3000>
2. F12 → Network → 勾 **Disable cache** → `Ctrl+R`
3. 在过滤框输入 `api`，找到 `items` 和 `items/stats`，切到 Timing 看耗时
4. 地址栏改成 `http://localhost:3000/not-exist`，回车，看 Network 里那条红色 404，点开 Response 看 404.html
5. 再访问 `http://localhost:3000/api/not-exist`，对比 JSON 形态

## 5. 为什么耗时差这么多

`/api/items` 第一次 6 ms、第二次 2 ms，差别来自 SQLite 首次查询要打开页缓存；
`/` 首次 8 ms，之后走 `Cache-Control` 缓存直接 0 ms（显示 `(disk cache)`）。
这些数字都是本地回环，线上要加上网络 RTT 和 Render 冷启动的 30–50 秒。
