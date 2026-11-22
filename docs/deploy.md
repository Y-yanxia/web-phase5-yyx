# 部署：前端 GitHub Pages + 后端 Render

> 目标：得到一个能在外网打开的地址，手机流量也能访问（不是只能在同一个 WiFi 下）。

---

## 一、前端：GitHub Pages（已配好自动部署）

仓库里已有 `.github/workflows/pages.yml`，推送到 `main` 就会自动发布 `public/`。

**第一次需要手动开一下开关（只做一次）：**

1. 打开 <https://github.com/Y-yanxia/web-phase5-yyx/settings/pages>
2. `Build and deployment` → `Source` 选 **GitHub Actions**（不是 Deploy from a branch）
3. 回到 <https://github.com/Y-yanxia/web-phase5-yyx/actions>，等 `Deploy static site to Pages` 跑完
4. 访问 <https://y-yanxia.github.io/web-phase5-yyx/>

**如果后端已经上线，让前端指向后端：**

Settings → Secrets and variables → Actions → **Variables** → New repository variable：

| Name | Value |
|---|---|
| `API_BASE` | `https://你的服务.onrender.com` |

保存后去 Actions 页点 `Re-run all jobs`，构建时会把地址写进 `config.js`。

> 也可以不改变量，直接在地址栏临时指定：`https://y-yanxia.github.io/web-phase5-yyx/?api=https://xxx.onrender.com`

---

## 二、后端：Render（免费，约 5 分钟）

> ⚠️ **先看这条**：Render 主站 `render.com` 在国内经常打不开，但控制台 `dashboard.render.com` 是通的，直接开控制台登录。
> 如果创建服务时弹出 **Add Card**（$1 预授权验证），说明这个账号被要求绑卡——**不要硬上**，
> 直接用本文「方案 C：Cloudflare 隧道」或国内平台（见第五节）。
>
> 另外：新版 Render 的 GitHub 登录入口如果仍跳回 `render.com`，同样会被墙，那就只能走方案 C。

### 2.1 注册

1. 打开 <https://dashboard.render.com/>（**不是** render.com 首页）
2. 点 **Sign in with GitHub**（不用单独注册，直接用你的 GitHub 账号授权）
3. 授权时可以只勾选 `web-phase5-yyx` 这一个仓库

### 2.2 新建 Web Service

`Dashboard` → **New +** → **Web Service** → 选中 `web-phase5-yyx` → **Connect**

按下表填（其余保持默认）：

| 配置项 | 填什么 |
|---|---|
| Name | `onelist-api`（随便，会变成域名前缀） |
| Region | `Singapore`（国内访问最快） |
| Branch | `main` |
| Runtime | `Node` |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Instance Type | `Free` |

### 2.3 环境变量（Environment → Add Environment Variable）

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `ALLOWED_ORIGINS` | `https://y-yanxia.github.io` |
| `DEEPSEEK_API_KEY` | 有就填 `sk-...`；没有就留空（会进离线演示模式） |

> `PORT` **不要填**，Render 会自己注入，代码里读的就是 `process.env.PORT`。

### 2.4 部署完验证

在 Render 页面上方拿到地址，例如 `https://onelist-api.onrender.com`：

```bash
curl https://onelist-api.onrender.com/api/health
# {"code":0,"data":{"status":"up","mode":"mock",...},"msg":"ok"}

curl https://onelist-api.onrender.com/api/items
# {"code":0,"data":{"items":[],"total":0},"msg":"ok"}
```

第一次访问要等 **30–50 秒**（免费实例冷启动），不要以为挂了。

### 2.5 把前端接上去

回到 GitHub 仓库 → Settings → Variables → 新建 `API_BASE` = Render 地址 →
Actions → Re-run jobs → 打开 Pages 地址，列表能加载就通了。

---

## 三、常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| Pages 打开是 404 | Pages 的 Source 没选 GitHub Actions | Settings → Pages 改过来 |
| 页面能开但列表报错 | `API_BASE` 没配 / 配错 | 检查变量值有没有多余的 `/` |
| 浏览器 Console：CORS | Render 上的 `ALLOWED_ORIGINS` 没加 Pages 域名 | 加上 `https://y-yanxia.github.io` 后 redeploy |
| 部署失败 `node:sqlite` | Node 版本低于 22 | `package.json` 已声明 `engines: >=24`，Render 会读 |
| 数据一会儿就没了 | 免费实例重启，文件系统重置 | 预期行为，见 README「已知问题」 |
| 搜索时 502 | 免费实例休眠后唤醒中 | 等 30 秒重试 |

---

## 四、方案 C：Cloudflare 隧道（不需要账号、不需要卡，临时）

适用场景：只想先拿到一个能用的公网地址、或者平台注册要绑卡时。

**原理**：本机跑 `npm start`，用 cloudflared 把 3000 端口映射成 `https://xxx.trycloudflare.com`，
前端 Pages 通过 `API_BASE` 指向它。请求真的打到本机 Express，SQLite 也写在本机。

```powershell
# 1. 启动服务（另一个窗口）
npm start

# 2. 下载 cloudflared（国内可用镜像；官方地址 github.com 常被墙）
#    官方：https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
#    镜像：https://gh-proxy.com/https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
cloudflared.exe tunnel --url http://localhost:3000

# 3. 输出里会有一行：
#    |  https://xxxx-xxxx.trycloudflare.com  |
```

拿到地址后：

1. GitHub 仓库 → Settings → Secrets and variables → Actions → Variables → `API_BASE` = 这个地址
2. Actions → `Deploy static site to Pages` → Run workflow
3. 打开 Pages 地址，列表能加载就通了

**验证跨域**（浏览器控制台能看到错误时先跑这个）：

```bash
curl -i -X OPTIONS https://xxx.trycloudflare.com/api/items \
  -H "Origin: https://y-yanxia.github.io" \
  -H "Access-Control-Request-Method: GET"
# 期望：204 + Access-Control-Allow-Origin: https://y-yanxia.github.io
```

**代价（必须知道）**

| 限制 | 说明 |
|---|---|
| 依赖本机 | 电脑关机 / 睡眠 / 关掉终端，地址立刻失效 |
| 地址会变 | 每次重启 cloudflared 都会生成新的 `trycloudflare.com` 子域 |
| 速度 | 走 Cloudflare 边缘节点，比本机慢 0.3–3 秒（实测首包 2.5s） |
| 不适合交付 | 答辩现场如果电脑休眠，链接就是 502 |

所以它是**演示/录屏阶段的过渡方案**，正式提交前最好换成常驻主机（方案 A 或下表的国内选项）。

---

## 五、不上 Render 的替代方案

| 方案 | 优点 | 缺点 |
|---|---|---|
| Cloudflare 隧道（方案 C） | 零账号、零成本、SSE 完整 | 依赖本机开机 |
| 阿里云 / 腾讯云 学生机 | 国内快、常驻 | 要实名、几十块/月 |
| Sealos / Zeabur | 支持常驻 Node，国内访问尚可 | 需注册，免费额度有限 |
| Railway | 部署快 | 需要绑卡 |
| 阿里云函数计算 | 国内快 | 要实名、配置复杂 |
| Vercel | 前端最省事 | **不能跑 Express + SSE**（serverless 超时），别把后端放这儿 |

> 两条红线：
> 1. **不要用 Vercel 部署这个后端**。serverless 有执行时长上限，流式响应会被截断；
>    而且它只有 `/tmp` 可写，SQLite 数据每次冷启动都会清空。
> 2. **Render 注册要绑卡时不要硬上**。新版 Render 可能要求 $1 预授权验证，
>    学生没有双币卡就走方案 C 或国内平台。

---

## 六、方案 D：容器镜像（已自动构建，最通用）

仓库里已经有 `Dockerfile` + `.github/workflows/docker.yml`：每次推 `main`，
GitHub Actions 会构建镜像、推到 GitHub 容器仓库，并在容器里跑一遍冒烟
（`/api/health` → 新增 → 缺字段 400），通过了才发布。

**镜像地址**（公开可匿名拉取，linux/amd64 + linux/arm64 双架构）：

```
ghcr.io/y-yanxia/web-phase5-yyx:latest
```

### 6.1 任何一台装了 Docker 的机器（学生机 / 云服务器 / 家里的旧电脑）

```bash
docker run -d --name onelist \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e ALLOWED_ORIGINS="https://y-yanxia.github.io,http://<这台机器的公网IP>:3000" \
  -e DEEPSEEK_API_KEY="sk-你的key" \
  -v onelist-data:/app/data \
  --restart unless-stopped \
  ghcr.io/y-yanxia/web-phase5-yyx:latest
```

或者用仓库里的 `docker-compose.yml`（更省事）：

```bash
git clone https://github.com/Y-yanxia/web-phase5-yyx.git
cd web-phase5-yyx
echo "DEEPSEEK_API_KEY=sk-你的key" > .env
docker compose up -d
docker compose logs -f      # 看到“页面 http://localhost:3000”就成功
```

**验证**：

```bash
curl http://127.0.0.1:3000/api/health
curl -X POST http://127.0.0.1:3000/api/items -H "Content-Type: application/json" -d '{"title":"docker test"}'
```

**更新版本**：`docker compose pull && docker compose up -d`（数据在 volume 里，不会丢）。

**数据持久化**：SQLite 落在 `/app/data/app.db`，已挂 `onelist-data` 卷；
删容器、重启机器都不丢，只有 `docker volume rm onelist-data` 才会清空。

### 6.2 云平台怎么填

| 平台 | 选什么 | 填什么 |
|---|---|---|
| 阿里云 / 腾讯云 轻量应用服务器 | 系统镜像 Ubuntu，装 Docker | 跑 6.1 的命令，安全组放行 3000 |
| 阿里云 函数计算 FC | 自定义容器 | 镜像填 `ghcr.io/...:latest`，端口 3000 |
| 腾讯云 云托管 | 自定义镜像 | 同上，环境变量照抄 |
| Sealos | 应用管理 → 从镜像创建 | 镜像地址 + 端口 3000 + 环境变量 |
| Zeabur | Docker 部署 | 镜像地址或直接连 GitHub 仓库 |

> 用 IP 访问时，`ALLOWED_ORIGINS` 里要加上 `http://<公网IP>:3000`，
> 否则浏览器会拦跨域（后端自己给自己发请求不受影响，但 Pages 页面调它必须加）。

### 6.3 和隧道方案的区别

| | 方案 C 隧道 | 方案 D 容器 |
|---|---|---|
| 需要账号 | 不需要 | 需要（云平台） |
| 需要绑卡 | 不需要 | 多数免费额度不需要 |
| 关机是否失效 | **会** | 不会 |
| 地址是否固定 | 每次重启会变 | 固定 |
| 数据持久化 | 本机文件 | volume |
| 适合 | 演示 / 录屏 | 正式交付 |

### 6.4 部署完记得改前端地址

后端有了固定地址后，把仓库变量 `API_BASE` 改成它，再重跑 Pages 工作流：

1. Settings → Secrets and variables → Actions → Variables → `API_BASE` = 新地址
2. Actions → `Deploy static site to Pages` → Run workflow
3. 打开 Pages，列表能加载即成功