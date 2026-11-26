/**
 * HTTP 小工具：统一响应体、async 路由包装、手写 CORS，三件小事放一处。
 * 链路位置：app.js 挂 CORS 和错误处理，所有路由都靠 ok() / asyncHandler() 回包。
 * 对外导出：ok / fail / asyncHandler / corsMiddleware。
 * 坑：Express 4 不会接住 async 函数里的 rejection，
 * 漏包 asyncHandler 服务会直接挂掉。
 */
// 统一返回格式的出口。全项目只允许通过 ok()/fail() 回包，
// 这样前端永远只需要判断 code === 0。
// 成功：HTTP 200 + code 0，前端只判断 code，不用去猜文案
export const ok = (res, data = null, msg = 'ok') => res.json({ code: 0, data, msg });

// 失败：HTTP 状态和业务 code 分开传，前端既能按状态码也能按 code 分支
export const fail = (res, status, code, msg) =>
  res.status(status).json({ code, data: null, msg });

// 包一层 async 路由：Express 4 不会捕获 async 函数里的 rejection，
// 不包的话一次数据库报错就能把整个进程干掉（任务2「服务不能崩」的考点）。
// Express 5 才原生支持 async，这里锁的是 4.x，所以必须自己包
export const asyncHandler = (fn) => (req, res, next) => {
  // 只做一件事：把 Promise 的 rejection 转交给 next(err)，进入全局错误处理
  Promise.resolve(fn(req, res, next)).catch(next);
};

// 手写 CORS：比 cors 包少一个依赖，也更容易在答辩时讲清预检请求发生了什么。
// 回显具体 origin 而不是写 *：以后要带 Cookie 时不用推倒重来
export function corsMiddleware(allowedOrigins) {
  // 配了 * 就全放开，只建议本地临时调试用
  const allowAll = allowedOrigins.includes('*');
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (allowAll || allowedOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      // Vary 不能省：告诉缓存按来源分开存，否则 A 站的头可能被发给 B 站
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Accept');
      res.setHeader('Access-Control-Max-Age', '86400');
    }
    // 预检请求到此结束：204 + 上面那几个头，浏览器才会放行真正的请求
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  };
}
