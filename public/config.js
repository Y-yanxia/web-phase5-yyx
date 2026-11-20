/* 前端运行配置。
 *
 * 本地开发（后端顺手托管静态页）：留空即可，请求会打到同源的 /api。
 * 前后端分开部署（前端 GitHub Pages / 后端 Render）：
 *   把下面这行改成后端地址，例如
 *   window.__API_BASE__ = 'https://onelist-api.onrender.com';
 * 也可以在地址栏临时覆盖：index.html?api=https://xxx
 */
window.__API_BASE__ = '';
