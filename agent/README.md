# forge-agent(Cloud Run Service)

Forge 2.0 的 **Agent 执行体**:用 [pi coding agent](https://github.com/badlogic/pi-mono) 在隔离工作目录里写单文件网站。一次 HTTP 请求(`POST /run`)承载一个 job 的完整生命周期,请求结束实例缩容到 0 —— 临时、用完即销毁。

其余一切(前端、鉴权、任务状态、进度订阅、发布、持久化)都在 Cloudflare 侧,见 [../docs/FORGE2.md](../docs/FORGE2.md)。

## 接口

- `GET /health` → `{ ok: true }`
- `POST /run`(头 `X-Agent-Secret`)body 见 `src/types.ts` `RunRequest`,成功返回 `{ html, plan? }`,失败返回非 2xx `{ error }`。
- 执行期间向 `{callbackBase}/internal/jobs/:id/progress` 推送 `{ stage?, progress?, plan?, htmlPreview? }`。

## 本地跑

```bash
cp .env.example .env            # 填 AGENT_SECRET / LLM_*
set -a && . ./.env && set +a
npm install
npm run dev                     # node --experimental-strip-types src/index.ts
curl -s localhost:8080/health
```

## 部署到 Cloud Run

```bash
gcloud run deploy forge-agent \
  --source agent \
  --region asia-northeast1 \
  --timeout 3600 --concurrency 1 \
  --min-instances 0 --max-instances 5 \
  --cpu 1 --memory 1Gi \
  --set-env-vars LLM_BASE_URL=...,LLM_MODEL=...,PI_PROVIDER_ID=forge \
  --set-secrets LLM_API_KEY=llm-api-key:latest,AGENT_SECRET=agent-secret:latest
```

要点:

- `--concurrency 1`:一实例一请求,隔离彻底、用完即销毁(也最适合请求级计费)。
- `--timeout 3600`:Cloud Run 单请求上限(60 分钟);后台 `max_run_ms` 最大配到 3400s,留构建余量。
- `--min-instances 0`:空闲缩到 0,不常驻。
- 出网只用于调 LLM 网关与回调(小体积 JSON),流量成本可忽略;主要成本是请求时长。

## 结构

| 文件 | 职责 |
| --- | --- |
| `src/index.ts` | HTTP 服务:`/run`、`/health`、密钥校验 |
| `src/runner.ts` | 单 job:建工作目录 → 跑 pi → 收集 `index.html` / `plan.json` |
| `src/session.ts` | 装配 pi `AgentSession`(自定义 OpenAI 兼容 provider + 编码工具) |
| `src/prompt.ts` | system / user 提示词、plan.json 解析、HTML 提取 |
| `src/callback.ts` | 进度回调(字段级节流、fire-and-forget) |
| `src/config.ts` | 环境变量解析 |