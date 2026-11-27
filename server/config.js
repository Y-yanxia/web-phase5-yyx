/**
 * 配置层：把环境变量收敛成一个 config 对象，其他模块只认这个对象。
 * 链路位置：最上游，db / app / ai 全都从这里取端口、库路径、Key 和运行模式。
 * 对外导出：ROOT（项目根目录）、config；default 导出同一个 config 对象。
 * 坑：全项目只有这里读 process.env；没配 DEEPSEEK_API_KEY 会自动降级成 mock。
 */
// 配置集中在这里：环境变量 -> config 对象。
// [讲解点] 全项目只有这一个文件读 process.env，其他文件只认 config，
// 这样「哪些配置项存在」一眼可见，也不会出现某个文件偷偷写死 localhost。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 用 import.meta.url 反推项目根：不管从哪个目录启动，路径都稳定
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 极简 .env 解析：只支持 KEY=VALUE 和整行 # 注释。
// 不引 dotenv：少一个依赖，部署到 Render 时也少一个可能装不上的包。
// 多行值、变量展开这些都不支持，本地开发够用就行。
function loadDotEnv(file) {
  // 没有 .env 很正常（线上全靠环境变量注入），直接返回，不能报错
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    // 去掉成对引号，方便写带空格的值
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    // 真实环境变量优先于 .env（线上平台靠环境变量注入 Key）
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotEnv(path.join(ROOT, '.env'));

// 环境变量都是字符串，转不出整数就用兜底值，别让 NaN 一路传到端口
const toInt = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

// 逗号分隔的名单：去空白、去末尾斜杠、去重，最后并上开发默认源
const toList = (value, fallback) =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean)
    .concat(fallback)
    .filter((v, i, arr) => arr.indexOf(v) === i);

// 本地前端常见的几个来源，开发时不配 ALLOWED_ORIGINS 也能跨域
const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

// Key 先 trim：复制粘贴常带首尾空格或换行，直接拿去请求会 401
const apiKey = (process.env.DEEPSEEK_API_KEY ?? '').trim();
const nodeEnv = process.env.NODE_ENV ?? 'development';

// 唯一的配置出口：字段全部显式列出，新增配置请加在这里，别散落到各处
export const config = {
  nodeEnv,
  // isProd 目前没被读取，先留着给以后按环境分支的开关
  isProd: nodeEnv === 'production',
  // 平台一般用 PORT 注入，本地没配就 3000
  port: toInt(process.env.PORT, 3000),
  // :memory: 用于自动化测试：不落盘，测完即销毁
  dbFile:
    process.env.DB_FILE === ':memory:'
      ? ':memory:'
      // 其他值按项目根解析成绝对路径，避免换个 cwd 就写到别处
      : path.resolve(ROOT, process.env.DB_FILE || 'data/app.db'),
  deepseek: {
    apiKey,
    // 去掉尾部斜杠，拼路径时才不会出现 //chat/completions
    baseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  },
  // 没有 Key 或显式 MOCK_AI=1 时，走规则模拟的离线演示模式
  aiMode: !apiKey || process.env.MOCK_AI === '1' ? 'mock' : 'live',
  // 白名单：前端部署到别的域名时，把地址加进 ALLOWED_ORIGINS
  allowedOrigins: toList(process.env.ALLOWED_ORIGINS, DEV_ORIGINS),
  // 上下文最多留几条消息；Math.max(2,) 保证至少能装下一问一答
  historyLimit: Math.max(2, toInt(process.env.HISTORY_LIMIT, 8)),
  // 数据库文件放在 NFS（如阿里云 NAS）上时，WAL 可能不可用，用 SQLITE_WAL=0 关掉
  dbWal: (process.env.SQLITE_WAL ?? '1') !== '0',
  // ?fail=1 是任务3「三态截图」用的开发开关，生产环境关闭
  allowDevFail: nodeEnv !== 'production',
  // 上游 60 秒还不响应就 abort，别让前端一直转圈
  requestTimeoutMs: toInt(process.env.REQUEST_TIMEOUT_MS, 60_000),
};

// 默认导出同一个 config：两种引入方式都支持，不用维护两份
export default config;
