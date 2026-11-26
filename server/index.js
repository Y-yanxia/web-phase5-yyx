/**
 * 进程入口：起 HTTP 服务、打印启动信息、处理退出信号。
 * 链路位置：config -> db -> app 装配完之后，由这里 listen 真正对外提供服务。
 * 对外导出：无，`node server/index.js` 直接执行即启动。
 * 坑：业务逻辑别写在这，否则测试 import 一下就会把服务真的跑起来。
 */
// 进程入口：只负责启停，不写业务逻辑（方便测试里直接 createApp()）。
import { createApp } from './app.js';
import { config } from './config.js';

// 每次执行都新建一个 app：配置和数据库连接是模块单例，这里只负责装配
const app = createApp();

// 端口来自 config：本地默认 3000，Render 这类平台会注入 PORT
const server = app.listen(config.port, () => {
  const url = `http://localhost:${config.port}`;
  console.log('');
  console.log('  ┌─────────────────────────────────────────────┐');
  console.log('  │  一句话清单 · OneList                        │');
  console.log('  └─────────────────────────────────────────────┘');
  console.log(`  页面      ${url}`);
  console.log(`  AI 模式   ${config.aiMode === 'live' ? `DeepSeek / ${config.deepseek.model}` : '离线演示（未配置 DEEPSEEK_API_KEY）'}`);
  console.log(`  数据库    ${config.dbFile}`);
  console.log(`  环境      ${config.nodeEnv}`);
  console.log('');
});

// 优雅退出：容器重启时先把连接放干净，避免 SQLite WAL 残留
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\n[server] 收到 ${sig}，正在关闭…`);
    server.close(() => process.exit(0));
    // 兜底 3 秒：还有 SSE 长连接没断时，close 回调可能永远等不到
    // unref 让这个定时器不拖住进程，正常退出时它不会成为最后一块拼图
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
