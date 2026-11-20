// express 应用装配：中间件顺序就是「请求处理流水线」，改顺序前先想清楚影响。
import path from 'node:path';
import express from 'express';
import { ROOT, config } from './config.js';
import { corsMiddleware, ok } from './lib/http.js';
import { AppError } from './lib/errors.js';
import { itemsRouter } from './routes/items.js';
import { chatRouter } from './routes/chat.js';
import { getStats } from './db.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  // 1. 跨域：必须在业务路由之前，OPTIONS 预检才能被接住
  app.use(corsMiddleware(config.allowedOrigins));

  // 2. 解析 JSON。限额调小，顺手挡住超大请求体
  app.use(express.json({ limit: '32kb' }));

  // 3. 一行式访问日志：答辩演示时能直接看到前端到底发了什么请求
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.originalUrl} -> ${res.statusCode} ${Date.now() - start}ms`);
    });
    next();
  });

  // 4. 健康检查：Render 用它判断实例是否活着
  app.get('/api/health', (_req, res) =>
    ok(res, { status: 'up', mode: config.aiMode, uptime: Math.round(process.uptime()), stats: getStats() })
  );

  // 5. 业务路由
  app.use('/api/items', itemsRouter);
  app.use('/api/chat', chatRouter);

  // 6. 静态页面：前端和后端同源部署时，连 CORS 都不需要
  app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'], maxAge: '1h' }));

  // 7. 接口 404 也要是 JSON，不能掉进 HTML 错误页
  app.use('/api', (req, res) => {
    res.status(404).json({ code: 40400, data: null, msg: `接口不存在：${req.method} ${req.originalUrl}` });
  });

  // 8. 其余路径是「真 404」：404.html + 404 状态码。
  //    「软 404」（返回首页却给 200）会被验收脚本和搜索引擎一起判错。
  app.use((req, res) => {
    if (req.method !== 'GET') {
      return res.status(404).json({ code: 40400, data: null, msg: '资源不存在' });
    }
    res.status(404).sendFile(path.join(ROOT, 'public', '404.html'));
  });

  // 9. 全局错误处理：所有异常最后都变成 { code, data, msg }
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, _next) => {
    if (res.headersSent) return res.end();

    if (err instanceof AppError) {
      return res.status(err.status).json({ code: err.code, data: null, msg: err.message });
    }
    // express.json 的解析错误（body 不是合法 JSON）
    if (err?.type === 'entity.parse.failed') {
      return res.status(400).json({ code: 40010, data: null, msg: '请求体不是合法 JSON' });
    }
    if (err?.type === 'entity.too.large') {
      return res.status(413).json({ code: 41300, data: null, msg: '请求体太大' });
    }

    console.error('[error]', err);
    return res.status(500).json({ code: 50000, data: null, msg: '服务器内部错误' });
  });

  return app;
}

export default createApp;
