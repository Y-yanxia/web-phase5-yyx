// 极简静态服务器：只为了复现「前后端分域」场景（前端 5055，后端 3100）。
// 用法：node scripts/static-server.mjs [port]
//
// 解决什么问题：要复现 CORS，前后端必须真的不同源；这个极简服务器把 public/
// 单独起在 5055，后端仍在 3100，浏览器于是按跨域规则处理请求。
//
// 用法（一个终端一个）：
// node scripts/static-server.mjs [port]     # 默认 5055
// 浏览器打开 http://127.0.0.1:5055/?api=http://127.0.0.1:3100
//
// 前置条件：不用后端也能当静态页跑，但没有后端页面会进错误态；
// 要复现跨域，后端 3100 得活着且白名单里没有 5055。
// 产物：无文件，只占一个端口；Ctrl+C 结束，别和 3100 的业务服务搞混。
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

// 默认 5055：和 README 的复现步骤、cors-demo 的默认地址对上
const port = Number(process.argv[2] || 5055);
// 只服务 public/：不要把整个仓库暴露出去，.env 就在隔壁
const root = path.resolve('public');
// 只列真实用到的类型：MIME 写错一个，浏览器就直接拒收 CSS/JS
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

http
  .createServer((req, res) => {
    // 先解编码再取路径：中文文件名和 ?api= 参数都不能把路径拼坏
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = path.join(root, urlPath === '/' ? 'index.html' : urlPath);
    // 防目录穿越：../ 拼出去的一律 403，别顺手把 .env 送人
    if (!file.startsWith(root)) {
      res.writeHead(403).end('forbidden');
      return;
    }
    // 目录和文件分开处理：直接读目录会抛异常，先把 404 判掉
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      // 404 明确用纯文本：这里不是路由，只是文件没找到，别假装成页面
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('not found');
      return;
    }
    // 显式给 charset：不写的话 Windows 上中文可能被按 GBK 解
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  })
  // 启动就打印地址：两个终端对不上端口，是这组实验最常见的错
  .listen(port, () => console.log(`static server on http://127.0.0.1:${port} (root=${root})`));
