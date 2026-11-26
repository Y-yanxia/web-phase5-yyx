/* 前端运行配置。
 *
 * 本地开发（后端顺手托管静态页）：留空即可，请求会打到同源的 /api。
 * 前后端分开部署（前端 GitHub Pages / 后端 Render）：
 *   把下面这行改成后端地址，例如
 *   window.__API_BASE__ = 'https://onelist-api.onrender.com';
 * 也可以在地址栏临时覆盖：index.html?api=https://xxx
 *
 * 这个文件是什么：全站唯一一处「后端地址」配置，就是一个全局变量。
 * 在页面里的角色：不画界面、不发请求，只把地址挂到 window.__API_BASE__ 上等人来读。
 * 和谁配合：index.html 里本文件写在 app.js 之前 —— 普通 script 是同步执行的，
 *   而 module 默认 defer，所以 app.js 跑起来时 window.__API_BASE__ 一定已经存在；
 *   app.js 的 API_BASE 取值顺序是：?api= 参数 > window.__API_BASE__ > 同源（location.origin）。
 * 为什么用 window 上的变量而不是 import / export：
 *   这是最原始的做法 —— 一个普通 script 挂个全局变量，不需要构建工具，
 *   静态托管（GitHub Pages）直接就能跑；代价是名字要够特别，别撞上别人的变量。
 * 为什么默认空字符串、而不写死 localhost:3000：
 *   留空时 app.js 会回退到「同源」，本地和线上共用同一份代码；
 *   写死地址的话，部署上线后页面会去请求访问者自己电脑上的 localhost。
 */
window.__API_BASE__ = '';
