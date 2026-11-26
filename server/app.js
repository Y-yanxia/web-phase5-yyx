/**
 * Express 应用装配：把中间件、路由、静态页、错误处理按固定顺序串成一条流水线。
 * 链路位置：index.js 调 createApp() 拿实例；测试也直接调它，不占固定端口。
 * 对外导出：createApp（具名导出 + default），返回配置好的 express 实例。
 * 坑：中间件顺序就是执行顺序——CORS 必须在路由前，404 必须在路由后，错误处理永远最后。
 */
// express 应用装配：中间件顺序就是「请求处理流水线」，改顺序前先想清楚影响。
import path from 'node:path';
import express from 'express';
import { ROOT, config } from './config.js';
import { corsMiddleware, ok } from './lib/http.js';
import { AppError } from './lib/errors.js';
import { itemsRouter } from './routes/items.js';
import { chatRouter } from './routes/chat.js';
import { getStats } from './db.js';

// 创建并返回 express 实例；每调一次都是独立 app，测试之间互不干扰
export function createApp() {
  const app = express();
  // 关掉 x-powered-by：别把「这是 Express」写在响应头里
  app.disable('x-powered-by');

  // 1. 跨域：必须在业务路由之前，OPTIONS 预检才能被接住
  app.use(corsMiddleware(config.allowedOrigins));

  // 2. 解析 JSON。限额调小，顺手挡住超大请求体
  // 只管 JSON；表单/纯文本进来时 req.body 是 undefined，路由里已兜底
  app.use(express.json({ limit: '32kb' }));

  // 3. 一行式访问日志：答辩演示时能直接看到前端到底发了什么请求
  app.use((req, res, next) => {
    const start = Date.now();
    // 监听 finish 而不是 close：finish 才是「响应写完了」，close 断连时也会触发
    res.on('finish', () => {
      console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
  });

  // 4. 健康检查：Render 用它判断实例是否活着
  // 顺手读一次统计，健康检查就顺带验证了数据库连接没掉
  app.get('/api/health', (_req, res) =>
    ok(res, { status: 'up', mode: config.aiMode, uptime: Math.round(process.uptime()), stats: getStats() })
  );

  // 5. 业务路由
  // 前缀只在这里挂一次，路由文件内部只写相对路径，换前缀不用翻遍每个文件
  app.use('/api/items', itemsRouter);
  app.use('/api/chat', chatRouter);

  // 6. 静态页面：前端和后端同源部署时，连 CORS 都不需要
  // extensions 让 /404 也命中 404.html；maxAge 给浏览器省点带宽
  app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'], maxAge: '1h' }));

  // 7. 接口 404 也要是 JSON，不能掉进 HTML 错误页
  // 放在静态之后：先让真实文件有机会命中，剩下的 /api/* 才落到这里
  app.use('/api', (req, res) => {
    res.status(404).json({ code: 40400, data: null, msg: `接口不存在：${req.method} ${req.originalUrl}` });
  });

  // 8. 其余路径是「真 404」：404.html + 404 状态码。
  //    「软 404」（返回首页却给 200）会被验收脚本和搜索引擎一起判错。
  app.use((req, res) => {
    // 非 GET 的兜底也用 JSON：前端拿到的永远是能直接 parse 的响应
    if (req.method !== 'GET') {
      return res.status(404).json({ code: 40400, data: null, msg: '资源不存在' });
    }
    res.status(404).sendFile(path.join(ROOT, 'public', '404.html'));
  });

  // 9. 全局错误处理：所有异常最后都变成 { code, data, msg }
  // 四个参数是 Express 认出错误中间件的规则，少一个都不会进来
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    // SSE 已经 flushHeaders 就改不了状态码了，只能把连接收掉
    if (res.headersSent) return res.end();

    if (err instanceof AppError) {
      // 业务错误：status/code/message 都是我们自己给的，原样回包
      return res.status(err.status).json({ code: err.code, data: null, msg: err.message });
    }
    // express.json 的解析错误（body 不是合法 JSON）
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ code: 40010, data: null, msg: '请求体不是合法 JSON' });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ code: 41300, data: null, msg: '请求体太大' });
    }

    // 未知错误只在这里留堆栈，返回给前端的一律是笼统文案
    console.error('[error]', err);
    return res.status(500).json({ code: 50000, data: null, msg: '服务器内部错误' });
  });

  return app;
}

// 默认导出同一个函数，方便 `import createApp from './app.js'`
export default createApp;
