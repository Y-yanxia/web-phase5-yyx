// 统一返回格式的出口。全项目只允许通过 ok()/fail() 回包，
// 这样前端永远只需要判断 code === 0。
export const ok = (res, data = null, msg = 'ok') => res.json({ code: 0, data, msg });

export const fail = (res, status, code, msg) =>
  res.status(status).json({ code, data: null, msg });

// 包一层 async 路由：Express 4 不会捕获 async 函数里的 rejection，
// 不包的话一次数据库报错就能把整个进程干掉（任务2「服务不能崩」的考点）。
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// 手写 CORS：比 cors 包少一个依赖，也更容易在答辩时讲清预检请求发生了什么。
export function corsMiddleware(allowedOrigins) {
  const allowAll = allowedOrigins.includes('*');
  return (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && (allowAll || allowedOrigins.includes(origin))) {
      res.setHeader('Access-Control-Allow-Origin', origin);
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
