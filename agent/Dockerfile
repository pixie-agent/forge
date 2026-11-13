# Forge 2.0 agent runtime — Google Cloud Run Service
# 一次请求 = 一个 job 的完整生成生命周期;请求结束实例缩容到 0
FROM node:26.13.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# 预装 Vite+React 脚手架依赖:每个 job 直接拷贝模板 + 符号链接 node_modules,运行期不再 npm install
FROM node:26.13.0-bookworm-slim AS template
WORKDIR /opt/forge-template
# 先落源码、再装依赖:npm ci 会按 lockfile 重建 node_modules,保证镜像里是 Linux 原生安装。
# (构建上下文已用 .dockerignore/.gcloudignore 排除宿主 node_modules;这里 rm -rf 是第二道保险,
#  即使有残留也不会让宿主的 .bin 软链覆盖掉正确安装。)
COPY template/ ./
RUN rm -rf node_modules \
  && npm ci --no-audit --no-fund \
  && npm cache clean --force

FROM node:26.13.0-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
# 预装脚手架(含 node_modules)挂到 agent 的模板目录(WORKSPACE_TEMPLATE_DIR 默认即此路径)
COPY --from=template /opt/forge-template /opt/forge-template
# pi 的 bash 工具需要 bash;bookworm-slim 已带 bash,这里补上常用小工具便于 agent 自检
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
USER node
EXPOSE 8080
CMD ["node", "dist/index.js"]
