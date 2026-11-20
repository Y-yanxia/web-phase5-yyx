// 进程入口：只负责启停，不写业务逻辑（方便测试里直接 createApp()）。
import { createApp } from './app.js';
import { config } from './config.js';

const app = createApp();

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
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
