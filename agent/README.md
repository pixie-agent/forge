# Forge Agent

Forge Agent 是运行在 Google Cloud Run 上的执行体。它使用 [pi coding agent](https://github.com/earendil-works/pi) 在一次性工作目录内生成或修改多文件 React 应用，执行平台侧 Vite 构建，再将进度、断点和最终产物回调给 Cloudflare Worker。

Forge Web、账号、任务状态、计费、持久化和发布都在仓库根目录的 Cloudflare Worker 中。完整架构见 [`../docs/FORGE2.md`](../docs/FORGE2.md)。

## 接口

- `GET /health`：公开健康检查，返回 `{ "ok": true }`。
- `POST /run`：执行一次任务，必须携带与 Worker 相同的 `X-Agent-Secret`。

请求体类型见 `src/types.ts` 的 `RunRequest`。Agent 会向请求中的 `callbackBase` 回调：

- 进度和心跳
- 执行中追加要求与取消状态巡检
- 源码断点快照
- 模型用量
- 最终 `commit` 或 `fail`

HTTP 请求体上限为 24 MiB。任务运行预算由环境变量提供默认值，并可由 Worker 下发的模型配置逐任务覆盖，最大为 3400 秒。

## 本地运行

从仓库根目录安装全部依赖：

```bash
npm run bootstrap
cp agent/.env.example agent/.env
```

编辑 `agent/.env`，至少配置：

```text
AGENT_SECRET=与根目录 .dev.vars 相同的值
LLM_BASE_URL=模型接口地址
LLM_MODEL=模型 ID
LLM_API_KEY=模型密钥
WORKSPACE_TEMPLATE_DIR=./template
```

从根目录启动：

```bash
npm run dev:agent
curl -s http://localhost:8080/health
```

`npm run dev:agent` 会加载 `agent/.env`，并将模板目录转换为绝对路径。也可以进入 `agent/` 后直接运行 `npm run dev`。

## 构建

```bash
npm run typecheck
npm run build
```

根目录的 `npm run check` 同时验证 Worker、Web、Agent 和模板。

## Cloud Run

通用部署要求：

- Node.js 22.19+ 容器（当前固定 `22.22.1-bookworm-slim`）
- 请求超时 3600 秒
- `AGENT_MAX_RUN_MS` 或任务级 `max_run_ms` 小于 Cloud Run 超时
- VIP 执行体通常使用 `--concurrency 1`
- 模型密钥和 `AGENT_SECRET` 通过 Secret Manager 注入
- `WORKSPACE_ROOT` 指向可写的临时目录

维护者专用部署参数位于根 `package.json`。自托管者不应复用其中的服务名、项目或 secret 名；请参阅 [`../docs/SELF_HOSTING.md`](../docs/SELF_HOSTING.md)。

当前维护者部署允许未认证网络访问，但 `/run` 仍执行共享密钥校验。自托管环境应在可行时增加 Cloud Run IAM、受控 ingress、速率限制和异常调用告警。

## 目录

| 路径 | 职责 |
| --- | --- |
| `src/index.ts` | HTTP、鉴权、请求校验和进程内队列 |
| `src/runner.ts` | 工作目录、附件、pi 会话、构建、复查和产物收集 |
| `src/session.ts` | pi provider 与编码工具装配 |
| `src/prompt.ts` | 系统提示词、生成、修改和复查提示词 |
| `src/callback.ts` | 进度、心跳、巡检、断点和终态回调 |
| `src/config.ts` | 环境变量与任务级模型配置合并 |
| `template/` | 预装依赖并复制到每个生成项目的 React 模板 |

## 许可

Agent 平台代码适用仓库根目录的 PolyForm Noncommercial 1.0.0。`template/` 会进入用户导出项目，因此单独采用 Apache-2.0。
