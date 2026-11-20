// 配置集中在这里：环境变量 -> config 对象。
// [讲解点] 全项目只有这一个文件读 process.env，其他文件只认 config，
// 这样「哪些配置项存在」一眼可见，也不会出现某个文件偷偷写死 localhost。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 极简 .env 解析：只支持 KEY=VALUE 和整行 # 注释。
// 不引 dotenv：少一个依赖，部署到 Render 时也少一个可能装不上的包。
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
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

const toInt = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

const toList = (value, fallback) =>
  (value ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean)
    .concat(fallback)
    .filter((v, i, arr) => arr.indexOf(v) === i);

const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
];

const apiKey = (process.env.DEEPSEEK_API_KEY ?? '').trim();
const nodeEnv = process.env.NODE_ENV ?? 'development';

export const config = {
  nodeEnv,
  isProd: nodeEnv === 'production',
  port: toInt(process.env.PORT, 3000),
  // :memory: 用于自动化测试：不落盘，测完即销毁
  dbFile:
    process.env.DB_FILE === ':memory:'
      ? ':memory:'
      : path.resolve(ROOT, process.env.DB_FILE || 'data/app.db'),
  deepseek: {
    apiKey,
    baseUrl: (process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com').replace(/\/+$/, ''),
    model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
  },
  // 没有 Key 或显式 MOCK_AI=1 时，走规则模拟的离线演示模式
  aiMode: !apiKey || process.env.MOCK_AI === '1' ? 'mock' : 'live',
  allowedOrigins: toList(process.env.ALLOWED_ORIGINS, DEV_ORIGINS),
  historyLimit: Math.max(2, toInt(process.env.HISTORY_LIMIT, 8)),
  // ?fail=1 是任务3「三态截图」用的开发开关，生产环境关闭
  allowDevFail: nodeEnv !== 'production',
  requestTimeoutMs: toInt(process.env.REQUEST_TIMEOUT_MS, 60_000),
};

export default config;
