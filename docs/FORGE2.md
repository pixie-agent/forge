# Forge 2.0 设计:Cloudflare 编排 + Cloud Run 跑 Agent

> 目标:把「Agent 实际跟 AI 交互的过程」从 Cloudflare Worker 里拿出来,放进一个**有文件系统、能跑命令、执行完即销毁**的环境(Google Cloud Run Service),其余能力(前端、鉴权、任务状态、进度订阅、发布、站点数据)全部沿用 Cloudflare。旧线上服务(生产 Worker `forge` / 本仓库历史 `forge-v2` 语义)不受影响。

## 1. 为什么是 Cloud Run Service,不是 Cloud Functions

| 维度 | Cloud Functions | Cloud Run Service |
| --- | --- | --- |
| 能否跑命令 / 有文件系统 | Gen2 可以,但运行模型是"函数",不适合长驻的 agent 循环 | **可以**,容器内任意命令;`/tmp` 可写,自定义镜像 |
| 自定义二进制(pi CLI / node / git) | 受限 | **完全自由**(自定义 Dockerfile) |
| 执行时长 | 有上限,长任务需拆 | 请求超时**最高 60 分钟**,一次请求跑完整个生成 |
| 临时、用完即销毁 | 是 | **是**(缩容到 0;`--min-instances=0`) |
| 出网流量计费 | 有免费额度后按量 | 同类,出网按 GiB 计费(见 §7) |

结论:**用 Cloud Run Service**。一次生成 = 一次 HTTP 请求,请求结束实例缩容到 0,天然"临时、执行完即销毁"。

## 2. 职责边界(定下来的事)

- **Cloudflare Worker `forge-v2`**(新项目空间、新 D1):前端 Assets、`/api/auth`、`/api/projects`、`/api/jobs`(SSE + 轮询)、`/s/:slug` 发布、`/api/site` 站点数据、**任务派发(`waitUntil`)+ 内部回调 + cron 心跳巡检**。**不跑任何 LLM 调用。**
- **Google Cloud Run Service `forge-agent`**:唯一的 AI 交互执行体。用 **pi coding agent** 在隔离工作目录里写代码(有 `read/write/edit/bash` 工具),再在平台侧 `vite build`,把源码树与构建产物交回。
- **边界规则**:产物落库、版本、积分、消息等**持久化与权限逻辑只留在 Cloudflare**;Cloud Run 只回传原始产物(`src`/`dist`/`manifest`/`plan`)与进度。

## 3. 数据流

```
浏览器 ──POST /api/projects/:id/generate──► Worker(建 job=pending,立即返回 {jobId})
                                             │
                        waitUntil 中异步 dispatch(不阻塞响应,断开也无妨)
                                             │  POST https://forge-agent/run(X-Agent-Secret)
                                             ▼
                                   Cloud Run 实例(每 job 一个,一次请求持有到跑完)
                                     ├─ 建 /tmp/workspace/<jobId>,写入现状(chat 时带当前源码树)
                                     ├─ 起 pi AgentSession(自定义 provider 指向 OpenAI 兼容网关)
                                     ├─ 事件流 → POST {PUBLIC_BASE_URL}/internal/jobs/:id/progress  (进度/规划/当前文件预览 + 心跳)
                                     ├─ 结束前 vite build 出 dist
                                     └─ 结束 → POST /internal/jobs/:id/commit(成功,回传 src/dist/manifest/plan)
                                                   或 POST /internal/jobs/:id/fail(失败,回传 error)
                                             │
                       commit 回调里:写版本、乐观锁推 current_version、补 assistant 消息、扣积分(幂等)
                                             ▼
浏览器 ──SSE/轮询 /api/jobs/:id──► 读 D1 里的状态(Worker 只是把状态推给前端)
```

### 为什么不用 Workflow 保持 HTTP 请求打开

Cloud Run 请求级计费(便宜、用完即缩)要求**请求在跑时 CPU 才分配**,所以对 Cloud Run 的那次 HTTP 请求要一直握住到 agent 跑完。曾用 Workflow 的 step 来握(见 git 历史),但 step 超时上限覆盖不了长生成,还多一层编排状态。关键观察:**Cloudflare 对 Worker 的出站请求会超时掐断(524),但掐断不影响 Cloud Run 继续跑**——Cloud Run 只要 handler 未返回就持续执行并保持 CPU。于是:

- Worker 侧:`generate`/`chat` 在 `waitUntil` 中发起 `POST /run`,**不等待、不阻塞**对浏览器的响应;连接被掐断也无所谓。
- Cloud Run 侧:一次 `/run` 请求 = 一个 job 的完整生命周期,`--timeout=1800`、`--concurrency=1`(一请求一实例语义)。
- 交付以 **commit / fail 回调**为准(不依赖 HTTP 响应体);派发失败或实例异常由 cron 心跳巡检兜底判死。

## 4. 进度协议

复用现有 `jobs` 表的 `stage/progress/plan_json/files_preview/agent_log` 字段,以及 `/api/jobs/:id`、`/api/jobs/:id/events`。

- Cloud Run 订阅 pi 的事件:
  - `agent_start` → `stage=planning`,`progress=正在规划方案`
  - 首次写 `plan.json` → 回填 `plan_json`(前端规划卡片)
  - 写/改源文件 → `stage=coding`,`progress=正在编写 {path}`,并把该文件内容作为 `files_preview`(前端「代码」页随写随看)
  - 结束前的 `vite build` → `stage=building`,`progress=正在构建应用产物`
  - `message_update`(thinking/正文的逐 token 增量)+ `tool_execution_start/end` → 追加进 **`agent_log`**(前端「Agent 实时输出」面板,像终端一样跟随)
- 回调走 Worker 内部接口(`X-Agent-Secret` 校验),只允许字段级更新,不碰状态机:
  - `POST /internal/jobs/:id/progress`:进度 / 规划 / 当前文件预览 / 心跳
  - `POST /internal/jobs/:id/log`:流式日志增量;**原子追加** `agent_log = substr(COALESCE(agent_log,'') || ?, -20000)` 保留尾部,免读改写;agent 侧按 ~800ms 串行 flush,终态前 `stop()` 补发剩余
- 任务的**终态**只由 `commit` / `fail` 回调落定(幂等):成功才补 assistant 消息 + 扣积分;失败/判死不扣。回调带守卫(`WHERE status IN ('pending','running')`),迟到回调不复活已判死任务,但「判死后又收到 commit」的迟到成功仍可复活交付。
- 前端 `subscribeJob` 走 SSE(`/api/jobs/:id/events`),指纹含 `files_preview/agent_log` 的长度变化 → 每次追加都会推送一份最新快照。

## 5. Agent 形态(pi coding agent)

- 容器内安装 `@mariozechner/pi-coding-agent`,用其 **SDK**(`createAgentSession`)嵌入,不 fork pi。
- 自定义 provider 用 `models.json` 声明,指向现有网关(`LLM_BASE_URL/LLM_API_KEY/LLM_MODEL`)。**网关方言由 `PI_LLM_API` 决定**:`openai-completions`(默认,OpenAI 兼容)/ `anthropic-messages`(Anthropic 兼容)/ `openai-responses`。
- **当前生产实际值(2026-10-17 实测,以 Cloud Run 服务的 env 为准)**:`LLM_BASE_URL=https://api.deepseek.com/anthropic`、`LLM_MODEL=deepseek-flash`、`PI_LLM_API=anthropic-messages`、`PI_PROVIDER_ID=forge`、`PI_MODEL_REASONING=true`——即走 DeepSeek 的 **Anthropic 协议**端点,不是 OpenAI 兼容端点。文档里早先写的 GLM/`zai` 组合(`PI_THINKING_LEVEL/PI_THINKING_FORMAT=zai/PI_SUPPORTS_DEVELOPER_ROLE=…`)是**过期值**,仅在使用相应 OpenAI 兼容网关时才需要。
- 其余调优开关(见 `agent/src/config.ts`):`PI_THINKING_LEVEL`(off…xhigh)、`PI_MODEL_REASONING`(模型是否声明支持推理)、`PI_THINKING_FORMAT`(openai|zai|qwen|qwen-chat-template)、`PI_SUPPORTS_DEVELOPER_ROLE` / `PI_SUPPORTS_REASONING_EFFORT`(默认 true;网关不认 `developer` 角色时置 false 走 system)。
- 工具集:`createCodingTools(workspace)`(read/bash/write/edit),`sessionManager: inMemory`,每次 job 全新会话、全新工作目录 → 用完即弃。
- System prompt 用 `DefaultResourceLoader({ systemPrompt })` 注入:约定产出**多文件 React 应用**(Vite+Tailwind、简体中文、响应式、无外图、真实文案、`src/lib/forge.js` 数据接口)。
- `generate`:先写 `plan.json`(→ 前端规划卡片),再按计划实现 `src/` 下的 React 组件。
- `chat`:Worker 把当前源码树放进 dispatch 载荷,Cloud Run 预写入工作目录,提示"只按要求改"。
- 结束前平台侧执行一次 `vite build`,收集源码树 + 构建产物 + 清单回传(见 §13.7)。

## 6. 安全

- Worker → Cloud Run:请求头 `X-Agent-Secret`(共享密钥)。Cloud Run 可设 `--no-allow-unauthenticated` + 由 Worker 带 Google OIDC token 进一步收紧(路线图)。
- Cloud Run → Worker:`X-Agent-Secret` 校验;`/internal/*` 不挂用户鉴权中间件、不读 cookie。
- 生成的页面仍走 `/s/:slug` 的 CSP `sandbox`,opaque origin,读不到主站凭证(不变)。
- Agent 工作目录与网络:容器内除 LLM 网关与回调用例外网可后续用 VPC egress 限制(路线图)。

## 7. 成本(Cloud Run)

- **每月免费额度**:Cloud Run 有永久免费层(约每月 18 万 vCPU·秒 + 36 万 GiB·秒 + 100 万请求,区域/口径以官方为准),小规模够用;超出按用量计费。
- **出网流量**:Cloud Run 对**出站到互联网的数据传输按 GiB 收费**(有少量免费出网额度),入网免费;同区域内网互通不计费。Agent 主要"出网"是调 LLM 网关与回调,都是小体积 JSON,流量成本可忽略;真正成本是 vCPU/内存的**请求时长**。
- 省钱关键:请求级计费 + `--min-instances=0` + `--concurrency=1` + 生成完立刻响应结束 → 实例随即缩容到 0。

## 8. 新增/改动清单

新增(Cloud Run 侧,`agent/`):
- `index.ts`(HTTP:`POST /run`、`GET /health`)、`runner.ts`(pi 会话 + 事件→进度 + 平台侧构建)、`session.ts`(模型/工具装配)、`prompt.ts`、`callback.ts`、`config.ts`;`template/`(预装依赖的 Vite+React 脚手架)、`Dockerfile`、`package.json`、`tsconfig.json`。

改动(Cloudflare 侧):
- `src/workflow.ts`:**已删除**(用 `waitUntil` 异步 dispatch + 回调替代持久编排)。
- `src/routes/internal.ts`(新):进度 / commit / fail 回调。
- `src/lib/agent.ts`(新):dispatch 载荷构造 + 调用 Cloud Run。
- `src/lib/commit.ts`(新):commit / fail 回调落定终态(写版本、扣积分、补消息)。
- `src/lib/jobs.ts`:心跳式状态 + cron 巡检判死。
- `src/routes/generate.ts`:`waitUntil` 异步 dispatch。
- `src/types.ts`:`Env` 增加 `AGENT_URL`、`AGENT_SECRET`、`PUBLIC_BASE_URL`(可选 `AGENT_DISPATCH_TIMEOUT_MS` 等);移除 Workflow 类型。
- `src/index.ts`:挂载 `/internal`,移除 Workflow 导出与 cron 改为任务巡检。
- `wrangler.jsonc` / `.dev.vars.example`:新增变量(Worker 名保持 `forge-v2`;D1 建议另建 `forge-v2` 隔离数据)。
- `src/lib/prompts.ts`、`src/lib/llm.ts`:Worker 侧不再被 workflow 使用;`llm.ts` 保留给可能的轻量用途,`prompts.ts` 的约束文案迁到 `agent/src/prompt.ts`。

## 9. 全新环境搭建(与旧服务完全隔离)

原则:**本项目的资源全部新建,不复用线上 `forge` 的 Worker / D1 / secrets / Workflow,也不复用既有的 Cloud Run 服务。** 旧服务只读不动。

### 9.1 Cloudflare(新项目空间)

```bash
# 1) 新建独立 D1,把输出的 database_id 填进 wrangler.jsonc
npx wrangler d1 create forge-v2
# 2) 初始化新库(幂等)
npm run db:init:remote
# 3) 逐个配置 secrets(vars 已在 wrangler.jsonc,不在 secrets 里)
npx wrangler secret put AGENT_SECRET     # 与 Cloud Run 侧同名同值
#    AGENT_URL / PUBLIC_BASE_URL 是明文地址,写在 wrangler.jsonc 的 vars 里
# 4) 可选:启用 Google 登录(见下方说明)
# npx wrangler secret put GOOGLE_CLIENT_ID
# npx wrangler secret put GOOGLE_CLIENT_SECRET
npm run deploy                            # 构建前端 + 部署 Worker(名:forge-v2)
```

> `wrangler.jsonc` 里 `database_id` 现在是占位符 `REPLACE_WITH_FORGE_V2_D1_ID`,**必须先 `d1 create` 再替换**,否则部署报错——这是刻意的,防止误用旧库。
> Worker 名 `forge-v2` 为全新命名,不会覆盖线上 `forge`(v2 已不再注册 Workflow)。

**Google 登录(可选,与邮箱/密码登录共存)**:在 Google Cloud Console →「API 和服务 → 凭据」创建「OAuth 客户端 ID(Web 应用)」,「已获授权的重定向 URI」填 `${PUBLIC_BASE_URL}/api/auth/google/callback`(本地为 `http://localhost:8787/api/auth/google/callback`),再把客户端 ID/密钥存为 Worker secrets:`npx wrangler secret put GOOGLE_CLIENT_ID`、`npx wrangler secret put GOOGLE_CLIENT_SECRET`——两者缺一即不启用,登录页只保留邮箱/密码。老库需执行一次 `schema.migrate-google.sql`(`npm run db:migrate:google:remote`)新增 `users.google_sub`;全新安装的 `schema.sql` 已含。流程:前端「使用 Google 登录」→ `GET /api/auth/google`(state 随机数存 HttpOnly cookie 防 CSRF,`idea` 随 state 透传)→ Google 授权页 → `GET /api/auth/google/callback` 用 code 换 `id_token`,按 `sub` 找账号;找不到再按邮箱命中**同一账号**并回填 `google_sub`(邮箱/密码账号与 Google 合并,历史数据与积分保留),都没有才新建(无密码,`password_hash` 存空串)。

### 9.2 Google Cloud(新 Cloud Run 服务)

先把项目与区域定下来(本次实际部署:`PROJECT_ID=sixth-impulse-286413`、`REGION=us-central1`),然后:

```bash
gcloud config set project $PROJECT_ID

# 启用需要的 API
gcloud services enable \
  run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com \
  secretmanager.googleapis.com

# 存放 LLM key 与内部密钥(Secret Manager)
printf '%s' "$LLM_API_KEY" | gcloud secrets create llm-api-key --data-file=-
printf '%s' "$AGENT_SECRET" | gcloud secrets create agent-secret --data-file=-

# 从源码部署(Cloud Build 构建镜像,推 Artifact Registry)
# 生产与 staging 各有一个 npm 脚本(参数唯一来源,不要手敲 gcloud 以免漂移):
#   npm run agent:deploy:prod    → 服务 forge-agent
#   npm run agent:deploy:staging → 服务 forge-agent-staging(--max-instances 1)
# 生产实际使用的 env(2026-10-17 实测):
gcloud run deploy forge-agent \
  --source agent --region $REGION \
  --timeout 1800 --concurrency 1 --min-instances 0 --max-instances 5 \
  --cpu 1 --memory 1Gi \
  --set-env-vars LLM_BASE_URL=https://api.deepseek.com/anthropic,LLM_MODEL=deepseek-flash,PI_LLM_API=anthropic-messages,PI_PROVIDER_ID=forge,PI_MODEL_REASONING=true,AGENT_MAX_RUN_MS=1500000,WORKSPACE_ROOT=/tmp/forge-agent \
  --set-secrets LLM_API_KEY=llm-api-key:latest,AGENT_SECRET=agent-secret:latest
```

> 换用 OpenAI 兼容网关时,把 `PI_LLM_API` 改回 `openai-completions`,并按需加 `PI_SUPPORTS_DEVELOPER_ROLE=false` / `PI_THINKING_FORMAT=zai|qwen` 等(见 §5)。
> `AGENT_MAX_RUN_MS` 必须 **小于** Cloud Run `--timeout`(两者都按毫秒/秒口径核对):默认 1500s,`--timeout 1800`。设太小会让正常的多文件生成被自身超时掐死(staging 初版设 300s 即踩过:一个真实 generate 需要 ~6.5 分钟)。

部署完把服务 URL 填回 `wrangler.jsonc` 的 `AGENT_URL`,把 Worker 的对外域填进 `PUBLIC_BASE_URL`,再 `npm run deploy` 一次。

### 9.3 需要哪些 GCP 权限

**(a) 执行部署的人 / CI 服务账户** —— 用 `--source` 部署会用到 Cloud Build + Artifact Registry + 一个临时 GCS staging bucket,最小角色集:

| 角色 | 用途 |
| --- | --- |
| `roles/run.admin` | 创建/更新 Cloud Run 服务 |
| `roles/iam.serviceAccountUser` | 把运行时 SA 绑到 Cloud Run 服务上 |
| `roles/cloudbuild.builds.editor` | Cloud Build 构建镜像 |
| `roles/artifactregistry.writer` | 推送镜像到 Artifact Registry |
| `roles/storage.objectAdmin` | Cloud Build 的临时 staging bucket 读写 |
| `roles/secretmanager.admin` | 创建/更新 secret(仅首次需要,可用 `secretVersionAdder` 收窄) |
| `roles/serviceusage.serviceUsageAdmin` | 启用上面那批 API(仅首次需要) |

授权示例:

```bash
for r in run.admin iam.serviceAccountUser cloudbuild.builds.editor \
         artifactregistry.writer storage.objectAdmin secretmanager.admin \
         serviceusage.serviceUsageAdmin; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="user:YOU@example.com" --role="roles/$r"
done
```

> 开发期图省事可直接给 `roles/editor`(覆盖上表大部分),但生产建议按上表收窄。

**(b) Cloud Run 运行时服务账户**(容器自身) —— 只有读密钥需要:

| 角色 | 用途 |
| --- | --- |
| `roles/secretmanager.secretAccessor` | 读 `--set-secrets` 注入的 `LLM_API_KEY` / `AGENT_SECRET` |

若用默认计算 SA,执行一次:
```bash
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

**(c) Cloudflare Worker 调用 Cloud Run** —— 现在用共享密钥(`X-Agent-Secret`),Cloud Run 允许未认证访问即可,**不需要任何 GCP IAM**。

> 可选收紧(路线图):建一个调用方 SA 带 `roles/run.invoker`,Worker 换取其 ID token 调用。代价是 Worker 侧要管理该 SA 的凭据,当前不做。

### 9.4 回滚

- Worker 回退版本(`wrangler rollback`)即可;Cloud Run 独立无状态,回退 = 部署上一镜像。

## 10. 明确不做(路线图)

- **显式的「失败断点续跑」**:交给 coding agent 自身在单次执行内重试/续写;v1 的 `sections_json` 断点复用机制在 v2 废弃(不再写该字段,"失败后续聊续跑"入口自然失效)。
- 多 agent 编排 / 子代理;pi 扩展与技能市场。
- ~~生成产物迁 R2(仍存 D1 TEXT)~~ → 已转为**计划项**,见 §13(多文件产物的源码树与构建产物走 R2)。
- Cloud Run 侧做 D1 直连或本地库:持久化一律回 CF。
- OIDC 双向鉴权、VPC egress 白名单、`--min-instances>0` 常驻预热。

## 11. 当前部署状态(已跑通)

| 组件 | 值 |
| --- | --- |
| Cloudflare Worker | `forge-v2` → `https://forge-v2.needle.workers.dev` |
| D1 | `forge-v2`(`6fd724ad-b430-4d2b-9eae-6353c6dbde56`) |
| Cloud Run Service | `forge-agent`(us-central1)→ `https://forge-agent-323709989821.us-central1.run.app` |
| GCP 项目 | `sixth-impulse-286413`(项目号 `323709989821`) |
| 运行时 SA | 默认计算 SA `323709989821-compute@developer.gserviceaccount.com` |
| 镜像 | `us-central1-docker.pkg.dev/sixth-impulse-286413/cloud-run-source-deploy/forge-agent` |
| 规格 | 1 vCPU / 1GiB,`--timeout=1800 --concurrency=1 --min-instances=0` |
| Secrets | `llm-api-key` → `LLM_API_KEY`;`agent-secret` → `AGENT_SECRET`(Secret Manager,经 `--set-secrets` 注入) |
| Worker Secrets | `AGENT_SECRET`;可选 `ADMIN_PASSWORD`(后台口令)、`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`(Google 登录,缺一即不启用) |
| R2 | `forge-v2-artifacts`(绑定 `ARTIFACTS`):构建产物 `p/{projectId}/v/{versionNo}/*` 与生成应用上传对象 |
| KV | `forge-v2-appdata`(绑定 `APPDATA`):生成应用键值存储,键 `p:{projectId}:{env}:{key}` |
| Durable Object | `PROJECT_DB`(类 `ProjectDb`):生成应用的文档数据 + owner SQL 控制台,每项目 × 每环境一个独立 SQLite 实例,名 `${projectId}:${env}` |

### 11.1 STAGING(与生产完全隔离,2026-10-17 搭建)

测试环境用于「先在 staging 开发验证,再上线」:两套环境**资源全隔离、代码同源**(同一仓库、同一份 `web/dist`、同一份 `agent/` 源码),差异只在部署目标与少量配置。完整说明见 §16。

| 组件 | 生产 | staging |
| --- | --- | --- |
| Cloudflare Worker | `forge-v2` → `forge-v2.needle.workers.dev` | `forge-v2-staging` → `forge-v2-staging.needle.workers.dev` |
| wrangler 环境 | 顶层(不带 `--env`,`npm run deploy`) | `env.staging`(`npm run deploy:staging`) |
| D1 | `forge-v2`(`6fd724ad-…`) | `forge-v2-staging`(`da94e0ba-…`) |
| R2 | `forge-v2-artifacts` | `forge-v2-artifacts-staging` |
| KV | `f6b66c90…` | `67e46b44…` |
| Durable Object | 独立 namespace(Worker `forge-v2`) | 独立 namespace(Worker `forge-v2-staging`) |
| Cloud Run Service | `forge-agent`(`--max-instances 5`) | `forge-agent-staging`(`--max-instances 1`) |
| LLM key | Secret `llm-api-key` | **复用** `llm-api-key`(同一把) |
| 内部密钥 | Secret `agent-secret` | Secret `agent-secret-staging`(**另一把**) |
| Cron | `* * * * *`(仅巡检本环境任务) | `* * * * *`(仅巡检本环境任务) |
| 环境标识 | 不设 `ENVIRONMENT`(前端按 production,无角标) | `ENVIRONMENT=staging`(前端显示琥珀色 STAGING 角标) |

> 多文件产物引入后需额外两步:**(1)** `npx wrangler kv namespace create forge-v2-appdata` 并把返回的 id 填进 `wrangler.jsonc` 的 `APPDATA.id`(当前是占位符,不填无法部署);**(2)** 对已存在的 v2 库执行一次 `schema.migrate-multifile.sql`(重建 `versions`/`jobs`,不保留旧单文件产物与任务历史)。全新安装直接 `schema.sql` 即可。之后 `npm run deploy` 部署 Worker;Cloud Run 侧因 Dockerfile 现在会预装 `template/` 依赖,需重新 `gcloud run deploy` 一次。

> 启用 Google 登录另需一步:对已存在的 v2 库执行一次 `schema.migrate-google.sql`(`npm run db:migrate:google:remote`),新增 `users.google_sub` 及其唯一索引;不启用可跳过(登录页自动隐藏 Google 按钮)。

**已启用的 API**:`run` / `cloudbuild` / `artifactregistry` / `compute` / `secretmanager`。

**已具备的 IAM**:执行部署的账号 `ttswhh@gmail.com` 在该项目是 `roles/owner`(无需再加权限);运行时默认计算 SA 已含 `secretmanager.secretAccessor`(读注入的密钥)、`artifactregistry.writer`、`logging.logWriter`、`iam.serviceAccountUser`、`run.admin`、`editor`。

**端到端验证(多文件)**:`generate`(极简番茄钟)→ Cloud Run agent 写多文件 React 源码 → 平台 `vite build` → commit 回调落版本(`src_json` 进 D1、`dist` 进 R2、`manifest` 生成)→ 预览 `GET /p/:token/` 200 → `publish` → `GET /s/:slug/` 200,入口注入 `window.__FORGE_API_BASE__="/s/:slug/api"`,Vite 哈希资源(`assets/*.js|css`)按长缓存命中,`/s/:slug/api/db/:collection` 200。全链路贯通。

## 12. 管理后台(只读)

跨用户查看全部产物的后台,与普通用户体系**完全隔离**:口令来自 `ADMIN_PASSWORD` secret,`POST /api/admin/login` 校验后下发由口令派生的 HttpOnly cookie(`lib/admin.ts`,改口令即全体失效,无需会话表)。

- 页面:`/admin`(产物列表:属主、状态、版本/对话/数据计数、公开链接,支持关键字搜索与分页,含全站统计);`/admin/projects/:id`(详情:全部版本源码 + iframe 预览 + 公开链接、对话记录、任务与 **agent 流式日志**尾部、站点数据);`/admin/users`(用户使用情况列表,按邮箱搜索、分页);`/admin/users/:id`(单个用户详情)。「数据计数」= 该项目两个环境 SQLite 各表行数之和,实时统计(页大小上限 20 以控制子请求)。顶栏在「产物 / 用户」间切换,产物列表的属主邮箱、用户详情的项目行互链。
- **用户使用情况**(`/admin/users`、`/admin/users/:id`):每个注册用户一行,聚合「核心用量」(项目数、正式版本数、对话消息数、任务数(生成/对话、成功/失败))、「积分」(余额 credits;已消耗 ≈ 成功任务数,每次成功 commit 扣 1)、「活跃度」(注册时间、最近活跃 = 最后一次任务时间、近 7/30 天任务数)、「产物体量」(构建产物总字节 = 各正式版本 `bytes` 之和;数据行数按项目读两个环境的独立 SQLite 求和,仅在用户详情页按该用户的项目集计算以控制子请求)。聚合走 `users` 上的关联子查询,任务量以 `jobs` 表为准。
- 接口(除 login/logout/me 外全部 `requireAdmin` 只读):`GET /api/admin/{me,stats,projects,projects/:id,projects/:id/versions/:no,projects/:id/data/:env/:collection,users,users/:id}`;`POST /api/admin/{login,logout,migrate-doc-data}`。数据行取自项目该环境的独立 SQLite 库(§15)。`stats` 除项目/用户/版本外,含任务总数、成功/失败数、近 7 天任务数与近 7 天活跃用户数。
- 配置:`npx wrangler secret put ADMIN_PASSWORD`(未设置则后台整体不可用)。

## 13. 产物形态与选型(多文件 / 全栈)

> 本章的**阶段一已落地**:产物从「一个版本 = 一段 HTML」升级为**多文件 React 应用**(源码树 + 构建产物),后端由平台通用数据 API 承载,整套跑在 Cloudflare 上。

### 13.1 结论(拍板)

| 维度 | 决定 |
| --- | --- |
| 前端 | **Vite + React(SPA)**,构建为静态产物 `dist/` |
| 后端 | **同一 Worker 内 Hono 路由**;绑定限定 **D1(平台元数据)/ KV / R2 / 每项目每环境独立 SQLite(Durable Object)** |
| 交付 | 阶段一 = 平台单 Worker 承载(共享资源按项目命名空间隔离);阶段二 = 每产物一个 Workers for Platforms 用户 Worker |
| 预览 | **保留静态即时预览**(SPA 产物即静态文件,`html_preview` 语义可延续) |
| 存储 | 源码树 + 构建产物 → **R2**;D1 只留平台元数据(项目/版本/任务/消息);**生成应用的数据 → 每项目 × 每环境一个独立 SQLite(见 §15)** |

### 13.2 为什么不做 SSR

SSR 让**产物应用本身**更简单(前后端合一、loader 直连 D1、无 API 契约),但让**平台侧**更重:

1. **平台绑死框架**:SSR 产物是框架的 server bundle + 适配器,平台要把某个框架的 runtime 搬进用户 Worker,升级/适配/各框架的坑都归平台。
2. **丢即时预览(最大隐性成本)**:现有「agent 写一点、预览长一点」依赖单份静态 HTML;SSR 没有单份 HTML,要预览就得把 server 跑起来。
3. **agent 生成成功率下降**:元框架约定多(loader vs action、server-only 模块、hydration),越厚越易写错。

对照(结论:现阶段选左列):

| | **SPA + Hono API(选定)** | SSR 元框架(Remix/SvelteKit/Astro) | Hono + JSX(最薄 SSR) |
| --- | --- | --- | --- |
| 应用心智 | 前后端两块 + 固定契约 | 一块 app | 一块 Worker |
| 平台承载复杂度 | 低(只发文件) | 高(绑框架 runtime) | 中 |
| 即时静态预览 | ✅ | ❌ | ⚠️(需一次渲染) |
| 交互丰富度 | 高 | 高 | 中(需 islands) |
| agent 生成难度 | 中 | 高 | 低 |

### 13.3 "SPA + Hono" 不等于"维护 API 契约"

这里的后端是**平台提供的通用能力**(D1/KV/R2 按项目命名空间化),**不是**每个项目手写的一套接口。agent 只调固定端点(读写集合、键值、对象),所以不存在"每项目都要设计前后端契约"的负担——这正是当初担心 SSR 复杂度的那个点被规避掉的地方。

### 13.4 存储与数据模型演进

- `versions.html TEXT` → **版本 = 文件树(路径→内容)+ 构建产物引用**;大对象进 R2,D1 只存元数据(`manifest`、`build_hash`、`artifact_ref`、`deploy_version`)。
- 管理后台「版本源码」页从**单份 HTML** 升级为**文件树浏览 + 每个文件预览 + 构建产物 + 已部署 URL**(§12 需相应扩展)。

### 13.5 阶段划分(避免一步到位)

- **阶段一(小改,验证框架可行)**:固定 Vite+React 框架 + 多文件;后端仍是**平台通用数据 API**(`/api/app/:slug/*` 代理 D1/KV/R2,按项目命名空间);产物存 R2;预览/发布/后台升级为文件树。agent **不部署** Worker。
- **阶段二(真正的"整套跑在 CF")**:接 **Workers for Platforms**,把每个项目的后端打包成独立用户 Worker 部署,绑共享资源,挂 `{slug}.域名`。
- 阶段一的价值:不改执行模型就把交付链路升级成多文件,正好是阶段二的地基。

### 13.6 保留后路(尚未决定)

- 若将来要 SSR / 统一全栈:**Remix / React Router v7**(Cloudflare 一等支持),接受平台绑框架 + 预览改为"跑预览 Worker"。
- **SSG 桥**:用支持 SSG 的框架,在 agent 容器里构建时把各路由渲染成静态 HTML——保留统一开发模型,又留住静态预览/发布链路;代价是动态数据退回客户端调平台数据接口。
- **自定义域名**:暂不做(未来付费增值能力;届时仍需 Cloudflare for SaaS)。

### 13.7 阶段一实现落点(已落地)

**数据模型**
- `versions`:`src_json`(源码树 `路径→内容`,交付/续聊基线)+ `manifest_json`(入口、`buildHash`、字节数、产物文件清单)+ `bytes`;构建产物本体在 R2(`p/{projectId}/v/{versionNo}/{path}`)。
- `jobs`:新增 `files_preview`(agent 最近写入的源文件 `{path,content}`,前端流式看代码),取代单文件时代的半成品 HTML。

**执行链路(agent/Cloud Run)**
- `agent/template/`:预装 Vite + React + Tailwind + `src/lib/forge.js`(db/kv/blob SDK)的脚手架,Dockerfile 在构建期 `npm install` 其依赖,运行期每 job 拷贝模板 + 符号链接 `node_modules`(不再运行期安装)。
- `agent/src/prompt.ts`:system 约定多文件 React 产出规范;generate 先写 `plan.json` 再实现应用,chat 在既有源码树上改。
- `agent/src/runner.ts`:拷模板 → 预写当前源码(chat)→ 跑 pi 会话 → **平台侧确定性 `vite build`** → 收集 `src`(源码树,跳过 node_modules/dist/plan.json/package-lock.json)+ `dist`(构建产物)+ `manifest`。
- commit 回调回传 `{src, dist, manifest, plan}`;Worker 侧 `commit.ts` 把 `src` 写 D1、`dist` 写 R2、生成并落 `manifest`。

**服务与后端 API**
- `src/routes/serve.ts`:`/s/:slug/*`(发布,env=live)与 `/p/:token/*`(草稿预览,env=draft,HMAC 令牌绑定 project+version)服务 R2 里的构建产物;入口 HTML 注入 `window.__FORGE_API_BASE__` 指向同源 `/api` 子路径;`assets/` 长缓存,其余 no-store;SPA 兜底回退入口。
- `src/lib/appdata.ts`:平台通用数据 API,同一套端点覆盖文档集合(`/db/:collection`)、KV 键值(`/kv/:key`)、R2 对象(`/blob/:key`),按项目 + 环境(draft/live)命名空间隔离,响应带 CORS(页面跑在 sandbox opaque origin)。其中 `/db` 的存储已从共享 D1 的 `site_data` 迁到每项目每环境的独立 SQLite(见 §15),HTTP 契约不变。
- `src/lib/projectDb.ts`:每项目 × 每环境一个 Durable Object(绑定 `PROJECT_DB`,类 `ProjectDb`,`new_sqlite_classes`),实例名 `${projectId}:${env}`;承载 `/db` 文档接口(集合 → 一张固定列的表)与 owner 的 SQL 控制台(任意 DDL/DML/索引)。

**前端**
- 工作台 `PreviewPane`:`预览` 用 `/p/:token/` iframe(取代 srcDoc 单 HTML),`代码` 在生成中展示 agent 实时写入的文件、完成后展示构建产物清单,`数据`(DataPanel)含 **键值 / 对象 / SQL** 三个页签,均按测试/线上环境隔离;其中 SQL 页即 DBeaver 风格的表数据网格 + SQL 编辑器(所有表都在这里)。
- 管理后台 `AdminProject`:版本详情从「单份 HTML」升级为**文件树浏览 + 逐文件源码预览**;每个版本由后台签发草稿令牌,可直接用 `/p/:token/` 预览任意历史版本。
## 14. 版本能力(用户侧)

每次「生成」或「对话修改」都会产出一个**新版本**,历史版本永久保留、互不覆盖。

- **编号**:新版本号 = `MAX(version_no) + 1`(不是 `current_version + 1`)。这样即使把某个旧版本「恢复」为当前版本后再继续修改,新版本也排在最后,不会与既有版本号冲突。
- **基线**:对话修改始终以「当前生效版本」(`projects.current_version`)的源码为基线;查看历史版本不会改变基线,只有「恢复」才会。
- **切换查看**:工作台预览工具栏的版本下拉可查看任意历史版本(预览 + 源码同步切换),`(当前)` 标记生效版本。
- **恢复**:「恢复 vN 为当前版本」把 `current_version` 指向该版本,发布页 `/s/:slug` 随之更新;可反复切换。生成任务进行中禁止切换(避免与落定的乐观锁竞争)。
- **发布**:「发布」作用于当前生效版本;查看历史版本时该按钮禁用,需先恢复。
- **交付/导出**:`GET /api/projects/:id/versions/:no/export` 把该版本源码树打成 zip(`src/lib/zip.ts`,零依赖仅存储压缩),下载即可本地 `npm install && npm run build` 运行或另存交付。

### 14.1 生成应用的数据能力(修正)

- 平台数据 API 的写操作(POST/PUT/DELETE)此前因 `serve.ts` 只注册了 `app.get` 而全部 404,导致生成应用"新增后列表为空、统计为 0"。已改为 `app.all`,并新增 `PUT /db/:collection/:id`(合并式更新,支撑"标记完成")。
- 模板新增 `src/lib/store.js` 的 `useCollection(collection)`:统一管理列表状态,`add/update/toggle/remove` 后自动重拉,列表与所有统计从同一份 `items` 派生;prompt 明确要求"状态联动"并在结束前按真实点击流程自查。

## 15. 数据层:每项目 × 每环境的独立 SQLite(Durable Object)

### 15.1 结论

- 生成应用的数据(原共享 D1 表 `site_data` 的「文档集合」)迁到**每项目 × 每环境一个独立 SQLite 库**,由 Durable Object 承载。
- 绑定 `PROJECT_DB`,类 `ProjectDb`;wrangler 迁移 `{ "tag": "v1", "new_sqlite_classes": ["ProjectDb"] }`(类名一经部署即固化,不可随意改名)。
- 实例名 `${projectId}:${env}`(env ∈ `draft`/`live`)。项目之间、测试/线上之间是**物理隔离**,不靠 `WHERE` 过滤;库在第一次被访问时自动创建。

### 15.2 为什么

- 用户诉求:给生成应用真正的 SQLite 能力(建表 / 建索引 / 原生 SQL),而不是平台封装的一层"文档 JSON"。
- 物理隔离比"共享表 + `project_id` 列过滤"更强,且每库可独立演进 schema、独立销毁。
- 执行/计费模型不变:仍是 Cloudflare 绑定,不引入新服务。

### 15.3 两类入口

| 入口 | 鉴权 | 说明 |
| --- | --- | --- |
| 生成应用 `/db/:collection`(`/s/:slug/api`、`/p/:token/api`) | 公开(CORS,无 cookie) | `GET/POST/PUT/PATCH/DELETE`;集合 → 一张固定列的表 `(id, data JSON文本, created_at, client_ip)`;HTTP 契约与旧 `site_data` 完全一致,已生成的应用无需改动;带频控与 500 行上限 |
| owner SQL 控制台 `/api/projects/:id/sql`、`/schema` | 登录 + 属主 | 在该环境库上执行任意 SQL(DDL/DML/索引),并列出表 / 索引 / 视图与行数;不做语句白名单——用户只能碰到自己项目、自己环境的库 |

DO 内部按 op 分发:`exec` / `schema` / `db.list|add|update|remove|collections` / `seed` / `seeded` / `destroy`。

控制台 UI 是 **DBeaver 风格**:左侧「库结构」树,点表名即在右侧网格翻页浏览;点击单元格就地编辑(Enter 提交 / Esc 取消)、可「新增行」、按行「删除」。行定位基于 `rowid`(`SELECT rowid AS __rowid, *`),`WITHOUT ROWID` 表自动退回只读浏览。切到「SQL 编辑器」可写任意语句。上述所有操作都走 `/sql` 端点(带参数绑定,标识符一律安全引用),不新增后端接口。生成应用写的文档集合(表)也直接出现在这棵结构树里,所以**不再单独提供「文档」页签**——SQL 一页即可浏览/编辑所有表。

### 15.4 隔离与清理

- 测试环境(draft)= 预览页 `/p/:token/api` 写入;线上环境(live)= 发布页 `/s/:slug/api` 写入;两者互不可见。
- KV / R2 仍是共享资源 + 前缀(`p:{projectId}:{env}:` / `appdata/{projectId}/{env}/`),与 SQLite 采用同一套"项目 × 环境"隔离口径。
- 删除项目时 `deleteProjectAppData` 清 KV 前缀 + R2 前缀 + `destroyProjectDb`(两个环境各 `deleteAll`)。

### 15.5 迁移(一次性,幂等)

旧 D1 `site_data` 的存量行需回填进 SQLite。迁移后 D1 `site_data` **只读、不再写入**。

```bash
# 1) 登录后台拿 cookie
curl -s -c /tmp/a.jar -X POST https://forge-v2.needle.workers.dev/api/admin/login \
  -H 'Content-Type: application/json' -d '{"password":"<ADMIN_PASSWORD>"}'

# 2) 回填全部;加 ?projectId=xxx 只迁一个项目
curl -s -b /tmp/a.jar -X POST https://forge-v2.needle.workers.dev/api/admin/migrate-doc-data
```

返回 `{groups, rows, errors}`;`rows` 为回填行数(按 `INSERT OR IGNORE` 幂等,重复跑不产生重复)。

### 15.6 与旧实现的差异(用户可见)

- 工作台「数据」页签从 **文档 / 键值 / 对象 / SQL** 收敛为 **键值 / 对象 / SQL**:文档集合不再是独立页签,改在「SQL」的结构树里以表的形式浏览/编辑(DBeaver 风格),与生成应用读的是**同一个库**。
- 移除了 owner 的 `/api/projects/:id/data/*` 一组接口(仅原「文档」页签使用),后端不再有第二条文档数据通路。
- D1 `site_data` 停写:仅作为迁移的历史源保留。
- 管理后台产物列表的「数据」列改为实时统计两个环境 SQLite 的行数之和。
- 生成应用侧 HTTP 契约完全不变(`db/:collection` 的请求 / 响应形态一致),无需重新生成即可继续使用。

## 16. STAGING 环境(与生产完全隔离)

### 16.1 目标与原则

「先在 staging 开发验证,确认没问题再上线」。两套环境**代码同源**(同一仓库、同一份构建产物、同一份 `agent/` 源码),资源**全隔离**,互不读写、互不覆盖。生产配置在 `wrangler.jsonc` 顶层,一字未动;staging 全部落在 `env.staging` 块与独立的 GCP 服务里。

### 16.2 Cloudflare 侧(`wrangler.jsonc` 的 `env.staging`)

wrangler 的规则:**绑定类配置(`vars` / `d1_databases` / `kv_namespaces` / `r2_buckets` / `durable_objects` / secrets)不可继承,必须在每个环境里显式声明**,漏声明不会在部署时报错,而是运行时 `c.env.XXX` 为 `undefined`(例如漏 `PROJECT_DB` 会让生成应用的 `/db` 接口和数据面板直接 500)。`main` / `compatibility_date` / `assets` / `migrations` / `triggers` 可继承,故意不重复,以免两边漂移。

```bash
# 一次性:建独立资源并把 id 填进 wrangler.jsonc 的 env.staging
npx wrangler d1 create forge-v2-staging          # → da94e0ba-7f9c-48ce-96ca-3160975bf8da
npx wrangler r2 bucket create forge-v2-artifacts-staging
npx wrangler kv namespace create forge-v2-appdata-staging   # → 67e46b44ce224ff9a4ea2af583dead21
npm run db:init:staging                          # 幂等初始化 schema
npm run db:migrate:google:staging                # 如需 Google 登录(新增 users.google_sub)
npx wrangler secret put AGENT_SECRET --env staging
npx wrangler secret put ADMIN_PASSWORD --env staging
npm run deploy:staging                            # 构建前端 + 部署 Worker forge-v2-staging
```

- 环境名即 Worker 名:`env.staging.name = "forge-v2-staging"`,遵循官方 `<顶层名>-<环境名>` 规则。
- **生产部署守卫**:`npm run deploy` 带 `predeploy` 钩子(`scripts/guard-prod-deploy.mjs`),两道检查,任一不满足即中止:**(1) 当前分支必须是 `main`**;**(2) 工作区必须干净**(无未提交改动)。即生产只允许从「已验收并已提交的 main」部署。staging **故意不挂**该守卫,任何分支都能发到测试环境,用 `npm run deploy:staging`。
- `npm run deploy` 显式写成 `wrangler deploy --env=""`,在多环境配置下明确指向顶层(生产),避免 wrangler 的裸 `deploy` 交互警告。

### 16.3 Google Cloud 侧(同项目内独立 Cloud Run 服务)

不新建 GCP 项目,在同项目 `sixth-impulse-286413` 内新建服务 `forge-agent-staging`,与 `forge-agent` 并列、镜像互不覆盖。

- **LLM 密钥复用**同一把 Secret `llm-api-key`(省钱;隔离靠服务边界,不靠密钥)。
- **内部密钥另建**:Secret `agent-secret-staging`,与生产的 `agent-secret` 不同值 → 生产 Worker 的预览令牌(HMAC over `AGENT_SECRET`)在 staging 校验必然失败,反之亦然,天然挡住跨环境令牌。
- **成本上限钉死**:`--max-instances 1`,同一时刻最多一个 job;`AGENT_MAX_RUN_MS` 与生产一致(1500s,必须 < `--timeout 1800`)——**不要把 staging 的运行上限调得比生产小**,否则正常的多文件生成会被自身超时掐死(初版设 300s 即踩过,失败信息「Agent 执行超时(上限 300s)」),失去验证价值。真正的滥用闸门是 `--max-instances 1`,不是把超时切短。
- 部署脚本:`npm run agent:deploy:staging` / `npm run agent:deploy:prod`(参数唯一来源)。

### 16.4 环境角标(前端如何区分)

生产与 staging **共用同一份 `web/dist`**,所以环境名只能**运行时下发**,不能用 Vite 构建期变量(否则会把 staging 角标打进生产包)。实现:staging 的 `vars` 里设 `ENVIRONMENT=staging`,生产不设 → `GET /api/auth/config` 回落 `environment: "production"`;前端 `<EnvBadge>`(挂在 `TopBar` / `AdminBar` / `Landing` / `Login`)取到非 production 才渲染琥珀色 `STAGING` 角标。

### 16.5 隔离验证(2026-10-17 实测结论)

| 检查项 | 结果 |
| --- | --- |
| D1 数据隔离 | 生产 `users/projects/versions/site_data = 13/26/36/3`;staging 初始全 0。staging 跑完一次 E2E 后为 `1/1/1`,生产计数**分毫未变** |
| R2 产物隔离 | `forge-v2-artifacts` 20 个对象(生产项目)、`forge-v2-artifacts-staging` 仅 3 个(E2E 项目),互不出现 |
| Durable Object 隔离 | 独立 Worker ⇒ 独立 DO namespace;staging 生成应用的 `/p/:token/api/db/:collection` 返回 200(绑定已接好,漏配会 500),同一 token 在生产的同路径 404 |
| 跨环境预览令牌 | staging 令牌在 staging `GET /p/:token/` = 200;同一令牌在**生产** 404(`AGENT_SECRET` 不同) |
| 生产未被动过 | 生产线上仍服务旧构建 `assets/index-BRvPdKmy.js`(未重新部署),`/api/auth/config` 仍返回 `{"google":true}` 无 `environment` 字段 |
| Cron 独立 | CF API 显示 `forge-v2` 与 `forge-v2-staging` 各有独立 `* * * * *` schedule,各自只巡检本环境任务 |
| 端到端 | staging 注册 → 建项目 → `generate` → Cloud Run `forge-agent-staging` 写多文件 React → 构建 → commit 落版本(draft `version_no=0`,307834 B,20 个源文件)→ `GET /p/:token/` 200。全程只写 staging 的 D1/R2 |

### 16.6 状态与注意

- **staging Google 登录已启用(2026-10-17)**:`GET /api/auth/config` = `{"google":true,"environment":"staging"}`。做法是在同一 OAuth 客户端(项目 `sixth-impulse-286413`,ID `323709989821-17kuk1ul970tl0sp16gsk4csli6peljm`)追加回调 URI `https://forge-v2-staging.needle.workers.dev/api/auth/google/callback`,再给 staging Worker 写入 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`(与生产同值)。校验:`GET /api/auth/google` 302 → `accounts.google.com/v3/signin/identifier`,无 `redirect_uri_mismatch`,说明 client + 回调白名单都生效。
- ⚠️ **Worker secret 只写不可读**:生产那两个值无法被任何环境「读取后复制」。wrangler 实际写入方式一直是 `printf '%s' "$值" | npx wrangler secret put …`(日志里 `secretSource: stdin` / `isInteractive: false`,见 `~/Library/Preferences/.wrangler/logs/`),所以 shell 历史里查不到值——换新环境时只能由**持有原始 secret 的人**再输入一次,或给该环境另建一个 OAuth 客户端。
- staging D1 里留有本次 E2E 的 1 用户 / 1 项目 / 1 版本(测试环境,可保留或按需清)。

### 16.7 分支模型与上线流程

**staging 分支开发测试 → 验证通过合并到 `main` → 从 `main` 上线。** 环境隔离(§16.2/§16.3)与分支是**两条独立的轴**:分支决定「跑的是哪份代码」,wrangler 环境决定「代码跑在哪套资源上」。两者组合出的日常流程:

```bash
# 1) 在 staging 分支开发
git switch staging
# ...改代码...
npm run typecheck && npm run build

# 2) 发到测试环境验证(任何分支都可发;不走生产守卫)
npm run deploy:staging          # Worker forge-v2-staging
npm run agent:deploy:staging    # 只在改了 agent/ 时需要

# 3) 验证没问题 → 合并到 main
git switch main && git merge staging && git push origin main

# 4) 从 main 上线生产(predeploy 守卫:必须是 main 且工作区干净)
npm run deploy                  # Worker forge-v2
npm run agent:deploy:prod       # 只在改了 agent/ 时需要
```

要点:

- **`main` 是「可上线」基线**:`main` 上的每个提交都应该是已验收、可随时部署的;不直接在 `main 上攒未验证的改动。
- **守卫只拦生产**:`npm run deploy` 前置检查「分支 = main」+「工作区干净」(`scripts/guard-prod-deploy.mjs`)。`npm run deploy:staging` / `agent:deploy:staging` 不加任何守卫——未提交、未合并的改动正是要靠它验证。
- **staging 与 main 共用同一份 `web/dist` 和 `agent/` 源码**:所以「代码在 staging 上跑通」不能靠构建期差异,环境差异只允许来自 §16.2/§16.3 的配置(绑定、`ENVIRONMENT`、Cloud Run 服务名与规格)。任何「只在某一环境生效」的行为都必须用运行时配置表达。
- **前端环境角标**(§16.4)就是这条纪律的护栏:在 staging 域名看到琥珀色 `STAGING`,在 `forge-v2.needle.workers.dev` 看到干净顶栏。
