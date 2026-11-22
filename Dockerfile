# 一句话清单 · 生产镜像
# Node 24 是硬要求：内置的 node:sqlite 在 22 上要开实验开关，24 才是默认可用
FROM node:24-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# 先只拷依赖清单，利用 layer 缓存：代码改了不用重装依赖
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 只拷运行需要的东西（public 是静态页，server 是接口）
COPY server ./server
COPY public ./public

# SQLite 文件目录；挂 volume 时从这里持久化
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 3000

# 容器里没有 shell 也用 exec 形式，信号能直达 node
CMD ["node", "server/index.js"]
