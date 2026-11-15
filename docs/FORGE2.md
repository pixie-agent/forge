# Forge 2.0 Design: Cloudflare Orchestration + Cloud Run for the Agent

> This document records both the historical decisions and the instance configuration of the Pixie Agent maintenance environment; it is not a self-hosting deployment template. For external deployments, start from [`wrangler.example.jsonc`](../wrangler.example.jsonc) and [`docs/SELF_HOSTING.md`](SELF_HOSTING.md); do not reuse the resource names, IDs, domains, or service addresses in this document.

> Goal: take "the process where the Agent actually interacts with the AI" out of the Cloudflare Worker and put it into an environment that **has a filesystem, can run commands, and is destroyed after execution** (a Google Cloud Run Service), while everything else (frontend, auth, job status, progress subscriptions, publishing, site data) stays on Cloudflare. The old production service (production Worker `forge` / the historical `forge-v2` semantics in this repo's history) is unaffected.

## 1. Why a Cloud Run Service, not Cloud Functions

| Dimension | Cloud Functions | Cloud Run Service |
| --- | --- | --- |
| Can run commands / has a filesystem | Gen2 can, but the execution model is a "function", unsuitable for a long-lived agent loop | **Yes**: arbitrary commands in the container; `/tmp` writable, custom image |
| Custom binaries (pi CLI / node / git) | Restricted | **Completely free** (custom Dockerfile) |
| Execution duration | Capped; long tasks must be split | Request timeout **up to 60 minutes**; one request runs an entire generation |
| Ephemeral, destroyed after use | Yes | **Yes** (scales to 0; `--min-instances=0`) |
| Egress traffic billing | Pay per use after a free quota | Same; egress billed per GiB (see §7) |

Conclusion: **use a Cloud Run Service**. One generation = one HTTP request; when the request ends the instance scales to 0, which is naturally "ephemeral, destroyed after execution".

## 2. Responsibility Boundaries (decided)

- **Cloudflare Worker `forge-v2`** (new project space, new D1): frontend Assets, `/api/auth`, `/api/projects`, `/api/jobs` (SSE + polling), `/s/:slug` publishing, `/api/site` site data, **job dispatch (`waitUntil`) + internal callbacks + cron heartbeat inspection**. **Runs no LLM calls at all.**
- **Google Cloud Run Service `forge-agent`**: the sole AI-interaction executor. Uses the **pi coding agent** to write code in an isolated working directory (with `read/write/edit/bash` tools), then runs `vite build` on the platform side and hands the source tree plus build artifacts back.
- **Boundary rule**: persistence of artifacts, versions, credits, messages, and all **permission logic stay on Cloudflare only**; Cloud Run only returns raw artifacts (`src`/`dist`/`manifest`/`plan`) and progress.

## 3. Data Flow

```
Browser ──POST /api/projects/:id/generate──► Worker (create job=pending, return {jobId} immediately)
                                             │
                        async dispatch inside waitUntil (does not block the response; disconnection is fine)
                                             │  POST https://forge-agent/run (X-Agent-Secret)
                                             ▼
                                   Cloud Run instance (one per job; one request held until the run finishes)
                                     ├─ Create /tmp/workspace/<jobId>, write current state (chat carries the current source tree)
                                     ├─ Start a pi AgentSession (custom provider pointing at the OpenAI-compatible gateway)
                                     ├─ Event stream → POST {PUBLIC_BASE_URL}/internal/jobs/:id/progress  (progress/plan/current file preview + heartbeat)
                                     ├─ Before finishing, vite build produces dist
                                     └─ On finish → POST /internal/jobs/:id/commit (success, returns src/dist/manifest/plan)
                                                   or POST /internal/jobs/:id/fail (failure, returns error)
                                     ← Inspection GET /internal/jobs/:id/state (every 5s; agent aborts on its own when the user stops, see §4)
                                             │
                       In the commit callback: write the version, optimistic-lock push of current_version, append the assistant message, deduct credits (idempotent)
                                             ▼
Browser ──SSE/polling /api/jobs/:id──► reads the status from D1 (the Worker merely pushes the status to the frontend)
           └─ Stop → POST /api/projects/:id/cancel ──► Worker sets cancelled on the spot (project unlocks immediately)
```

### Why not use Workflows to hold the HTTP request open

Cloud Run's request-based billing (cheap, scales away when idle) requires that **CPU is allocated only while a request is running**, so the HTTP request to Cloud Run must be held until the agent finishes. We once used Workflow steps to hold it (see git history), but the step timeout ceiling cannot cover long generations, and it adds another layer of orchestration state. Key observation: **Cloudflare's outbound requests from the Worker get cut off on timeout (524), but the cutoff does not affect Cloud Run continuing to run** — as long as the handler has not returned, Cloud Run keeps executing and holds CPU. Therefore:

- Worker side: `generate`/`chat` fire `POST /run` inside `waitUntil`, **without waiting for or blocking** the response to the browser; the connection being cut doesn't matter.
- Cloud Run side: one `/run` request = the full lifecycle of one job, `--timeout=3600`, `--concurrency=1` (one request per instance semantics).
- Delivery is governed by the **commit / fail callbacks** (not the HTTP response body); dispatch failures or instance anomalies are caught dead by the cron heartbeat inspection.

## 4. Progress Protocol

Reuses the existing `jobs` table's `stage/progress/plan_json/files_preview/agent_log` fields, plus `/api/jobs/:id` and `/api/jobs/:id/events`.

- **Acceptance state and failing early**: after the job is created, `status=pending` is kept and the frontend explicitly shows "connecting to the execution service"; the Agent's first heartbeat/progress callback atomically transitions the status to `running`. A clear `/run` non-2xx or invalid response immediately marks the job failed and refunds credits. If there is no clear response, job queries, SSE, and cron all proactively check: pending with no first callback 45s after creation is judged "execution service never accepted"; running with no heartbeat for over 180s is judged lost. This way, even when local `wrangler dev` doesn't run the scheduled cron, users keeping the page open or refreshing won't wait forever.

- Cloud Run subscribes to pi's events:
  - `agent_start` → `stage=planning`, `progress=正在规划方案`
  - First write of `plan.json` → fills back `plan_json` (frontend plan card)
  - Writing/modifying source files → `stage=coding`, `progress=正在编写 {path} · 已修改 {count} 个文件`, and the file's content becomes `files_preview` (frontend "Code" tab updates as files are written)
  - `vite build` before finishing → `stage=building`, `progress=正在构建应用产物`
  - **Design review round** (generate only, see §17.4): after the first draft builds successfully, the same session runs another round of "design-director review and polish" → `stage` **remains `coding`**, `progress=正在做设计总监复查与打磨` (when rebuilding it returns to `building`/`正在重新构建应用产物`), and a milestone line is appended to `agent_log`. **No new stage**: the stage whitelist in `src/routes/internal.ts` is `planning|coding|building`; adding a new value would just be silently ignored, and the payoff doesn't justify it.
  - `message_update` (per-token increments of thinking/body) + `tool_execution_start/end` → **written only to Cloud Run stdout** (batched every 5s; ops use `gcloud logging read` for troubleshooting); **no longer goes into D1**. D1's `agent_log` keeps only milestones (review round start/end, delivery-language re-ask, etc.) and alerts; the frontend shows only "stage + current file + number of files changed" — these key nodes. We once used per-token logs as a message bus, which in practice produced 36k `POST /log` calls and 73k D1 write rows per day that users never looked at.
- Callbacks go through the Worker's internal endpoints (validated with `X-Agent-Secret`), allowing only field-level updates, never touching the state machine:
  - `POST /internal/jobs/:id/progress`: progress / plan / current file preview / heartbeat
  - `POST /internal/jobs/:id/log`: milestone log increments; **atomic append** `agent_log = substr(COALESCE(agent_log,'') || ?, -20000)` keeps the tail, avoiding read-modify-write; the agent side serially flushes at ~800ms intervals and `stop()` flushes the remainder before the final state. **Do not immediately re-issue recursively after a flush completes**, otherwise D1 gets written once per network round trip (measured ~11 times/second).
  - `POST /internal/jobs/:id/checkpoint`: source tree checkpoint snapshot (see below)
  - `GET /internal/jobs/:id/state`: read-only `{status, cancelled, messages}`, used for the agent's cancellation inspection + steering pickup (see §5.2)
- **Checkpoint snapshots / resume after failure**: the agent uploads the whole source tree every 60s (only when the tree's SHA-256 changed) and during exceptional shutdowns; the Worker stores it in R2 at `cp/<projectId>/<jobId>.json`, and `jobs` records only `checkpoint_key/checkpoint_files/checkpoint_bytes/checkpoint_at` — source code never enters D1. On a successful commit the checkpoint for this run is deleted (along with the checkpoint of the older job referenced by the payload's `resumeOf`); on failure/stop it is kept 7 days and cleaned up by cron inspection. `POST /api/projects/:id/resume` reads the snapshot out and dispatches it as the `currentFiles` baseline of a new `chat` round — the agent continues on the files already written instead of rewriting everything from the template scaffold.
- The job's **terminal state** is settled only by the `commit` / `fail` callbacks (idempotent): success alone appends the assistant message + deducts credits; failure/judged-dead does not. Callbacks carry a guard (`WHERE status IN ('pending','running')`), so a late callback cannot resurrect a job already judged dead, but a late success ("commit arriving after it was judged dead") can still resurrect and deliver.
- **Manual stop (cooperative cancellation)**: the 4th terminal state, `cancelled`. The Worker cannot kill an in-flight Cloud Run request in reverse, so it is split into two segments:
  - **Worker side immediately**: `POST /api/projects/:id/cancel` (user-authenticated) → `cancelJob()` sets the active job to `cancelled` and appends an assistant message. `ACTIVE_STATUS_SQL` does not include `cancelled`, so **the project lock is released on the spot** (no need to wait for a heartbeat timeout — this is the most practical value of "stop"). No credit deduction, no version written.
  - **Agent side best-effort**: `GET /internal/jobs/:id/state` returns only `{status, cancelled}`; the agent polls every 5s (`startJobWatcher`, with `X-Agent-Secret`; the same inspection also picks up steering input, see §5.2). On seeing `cancelled` it calls `AbortController.abort()` to interrupt the current pi round, and `runJob` calls `throwIfCancelled()` after each phase. **This round's output does not enter the draft, but a checkpoint snapshot is force-written during exceptional shutdown** — the user can click "Resume from checkpoint" to continue, instead of losing everything.
  - Races: if cancellation happens first, the late commit is blocked by the guard as `already-settled` (it will not resurrect as success); if a cancel request lands in the instant a commit has already passed the guard, the draft may be updated while the job shows cancelled — an extremely small window; the artifact is still complete and usable, and it is not handled.
  - Frontend: while a job is running, "Send" is replaced by "■ Stop" (`ChatPanel`); once the server settles, SSE pushes `cancelled` and `Workspace.settle` clears the plan card/execution path (avoiding freezing into a fake success of "all three steps checked"), **keeping the last written file preview**; it then fetches `/job/active` once, and if a checkpoint exists shows a "Stopped; you can resume from checkpoint" card in the conversation.
  - Response latency: the user-visible "stopped" is immediate; on the Cloud Run side the actual wind-down and the last snapshot can lag by up to 5s (the inspection interval), so the frontend waits 3s when querying the checkpoint.
- The frontend's `subscribeJob` uses SSE (`/api/jobs/:id/events`); the fingerprint includes length changes of `files_preview/agent_log` → every append pushes a fresh snapshot.

## 5. Agent Form (pi coding agent)

- Installs `@earendil-works/pi-coding-agent@^1.5.0` inside the container and embeds it via its **SDK** (`createAgentSession`); no fork of pi. The old `@mariozechner/*` scope is deprecated and has unfixable security advisories; it was migrated to the maintained scope when the source-available preparation happened.
- The custom provider is declared via `models.json`, pointing at the existing gateway (`LLM_BASE_URL/LLM_API_KEY/LLM_MODEL`). **The gateway dialect is determined by `PI_LLM_API`**: `openai-completions` (default, OpenAI-compatible) / `anthropic-messages` (Anthropic-compatible) / `openai-responses`.
- **Current actual production values (measured 2026-10-17; the Cloud Run service's env is authoritative)**: `LLM_BASE_URL=https://api.deepseek.com/anthropic`, `LLM_MODEL=deepseek-flash`, `PI_LLM_API=anthropic-messages`, `PI_PROVIDER_ID=forge`, `PI_MODEL_REASONING=true` — i.e., DeepSeek's **Anthropic protocol** endpoint, not the OpenAI-compatible endpoint. The GLM/`zai` combination written earlier in the docs (`PI_THINKING_LEVEL/PI_THINKING_FORMAT=zai/PI_SUPPORTS_DEVELOPER_ROLE=…`) is **outdated** and only needed with the corresponding OpenAI-compatible gateway.
- Remaining tuning switches (see `agent/src/config.ts`): `PI_THINKING_LEVEL` (off…xhigh), `PI_MODEL_REASONING` (whether the model declares reasoning support), `PI_THINKING_FORMAT` (openai|zai|qwen|qwen-chat-template), `PI_SUPPORTS_DEVELOPER_ROLE` / `PI_SUPPORTS_REASONING_EFFORT` (default true; set false to route via system when the gateway doesn't recognize the `developer` role), `PI_MODEL_INPUT_IMAGE` (default false; only when true does the model declare image input support, see §5.1).
- Toolset: `createCodingTools(workspace)` (read/bash/write/edit), `sessionManager: inMemory`; each job gets a fresh session and a fresh working directory → discarded after use.
- The system prompt is injected via `DefaultResourceLoader({ systemPrompt })`: it stipulates a **multi-file React app** (Vite+Tailwind, responsive, no external images, real copy, `src/lib/forge.js` data interface); **the copy language follows the body of the user's request** (see §17.8), no longer hardcoded to Chinese.
  Starting 2026-10-17 the system prompt was extended to "design contract + component catalog + data layer + state coverage + self-check checklist" (~23 KB); the core is writing the **design system** and **component API** as a vocabulary the model can copy directly — see §17.
- **Mandatory restoration of platform-owned files**: `restorePlatformFiles()` overwrites `LICENSE` / `THIRD_PARTY_NOTICES.md` / `package.json` / `package-lock.json` / `index.html` / `vite.config.js` / `src/main.jsx` / `src/index.css` / `src/lib/*` / `src/components/ui/**` / `src/styles/**` back into the working directory from the template, at two moments — ① before the agent starts (rebuilding the platform directories together, wiping drift from the previous version's source); ② after each agent round and before build (overwrite only, no deletion, preserving files the model added). The sole exception is `src/styles/tokens.css` — the file where the model picks colors per `plan.palette`; it is preserved at all times. This way neither chat-version source drift nor the model's own drift can break the scaffold contract, the design system, or the backend SDK, and none of it enters the artifacts or the source tree.
- `generate`: first writes `plan.json` (→ frontend plan card), then implements the React components under `src/` per the plan.
- `chat`: the Worker puts the current source tree into the dispatch payload; Cloud Run pre-writes it into the working directory and prompts "change only what the request asks".
- Before finishing, the platform side runs `vite build` and returns the collected source tree + build artifacts + manifest (see §13.7); generate also runs a design review round after the build passes (see §17.4).
- New tuning switches: `AGENT_DESIGN_REVIEW` (`off|generate|always`, default `generate`; `generate` = run the review round only for from-scratch generation), `AGENT_POLISH_MAX_MS` (upper bound on the review round's duration, default 300000). **The defaults live in code and take effect even when not explicitly declared**; the review round uses the smaller of "remaining total budget" and `AGENT_POLISH_MAX_MS`, and is skipped automatically when less than 30s remains.

### 5.1 User Attachments (images / text files)

When submitting a request (initial `generate` and later `chat`), the user can upload reference material along with the message so the model can "look at the image/document" while editing.

Flow: `ChatPanel` picks files → local validation + base64 conversion → the `attachments` field of `POST /api/projects/:id/{generate,chat}` → authoritative validation on the Worker → inlined into the Cloud Run `/run` payload for this dispatch → agent writes to disk + hands images to the model as multimodal input.

| Item | Rule | Authoritative enforcement location |
| --- | --- | --- |
| Type | Images `png/jpg/jpeg/webp/gif`; text `txt/md/csv/json/js/jsx/ts/tsx/html/css/py/go/java/sql/yml/yaml/xml` | `src/lib/attachments.ts` (the frontend `web/src/lib/attachments.ts` only pre-filters) |
| Single size | Images ≤ **2MB** (same as the generated app's `blob.put` cap); text ≤ **256KB** | Same as above |
| Count / total | ≤ **3** per message, total (after decoding) ≤ **4MB** | Same as above |

- **Never persisted**: attachment bytes do not go into D1 (4MB per message would blow the row/statement limits) nor into `jobs.payload`. A line `📎 附件 N 个:…` is appended to the end of the user message text as a persistent trace; the real bytes live only in this one message's dispatch. **Corollary: after a failure, "one-click retry" resends only the text; attachments must be re-uploaded.**
- **Two usages on the agent side**: images get both "write to disk + inline" — inline (`session.prompt(text, { images })`, pi's `ImageContent`) guarantees the model sees them at first glance; they are also written to the working directory as `.attachments/1-<original name>`, so the agent can still `read` them itself when needed. Text attachments are only written to disk; a checklist in the prompt guides the model to `read` them.
- `.attachments/` is in `runner.ts`'s `SKIP_DIRS` → it does not enter `collectSource`'s source tree, does not enter build artifacts, and will not be mistakenly deleted by `restoreFromMap`.
- **Image input gated by environment switch + admin row**: declaring `input: ['text','image']` in `models.json` requires the admin-side `model_configs.image_input=1` (delivered per job); Cloud Run's `PI_MODEL_INPUT_IMAGE=true` is only the fallback. Upstream gateway dialects do not necessarily accept image blocks — declaring it but failing to send results in an immediate 400, so new providers must be tested first. Staging (GLM, OpenAI-compatible) is enabled; the production DeepSeek / GLM Anthropic endpoints were measured on 2026-10-25 to accept image blocks, and the production admin row's `image_input=1` is in effect (Cloud Run env unset).
- Request body cap: `MAX_BODY_BYTES` in `agent/src/index.ts` was raised from 2MB to 24MB (chat source tree + 4MB attachments base64 ≈ 5.4MB, leaving 2x headroom); Cloud Run's single-request cap is 32MB.

### 5.2 Steering (additional requests during generation)

The user doesn't have to wait for the current round to finish: while a job is running they can keep typing and pasting images, and the content is delivered immediately to the **currently executing** agent — no queuing for the next job.

Flow: `ChatPanel` (input stays usable during generation; Enter = "append") → `POST /api/projects/:id/steer` → written to the `job_messages` delivery queue → the agent's 5s inspection `GET /internal/jobs/:id/state` picks it up and marks `consumed_at` → injected via pi's `session.steer()`.

- **Delivery only, never touches the state machine**: steer does not touch any `jobs` field; the job keeps running. The content is also written into `messages` as a `user` message (order and timestamps in the conversation history are both correct; the user sees it immediately). §4's inspection is thereby extended from "check cancelled only" to "cancelled + unconsumed steering input" — two things in one request.
- **Uses pi's native steer**: `session.steer(text, { images })` takes effect after the current tool-call round ends and before the next LLM call, consuming one at a time → **it does not interrupt a running command**; it is not "interrupt on interjection". Images go through multimodal inlining; text attachments are inlined into the steer text (the steer path has no write-to-disk step).
- **Buffered before the session is ready**: copying the template + creating the pi session leaves a window of a dozen-plus seconds; steering arriving during that window first goes into an in-memory queue, and `runJob`'s `onSession` callback delivers it once it has the session — no message loss.
- **Limits are tighter than the initial submission** (the whole row must fit in D1): images ≤ **1MB**, text ≤ **128KB**, total ≤ **1.2MB** (base64 ≈ 1.6MB, headroom under `job_messages`' 2MB per-row cap); see `STEER_LIMITS` in `src/lib/attachments.ts`.
- **Temporary files, released when the job settles**: `job_messages` exists only while the job is `pending/running`; all three terminal paths — `commit` / `fail` / `cancelled` — call `clearJobMessages()` to delete the whole batch (including attachment base64), and cron's `sweepJobs` cleans up orphan rows as a backstop. **Corollary: the steering attachments of a historical job cannot be recovered** — they were never meant to outlive that round; the conversation history keeps only the `📎 附件 N 个` trace line.
- **Job just ended**: steer on a non-active job returns 409, and the frontend degrades to a normal send (starting a new job directly) so the user doesn't type for nothing.
- Frontend: `Cmd/Ctrl+V` pastes images via the browser's native clipboard capability (no extra dependencies); the same attachment validation is shared between idle and generating states, with only the limits switching by state; during generation the "Send" button becomes "Append", with "■ Stop" still next to it.

## 6. Security

- Worker → Cloud Run: request header `X-Agent-Secret` (shared secret). Cloud Run can additionally set `--no-allow-unauthenticated` + have the Worker carry a Google OIDC token to tighten further (roadmap).
- Cloud Run → Worker: `X-Agent-Secret` validation; `/internal/*` does not mount the user-auth middleware and does not read cookies.
- Generated pages still go through `/s/:slug`'s CSP `sandbox`, opaque origin, unable to read main-site credentials (unchanged).
- Agent working directory and network: egress from the container to anything other than the LLM gateway and callbacks can later be restricted with VPC egress (roadmap).

## 7. Cost (Cloud Run)

- **Monthly free quota**: Cloud Run has a permanent free tier (roughly 180k vCPU·seconds + 360k GiB·seconds + 1M requests per month; regions/definitions per official docs), enough for small scale; beyond that it's pay-per-use.
- **Egress traffic**: Cloud Run charges **per GiB for data transferred outbound to the internet** (with a small free egress quota); ingress is free, and same-region internal traffic is not billed. The agent's main "egress" is calling the LLM gateway and callbacks — all small JSON, so traffic cost is negligible; the real cost is vCPU/memory **request duration**.
- Key to saving money: request-based billing + `--min-instances=0` + `--concurrency=1` + the response ending immediately after generation → the instance scales to 0 right away.

## 8. Additions/Changes List

New (Cloud Run side, `agent/`):
- `index.ts` (HTTP: `POST /run`, `GET /health`), `runner.ts` (pi session + events→progress + platform-owned file restoration + user attachments to disk/multimodal input + platform-side build + design-review round rollback + `AbortSignal` cooperative cancellation + periodic checkpoint snapshots), `session.ts` (model/tool assembly), `prompt.ts` (system / `POLISH_PROMPT` / generate / chat), `attachments.ts` (attachment disk naming and prompt checklist, see §5.1), `callback.ts` (progress/heartbeat/milestone log/checkpoint/commit/fail + `startJobWatcher`: one 5s inspection doing both cooperative cancellation and steering pickup, see §5.2), `config.ts`; `template/` (Vite+React scaffold with preinstalled dependencies + design system, see §17), `Dockerfile`, `package.json`, `tsconfig.json`.

Changes (Cloudflare side):
- `src/workflow.ts`: **deleted** (replaced by `waitUntil` async dispatch + callbacks instead of durable orchestration).
- `src/routes/internal.ts` (new): progress / commit / fail callbacks, plus `GET /jobs/:id/state` for cancellation inspection + steering pickup.
- `src/lib/agent.ts` (new): dispatch payload construction + calling Cloud Run.
- `src/lib/attachments.ts` (new): conversation attachment type whitelist / size and count caps / base64 validation (aligned with the generated app's 2MB `blob` cap), see §5.1; also contains the separate `STEER_LIMITS` for mid-generation steering, see §5.2.
- `src/lib/commit.ts` (new): settles terminal states from commit / fail callbacks (write version, deduct credits, append message), and settles manual stops via `cancelJob()` (sets `cancelled`, unlocks the project immediately); all three terminal paths clear the `job_messages` delivery queue.
- `src/lib/jobs.ts`: heartbeat-style status + cron inspection declaring death; `JobStatus` includes the 4th terminal state `cancelled`; `sweepJobs` cleans up orphan `job_messages` rows as a backstop.
- `src/lib/jobHelpers.ts`: job snapshot queries + `clearJobMessages()` (see §5.2).
- `src/routes/generate.ts`: `waitUntil` async dispatch; `POST /:id/cancel` (user manual stop); `POST /:id/steer` (mid-generation steering, see §5.2).
- `schema.sql` / `schema.migrate-steer.sql`: `job_messages` delivery queue table (see §5.2).
- `web/src/lib/attachments.ts`, `web/src/components/ChatPanel.tsx`, `web/src/pages/Workspace.tsx`: attachment picking/pasting and limits, mid-generation steering, draggable-resize conversation pane (see §5.2, §18).
- `src/types.ts`: `Env` gains `AGENT_URL`, `AGENT_SECRET`, `PUBLIC_BASE_URL` (optionally `AGENT_DISPATCH_TIMEOUT_MS` etc.); Workflow types removed.
- `src/index.ts`: mounts `/internal`; Workflow export removed and cron changed to job inspection.
- `wrangler.jsonc` / `.dev.vars.example`: new variables (Worker name stays `forge-v2`; D1 recommended to be a new isolated `forge-v2` database).
- `src/lib/prompts.ts`, `src/lib/llm.ts`: no longer used by the workflow on the Worker side; `llm.ts` is kept for possible lightweight uses, and `prompts.ts`' constraint copy moved to `agent/src/prompt.ts`.

## 9. Building a Brand-New Environment (fully isolated from the old service)

Principle: **all resources for this project are created fresh; do not reuse the online `forge`'s Worker / D1 / secrets / Workflow, and do not reuse existing Cloud Run services.** The old service is read-only and untouched.

### 9.1 Cloudflare (new project space)

```bash
# 1) 新建独立 D1,把输出的 database_id 填进 wrangler.jsonc
npx wrangler d1 create forge-v2
# 2) 初始化新库(幂等)
npm run db:init:remote
# 3) 逐个配置 secrets(vars 已在 wrangler.jsonc,不在 secrets 里)
npx wrangler secret put AGENT_SECRET     # 与 Cloud Run 侧同名同值
#    AGENT_URL / PUBLIC_BASE_URL 是明文地址,写在 wrangler.jsonc 的 vars 里
# 4) 注册验证邮件:Resend 后台验证发件域名后创建 API key(免费档 3,000 封/月)
# npx wrangler secret put RESEND_API_KEY
# 5) 可选:启用 Google 登录(见下方说明)
# npx wrangler secret put GOOGLE_CLIENT_ID
# npx wrangler secret put GOOGLE_CLIENT_SECRET
# 6) 可选:启用连接器(见 §19;值只需随机 32 字节,换掉即所有连接需重新授权)
# npx wrangler secret put CONNECTOR_KEK
npm run deploy                            # 构建前端 + 部署 Worker(名:forge-v2)
```

> The `database_id` in `wrangler.jsonc` is currently the placeholder `REPLACE_WITH_FORGE_V2_D1_ID`; you **must run `d1 create` first and then replace it**, otherwise deployment errors out — this is intentional, to prevent accidentally using the old database.
> The Worker name `forge-v2` is a brand-new name and will not overwrite the online `forge` (v2 no longer registers a Workflow).

**Google login (optional, coexists with email/password login)**: in Google Cloud Console → "APIs & Services → Credentials", create an "OAuth client ID (Web application)"; put `${PUBLIC_BASE_URL}/api/auth/google/callback` in "Authorized redirect URIs" (locally `http://localhost:8787/api/auth/google/callback`), then store the client ID/secret as Worker secrets: `npx wrangler secret put GOOGLE_CLIENT_ID` and `npx wrangler secret put GOOGLE_CLIENT_SECRET` — if either is missing the feature is disabled and the login page keeps only email/password. Old databases need to run `schema.migrate-google.sql` once (`npm run db:migrate:google:remote`) to add `users.google_sub`; a fresh install of `schema.sql` already includes it. Flow: frontend "Sign in with Google" → `GET /api/auth/google` (a random state stored in an HttpOnly cookie against CSRF, with `idea` passed through alongside the state) → Google authorization page → `GET /api/auth/google/callback` exchanges the code for `id_token` and looks up the account by `sub`; if not found, it matches the **same account** by email and fills back `google_sub` (the email/password account merges with Google; historical data and credits are preserved); only if neither matches does it create a new account (no password, `password_hash` stored as an empty string).

**Change / set password (2026-10-22)**: while logged in, `POST /api/auth/password` (`currentPassword?` + `newPassword`); the frontend entry is the top-bar email → `/account`. Accounts with an existing password must provide the current password; pure Google accounts (`password_hash` an empty string) have no current password and can set one directly, after which they can log in to the same account with email + password. A successful password change **revokes all of that user's old sessions** and issues a fresh cookie for the current request; other devices must log in again. There is no "forgot password" email reset flow.

**Email verification (required for signup, 2026-10-21)**: signup **no longer grants credits or creates a session**; it only sets `users.email_verified = 0` and sends a one-time verification link; only after clicking the link (`/verify?token=…`) and verifying successfully is it set to 1, `SIGNUP_CREDITS` granted, and auto-login performed. Verification email goes through **Resend** (free tier 3,000 emails/month, 100 emails/day, no paid subscription needed; pay-per-use beyond that); the Worker calls `https://api.resend.com/emails` with `fetch`, the key is the Worker secret `RESEND_API_KEY` (written once per environment), and the sender address is `vars.EMAIL_FROM=noreply@1forgen.site`. Prerequisite: **verify the sending domain `1forgen.site`** in Resend's console (add DKIM/SPF DNS records; takes effect within minutes under Cloudflare DNS); when unverified the API returns 403 `The domain is not verified`. Old databases run `npm run db:migrate:email:remote` (staging uses `…:email:staging`), adding `users.email_verified` and the `email_verifications` table.
- Tokens are stored only as SHA-256 (`src/lib/email.ts`); a database leak yields no usable links; validity is 24h, and resending invalidates the old link.
- Send failure does not block account creation (`verificationSent=false`); the frontend shows a pending-verification panel and allows immediate resend (not subject to the 60s cooldown).
- Rate limits: 60s cooldown per account + 5 per 24h; 20 per hour per IP (**shared by signup and resend**).
- Emails returned by Google login are treated as verified: a pending-verification account that logs in via Google is promoted directly and granted the signup credits, without sending again.
- Production/testing share the same sending domain and account quota (not an environment difference); the staging sender display name is `Forge Staging`.

### 9.2 Google Cloud (new Cloud Run service)

First settle the project and region (this deployment used `PROJECT_ID=sixth-impulse-286413`, `REGION=us-central1`), then:

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
  --timeout 3600 --concurrency 1 --min-instances 0 --max-instances 5 \
  --cpu 1 --memory 1Gi \
  --set-env-vars LLM_BASE_URL=https://api.deepseek.com/anthropic,LLM_MODEL=deepseek-flash,PI_LLM_API=anthropic-messages,PI_PROVIDER_ID=forge,PI_MODEL_REASONING=true,AGENT_MAX_RUN_MS=1500000,WORKSPACE_ROOT=/tmp/forge-agent \
  --set-secrets LLM_API_KEY=llm-api-key:latest,AGENT_SECRET=agent-secret:latest
```

> When switching to an OpenAI-compatible gateway, change `PI_LLM_API` back to `openai-completions` and add `PI_SUPPORTS_DEVELOPER_ROLE=false` / `PI_THINKING_FORMAT=zai|qwen` etc. as needed (see §5).
> **Image input must be enabled explicitly**: only with `PI_MODEL_INPUT_IMAGE=true` does the model declare image support and get user-uploaded images inlined (see §5.1). Staging's (GLM, OpenAI-compatible) `agent:deploy:staging` already sets it; **production (DeepSeek Anthropic dialect) deliberately does not** — before enabling it, test with a real image that the endpoint accepts image blocks, otherwise the whole round 400s.
> `AGENT_MAX_RUN_MS` must be **smaller than** Cloud Run's `--timeout` (verify both in ms/s terms): env default 1500s, admin-side `model_configs.max_run_ms` can go up to 3400s, VIP's `--timeout 3600`. Note `max_run_ms` only bounds the model's main loop; the build and review round happen after it, so the admin-side validation deliberately leaves 200s of headroom — don't set it flush against 3600s. Setting it too small lets a normal multi-file generation be killed by its own timeout (staging's initial 300s hit exactly this: a real generate takes ~6.5 minutes).
> The two generation-quality switches (`AGENT_DESIGN_REVIEW=generate`, `AGENT_POLISH_MAX_MS=300000`) don't need to go into `--set-env-vars`: the code has the same defaults, and behavior is unaffected if the deploy script doesn't declare them (see §5, §17.4).

After deployment, put the service URL back into `wrangler.jsonc`'s `AGENT_URL`, put the Worker's public domain into `PUBLIC_BASE_URL`, then run `npm run deploy` once more.

> ⚠️ **The image build context must exclude the host's `node_modules`** (pitfall hit 2026-10-17, fixed): the template stage of `agent/Dockerfile` uses `npm install` to install scaffold dependencies, while `gcloud run deploy --source agent` sends the whole `agent/` as context — including local `agent/template/node_modules` (macOS, ≈118 MB, 7872 files).
> Once copied into the image by `COPY template/ ./`, it **overwrites the correct Linux installation inside the container**: macOS's `node_modules/.bin/vite` is a relative symlink `../vite/bin/vite.js`, which gets dereferenced into a plain file `.bin/vite` during context transfer; the entry path then misaligns, `import('../dist/node/cli.js')` resolves to `node_modules/dist/node/cli.js` → `ERR_MODULE_NOT_FOUND`, manifesting as **every generate failing at the "building app artifacts" stage**.
> The fix has three layers, all required: ① `agent/.dockerignore` lists `**/node_modules` (the old form `node_modules` matches only the root level and **does not match `template/node_modules`**); ② `agent/.gcloudignore` explicitly excludes `template/node_modules` (which also cut the upload from 23434 files to 39); ③ the Dockerfile was changed to `COPY template/ ./` first and then `rm -rf node_modules && npm install`, so even with leftovers the in-container installation wins. After the change, `gcloud meta list-files-for-upload agent | grep -c template/node_modules` should yield `0`.

### 9.3 Which GCP Permissions Are Needed

**(a) The person / CI service account doing deployment** — deploying with `--source` uses Cloud Build + Artifact Registry + a temporary GCS staging bucket; minimal role set:

| Role | Purpose |
| --- | --- |
| `roles/run.admin` | Create/update the Cloud Run service |
| `roles/iam.serviceAccountUser` | Bind the runtime SA to the Cloud Run service |
| `roles/cloudbuild.builds.editor` | Cloud Build builds images |
| `roles/artifactregistry.writer` | Push images to Artifact Registry |
| `roles/storage.objectAdmin` | Read/write Cloud Build's temporary staging bucket |
| `roles/secretmanager.admin` | Create/update secrets (needed only the first time; can be narrowed to `secretVersionAdder`) |
| `roles/serviceusage.serviceUsageAdmin` | Enable the batch of APIs above (needed only the first time) |

Authorization example:

```bash
for r in run.admin iam.serviceAccountUser cloudbuild.builds.editor \
         artifactregistry.writer storage.objectAdmin secretmanager.admin \
         serviceusage.serviceUsageAdmin; do
  gcloud projects add-iam-policy-binding $PROJECT_ID \
    --member="user:YOU@example.com" --role="roles/$r"
done
```

> During development, for convenience you can just grant `roles/editor` (covers most of the table above), but for production it's recommended to narrow to the table above.

**(b) The Cloud Run runtime service account** (the container itself) — only reading secrets requires it:

| Role | Purpose |
| --- | --- |
| `roles/secretmanager.secretAccessor` | Read `LLM_API_KEY` / `AGENT_SECRET` injected via `--set-secrets` |

If using the default compute SA, run once:
```bash
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

**(c) Cloudflare Worker calling Cloud Run** — currently uses a shared secret (`X-Agent-Secret`); Cloud Run just needs to allow unauthenticated access, so **no GCP IAM is needed at all**.

> Optional tightening (roadmap): create a caller SA with `roles/run.invoker` and have the Worker exchange for its ID token to call. The cost is that the Worker side must manage that SA's credentials; not done for now.

### 9.4 Rollback

- Roll the Worker back a version (`wrangler rollback`); Cloud Run is independent and stateless — rollback = deploy the previous image.

## 10. Explicitly Not Doing (roadmap)

- **Explicit "resume from failure checkpoint"**: left to the coding agent itself to retry/continue within a single execution; v1's `sections_json` checkpoint reuse mechanism is deprecated in v2 (the field is no longer written, so the "continue after failure" entry point naturally becomes inert).
- Multi-agent orchestration / sub-agents; pi extensions and a skills marketplace.
- ~~Move artifacts to R2 (still stored as D1 TEXT)~~ → now a **planned item**, see §13 (multi-file artifacts' source tree and build artifacts go to R2).
- D1 direct connection or a local database on the Cloud Run side: all persistence returns to CF.
- OIDC mutual auth, VPC egress allowlist, `--min-instances>0` warm standby.
- **Credit billing**: overseas prepayment (one-time top-up packs + monthly subscriptions). Phases one through four are done — usage metering, credit ledger, freeze settlement, multilingual (11 languages, §20.5), billing UI, **Creem (MoR) payment integration + webhook credit grants** (see §20).

## 11. Current Deployment Status (working end-to-end)

| Component | Value |
| --- | --- |
| Cloudflare Worker | `forge-v2` → `https://app.1forgen.site` (Custom Domain, since 2026-10-19; `forge-v2.needle.workers.dev` kept) |
| D1 | `forge-v2` (`6fd724ad-b430-4d2b-9eae-6353c6dbde56`) |
| Cloud Run Service | `forge-agent` (us-central1) → `https://forge-agent-323709989821.us-central1.run.app` |
| GCP project | `sixth-impulse-286413` (project number `323709989821`) |
| Runtime SA | Default compute SA `323709989821-compute@developer.gserviceaccount.com` |
| Image | `us-central1-docker.pkg.dev/sixth-impulse-286413/cloud-run-source-deploy/forge-agent` |
| Spec | 1 vCPU / 1GiB, `--timeout=3600 --concurrency=1 --min-instances=0` |
| Secrets | `llm-api-key` → `LLM_API_KEY`; `agent-secret` → `AGENT_SECRET` (Secret Manager, injected via `--set-secrets`) |
| Worker Secrets | `AGENT_SECRET`; optional `ADMIN_PASSWORD` (admin console password), `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (Google login; feature disabled unless both are set) |
| R2 | `forge-v2-artifacts` (binding `ARTIFACTS`): build artifacts at `p/{projectId}/v/{versionNo}/*` and generated-app upload objects |
| KV | `forge-v2-appdata` (binding `APPDATA`): generated-app key-value store, keys `p:{projectId}:{env}:{key}` |
| Durable Object | `PROJECT_DB` (class `ProjectDb`): generated apps' document data + owner SQL console; one isolated SQLite instance per project × per environment, named `${projectId}:${env}` |

### 11.1 STAGING (fully isolated from production, set up 2026-10-17)

The staging environment exists for "develop and validate on staging first, then go live": the two environments are **fully resource-isolated with code from the same source** (same repo, same `web/dist`, same `agent/` source); the differences are only the deployment targets and a small amount of configuration. Full details in §16.

| Component | Production | staging |
| --- | --- | --- |
| Cloudflare Worker | `forge-v2` → `app.1forgen.site` + `forge-v2.needle.workers.dev` | `forge-v2-staging` → `app-staging.1forgen.site` + `forge-v2-staging.needle.workers.dev` |
| wrangler environment | top level (no `--env`, `npm run deploy`) | `env.staging` (`npm run deploy:staging`) |
| D1 | `forge-v2` (`6fd724ad-…`) | `forge-v2-staging` (`da94e0ba-…`) |
| R2 | `forge-v2-artifacts` | `forge-v2-artifacts-staging` |
| KV | `f6b66c90…` | `67e46b44…` |
| Durable Object | Independent namespace (Worker `forge-v2`) | Independent namespace (Worker `forge-v2-staging`) |
| Cloud Run Service | `forge-agent` (`--max-instances 5`) | `forge-agent-staging` (`--max-instances 1`) |
| LLM key | Secret `llm-api-key` (DeepSeek, VIP); the free executor uses `llm-api-key-minimax` (MiniMax) | Secret `llm-api-key-staging` (GLM, VIP, **a different key**); the free executor uses `llm-api-key-minimax-staging` (MiniMax) |
| LLM model | VIP `deepseek-flash` (@ `api.deepseek.com/anthropic`, `anthropic-messages`); free `MiniMax-M3.1-Flash` (@ `api.minimaxi.com/anthropic`, `anthropic-messages`) | VIP `glm-5.3-flash` (@ `open.bigmodel.cn/api/paas/v4`, `openai-completions` + `PI_THINKING_FORMAT=zai`); free `MiniMax-M3.1-Flash` (Anthropic dialect) |
| Internal secret | Secret `agent-secret` | Secret `agent-secret-staging` (**a different key**) |
| Cron | `* * * * *` (inspects only this environment's jobs) | `* * * * *` (inspects only this environment's jobs) |
| Signup verification email | Resend Secret `RESEND_API_KEY` + `noreply@1forgen.site` (free tier 3,000 emails/month) | Same Resend account; secret written separately with `--env staging` |
| Environment badge | No `ENVIRONMENT` set (frontend assumes production, no badge) | `ENVIRONMENT=staging` (frontend shows an amber STAGING badge) |

> Multi-file artifacts added two extra steps: **(1)** `npx wrangler kv namespace create forge-v2-appdata` and fill the returned id into `APPDATA.id` in `wrangler.jsonc` (currently a placeholder; deployment fails without it); **(2)** run `schema.migrate-multifile.sql` once against the existing v2 database (rebuilds `versions`/`jobs`; old single-file artifacts and job history are not preserved). Fresh installs can just run `schema.sql`. Then `npm run deploy` deploys the Worker; on the Cloud Run side, since the Dockerfile now preinstalls the `template/` dependencies, one more `gcloud run deploy` is needed.

> Enabling Google login takes one more step: run `schema.migrate-google.sql` once against the existing v2 database (`npm run db:migrate:google:remote`), adding `users.google_sub` and its unique index; skip it if not enabling (the login page automatically hides the Google button).

**APIs already enabled**: `run` / `cloudbuild` / `artifactregistry` / `compute` / `secretmanager`.

**IAM already in place**: the deployment account `ttswhh@gmail.com` is `roles/owner` on the project (no extra grants needed); the runtime default compute SA already has `secretmanager.secretAccessor` (reading injected secrets), `artifactregistry.writer`, `logging.logWriter`, `iam.serviceAccountUser`, `run.admin`, `editor`.

**End-to-end verification (multi-file)**: `generate` (a minimal pomodoro timer) → Cloud Run agent writes multi-file React source → platform `vite build` → commit callback lands the version (`src_json` into D1, `dist` into R2, `manifest` generated) → preview `GET /p/:token/` 200 → `publish` → `GET /s/:slug/` 200, with `window.__FORGE_API_BASE__="/s/:slug/api"` injected at the entry, Vite hashed assets (`assets/*.js|css`) hitting long cache, `/s/:slug/api/db/:collection` 200. The whole chain works.

## 12. Admin Console

An admin console for viewing all artifacts across users, **fully isolated** from the normal user system: the password comes from the `ADMIN_PASSWORD` secret, and after `POST /api/admin/login` validates it, an HttpOnly cookie derived from the password is issued (`lib/admin.ts`; changing the password invalidates all sessions at once, no session table needed).

- Pages: `/admin` (artifact list: owner, status, version/conversation/data counts, public link + **draft preview**, keyword search and pagination, site-wide stats); `/admin/projects/:id` (details: draft + all version sources + iframe preview + public link, conversation history, tail of jobs and the **agent milestone log**, site data); `/admin/users` (per-user usage list, search by email, pagination, multi-select for **batch credit grants**, optional email notification); `/admin/users/:id` (single user details, can **grant credits** (optional email notification) and view recent credit transactions); `/admin/models` (model configuration and usage, see §21). "Data counts" = the sum of row counts across both environments' SQLite tables for the project, computed in real time (page size capped at 20 to limit subrequests). The top bar switches between "Artifacts / Users", and owner emails in the artifact list cross-link to user-detail project rows.
- **Draft preview**: the "draft" is a working copy with `version_no = 0`; it doesn't enter the formal version sequence but is exactly what the user currently sees. The list/details/user-details pages each issue it its own preview token (`draft.preview_token`); the details page defaults to showing the draft, and the list page can open it with one click via `↗`. The token is a stateless HMAC (bound to `projectId + versionNo`), the same locating scheme as `/p/:token/`, so admin previews don't depend on user cookies; the draft serves its data API under `/p/` with `env=draft` and carries a "staging environment · draft preview" badge. The admin side issues a token only when **the build manifest has artifacts** (`manifest.files` non-empty); otherwise `preview_token` is `null` and the frontend shows an empty state rather than opening an iframe that would inevitably 404; `GET /projects/:id/versions/:no` follows the same rule (`no = 0` means draft, requests allowed).
- Endpoints (all `requireAdmin` except login/logout/me; read-only except model config and manual credit grants): `GET /api/admin/{me,stats,projects,projects/:id,projects/:id/versions/:no,projects/:id/data/:env/:collection,users,users/:id}`; `POST /api/admin/{login,logout,migrate-doc-data}`; manual credit grants `POST /api/admin/users/:id/credits` (single user) and `POST /api/admin/users/credits` (batch, same amount, ≤100 users per call, amount a positive integer ≤100000, written only if every user exists). Granting credits writes only `users.credits` + one `credit_ledger` row (`reason = admin_grant`); no deduction is done; `GET /api/admin/users/:id` additionally returns the last 30 `credits_log` rows. When a request carries `notify: true`, a bilingual (zh/en) credit-arrival email (`src/lib/messages/grant.ts`) is additionally sent to users with **verified emails** (Resend, `src/lib/email.ts`); a single send failure or unverified email only counts toward the returned `notify` stats and **does not affect the grant itself**. Data rows come from the project's isolated SQLite database for that environment (§15). Beyond projects/users/versions, `stats` includes total jobs, success/failure counts, jobs over the last 7 days, and active users over the last 7 days. Each row of the project list / user details carries a `draft` field: the artifact file count is computed directly in SQL via `json_array_length(json_extract(manifest_json,'$.files'))` (with a `json_valid` fallback), rather than pulling the whole manifest into the Worker.
- **User usage** (`/admin/users`, `/admin/users/:id`): one row per registered user, aggregating "core usage" (project count, formal version count, conversation message count, job count (generate/chat, success/failure)), "credits" (balance `credits`; consumed ≈ successful job count, 1 deducted per successful commit), "activity" (signup time, last active = last job time, jobs over the last 7/30 days), and "artifact volume" (total build artifact bytes = sum of each formal version's `bytes`; data row counts are summed by reading both environments' isolated SQLite per project, computed only on the user-details page over that user's project set to limit subrequests). Aggregation uses correlated subqueries on `users`, with job counts based on the `jobs` table.
- **Model configuration and usage** (`/admin/models`): one of the writable areas (the other is manual credit grants), see §21. `GET /api/admin/models` returns the config list + usage over the last 7 days aggregated by config/model; `POST /api/admin/models` adds a config; `POST /api/admin/models/:id/enable|disable` enables/disables. The top bar switches between "Artifacts / Users / Models".
- Configuration: `npx wrangler secret put ADMIN_PASSWORD` (if unset, the admin console is entirely unavailable).

## 13. Artifact Form and Choices (multi-file / full-stack)

> **Phase one of this chapter is done**: artifacts upgraded from "one version = a piece of HTML" to **multi-file React apps** (source tree + build artifacts), with the backend carried by the platform's generic data API, the whole thing running on Cloudflare.

### 13.1 Conclusion (decided)

| Dimension | Decision |
| --- | --- |
| Frontend | **Vite + React (SPA)**, built into static artifacts `dist/` |
| Backend | **Hono routes in the same Worker**; bindings limited to **D1 (platform metadata) / KV / R2 / per-project-per-environment isolated SQLite (Durable Object)** |
| Delivery | Phase 1 = carried by the platform's single Worker (shared resources namespaced per project); Phase 2 = one Workers for Platforms user Worker per artifact |
| Preview | **Keep the static instant preview** (SPA artifacts are just static files; `html_preview` semantics can carry over) |
| Storage | Source tree + build artifacts → **R2**; D1 keeps only platform metadata (projects/versions/jobs/messages); **generated apps' data → one isolated SQLite per project × per environment (see §15)** |

### 13.2 Why Not SSR

SSR makes **the artifact app itself** simpler (frontend and backend unified, loaders hitting D1 directly, no API contract) but makes **the platform side** heavier:

1. **The platform is locked to the framework**: an SSR artifact is the framework's server bundle + adapter; the platform would have to carry a particular framework's runtime into the user Worker, and upgrades/adaptation/every framework's quirks become the platform's problem.
2. **Loses instant preview (the biggest hidden cost)**: the existing "agent writes a bit, preview grows a bit" depends on a single static HTML; SSR has no single HTML — to preview you'd have to run the server.
3. **Agent generation success rate drops**: meta-frameworks have more conventions (loader vs action, server-only modules, hydration); the thicker the stack, the easier to get wrong.

Comparison (conclusion: at this stage choose the left column):

| | **SPA + Hono API (chosen)** | SSR meta-framework (Remix/SvelteKit/Astro) | Hono + JSX (thinnest SSR) |
| --- | --- | --- | --- |
| App mental model | Two pieces, frontend + backend, + fixed contract | One app | One Worker |
| Platform carrying complexity | Low (just serve files) | High (tied to a framework runtime) | Medium |
| Instant static preview | ✅ | ❌ | ⚠️ (needs one render) |
| Interaction richness | High | High | Medium (needs islands) |
| Agent generation difficulty | Medium | High | Low |

### 13.3 "SPA + Hono" Does Not Mean "Maintaining an API Contract"

The backend here is a **platform-provided generic capability** (D1/KV/R2 namespaced per project), **not** a set of hand-written endpoints per project. The agent only calls fixed endpoints (read/write collections, key-value, objects), so there is no burden of "designing a frontend/backend contract per project" — this is exactly where the SSR-complexity concern gets avoided.

### 13.4 Storage and Data Model Evolution

- `versions.html TEXT` → **version = a file tree (path→content) + build artifact reference**; large objects go to R2, D1 keeps only metadata (`manifest`, `build_hash`, `artifact_ref`, `deploy_version`).
- The admin console's "version source" page upgrades from **a single HTML** to **file tree browsing + per-file preview + build artifacts + deployed URL** (§12 needs a corresponding extension).

### 13.5 Phasing (avoid doing it all at once)

- **Phase 1 (small change, validate the framework works)**: fixed Vite+React framework + multi-file; the backend is still the **platform generic data API** (`/api/app/:slug/*` proxying D1/KV/R2, namespaced per project); artifacts stored in R2; preview/publish/admin upgraded to a file tree. The agent **does not deploy** Workers.
- **Phase 2 (true "whole thing on CF")**: adopt **Workers for Platforms**, package each project's backend as an independent user Worker, bind shared resources, mount at `{slug}.domain`.
- The value of Phase 1: upgrade the delivery chain to multi-file without changing the execution model — exactly the foundation for Phase 2.

### 13.6 Keeping Options Open (not yet decided)

- If SSR / unified full-stack is wanted later: **Remix / React Router v7** (first-class Cloudflare support), accepting platform-tied framework + preview changing to "run a preview Worker".
- **SSG bridge**: use an SSG-capable framework and render each route to static HTML at build time inside the agent container — keeps a unified development model while retaining the static preview/publish chain; the cost is that dynamic data falls back to client-side calls to the platform data API.
- **Custom domains**: custom domains for **user projects** are not being done for now (a future paid add-on; it will still require Cloudflare for SaaS). **The platform's own domains are already attached** (2026-10-19): `app.1forgen.site` → `forge-v2`, `app-staging.1forgen.site` → `forge-v2-staging`, both Custom Domains, with the root domain `1forgen.site` left empty and unused. Note this is a different matter from "user projects attaching domains they bought" — only the latter needs Cloudflare for SaaS.

### 13.7 Phase 1 Implementation (done)

**Data model**
- `versions`: `src_json` (source tree `path→content`, the baseline for delivery/continued chat) + `manifest_json` (entry, `buildHash`, byte counts, artifact file list) + `bytes`; the build artifacts themselves live in R2 (`p/{projectId}/v/{versionNo}/{path}`).
- `jobs`: new `files_preview` (the source files `{path,content}` the agent most recently wrote; the frontend watches code stream in), replacing the half-finished HTML of the single-file era.

**Execution chain (agent/Cloud Run)**
- `agent/template/`: scaffold with preinstalled Vite + React + Tailwind + **design system** (`src/styles/{tokens,theme,base}.css`, `src/components/ui/**` 30+ component primitives, `src/lib/motion.jsx`, `src/lib/cx.js`) + **backend SDK** (`src/lib/forge.js`'s db/kv/counter/blob/storage, `src/lib/store.js`'s hooks); the Dockerfile runs `npm install` on its dependencies at build time (including `lucide-react`, `motion`), and at runtime each job copies the template + symlinks `node_modules` (no runtime install anymore). See §17 for details.
- `agent/src/prompt.ts`: the system prompt stipulates the multi-file React output spec + design system contract + component catalog + data layer usage + state coverage checklist; generate first writes `plan.json`, then writes `palette` into `tokens.css`, then implements the app; chat edits the existing source tree; `POLISH_PROMPT` is the prompt for the second design review round.
- `agent/src/runner.ts`: copy template → pre-write current source (chat) → **restore platform-owned files** → run the pi session → **platform-side deterministic `vite build`** → (generate) design review round + rebuild (rollback to the first round's source on failure) → collect `src` (source tree, skipping node_modules/dist/plan.json/package-lock.json) + `dist` (build artifacts) + `manifest`.
- The commit callback returns `{src, dist, manifest, plan}`; the Worker side's `commit.ts` writes `src` to D1, `dist` to R2, and generates and stores `manifest`.

**Service and backend API**
- `src/routes/serve.ts`: `/s/:slug/*` (published, env=live) and `/p/:token/*` (draft preview, env=draft, HMAC token bound to project+version) serve build artifacts from R2; the entry HTML gets `window.__FORGE_API_BASE__` injected pointing at the same-origin `/api` subpath; `assets/` long-cached, everything else no-store; SPA fallback to the entry. When a connector binding exists, the entry HTML additionally gets a `window.__FORGE_CONNECTORS__` injected (public non-secret values only, see §19).
- `src/lib/appdata.ts`: the platform generic data API; one set of endpoints covering document collections (`/db/:collection`), KV key-value (`/kv/:key`), R2 objects (`/blob/:key`), namespaced by project + environment (draft/live), with CORS on responses (pages run in a sandbox opaque origin). The `/db` storage has migrated from shared D1's `site_data` to per-project-per-environment isolated SQLite (see §15); the HTTP contract is unchanged.
- `src/lib/projectDb.ts`: one Durable Object per project × per environment (binding `PROJECT_DB`, class `ProjectDb`, `new_sqlite_classes`), instance name `${projectId}:${env}`; carries the `/db` document interface (collection → one fixed-column table) and the owner's SQL console (arbitrary DDL/DML/indexes).

**Frontend**
- Workspace `PreviewPane`: `预览` uses a `/p/:token/` iframe (replacing the srcDoc single HTML), `代码` shows the files the agent is writing in real time during generation and the build artifact list after completion, and `数据` (DataPanel) has three tabs — **key-value / objects / SQL** — all isolated by staging/live environment; the SQL tab is a DBeaver-style table data grid + SQL editor (all tables appear here). Draft preview tokens are issued per `project+version`; after the same draft is edited, the token doesn't change and neither does the iframe's `src`, so the browser won't re-fetch the latest artifacts on its own — therefore when a job ends (`streaming` true→false) the frontend force-remounts the iframe once, and the preview toolbar also provides a "⟳ 刷新预览" button for manual reload.
- Admin console `AdminProject`: version details upgraded from "a single HTML" to **file tree browsing + per-file source preview**; each version gets a draft token issued by the admin side, so any historical version can be previewed directly at `/p/:token/`.

## 14. Versioning Capabilities (user-facing)

Every "generate" or "chat edit" produces a **new version**; historical versions are kept forever and never overwrite each other.

- **Numbering**: the new version number = `MAX(version_no) + 1` (not `current_version + 1`). This way, even if an old version is "restored" as the current version and then edited further, the new version still sorts last and won't conflict with existing version numbers.
- **Baseline**: chat edits always use the source of the "currently active version" (`projects.current_version`) as the baseline; viewing a historical version doesn't change the baseline — only "restore" does.
- **Switching views**: the version dropdown in the workspace preview toolbar can view any historical version (preview + source switch together), with `(当前)` marking the active version.
- **Restore**: "Restore vN as current version" points `current_version` at that version, and the publish page `/s/:slug` updates accordingly; can be toggled repeatedly. Switching is forbidden while a generation job is in flight (to avoid racing the settling optimistic lock).
- **Publish**: "Publish" applies to the currently active version; the button is disabled when viewing a historical version — restore first.
- **Delivery/export**: `GET /api/projects/:id/versions/:no/export` zips the version's source tree (`src/lib/zip.ts`, zero-dependency store-only compression); download it and run `npm install && npm run build` locally, or keep it as a deliverable.

### 14.1 Generated Apps' Data Capabilities (corrections)

- The platform data API's write operations (POST/PUT/DELETE) previously all 404'd because `serve.ts` registered only `app.get`, causing generated apps' "add then the list is empty, stats are 0". Fixed to `app.all`, plus a new `PUT /db/:collection/:id` (merge-style update, supporting "mark complete").
- The template adds `src/lib/store.js`'s `useCollection(collection)`: centrally manages list state; after `add/update/toggle/remove` it automatically re-fetches, and the list and all stats derive from the same `items`; the prompt explicitly requires "state linkage" and a self-check against real click flows before finishing.
- 2026-10-17 extensions (all additive; old contracts unchanged, existing apps need no changes):
  - **Server-side pagination / search / sort + real totals**: `GET /db/:collection?limit=&offset=&order=&q=` → `{items,total,limit,offset}`. `limit` ≤200, `offset` ≤10000, `order` accepts only `asc|desc` (anything else falls back to default descending), `q` ≤64 chars and does only an `instr(data, ?)` substring match (no SQL concatenation, no `%/_` escaping issues). `total` is the **total number of matching rows**, so page numbers and "N items total" no longer have to fake it with `items.length`.
  - **Atomic counters**: `POST|GET /kv/:key/incr` (`{by?,start?}`, `by` clamped to ±1000) → `{key,value}`. Lands in the project's SQLite (`_forge_counters` table, single `UPDATE v = v + ?`), so concurrent increments lose no counts — Workers KV allows 1 write per key per second, which loses counts for view counters/likes, so KV is deliberately avoided. `GET /kv/:key` falls back to reading the counter when KV has no value, so `kv.get` can also display a just-incremented value (no dual-write).
  - **Object listing**: `GET /blob?prefix=&limit=&cursor=` → `{items:[{key,size,uploaded}],cursor,truncated}`, `limit` ≤500 (default 100); the returned `key` has the project×environment prefix stripped and can be fed straight back to `blob.url(key)`. Object uploads gained a frontend 2 MiB pre-check with a friendly error.
- Remaining limits (not relaxed): document collections ≤500 rows, per-document request body ≤8 KiB, rate-limited writes (20), KV values ≤25 KiB, single object ≤2 MiB. **Read endpoints have no rate limit** (current state, unchanged).

## 15. Data Layer: Isolated SQLite per Project × per Environment (Durable Object)

### 15.1 Conclusion

- Generated apps' data (the "document collections" of the old shared D1 table `site_data`) migrates to **one isolated SQLite database per project × per environment**, carried by a Durable Object.
- Binding `PROJECT_DB`, class `ProjectDb`; wrangler migration `{ "tag": "v1", "new_sqlite_classes": ["ProjectDb"] }` (the class name is fixed once deployed and cannot be renamed casually).
- Instance name `${projectId}:${env}` (env ∈ `draft`/`live`). Projects, and staging/live, are **physically isolated** — not filtered by `WHERE`; the database is created automatically on first access.

### 15.2 Why

- User demand: real SQLite capability for generated apps (create tables / create indexes / native SQL), not a platform-wrapped layer of "document JSON".
- Physical isolation is stronger than "shared table + `project_id` column filtering", and each database can evolve its schema and be destroyed independently.
- The execution/billing model is unchanged: still Cloudflare bindings, no new service introduced.

### 15.3 The Two Entry Points

| Entry | Auth | Notes |
| --- | --- | --- |
| Generated app `/db/:collection` (`/s/:slug/api`, `/p/:token/api`) | Public (CORS, no cookies) | `GET/POST/PUT/PATCH/DELETE`; collection → one fixed-column table `(id, data JSON text, created_at, client_ip)`; the HTTP contract is identical to the old `site_data`, generated apps need no changes; rate-limited with a 500-row cap |
| Owner SQL console `/api/projects/:id/sql`, `/schema` | Login + owner | Execute arbitrary SQL (DDL/DML/indexes) against that environment's database, list tables / indexes / views with row counts; no statement whitelisting — the user can only touch their own project's, own environment's database |

Internally the DO dispatches by op: `exec` / `schema` / `db.list|add|update|remove|collections` / `counter.incr|counter.get` / `seed` / `seeded` / `destroy`. `counter.*` lands in the internal table `_forge_counters` (underscore-prefixed; `schema()` filters `NOT LIKE '\_%'`, so it's invisible in the owner SQL console's structure tree and can't be modified by mistake). Since 2026-10-17 `db.list` accepts `limit/offset/order/q` and returns `total` (see §14.1); the op name is unchanged and old caller behavior is unchanged.

The console UI is **DBeaver-style**: a "database structure" tree on the left; clicking a table name pages through it in the grid on the right; clicking a cell edits in place (Enter commits / Esc cancels), with "add row" and per-row "delete". Row addressing is based on `rowid` (`SELECT rowid AS __rowid, *`); `WITHOUT ROWID` tables automatically fall back to read-only browsing. Switching to the "SQL editor" allows arbitrary statements. All of these operations go through the `/sql` endpoint (with parameter binding; identifiers always safely quoted) — no new backend endpoints. Document collections (tables) written by generated apps also appear directly in this structure tree, so **there is no separate "Documents" tab anymore** — the single SQL page browses/edits all tables.

### 15.4 Isolation and Cleanup

- The staging environment (draft) = written via the preview page `/p/:token/api`; the live environment (live) = written via the publish page `/s/:slug/api`; neither sees the other.
- KV / R2 remain shared resources + prefixes (`p:{projectId}:{env}:` / `appdata/{projectId}/{env}/`), using the same "project × environment" isolation scheme as SQLite.
- On project deletion, `deleteProjectAppData` clears the KV prefix + R2 prefix + `destroyProjectDb` (`deleteAll` on each of the two environments).
- Deletion order: first delete child tables in foreign-key order within a single D1 batch (`job_messages` → `jobs` → `messages` → `versions` → `site_data` → `project_connectors` → `projects`), then clear R2/KV/DO. D1 has foreign keys on by default (`PRAGMA foreign_keys` always 1); skipping `jobs` makes the final `DELETE FROM projects` fail with `FOREIGN KEY constraint failed` — the 2026-10-25 production 500 on project deletion was exactly this. Object-storage cleanup happens after the DB and failures there only log, avoiding the half-deleted state of "project still exists but artifacts/data are gone".

### 15.5 Migration (one-time, idempotent)

Existing rows in the old D1 `site_data` need backfilling into SQLite. After migration, D1's `site_data` is **read-only, no longer written**.

```bash
# 1) 登录后台拿 cookie
curl -s -c /tmp/a.jar -X POST https://forge-v2.needle.workers.dev/api/admin/login \
  -H 'Content-Type: application/json' -d '{"password":"<ADMIN_PASSWORD>"}'

# 2) 回填全部;加 ?projectId=xxx 只迁一个项目
curl -s -b /tmp/a.jar -X POST https://forge-v2.needle.workers.dev/api/admin/migrate-doc-data
```

Returns `{groups, rows, errors}`; `rows` is the number of backfilled rows (idempotent via `INSERT OR IGNORE`; re-running produces no duplicates).

### 15.6 Differences from the Old Implementation (user-visible)
- The workspace "Data" tab converged from **Documents / Key-value / Objects / SQL** to **Key-value / Objects / SQL**: document collections are no longer a standalone tab; they are browsed/edited as tables in the "SQL" structure tree (DBeaver style), reading the **same database** the generated app reads.
- Removed the owner's `/api/projects/:id/data/*` endpoint group (used only by the old "Documents" tab); the backend no longer has a second document-data pathway.
- D1 `site_data` stopped being written: kept only as the historical source for the migration.
- The admin console's artifact-list "Data" column now computes the live sum of row counts across both environments' SQLite databases.
- The generated-app side's HTTP contract is completely unchanged (the `db/:collection` request/response shapes are identical), so existing apps keep working without regeneration.

## 16. STAGING Environment (fully isolated from production)

### 16.1 Goals and Principles

"Develop and validate on staging first; go live only after confirming everything is fine." The two environments are **code-identical** (same repo, same build artifacts, same `agent/` source) with **fully isolated** resources — neither reads/writes nor overwrites the other. The production config at the top level of `wrangler.jsonc` is untouched, word for word; staging lives entirely in the `env.staging` block and in separate GCP services.

### 16.2 Cloudflare Side (`wrangler.jsonc`'s `env.staging`)

Wrangler's rule: **binding-type config (`vars` / `d1_databases` / `kv_namespaces` / `r2_buckets` / `durable_objects` / secrets) is not inherited and must be declared explicitly in every environment**; a missing declaration does not error at deploy time — instead `c.env.XXX` is `undefined` at runtime (e.g., omitting `PROJECT_DB` makes generated apps' `/db` endpoint and data panel 500 outright). `main` / `compatibility_date` / `assets` / `migrations` / `triggers` are inheritable and are deliberately not repeated, to avoid the two sides drifting.

```bash
# 一次性:建独立资源并把 id 填进 wrangler.jsonc 的 env.staging
npx wrangler d1 create forge-v2-staging          # → da94e0ba-7f9c-48ce-96ca-3160975bf8da
npx wrangler r2 bucket create forge-v2-artifacts-staging
npx wrangler kv namespace create forge-v2-appdata-staging   # → 67e46b44ce224ff9a4ea2af583dead21
npm run db:init:staging                          # 幂等初始化 schema
npm run db:migrate:google:staging                # 如需 Google 登录(新增 users.google_sub)
npm run db:migrate:email:staging                 # 邮箱验证(users.email_verified + email_verifications)
npx wrangler secret put AGENT_SECRET --env staging
npx wrangler secret put ADMIN_PASSWORD --env staging
npm run deploy:staging                            # 构建前端 + 部署 Worker forge-v2-staging
```

- The environment name is the Worker name: `env.staging.name = "forge-v2-staging"`, following the official `<top-level name>-<environment name>` rule.
- **Production deploy guard**: `npm run deploy`, `npm run agent:deploy:prod`, and `npm run agent:deploy:free:prod` all run `scripts/guard-prod-deploy.mjs` through the corresponding `pre*` hooks; two checks, and either failing aborts: **(1) the current branch must be `main`**; **(2) the working tree must be clean** (no uncommitted changes). That is, production deployments of the Worker and both Agent types are allowed only from "an accepted, committed `main`". The staging commands deliberately carry no guard.
- `npm run deploy` is written explicitly as `wrangler deploy --env=""`, which unambiguously targets the top level (production) under a multi-environment config, avoiding wrangler's bare `deploy` interactive warning.

### 16.3 Google Cloud Side (separate Cloud Run service within the same project)

No new GCP project; the service `forge-agent-staging` is created within the same project `sixth-impulse-286413`, alongside `forge-agent`, with images that don't overwrite each other.

- **Independent LLM keys (since 2026-10-18)**: staging switched to GLM, with its key stored as Secret `llm-api-key-staging`; production still uses `llm-api-key` (DeepSeek). The two keys belong to different vendors and **cannot be shared** — the earlier "reuse the same key" approach is retired; isolation now has a key boundary on top of the service boundary.
- **Separate internal secret**: Secret `agent-secret-staging`, different from production's `agent-secret` → production Worker preview tokens (HMAC over `AGENT_SECRET`) necessarily fail validation on staging and vice versa, naturally blocking cross-environment tokens.
- **Cost cap pinned**: `--max-instances 1`, at most one job at any moment; the run budget matches production (configurable to 3400s on the admin side, must be < `--timeout 3600`) — **do not set staging's run cap smaller than production's**, otherwise normal multi-file generations get killed by their own timeout (the initial 300s hit exactly this, with failure message "Agent 执行超时(上限 300s)"), destroying its validation value. The real abuse gate is `--max-instances 1`, not shortening the timeout.
- Deploy scripts: `npm run agent:deploy:staging` / `npm run agent:deploy:prod` (the single source of parameters).

### 16.4 Environment Badge (how the frontend tells environments apart)

Production and staging **share the same `web/dist`**, so the environment name can only be **delivered at runtime**, not via Vite build-time variables (otherwise the staging badge would get built into the production bundle). Implementation: staging's `vars` sets `ENVIRONMENT=staging`, production doesn't → `GET /api/auth/config` falls back to `environment: "production"`; the frontend `<EnvBadge>` (mounted on `TopBar` / `AdminBar` / `Landing` / `Login`) renders the amber `STAGING` badge only when it reads a non-production value.

### 16.5 Isolation Verification (measured conclusions, 2026-10-17)

| Check | Result |
| --- | --- |
| D1 data isolation | Production `users/projects/versions/site_data = 13/26/36/3`; staging started all 0. After one E2E run staging was `1/1/1`, and production's counts **didn't move at all** |
| R2 artifact isolation | `forge-v2-artifacts` 20 objects (production projects), `forge-v2-artifacts-staging` only 3 (the E2E project); neither appears in the other |
| Durable Object isolation | Independent Worker ⇒ independent DO namespace; staging's generated app `/p/:token/api/db/:collection` returned 200 (bindings wired; a missing config would 500), and the same token 404s at production's same path |
| Cross-environment preview tokens | Staging token at staging `GET /p/:token/` = 200; the same token at **production** 404 (`AGENT_SECRET` differs) |
| Production untouched | Production still serves the old build `assets/index-BRvPdKmy.js` (not redeployed), and `/api/auth/config` still returns `{"google":true}` with no `environment` field |
| Cron independence | The CF API shows `forge-v2` and `forge-v2-staging` each with an independent `* * * * *` schedule, each inspecting only its own environment's jobs |
| End-to-end | Staging signup → create project → `generate` → Cloud Run `forge-agent-staging` writes multi-file React → build → commit lands the version (draft `version_no=0`, 307834 B, 20 source files) → `GET /p/:token/` 200. Only staging's D1/R2 were written the whole way |

### 16.6 Status and Notes

- **Staging Google login enabled (2026-10-17)**: `GET /api/auth/config` = `{"google":true,"environment":"staging"}`. How: append `${STAGING_PUBLIC_BASE_URL}/api/auth/google/callback` to the existing OAuth client, then write `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` separately for the staging Worker. Verified that `GET /api/auth/google` 302s to Google properly with no `redirect_uri_mismatch`, meaning both the client and the callback allowlist took effect.
- ⚠️ **Worker secrets are write-only**: the production values cannot be "read and copied" by any environment. Wrangler's actual write method has always been `printf '%s' "$值" | npx wrangler secret put …` (logs show `secretSource: stdin` / `isInteractive: false`, see `~/Library/Preferences/.wrangler/logs/`), so the values can't be found in shell history — when switching to a new environment, only the **person holding the original secret** can enter it again, or create a new OAuth client for that environment.
- Staging's D1 retains this E2E's 1 user / 1 project / 1 version (a test environment; can be kept or cleaned as needed).

### 16.7 Branch Model and Release Flow

**Develop and test on the `staging` branch → merge to `main` after validation → release from `main`.** Environment isolation (§16.2/§16.3) and branches are **two independent axes**: the branch decides "which copy of the code runs", and the wrangler environment decides "which set of resources it runs on". The daily flow combining both:

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

Key points:

- **`main` is the "releasable" baseline**: every commit on `main` should be accepted and deployable at any time; don't accumulate unverified changes directly on main.
- **The guard blocks production only**: `npm run deploy`, `agent:deploy:prod`, and `agent:deploy:free:prod` all pre-check "branch = main" + "clean working tree" (`scripts/guard-prod-deploy.mjs`). `npm run deploy:staging` / `agent:deploy:staging` / `agent:deploy:free:staging` have no guard at all — uncommitted, unmerged changes are exactly what it exists to validate.
- **Staging and main share the same `web/dist` and `agent/` source**: so "the code works on staging" cannot rely on build-time differences; environment differences may only come from the config in §16.2/§16.3 (bindings, `ENVIRONMENT`, Cloud Run service names and specs). Any behavior that "only takes effect in one environment" must be expressed as runtime configuration.
- **The frontend environment badge** (§16.4) is the guardrail for this discipline: amber `STAGING` at `app-staging.1forgen.site`, a clean top bar at `app.1forgen.site`.

## 17. Generation Quality: Template Design System + Design Review Loop (2026-10-17)

Goal: users are not professional developers, so **the completeness, look, and interactions of the output must be backstopped by the platform, not left to the model's improvisation**. The approach: bake "Apple-homepage-grade" visuals and interactions into **deterministic defaults** in the template, then lock them in with a prompt contract + a second review round.

### 17.1 Three Upgrades

| Block | Content | Location |
| --- | --- | --- |
| Data capability | Pagination/search/real totals, atomic counters, object listing | `src/lib/{projectDb,appdata}.ts` (§14.1) |
| Design system | Three-layer token CSS + 30+ component primitives + icon/motion/data hooks | `agent/template/src/{styles,components/ui,lib}` |
| Prompts + review | Contract-based system prompt (design/components/data/state/self-check) + same-session second design polish round with rollback | `agent/src/{prompt,runner,config}.ts` |

### 17.2 Template Design System (agent/template/)

Dependencies are **preinstalled in the image**; the model doesn't need to (and isn't allowed to) install packages: `lucide-react` (icons), `motion` (animation); the script contracts of `package.json` / `vite.config.js` / `Dockerfile` are unchanged.

Key files:

```
LICENSE / THIRD_PARTY_NOTICES.md  模板 Apache-2.0 许可与依赖完整说明,随源码与 dist 交付
package-lock.json                 模板精确依赖树,随源码导出
src/index.css                     4 行,只 import 三层样式(模型别删)
src/styles/tokens.css             ★ 模型唯一允许改的文件:--brand / --accent 两行
src/styles/theme.css              @theme inline 把 token 桥成语义工具类 + 关键帧/工具类
src/styles/base.css               reset / focus-visible / .wrap / .display-* / .glass / reduced-motion 兜底
src/components/ui/index.js        唯一的 import 出口(barrel)
src/components/ui/{Button,Card,Field,Modal,Tabs,Toast,Feedback,Layout,Icon,Reveal}.jsx
src/lib/cx.js                     className 拼接
src/lib/motion.jsx                Reveal/Stagger/useCountUp/formatNumber(包装 motion/react)
src/lib/forge.js                  db / kv / counter / blob / storage
src/lib/connectors.js             外部连接器的公开配置(connector/hasConnector/loadGA4)
src/lib/store.js                  useCollection / useCollectionStats / useKv / useCounter / useUpload / useBlobs / useDebounced
src/App.jsx                       示例应用(留言墙)= 模板自身的冒烟基线
```

- **Token-first three layers**: `tokens.css` (palette and derived color scales, `color-mix` derivation + both dark sets) → `theme.css` (`@theme inline` semantic classes) → `base.css` (typography/accessibility/fallbacks). Light/dark switching takes effect in **pure CSS**; components never write `dark:` variants.
- **Semantic vocabulary** (listed directly in the prompt for the model to copy; no hardcoded hex, no `gray-*`): `bg-canvas|panel|panel-2|brand-soft`, `border-line`, `text-ink|muted|brand|brand-600|accent|success|warning|danger`, `rounded-card|field|pill`, `shadow-card|lift|pop`, `ease-soft|spring`, `font-sans|num`.
- **Components are the "path of least effort"**: a single import path, zero props still renders passable styles, three states (loading skeleton / `EmptyState` / `ErrorState`) built in, `ConfirmDialog` for destructive operations, `useToast` for feedback, `Reveal/Stagger` for motion. Icons use `<Icon name="Search" />` (whitelist `ICON_NAMES`), no icon library introduced.
- **localStorage/sessionStorage forbidden**: the publish page and preview page run under a CSP `sandbox` opaque origin, where accessing them throws `SecurityError` and white-screens the page; temporary UI state that needs "remembering" uses `storage.get/set` (internal try/catch + in-memory fallback), and all business data goes into db/kv.

### 17.3 Prompt Structure (agent/src/prompt.ts, ≈23 KB)

`systemPrompt(lang, mode)` is a **function** (both the artifact language and the job type are parameters, see §17.8), ordered: role and runtime environment → **output language block** (highest priority, see §17.8) → **file permissions** (may edit `src/**` and the two lines of `tokens.css`; platform files are off-limits, violations get force-restored) → **design system contract** (color/typography/rhythm/motion) → **component library catalog** (signatures and "when to use" of the 30+ exports) → **page structure** (nav/Hero/core features/stats/optional/footer, anchors and ids mapped) → **interaction and state coverage checklist** → data layer (`DATA_SDK`) → state linkage → **pre-finish self-check** (walk the main flow with real clicks + error paths + data capability coverage + visual checklist) → delivery-notes format.

`DATA_SDK` is not just "usage documentation" but a **coverage requirement**: the platform has four backend capabilities (db / counter / kv / blob); first judge which ones this app can use, **and every one it can use must be used** (normally ≥2), with decidable trigger conditions given — any summary figures like "today X / total X / X times in all" must use `counter` to maintain the summary (details go into db, summaries via counter; don't pull all details down and compute on the fly); any "settings/announcements/toggles/store profile" must use `kv`; any image/file upload must use `blob`. `generatePrompt` requires the selection to be written into `plan.json`'s `data` field (`{collections,counters,kv,blob}`); `POLISH_PROMPT`'s review checklist gains a 9th item specifically verifying "the capability is actually wired into the UI", and item 8 remains "is the data real/paginated/server-side searchable".

`generatePrompt`'s steps are pinned as: read the scaffold → write `plan.json` → **write `palette[0]/[1]` into `tokens.css`** → implement pages → self-check. The plan card's color swatch and the finished product's primary color therefore necessarily match (token-first).

`polishPrompt(lang, mode)`'s review checklist diverges at item 10 by mode: generate checks "is all copy in the target language (the scaffold's Chinese sample copy, any missed component defaults)"; chat checks "is the copy added/modified this time in the target language, with untouched old copy left as is". The closing sentence likewise uses the target language.

### 17.4 Design Review Loop (runner.ts)

After the first draft's build passes, the **same session** runs another round with `POLISH_PROMPT` ("design-director review and polish", a 10-item checklist: color/hierarchy/rhythm/components/three states/feedback/motion/data/data-capability coverage/copy), doing only fine polish — no overturning structure, no changing data interfaces. Engineering guardrails:

1. **Build before review**: the first round's source tree is stored via `collectSource` as the baseline; the review round only starts once the first draft has passed the build.
2. **A failed review round doesn't fail the job**: timeout or exception only writes one `agent_log` warning line; the first round's result is kept.
3. **Review output fails to build → rollback**: `restoreFromMap(workspace, baseline)` overwrites back to the first draft (and deletes extra files the review round added), then builds once more — the input already passed, so it will pass.
4. **Delivery notes still come from round one**: the review round's closing wording ("what I changed") is unsuitable as delivery notes; `RunResult.summary` prefers the first round's body text.
5. **Doesn't touch the stage whitelist**: the review round only changes the `progress` copy, see §4.
6. **Duration**: review-round budget = `min(AGENT_POLISH_MAX_MS, remaining total budget)`, auto-skipped if less than 30s remains; the overall cap is the admin-side `max_run_ms` (default 1500s, configurable to 3400s, < Cloud Run `--timeout 3600`), and the Cloud Run red line is unchanged.

### 17.5 Staging Verification Checklist

```bash
BASE=https://app-staging.1forgen.site/s/<slug>/api
curl -s "$BASE/db/todos?limit=5&offset=0&order=asc&q=买"   # {items:[…],total:N,limit:5,offset:0}
curl -s -X POST "$BASE/kv/visits/incr" -H 'content-type: application/json' -d '{"by":1}'   # {key,value:1}
curl -s "$BASE/kv/visits/incr"                             # {key,value:1}
curl -s "$BASE/kv/visits"                                  # KV 无值 → 回落读计数器
curl -s "$BASE/blob?prefix=uploads/&limit=50"              # {items:[{key,size,uploaded}],…}
curl -s -X PUT "$BASE/blob" -d x                           # 405(列举只允许 GET)
```

After generating, **look at both `/s/<slug>/` (the publish page) and `/p/<token>/` (the preview page)**, checking item by item: plan-card color swatch = the finished product's primary color; one unique h1 per page, uniform section spacing; no horizontal scroll at 390px, no emptiness at 1280px; all three states present in async areas; hover/active/focus-visible/disabled visible; still fully readable under the system's "reduce motion"; data survives refresh, draft and live invisible to each other; console shows **no `SecurityError`**; the `/api/jobs/:id` stage only ever shows `planning|coding|building`; `_forge_counters` is invisible in the owner's "Data → SQL" structure tree.

### 17.6 Known Limits and Follow-ups

- **Read endpoints have no rate limit** (only writes do): pagination/search doesn't amplify risk, but a page that loops over pages keeps firing read requests; adding read rate-limiting, if needed, is a separate topic (avoiding breaking existing apps; not done this round).
- **`src_json` grows with versions**: template files enter every version's source tree, making each version ≈45 KB larger than before the upgrade (the total is still on the order of a few hundred KB, with plenty of headroom under the 2 MiB chat payload cap). If it ever approaches D1's per-row/per-value limits, consider changing platform files to "backfill on demand" instead of storing them with the source tree.
- **The review round is "polish", not "redo"**: it improves execution consistency (were tokens used, are all three states present), and doesn't guarantee every design judgment is right; the prompt contract and component defaults remain the main safeguard.

### 17.7 Generated Apps' Tab Title and Live Code View (2026-10-17)

Two "completeness" details, both surfaced in the staging full-chain E2E:

- **Browser tab title**: `index.html` is a platform file the model can't change, and the template hardcodes `<title>应用</title>`, so every generated app's tab was named "应用". The approach changed to **injection at delivery**: `injectRuntime(html, apiBase, dataEnv, title)` replaces `<title>` with `projects.name` (already overwritten by `plan.name` when generate settles; chat doesn't overwrite it); in testing `/p/<token>/` yielded `<title>豆屋管家</title>`. It only affects the entry HTML (assets don't go through this path); when `projects.name` is empty the template stays as is; the title text is escaped as an HTML text node and truncated to 60 characters.
- **Live "code view" preview**: the model's `write/edit` sometimes provides **absolute paths** under the working directory, while the original code normalized with `relative(workspace, join(workspace, path))` — `path.join` **concatenates** rather than replaces on absolute paths, computing misaligned paths like `tmp/forge-agent/<jobId>/src/…`, so `readIfExists` couldn't read → `files_preview` stayed `null` and the frontend's live-code panel stayed blank. Fix: `isAbsolute(path) ? path : join(workspace, path)` then `relative`, discarding paths that land outside the working directory (starting with `..`).

### 17.8 Artifact Copy Language (2026-10-24)

**Origin**: the system prompt originally hardcoded "all copy in Simplified Chinese"; a user requesting in English still got an all-Chinese app. And the Chinese wasn't only in the copy the model writes — the scaffold's **platform files** (which the model may not change) contain a batch of runtime default strings (empty state "暂无内容", Modal's "确认/取消", error "加载失败"), `index.html`'s `<html lang="zh-CN">` could never be changed, and the platform's own progress/error messages show Chinese verbatim.

**The three "languages" are not the same thing; don't conflate them**:

| Concept | What it is | Who decides |
| --- | --- | --- |
| **Artifact language** | The copy language inside the generated app | The agent detects it from the request body (`agent/src/lang.ts`) |
| **Platform UI language** | The language of the platform chrome (job progress, error messages) | The Worker's `body.lang`, passed across the Worker→agent boundary to the agent (`RunRequest.lang`); the same 11 codes as the artifact set (§20.5) |
| **Scaffold locale** | The language of platform default copy (empty states/errors/Modal buttons) | A `setLocale()` call the artifact itself writes into `src/App.jsx` |

**How the artifact language is determined** (`agent/src/lang.ts`):

1. Script classes: kana → `ja`, hangul → `ko`, Cyrillic → `ru`; if CJK characters are ≥20% of "CJK + Latin letters" → `zh` — this threshold exists for "a Chinese request stuffed with React / TypeScript / IndexedDB", which a letter-count ratio would misjudge as English.
2. Latin scripts: weighted scoring on each language's **characteristic words** (only highly distinctive words are collected; generic function words would bleed across languages); a hit requires the top score ≥2 and 2x the runner-up.
3. Not identifiable → fall back to the platform UI language → fall back to `zh`.
4. When the user **explicitly specifies** a language in the request ("用英文", "in English", "日文"), the user's word wins — this is left to the model and written explicitly in the prompt.

The detection logic is the only branch-heavy code in this change and has its own self-check script: `node --experimental-strip-types agent/scripts/lang-check.mjs` (zh/en/ja/ko/ru/es/fr/de/it/pt/nl + mixed text + fallbacks).

**How the prompts implement it** (`agent/src/prompt.ts`): `systemPrompt(lang, mode)` / `polishPrompt(lang, mode)` / `generatePrompt(req, lang)` / `chatPrompt(req, lang)` are all parameterized by target language; the system prompt gets an **output language block** at the top that **names** the target language — the instructions themselves are written in Chinese, and without naming it the model would most likely follow the Chinese. Generate requires all copy in the target language; chat requires only **what is added/modified this time** in the target language, with existing copy untouched (saying "add a dark mode" on an English app won't translate the whole site).

**Scaffold locale** (`agent/template/src/lib/locale.js`): a zh/en pair of the platform default copy, switched by `setLocale()` and fetched with `t('key')`. Default strings in platform files always go through `t()`, never hardcoded Chinese literals. The app side has exactly one line: `setLocale('en')`.

- **`<html lang>` is changed in both places**: ① at runtime `setLocale()` changes `document.documentElement.lang`; ② **at build time** the template's vite plugin (`agent/template/vite.config.js`) writes it into the first-paint HTML based on the agent-passed `FORGE_LOCALE` — `index.html` is a platform file the model can't change, and the first-paint HTML arrives before the JS; relying only on the runtime change lags one beat (screen readers and browser translate prompts read the first paint).
- **No reliance on model diligence**: before building, the agent runs `ensureLocaleCall()`, checking whether `src/App.jsx` has that call — if missing it's added, if wrong it's corrected. Chat mode **doesn't touch** an existing app's locale (that would translate the whole site's default copy).

**Platform chrome**: the agent's progress/log/error copy follows the UI language (`agent/src/i18n.ts`, which does not share a module with the Worker's `src/lib/messages/` — two independent build products); the Worker side's `jobs.error` follows the lang in the job payload (`srv(lang, key)`); the draft preview badge "测试环境 · 草稿预览" renders according to the `?lang=` on the preview URL (carried by the frontend on the iframe's URL) in all 11 languages.

**Delivery notes: language and extraction** (both have burned us):

1. **Language**: the model sometimes writes the closing in the prompt's language (Chinese) rather than the target language — the app content it wrote was English, its self-check even said "all English ✓", but the final delivery note was Chinese (and it claimed "and wrote the delivery note in English"). Two safeguards: ① the prompt **ends** by pinning again "your final reply (delivery note) must be written in <language>" (end-of-prompt instructions carry more weight; the top language block gets diluted by thousands of following Chinese words); ② the agent side checks whether Chinese characters got mixed into the delivery note (`matchesLang` in `lang.ts`), and if it went astray, asks again with a **short prompt whose only ask is to write the delivery note** (`deliveryNotePrompt`) — short instructions with a single goal work far better than emphasizing inside a long prompt; if that fails, the original is kept.
2. **Extraction**: only trust the body text **after the last tool call** — some models (measured MiniMax-M3.1-Flash) say one sentence at the very start, then think and call tools the whole round without emitting body text again at the end; taking "the last paragraph of body text" would grab the opening line as the delivery note. No body text after tool calls → treat as "the model wrote no delivery note", return empty, and let the Worker fall back to the platform's own closing copy (`commit.generate`, in the job's language).

**Known limit**: the scaffold locale ships only zh and en — for artifacts in Japanese/Korean etc., the platform default copy falls back to English (the app's own copy is still in the target language).

## 18. Chat Pane Interactions (2026-10-18)

Three UX reinforcements on the user-facing "submit a request" path, all in `web/src/components/ChatPanel.tsx` + `web/src/pages/Workspace.tsx`:

- **Keep typing during generation (steering)**: while a job is `pending/running` the input is no longer disabled; Enter/"Append" delivers the content to the executing agent (server-side chain in §5.2). The input's placeholder and button copy switch by state: during generation "Append" + "■ Stop" side by side; when idle only "Send". If the steer request fails, **the input and attachments stay in place** so the user can retry directly; if the job just ended (409) it degrades to a normal send without losing content.
- **Pasting images**: `Cmd/Ctrl+V` adds clipboard images directly to the pending attachments, using the browser's native `clipboardData.items`, no extra dependencies. Paste sources often lack extensions; `withPastedName()` supplies one from the MIME type (`粘贴图片-<ts>.jpg`), otherwise the whitelist would reject it. Plain-text paste is not intercepted — it remains the browser's default behavior.
- **IME Enter doesn't misfire**: Enter during composition confirms candidate words; `onCompositionStart/End` state + `isComposing` / `keyCode 229` / a 100ms window after composition ends jointly intercept it, candidates land in the input first; another Enter then sends.
- **Attachment limits switch by state**: idle sends use `SEND_LIMITS` (images 2MB / text 256KB / total 4MB); mid-generation steering uses the tighter `STEER_LIMITS` (1MB / 128KB / 1.2MB, see §5.2); the two constant sets are written separately in `web/src/lib/attachments.ts` and the Worker-side `src/lib/attachments.ts`, with the latter authoritative (the frontend only pre-filters). The tooltip's limit copy is generated dynamically from the current state.
- **Resizable chat pane**: on desktop, dragging the 6px handle on the right edge changes the width (`pointerdown` → follow movement → persist on release), double-click resets. Default width raised from 380px to **460px**; range `340–760px`, additionally constrained by `window.innerWidth - 360` so the preview area is never squeezed out. Width is stored in `localStorage['forge.chatWidth']` (both read and write do `clampWidth` + try/catch; in private mode resizing still works, it just isn't remembered). On narrow screens (`<768px`) `w-full` decides; the inline width applies only on desktop — mobile remains full-screen + top tab switching.

## 19. Connectors: Letting Generated Sites Use External Systems (2026-10-19)

The answer to "can I hook up payments/analytics/repos" on the user side is not MCP but **platform hand-written provider adapters**. Full design and trade-offs in `docs/CONNECTORS.md`; this section records only what landed in the platform and its runtime constraints.

### 19.1 Why Not MCP

- pi **deliberately does not support MCP** (`pi-coding-agent/README.md:446`); the current session mounts only `createCodingTools`. Supporting MCP would mean writing a pi extension ourselves plus three new problem areas: process lifecycle, auth, and tool-name conflicts.
- What generation needs — "use an external account to do a thing" — is achievable with **injected credentials + prompt explanation + the agent's own bash**, with zero new runtime.
- Runtime (visitor pages) is not an MCP client scenario: pages run in a CSP `sandbox` opaque origin and can only call external APIs with public values or a user-supplied backend.

### 19.2 Three Forms and This Phase's Scope

| Form | Example | Credentials | This phase |
| --- | --- | --- | --- |
| A pure injection | GA4 `measurementId`, Stripe Payment Link, maps key | All public | ✅ |
| B generation-time authorization | GA4 Data API, Search Console, GitHub | OAuth, used once at generation time then discarded | ✅ (first provider: GA4) |
| **B′ bring-your-own key (`auth:'apikey'`)** | **Stripe, Supabase, various long-tail SaaS** | **User generates a key in the provider's console and pastes it in** | ✅ (first provider: Stripe) |
| C runtime closed loop | Stripe runtime custody + webhooks | Contains secrets; the platform must keep them server-side | ❌ Deferred (the platform does not hold funds-related secrets) |

Adding a provider = adding one file `src/lib/connectors/providers/*.ts` and registering it in `registry.ts`, **no schema change, no core code changes**.
**B′ is this design's expansion strategy**: the `oauth` form requires the platform to register an OAuth client + callback URL with each provider (often with approval processes), which is impossible for the long tail; the `apikey` form requires **zero platform-side registration** — the user already has their own account with the provider, and copying a key costs far less than the platform applying on each one's behalf.
So apart from the few "OAuth-only / worth registering" providers (GA4, GitHub), **everything else goes through `apikey`**.
It reuses exactly the same storage and parsing chain as GA4 (the same `connections` table, the same `CONNECTOR_KEK`, the same `resolveGrants`),
with the **sole difference being the credential source**: from "a token exchanged with the upstream" to "a key the user pasted in".

### 19.3 Data Model (two tables, `schema.migrate-connectors.sql`)

- `connections` (**account level**): one external account can serve multiple projects, avoiding n OAuth round trips for n projects. Credentials are AES-GCM encrypted and stored in `credentials` (master key `CONNECTOR_KEK`), `UNIQUE(user_id, provider, account_label)`; re-authorization overwrites.
- `project_connectors` (**project-level binding**): `PRIMARY KEY(project_id, provider, env)`. **The `env` dimension is mandatory**, matching KV/R2/DO's "project × environment" scheme, otherwise sooner or later "the draft's test payment lands in the real account".

### 19.4 The Four Flows

0. **Bring-your-own key → encrypted storage (B′ only)**: paste the key in the panel → `POST /api/connections/:provider/secret` (`src/routes/connections.ts`).
   Validation accepts only keys declared in `provider.secretInputs`; missing required fields are rejected; the key is AES-GCM encrypted and written to `connections` (same table and KEK as OAuth),
   non-secret config is written along the way, and `setBinding` binds it to `(project, env)` — the same semantics as the OAuth callback. **Values only go up, never echo back**: list endpoints never return `credentials`.
1. **Public values → generation page**: `injectRuntime()` (`src/lib/artifacts.ts`) injects an extra `window.__FORGE_CONNECTORS__` containing only keys marked `public` in `configFields`. The SDK lives in `agent/template/src/lib/connectors.js` (a platform file, force-restored via `PLATFORM_FILES`), providing `connector()/hasConnector()/loadGA4()`. With no binding, **the global is not injected** and the artifact is byte-for-byte identical to before.
2. **Reading real data at generation time**: `launchJob` (`src/routes/generate.ts`) resolves grants ("draft binding first, fall back to live", `resolveGrants`) and dispatches them once via `AgentRunRequest.connectors`; the agent side writes them to `.forge/connectors.json` in the working directory (`.forge` is in `SKIP_DIRS`, kept out of the source tree/artifacts), and `connectorsBrief()` splices usage instructions into the user prompt. **Credentials in plaintext live only in this one request and the container** — never in D1/R2/versions.
3. **Runtime closed loop (form C)**: not done. The future escape hatch is an `ext` proxy branch in `src/lib/appdata.ts`, and only **test-mode** credentials would be considered for proxying.

### 19.5 Interaction: Inherit by Default; Only Override on Purpose

- Rule: **a binding means everything takes effect by default**; the per-turn chips are just toggles to "temporarily disable / temporarily enable", **not persisted, auto-reset at the end of the turn**, avoiding connectors becoming a second "re-pick on every message" attachment.
- **Permission tiers**: read-only providers are included by default every turn; writable providers (non-empty `writeScopes`) are **not** included by default — the user must enable them for the turn, and the agent must explain the impact before acting.
- The capability bar `web/src/components/ConnectorChips.tsx` sits above the chat input (chips always carry a `只读`/`可写` badge); full management lives in `web/src/components/ConnectorsPanel.tsx` (the top-bar "Connectors" entry; manage account switching / revocation / re-uploading keys / what draft and live each bind / form-A config). **The chat pane only toggles; it does not configure.**
- The capability bar shows only bindings that **will actually take effect**: a provider whose binding exists but whose credentials are missing/revoked gets no chip (the same rule as `resolveGrants`), so users never see a lit chip that does nothing.
- Panel entries branch three ways by `auth`: `oauth` → "Connect" jumps to the authorization page; `apikey` → password field to paste + "Save and bind" (collapsed once saved; "Re-upload" overwrites to rotate, and "Use existing key" binds an account-level connection to this project); `config` → plain inputs.
- **First-time onboarding happens in the conversation, not the panel**: the capability bar's "+ Connect" expands an inline provider list → on selection, `web/src/components/ConnectorCard.tsx` credential card expands at the end of the conversation flow. Keys **only go up and are never echoed**, and **never travel the message pathway** (a direct `POST /api/connections/:provider/secret`) — plaintext never enters the `messages` table, the prompt, or `agent_log`. The panel keeps only slow variables (account switching / revocation / re-upload / separate draft and live config). The card binds to `draft` by default; going live requires explicitly clicking "线上".
- **The card offers reuse before creation**: its top lists previously saved credentials for this provider under the account (clicking one writes only a project-level binding, **without re-uploading the key**; also applies to `oauth` — selecting an already-authorized account means **no second authorization**); switching accounts or uploading a new key goes through the input boxes or the authorization page below. The data comes from the account-level `connections` in the `GET /api/projects/:id/connectors` response (the draft/live copies are the same list).
- Chips are read-only during generation: credentials were fixed at dispatch time; steering does not change connectors.

### 19.6 Runtime Constraints

- `CONNECTOR_KEK` is a **Worker secret, written once each at the top level and in `env.staging`** (`wrangler secret put`; binding-type config is not inherited). **Rotating it = all user connections need re-authorization** (decryption failures are uniformly handled as "please re-authorize").
- Trust model: the platform's master key can decrypt every user's connection credentials — this is stated in the panel copy, not hidden; avoiding it requires waiting for Workers for Platforms.
- Without `CONNECTOR_KEK` configured, connectors degrade entirely to unavailable (endpoints return `enabled:false`, the panel says so), **without affecting other features**; the generation chain's `resolveGrants` just returns empty.
- OAuth reuses the login Google client (`GOOGLE_CLIENT_ID/SECRET`); the random state is stored in an HttpOnly cookie against CSRF; the callback redirects back to the workspace at the top level with `?connected=` / `?connector_error=`. The state looks like `<random>~<projectId>~<env>~<non-secret config base64url>` — required config already filled in the card travels with the authorization round trip, and at callback time is **merged** into storage with `connectionId` (not wholesale overwritten), so "switch account and re-authorize" won't wipe a previously entered `propertyId`, and the user doesn't have to come back and fill it again.
- The prompt's payment stance becomes tiered: **external payment links** (Payment Link) are allowed; collecting/storing card numbers, CVC, passwords remains forbidden.

### 19.7 To Be Completed by the User on the Platform Side (v0 acceptance dependencies)

1. Google Cloud Console: append the callback URI `${PUBLIC_BASE_URL}/api/connections/ga4/callback` to the existing OAuth client (once each for staging and production).
2. Enable the **Analytics Data API** (`analyticsdata.googleapis.com`), otherwise generation-time reads are 403.
3. Acceptance criteria for GA4 as the first provider: the generated app's stats block shows **real GA numbers** (not invented by the model), and the `G-XXXX` reported by the page comes from the bound config.

## 20. Credits and Billing: Overseas Prepayment + Multilingual (2026-10-20)

Aimed at overseas users, **prepaid credits**: signup grants a small trial allowance; afterwards credits come from one-time top-up packs or monthly subscriptions. Payments go through **MoR (Merchant of Record) — [Creem](https://creem.io) has been chosen**: the platform holds no overseas entity and does not collect or remit taxes; Creem, as merchant of record, invoices and collects from end users and bears tax compliance; we are only responsible for granting credits after funds arrive.

### 20.1 Terms

- **The unit is the "credit"**. One generation = **1 credit**; `generate` (first generation) and `chat` (chat edit) are priced the same. The price table is `JOB_COST` in `src/lib/credits.ts`; changing prices touches only that one place, no caller changes needed.
- **Four sources**: signup / first Google login grant (`SIGNUP_CREDITS = 5`, i.e. 5 generations), one-time top-up packs, monthly subscriptions, and **admin manual grants** (`grantAdminCredits` in `src/lib/credits.ts`; single user `POST /api/admin/users/:id/credits`, batch `POST /api/admin/users/credits`, same amount, ≤100 users per call, amount a positive integer ≤100000; grants only, never deductions, one `credit_ledger.reason = admin_grant` row per user). The admin can optionally also send arrival emails: sent only to addresses with `email_verified = 1`, bilingual (zh/en) body reusing `grant.*` from `src/lib/messages/grant.ts`; an email failure does not roll back the credits. Grants are **explicitly written** into `users.credits` (see §20.6), not relying on `schema.sql` column defaults.
- **Failure is free**: when a job fails or the user clicks "Stop", the credits frozen at initiation are refunded in full (both frontend copy and conversation-card wording rest on this promise).
- Why prepayment rather than monthly post-paid: prepayment is naturally an **abuse gate** (see §20.2), and it keeps cash-flow and bad-debt risk outside the platform.

### 20.2 Freeze-Settle (core mechanism, `src/lib/credits.ts`)

- **Credits are frozen when the job is initiated** (`reserveCredits`: one atomic conditional deduction `UPDATE ... WHERE credits >= ? RETURNING credits`, concurrency-safe), and **a successful settle (commit) deducts nothing more** — the frozen amount is the bill for this run.
- **Why not deduct on success**: freezing is simultaneously the **gate**. Otherwise a user could repeatedly initiate doomed jobs with 0 credits, and every failed job still burns LLM and Cloud Run money (the only global concurrency gate is Cloud Run's `--max-instances`, which doesn't stop this). So the gate lives in exactly one place — the freeze in `launchJob`; the `generate` / `chat` routes **no longer pre-check balances** (a job creation sits between the pre-check and the freeze; two checks would actually create a bypass window).
- **The balance of record is `users.credits`**; all increases/decreases land on a single conditional `UPDATE`; `credit_ledger` is an **append-only** audit trail. In the extreme case (deduction succeeded, process died before the ledger row was written) a ledger row goes missing, but the balance is always right — reconcile against the balance, use the ledger as evidence.
- **Idempotency**: the unique index `idx_ledger_job_once` guarantees at most one `job_hold` and one `job_release` per job. `releaseJobCredits` looks up how much to refund from the ledger itself (no hold row, or already refunded → returns 0), so callers pass only `jobId`. Of the three terminal paths (`commitJob` / `markJobFailed` / `cancelJob`), the latter two refund only when a **state transition actually happened** (`meta.changes` truthy); on the normal path a job is genuinely refunded only once.

### 20.3 Usage and Cost Metering

- When the agent winds down (**in all three terminal states: success, failure, user stop**) it calls `POST /internal/jobs/:id/usage`, reporting the pi session's accumulated tokens and `runMs`; the Worker side's `src/lib/pricing.ts` converts to `llm_cost_usd` / `gcp_cost_usd` and **upserts** into `job_usage` by `job_id` (idempotent; callback replays are harmless).
- **Deliberately no status guard**: failed and stopped jobs burn tokens and instance time just the same; missing them makes real gross margin uncomputable — this is precisely the core problem this change set out to solve (before it, the platform had no idea what a generation cost).
- **`runMs` covers the whole request's duration**, not just the pi part: Cloud Run bills by instance lifetime, and copying the template, creating the pi session, and the platform-side build all burn money.
- Prices are **snapshots**; changes must note source and date (`pricing.ts` comments record DeepSeek's price tier and source); **unknown models are recorded as 0** (better to under-count than invent); staging's GLM hasn't been priced item by item, so it's 0 for now. Historical costs already in the database are not recomputed — when recalculation is needed, use the raw tokens in `job_usage` (usage is the truth).
- Usage reporting is **pure statistics**: if the write fails, log it and move on; it never changes a job's terminal state (agent-side `reportUsage` is fire-and-forget).

### 20.4 Data Model (`schema.migrate-billing.sql`; fresh installs see `schema.sql`)

Four tables: `job_usage` (one row of real usage and cost per job), `credit_ledger` (append-only ledger), `orders` (settled top-up orders), `subscriptions` (subscription states).
Existing databases run the incremental migration, **not** `schema.sql` directly (it errors with `no such column`). Once each for staging / production:

```bash
npm run db:migrate:billing:staging     # staging(前面加 yes |,wrangler 会问确认)
npm run db:migrate:billing:remote      # 生产
```

The unique index on `orders.provider_ref` (`idx_orders_provider_ref`) is the **sole basis for webhook idempotency**: payment platforms replaying notifications is normal; the database blocks them.

### 20.5 Multilingual (11 languages)

The platform UI speaks **11 languages**: `zh, en, ja, ko, ru, es, fr, de, it, pt, nl` — deliberately the **same set as the artifact language set** (§17.8), so "the interface language" can double as the artifact-language default without a mapping table.

- **Frontend**: a homegrown minimal i18n (`web/src/lib/i18n/`), **no third-party library**. `langs.ts` is the single source of truth for the language list (`LANGS` / `LANG_OPTIONS` / `Lang`); one dictionary per language, `dict.<lang>.ts`. **Key names are the sole contract** — adding a language = adding one `Record<DictKey, string>` dictionary + one entry in `langs.ts` + one loader line, **without changing a single component**; `DictKey = keyof typeof zh` makes one missed key a compile error.
- **Per-language chunks**: each dictionary is loaded with a dynamic `import()`, so the initial bundle carries only the active language (~10 KB gzip each) instead of all 11 (~+70 KB gzip). The provider keeps the previous dictionary on screen while the next chunk loads, and renders nothing before the first one arrives (an SPA shows a blank root anyway) so the page never flashes the wrong language.
- **Language detection**: `localStorage['forge-lang']` first, then the browser (`navigator.language` prefix → `ja-JP` → `ja`); the default is English. `<html lang>` is set per language (BCP-47: `zh` → `zh-CN`). `LangToggle` is a **dropdown menu** listing all 11 in their native names (a two-way toggle was fine with two languages and unusable with eleven); hovering an entry preloads its chunk.
- **Legal documents live in their own module** (`web/src/lib/i18n/legal/`), not in the UI dictionary. UI copy follows the feature set; legal text follows the law — and Creem's account review requires the "pornography / adult / NSFW content is prohibited" clauses to survive verbatim, which machine translation cannot be trusted with. So only **reviewed** translations ship (`zh`, `en`); any other language falls back to the English text with a visible notice (`legal.fallbackNotice`) — an English original is better than an unreviewed translation presented as a legal term.
- **Server side**: the Worker **returns Chinese originals only** for the legacy API errors (its users are the Chinese ops/dev scenario); the frontend maps the Chinese copy to dictionary keys in `web/src/lib/i18n/serverMessages.ts`; when a mapping misses, **the Chinese is shown verbatim** — better to expose Chinese than swallow the real reason. The reason it isn't "the server directly returns a code" is that this would require changing 50+ return sites, and the only payoff is dropping one mapping table; new endpoints that want to be cleaner can just include `code` in the response.
- **The Worker has its own separate** `src/lib/messages/` (11 tables) behind `src/lib/i18n.ts`: it serves only **copy written directly into D1** (the attachments' 📎 list marker, commit's assistant message, the verification email). It does **not share a module** with the frontend's — the two are independent build products (what they share is `web/dist`, not source). The admin credit-grant email (`src/lib/messages/grant.ts`) is a **fixed bilingual zh+en** email: it is triggered from the admin console, which has no user-language context to derive a language from.
- **The agent has a third, independent set** (`agent/src/messages/`, 11 tables behind `agent/src/i18n.ts`) for the copy it streams into the chat pane (progress, logs, errors). All three sets use the same language codes, so the Worker→agent handoff is a pass-through (`body.lang` / `X-Forge-Lang`).
- **Fallbacks**: an unknown language code is treated as `zh` on the server (historical jobs and direct API calls land there) and as English in the browser (the widest common denominator for a first-time visitor).
- Environment differences may only come from runtime configuration (see §2 and AGENTS.md); **build-time variables are forbidden**, so language can only be chosen at runtime, not packaged per environment.
- **Artifact language is a different matter**: everything above concerns the language of the **platform UI**; **what language the generated app uses** is decided by the request body (see §17.8), independent of the UI language — request in English from a Chinese UI and you get an English app.
- **Coverage**: all **user-visible copy** outside the seven `/admin` pages (deliberately kept Chinese, for Chinese-speaking ops) is in the dictionaries — landing / login / project list / workspace (chat pane, preview area, connectors panel and in-chat credential card, data panel, code view) / billing page / top bar / theme and environment badges. The criterion is "characters rendered to the user"; code comments, `console`, and SQL column names don't enter the dictionaries.
- **Entries with inline formatting** (`**bold**`, `` `code` ``) render via `web/src/components/RichText.tsx` — it handles only these two markers, doesn't recurse, and parses the markers into React elements **rather than** `dangerouslySetInnerHTML`. Plain-text entries can call `t()` directly without this layer; a missed marker only loses styling, not content. List separators likewise go through a dictionary entry (`chat.listSep`, Chinese "、" / English ", "), not a hardcoded separator.
- **Parity is machine-checked**: `npm run i18n:check` (`scripts/check-i18n.mjs`) compares every language table against the Chinese source table on all three layers — **key sets** (no missing, no extra) and **`{placeholder}` sets** (a dropped `{name}` would show up verbatim in the UI) — warns when a table still looks like the English one, and fails on **stray leading/trailing spaces** in a value (a space smuggled into a sentence to work around a concatenation is invisible in review and gets lost the first time someone edits the string). Fragment entries (`*Suffix` / `*Prefix` / `*Hint`) and the explicit separator slots are exempt.
- **Spaces between two concatenated fragments are a dictionary decision, not a layout one**: the landing hero renders `{heroPrefix}{heroSep}<em>{heroHighlight}</em>`, and `landing.heroSep` is `''` for Chinese/Japanese and `' '` for the space-separated scripts. The English hero shipped for months as "Forge your idea intoa shippable website" because the two fragments were concatenated without a separator — the same defect would have hit 8 of the 11 languages, so the separator became an explicit dictionary slot rather than an invisible trailing space.

### 20.6 UI and Endpoints (Phase 4: Creem connected)

| Endpoint | Auth | Notes |
| --- | --- | --- |
| `GET /api/billing/plans` | Public | Price table (currency, unit price, top-up packs, subscription tiers) + `checkoutReady` (whether the payment channel is configured) |
| `GET /api/billing/summary` | Login required | Own balance + recent ledger entries + order history |
| `POST /api/billing/checkout` | Login required | Start checkout: validate the product → call Creem to create a checkout session → return `{ url }` for the frontend to redirect |
| `POST /api/billing/webhook` | **Public** (signature-verified) | Creem callback: lands `orders` + `credit_ledger` (`purchase`) and grants credits |

- **The single source of pricing is `src/lib/plans.ts`** (structured numbers, no natural language); the frontend pulls from `/api/billing/plans` and **does not keep a copy**. Copy (tier selling points) is assembled by id in the frontend i18n; adding a language doesn't touch the server.

#### Pricing (finalized 2026-10-20; `src/lib/plans.ts` is the only source)

**1 credit = 1 generation/edit** (`JOB_COST` all 1), so each tier's credit count is "how many runs you get".

| Tier | Price | Credits (= generations) | Unit price |
| --- | --- | --- | --- |
| pack_20 | $9 | 20 | $0.450 / run |
| pack_60 | $25 | 60 | $0.417 / run |
| pack_200 | $79 | 200 | $0.395 / run |
| Plus (monthly) | $19 | 50 / month | $0.380 / run |
| Pro (monthly) | $49 | 150 / month | $0.327 / run |

Pricing rationale: the marginal cost of one generation ≈ **$0.06–0.15** (LLM tokens at `src/lib/pricing.ts`'s DeepSeek off-peak tier + Cloud Run instance time), plus MoR fees (Creem 3.9% + $0.40/transaction). **The early price of $0.09/run (100 credits for $9) was pure loss** — the cost of a single generation ate the whole pack's profit, so "how many credits per pack" was lowered to match cost while the sticker price stayed (users see "1 credit = 1 generation"; the mental model is unchanged).

- Real costs should be calibrated against measured percentiles of `job_usage.cost_usd` (the field is ready, to be backfilled once metering is live).
- The signup grant is the **freebie-abuse gate**: `SIGNUP_CREDITS = 5` ≈ $0.3–0.75 per fake account (the old value of 20 was $1.2–3.0).
- **How many credits to grant is always decided by the local catalog**: the webhook trusts only the local catalog, not numbers sent by the upstream; if upstream amounts disagree with local, one warn log is all that happens.
- When changing prices, **change both sides**: `src/lib/plans.ts` (authoritative) + the Creem console products (amounts/descriptions must be updated or the products rebuilt), otherwise webhook reconciliation drifts.
- Frontend page `web/src/pages/Billing.tsx` (`/billing`; the top-bar credit pill is the entry): balance card + top-up packs + subscriptions + credit history / order table; when `checkoutReady === false` the checkout button is disabled and an explanation banner shows (the judgment comes from server config); there is also a **merchant-of-record disclosure** — under MoR the user's statement shows Creem, not this site; not saying so up front increases chargebacks.
- After payment, Creem brings the user back to `/billing?checkout=success`; the page says "credits usually arrive within seconds" and re-fetches the balance once (credits are landed by the webhook; the frontend redirect is a separate path).
- **Public pricing and legal pages (Creem account review requirements)**: `/pricing`, `/privacy`, `/terms`, `/acceptable-use` are all **login-free** public routes (hit directly by the SPA fallback); the `Landing` homepage also shows top-up/subscription prices directly, so reviewers can see them without registering. `PublicFooter` appears on both the homepage and the signup page, links the three documents, and shows the support email. The support email's only source is `SUPPORT_EMAIL` in `web/src/lib/site.ts`, which **must match exactly the email entered in the Creem store's business details**; the AUP retains an explicit ban on pornographic/adult/NSFW content.
- **Operating-entity disclosure (Creem review 2026-10-20)**: the footer and the three legal pages must clearly name the operating entity, matching Creem Business Details exactly — currently `Yunus Su` (business name `1forgen`, Hong Kong SAR). The only sources are `LEGAL_ENTITY` / `BUSINESS_NAME` / `OPERATOR_COUNTRY` in `web/src/lib/site.ts`. Creem previously rejected onboarding for "the site operator not matching the legal entity in onboarding".

### 20.7 Creem Integration (Phase 4)

**Checkout**: `POST {CREEM_API_BASE}/v1/checkouts`, `x-api-key: CREEM_API_KEY`, body = `{ product_id, request_id, success_url, customer: { email } }`; the response's `checkout_url` is the redirect target (`creemCreateCheckout` in `src/lib/creem.ts`).

**Idempotency**: the sole barrier is `orders`' unique index `idx_orders_provider_ref(provider, provider_ref)`. `settlePayment` first does `INSERT ... ON CONFLICT DO NOTHING` to land the order, and **grants credits only if the insert succeeded**; a replay (payment platforms re-sending is normal) returns directly without granting again. Event ids are deliberately **not** used for idempotency — Creem's automatic retries and manual re-sends differ semantically; the order/transaction id is the identifier of the money.

**Event handling** (`handleCreemEvent`, see the header of `src/lib/creem.ts`):

| Event | Handling |
| --- | --- |
| `checkout.completed` | **Handles one-time products only** (`product.billing_type === 'onetime'`) → land the order by Creem order id + grant credits |
| `subscription.paid` | Grants credits on **every successful subscription charge** (first period + renewals), landing orders by transaction id (`tran_...`); only this one is trusted, avoiding double-granting the first period |
| `subscription.active` / `canceled` / `scheduled_cancel` / `past_due` / `unpaid` / `expired` / `paused` / `update` / `trialing` | Only updates the `subscriptions` status; **grants no credits and doesn't revoke granted credits** |
| `refund.created` | Order set to `refunded`; if the balance suffices, claw back that order's granted credits (a `refund` ledger row); if not, only record the order — never drive the balance negative |
| Others | Ignored with a direct 200 |

- **Why the subscription first period trusts only `subscription.paid`**: the first period arrives as three events — `checkout.completed` (recurring), `subscription.active`, and `subscription.paid` — with different object ids; granting on all three would grant the same money three times. Creem officially also recommends `subscription.paid` for activating entitlements.
- **Attribution**: prefer `metadata.forgeUserId` written at checkout creation; fall back to matching a local account by buyer email (when a user checks out directly on the Creem store page, only the email is available).
- **Signature**: the `creem-signature` header = hex of `HMAC-SHA256(raw request body, CREEM_WEBHOOK_SECRET)`. It must be computed over the **unparsed raw body** (re-serializing after parsing fails verification due to spacing/key order), compared with a fixed-length comparison. Verification failure returns 401. Handler exceptions return 500 → Creem retries with backoff (5 times: immediately / 30s / 5min / 30min / 6h, within 24h).
- **No pending orders**: Creem checkout sessions expire; pre-creating pending rows only leaves dirty data that never settles after the user abandons payment. Orders are always landed when the webhook settles.

**Configuration (all environment differences at runtime; see §2 / AGENTS.md)**:

| Name | Form | Production | staging |
| --- | --- | --- | --- |
| `CREEM_API_KEY` | Worker secret | live key | test (sandbox) key |
| `CREEM_WEBHOOK_SECRET` | Worker secret | live webhook secret | test webhook secret |
| `CREEM_API_BASE` | `vars` | `https://api.creem.io` | `https://test-api.creem.io` |
| `CREEM_PRODUCTS` | `vars` (JSON) | local catalog id → live product id | → test product id |

- **Webhook endpoint** registered addresses: production `https://app.1forgen.site/api/billing/webhook`, staging `https://app-staging.1forgen.site/api/billing/webhook`.
- **Staging fully configured (2026-10-20)**: the 5 test products + webhook endpoint were created with the Creem CLI (`brew install creem` → `creem login --api-key creem_test_...`), product ids written into `env.staging.vars.CREEM_PRODUCTS` in `wrangler.jsonc`; both secrets written with `wrangler secret put --env staging`. The batch product-seeding script is `scripts/creem-seed-products.mjs` (idempotent, with `Idempotency-Key`; `npm run creem:seed:test` / `creem:seed:live`); at live launch, re-run it with the live key.
- **Production fully configured (2026-10-20)**: the live store's 5 products were created with the same script using the live key, ids written into the top-level `vars.CREEM_PRODUCTS`; `CREEM_API_KEY` / `CREEM_WEBHOOK_SECRET` written to production secrets; the live webhook endpoint `wh_5AH5qwIzrTjr9Qu3Q17llC` (`https://app.1forgen.site/api/billing/webhook`, all events) registered. KYC and the payout account are completed by the account holder in the Creem console.
- Secrets are **write-only** (switching environments requires whoever holds the original value to re-enter it, see AGENTS.md §1).
- `CREEM_PRODUCTS` empty = checkout returns "product not configured" and the frontend shows "payment channel unavailable"; once products are created, fill in the real values — no code redeploy needed (changing vars does require re-running `deploy`/`deploy:staging`).
- **Cloudflare-side note**: bot protection may intercept the webhook (automated server-to-server requests). Don't use source-IP allowlists for auth (Creem provides no fixed egress IPs); if Bot Fight Mode is on, an exception is needed for that route (`docs.creem.io/code/webhooks` documents this).

### 20.8 Phase Planning (later)

- Pending finalization: subscription expiry and downgrade policy (currently canceling doesn't revoke granted credits), refund policy details.
- The user must provide: a Creem account and product creation (registered by the platform operator, unrelated to end users), webhook endpoint registration, writing `CREEM_API_KEY` / `CREEM_WEBHOOK_SECRET`.
- Optional enhancements: show subscription status on the billing page (data already in the `subscriptions` table), a customer self-service portal link (Creem hosted customer portal), an invoice download entry.

## 21. Model Configuration and Usage Observability (2026-10-21)

Goal: move "which model, at what price, running how long, whether the review round is on" out of **environment variables in the deploy command** and into admin-managed runtime data, and make every job's real cost **attributable by model/config**.

### 21.1 Data Model (`schema.migrate-model-config.sql`)

One `model_configs` row = one dispatchable model configuration:

| Field | Notes |
| --- | --- |
| `name` / `model_id` / `provider_id` | Admin display name / upstream model id / pi provider id |
| `base_url` / `api_dialect` | Gateway address and dialect (`openai-completions` / `anthropic-messages`) |
| `api_key_env` | **The secret's environment variable name** (a variable bound on the executor via `--set-secrets`, e.g. `LLM_API_KEY_MINIMAX` / `LLM_API_KEY_GLM`); only the variable name is stored, never the key value |
| `thinking_level` / `reasoning` / `image_input` | Thinking tier, whether it's a reasoning model, whether image input is declared |
| `thinking_format` / `max_tokens` | pi's `compat.thinkingFormat` (empty = inferred from baseUrl) and `Model.maxTokens`; the thinking budget is carved out of `max_tokens` — too small a value crowds out output |
| `design_review` / `max_run_ms` / `polish_max_ms` | Review-round switch and run budget |
| `input_price` / `output_price` / `cache_read_price` / `cache_write_price` | USD / 1M tokens; when all 0, falls back to the built-in prices in `src/lib/pricing.ts` |
| `channel` / `enabled` | `free` / `vip` / `default` (see §21.5); at most one `enabled = 1` per channel (partial unique index) |

- **Configs are editable in place**: the admin edits existing rows directly (model/gateway/budget/prices etc.), taking effect for the next job after saving. `job_usage` already lands the cost conversion at usage-report time, so price or budget changes don't recompute history; `jobs.model_config_id` still keeps the config id at dispatch time for attribution.
- **Fallbacks**: empty table, no enabled row, or a query failure (including un-run migration) → the Worker sends no override to the agent, which uses the Cloud Run env's default model. The admin is not a single point of failure in the generation chain.
- **Secret boundary (corrected 2026-10-25)**: the table stores **only the variable name** `api_key_env`; the key value still lives only in Cloud Run Secrets. An executor can bind several keys at once (`LLM_API_KEY_MINIMAX` / `LLM_API_KEY_GLM` / `LLM_API_KEY_DEEPSEEK` …), and the admin picks which per row — **switching providers no longer needs a redeploy**. The variable-name whitelist is `/^LLM_API_KEY(?:_[A-Z0-9]+)*$/`, preventing non-model secrets like `AGENT_SECRET` from being sent upstream.
  - A pitfall we hit: the old implementation had only one key, `LLM_API_KEY`; after the admin switched free to GLM, requests still carried MiniMax's key → bigmodel 401; pi downgraded the provider error into an "empty round", the build passed unchanged on the scaffold, the job was still marked `succeeded` and delivered the old template (users saw "the old page come back instantly"). Three layers of defense were fixed that day:
    1. `runner.ts` checks that `process.env[apiKeyEnv]` exists before accepting the job, failing directly if missing;
    2. `message_end`'s `stopReason === 'error'` fails the job before build, no longer silently degrading;
    3. The source tree is compared before and after generation; if not one byte changed → judged `error.emptyModelRun` (chat is exempt from this).
  - bigmodel's Anthropic endpoint: `https://open.bigmodel.cn/api/anthropic`, dialect `anthropic-messages`, `x-api-key` auth (alongside the `/api/paas/v4` OpenAI-compatible endpoint).
  - **The second production incident (2026-10-25, max_tokens truncation)**: after the production free channel switched to `glm-5.3-flash` + the Anthropic dialect, jobs authenticated fine and read the scaffold (6–8 tool calls), but the final thinking round consumed the entire 16384 `max_tokens`, `stop_reason=max_tokens`, and the model ended before ever calling `write`; zero source change → layer 3 judged it failed (frontend shows "模型没有返回可用内容…").
    - Not a credentials issue: logs show real usage (`in≈28k / out≈16.8k / cacheRead≈124k`); on 401 usage is 0.
    - bigmodel's Anthropic endpoint doesn't cap thinking by pi's `thinking.budget_tokens`, so a single thinking round can exceed 16k; OpenAI-compatible rows with `thinkingFormat=zai` constrain thinking via `reasoning_effort`, where 16384 is enough.
    - Fix: `schema.migrate-glm-max-tokens.sql` raised the Anthropic-dialect GLM row's `max_tokens` to 65536 (pi sums in the thinking budget and caps at 32000 → actual request 40192; the same prompt generated completely in local testing, 775s / 21 rounds / 33 tool calls).
    - `runner.ts` now distinguishes `stopReason=length`: judged `error.modelTruncated` with an explicit hint to "raise this config's max_tokens", no longer conflated with credential/dialect issues.
  - **Precedence of env vs admin**: job-level `model_id` / `base_url` / `api_dialect` / `thinking_level` / `reasoning` / `image_input` / `max_tokens` / `max_run_ms` / `polish_max_ms` / `queue_concurrency` always follow the `model_configs` override; Cloud Run env is only the fallback; `api_key_env` only selects the variable name — the key value still comes from Secrets and the admin can't touch it. `--timeout 3600s` is the hard ceiling; the admin's `max_run_ms` caps at 3400s; env `AGENT_MAX_RUN_MS=1500s` applies only when the config row is missing.
  - Adding a provider = create a Secret + add one `--set-secrets` binding line in `agent:deploy:*` (one-time); after that, switch anytime from the admin.

### 21.2 Chain

1. `launchJob` (`src/routes/generate.ts`) reads the active config once (`src/lib/modelConfig.ts:getActiveModelConfig`) after the credit freeze succeeds.
2. The config id is written to `jobs.model_config_id`; the config content is dispatched as the `model` field with `POST {AGENT_URL}/run` (`AgentModelOverride` in `src/lib/agent.ts`).
3. Agent-side `applyModelOverride` (`agent/src/config.ts`) merges the override over the env defaults with fallbacks for invalid values; `session.ts` uses it to generate `models.json` (including `compat.thinkingFormat` and `maxTokens`), and `runner.ts` uses it to control `maxRunMs` / the review round.
4. The usage callback `POST /internal/jobs/:id/usage` looks up the then-current prices by `jobs.model_config_id` (`src/routes/internal.ts`), converts, and writes `job_usage` (including `model_config_id`).

### 21.3 Admin Console

- Page `/admin/models` (Chinese, deliberately not i18n'd): last 7 days' jobs / success rate / total cost / cost per successful job / jobs without usage records; the currently active config; the full config list (with unpriced markers); add/edit forms; per-model usage.
- Endpoints: `GET /api/admin/models`, `POST /api/admin/models`, `PUT /api/admin/models/:id` (in-place edit), `POST /api/admin/models/:id/enable`, `POST /api/admin/models/:id/disable`, all `requireAdmin`.
- **Cost per successful job** = total cost in the window / successful job count. Failed jobs also burn tokens and instance time (the user doesn't pay; the platform does), so they must be amortized in; `jobs_without_usage` is counted separately, avoiding "reports look fine but a batch of jobs never reported".
- Unpriced: all four price fields 0 and the model absent from the built-in price table → the admin marks it "unpriced", costs recorded as 0 (better to under-count than invent numbers).

### 21.4 Rollout Steps

```bash
npm run db:migrate:model:staging      # v1:model_configs + usage 快照列
npm run db:migrate:model2:staging     # v2:thinking_format + max_tokens
npm run db:migrate:channel:staging    # jobs.channel
npm run db:seed:channels:staging      # 写入 staging 的 vip / free 默认配置(幂等)
npm run agent:deploy:staging          # 执行体绑多把 key(LLM_API_KEY_GLM 等)
npm run agent:deploy:free:staging
npm run db:migrate:api-key-env:staging # model_configs.api_key_env + 回填 + 修正 GLM 端点
npm run db:migrate:glm-tokens:staging  # Anthropic 方言 GLM 行 max_tokens → 65536(思考截断)
npm run typecheck && npm run build
npm run deploy:staging
# 验证:后台 /admin/models 看到两个通道各一条生效配置 → 分别发起任务 →
#       看 job_usage.model_config_id / jobs.channel 是否按通道归因
```

Production: `npm run db:migrate:model:remote` → `model2` → `channel` → `db:seed:channels:remote`
→ merge to `main` → `npm run deploy` (production deployment requires the user's explicit go-ahead).

### 21.5 Channel Split: Free Credits Queue / Paid Credits VIP (2026-10-21)

Goal: **free users get the cheap model with a job-concurrency cap to control cost; paying users keep the original model and don't queue.**
The criterion is "does the user have any `orders.status = 'paid'`" (one-time top-ups and subscription charges both count);
credit batches are not traced — credits are fungible, and the ledger has no notion of "which cent came from a top-up".

| | Free channel (`free`) | VIP channel (`vip`) |
| --- | --- | --- |
| Criterion | No paid order | Has at least one paid order |
| Model | MiniMax-M3.1-Flash (`anthropic-messages`) | DeepSeek V4.1-Flash (`anthropic-messages`) |
| Executor | Separate Cloud Run: `forge-agent-free` / `-staging` | The original `forge-agent` / `-staging` |
| Concurrency | Resource concurrency: Cloud Run `--concurrency 8 --no-cpu-throttling --max-instances 1`; job concurrency: `model_configs.queue_concurrency` (default 2, admin-editable) | Keeps the original config (no queue) |
| Timeout | Cloud Run `--timeout 3600`; Worker total-age threshold 3700s | Cloud Run `--timeout 3600`; Worker total-age threshold 3700s |

Flow:

1. `launchJob` (`src/routes/generate.ts`) computes the channel before dispatch and writes `jobs.channel`; free jobs are dispatched to
   `AGENT_URL_FREE` (`src/lib/agent.ts:dispatchAgent`), while VIP still goes through `AGENT_URL`.
2. The Worker fetches the effective `model_configs` row for the channel (`getModelConfigForUser`) and sends the model overrides and
   `queueConcurrency` (free channel only) with the request.
3. The free executor uses the request's `queueConcurrency` to set the `FifoQueue` in `agent/src/index.ts`; if absent it falls back to
   the Cloud Run env `AGENT_QUEUE_CONCURRENCY`. It caps **how many jobs run at the same time**, which is a different thing from Cloud Run's
   `--concurrency` (how many requests a single instance can accept — resource-side scaling). Queuing starts after the heartbeat and the
   cancellation patrol are up — while waiting, `updated_at` keeps being written as usual, so the 180s heartbeat threshold won't misjudge
   the job as lost; a user cancelling while queued gets an immediate 409. During queuing, the `progress` callback keeps reporting
   「排队中,前面还有 N 个任务」 (re-sent only when the position changes; once dequeued, the runner's first phase message overwrites it
   immediately), the frontend generation panel shows `job.progress` directly, so free users can perceive that they are queued; on the
   VIP channel `queueConcurrency = 0`, so no queue messages are ever produced.
   **After the admin changes concurrency, it takes effect on the next dispatch — no redeploy needed** (the value rides on every request;
   when raised, waiters are admitted immediately).
   `--concurrency 8` only reserves 8 in-flight request slots for "running + queued"; bursts beyond 8 are rejected at the platform layer
   and the job is marked failed by the patrol (for a deeper queue, move queuing to the Worker side).
   **Concurrent jobs' session directories must be isolated per job**: `createForgeSession`'s `agentDir` lives under each workspace's own
   `.pi/`. Sharing `${WORKSPACE_ROOT}/.pi/models.json` once caused two jobs writing/reading at the same time to get a truncated JSON
   (`Unexpected end of JSON input`) — this bit us in production on the second concurrent job; `.pi` is already in the source-collection skip list.
4. `jobs.channel` also feeds the patrol: the free channel's total-age threshold is relaxed to 3700s (queuing + 3600s execution).
   If the migration hasn't run (column missing), the patrol automatically falls back to the old single-threshold query, generation unaffected.

Configuration: when adding a config in `/admin/models`, pick the channel; the free channel also requires filling in the 「任务并发」
(`queue_concurrency`, 0 = unlimited) field. Each channel has at most one effective row, and they don't override each other. An
already-effective free config's task concurrency can be edited directly on its card (an ops knob that doesn't affect historical cost);
the change takes effect on the next dispatch.
The two default configs from `db:seed:channels:*` are idempotent seeds (fixed ids + `INSERT OR IGNORE`).
The free channel defaults to `thinking_level = low` (lowered from medium on 2026-10-22 to squeeze latency and cost out of the planning
phase); changing the level likewise goes through "add a new row and enable it", and historical `job_usage.model_config_id` still points
at the old row, so costs stay reproducible.
On 2026-10-23 the free channel switched from GLM-5.3-Flash to **MiniMax-M3.1-Flash** (`anthropic-messages`,
`https://api.minimaxi.com/anthropic`): the executor re-binds Secret `llm-api-key-minimax`
(staging: `llm-api-key-minimax-staging`), and the DB side runs `db:migrate:free-minimax:*` to add the effective row and disable the old GLM row.
MiniMax's Anthropic endpoint has been tested to support streaming, tool_use, thinking (`budget_tokens`) and image blocks;
image input is decided by the admin row `image_input` (the production GLM / DeepSeek rows were enabled and verified starting 2026-10-25).
**Key boundary**: the executor binds multiple keys at once; the admin can switch between already-bound providers just by picking a
variable name via `api_key_env`; only a **brand-new, never-bound provider** needs "create a secret + add a `--set-secrets` line +
redeploy the executor" — before going to production, create the secret and run `npm run agent:deploy:free:prod` first.

---

## 22. User dashboard: activity, funnel, retention and monetization (2026-10-22)

Goal: let operations see in one place at `/admin/dashboard` "how many people came, what they did once here, whether they stayed,
whether they paid, and whether each generation is profitable", instead of manually joining `jobs`, `orders` and `users` across several tables.

### 22.1 Data model (`schema.migrate-analytics.sql`)

| Object | Purpose |
| --- | --- |
| `users.last_active_at` | Time (UTC) of the most recent request carrying a session / login. Replaces the old practice of inferring activity from `MAX(jobs.created_at)` |
| `projects.published_at` | First-publish time (UTC). `published_version` only records the outcome; it can't record daily publish counts or publish latency |
| `user_daily_active(user_id, day, first_seen_at)` | One row per user per day, day boundary at UTC+8; the primary data source for DAU/WAU/MAU and retention |
| `user_events(id, user_id, name, props, created_at)` | Stream of key behaviors; `props` is JSON for easy field extension |

`user_events.name` currently records only these high-value actions (no full request logging):

```
register / register_verified / login
project_create / job_create / job_end / version_create / publish
checkout_start / order_paid / subscription_change
```

### 22.2 Instrumentation path (`src/lib/events.ts`)

- `touchActivity(db, userId)`:
  - Updates `users.last_active_at` only when "never written / more than 10 minutes stale / crossed a UTC+8 calendar day";
  - Only if it really updated does it `INSERT OR IGNORE` a `user_daily_active` row.
- `requireUser` (`src/lib/auth.ts`): when cookie `forge_act` isn't today, asynchronously `waitUntil(touchActivity)`
  and rewrites the cookie to today — normal browsing triggers at most one D1 write per day.
- `/api/auth/me` is handled the same way: the frontend fetches it on every entry into the app, making it the most stable visit-activity signal.
- `createSession` calls `touchActivity` + `logEvent('login')` directly when creating a session, covering "leave right after login".
- Business events hang off the main flow **afterwards** and are entirely best-effort: if the event tables aren't migrated or the write
  fails, only `console.warn` is logged — registration, generation and payment are unaffected.
- On publish, also writes `projects.published_at = COALESCE(published_at, now)` (first publish) and logs a `publish` event
  (logged on every publish, used for daily publish counts).

### 22.3 Definitions (dashboard and SQL agree)

| Metric | Definition |
| --- | --- |
| Activity (DAU/WAU/MAU) | Dedup by `user_id` over `user_daily_active ∪ jobs ∪ user_events` for the day / last 7 days / last 30 days, so historical activity from before instrumentation launched can be back-computed |
| Generation-active | Deduped users who created a `jobs` row that day |
| Stickiness | DAU ÷ MAU |
| Activation | First job with `status='succeeded'` |
| TTV | Registration → first successful job; reported as P50 / P90 |
| Paid conversion (cumulative) | Users with `orders.status='paid'` ÷ all registered users |
| 30-day paid penetration | Users who paid in the last 30 days ÷ MAU |
| ARPPU / ARPU | Cumulative paid amount ÷ paying users / last-30-day paid amount ÷ MAU |
| Retention Dn | Within each registration-week cohort, the share with activity **on exactly day n** after registration; shown as — until mature |
| Retention activity | Per-day dedup over `user_daily_active ∪ jobs ∪ user_events`; pre-instrumentation history can be back-computed from job behavior |
| Gross margin (cash basis) | Last-30-day paid amount − last-30-day `job_usage.cost_usd` |
| Gross margin (consumption basis) | Last-30-day consumed credits × (cumulative paid amount ÷ cumulative purchased credits) − cost; avoids overstating revenue by booking a top-up in full on the day it arrives |

Time zone: **all day boundaries are UTC+8 (Asia/Shanghai)**. D1's `datetime('now')` is UTC; the SQL uniformly uses
`date(col, '+8 hours')`; interval starts use `datetime(date('now','+8 hours','-N days'), '-8 hours')`
to convert local midnight back to UTC, which also keeps queries on the `created_at` index.

### 22.4 API and page

- `GET /api/admin/dashboard?days=7|30|90&end=0|1` (`requireAdmin`): returns
  `overview / series / funnel / activation / retention / monetization / quality` in one call;
  aggregation logic lives in `src/lib/dashboard.ts`.
  - `end=0` counts **today**, `end=1` counts **yesterday (T-1)**. Daily metrics (`new_users_today`,
    `jobs_today`, `dau`, `dau_jobs`) take that calendar day; WAU/MAU and the 7/30-day rolling windows also end on that day,
    so today's data never leaks into yesterday's window.
- Page `/admin/dashboard` (`web/src/pages/AdminDashboard.tsx`), in Chinese, with the
  「今日 / 昨日 T-1」 stats-day toggle and 7/30/90-day trend-window switch on top:
  overview cards, four trend lines, activation funnel, retention heatmap, monetization, quality & cost, definitions.
- The admin nav `AdminBar` adds 「大盘」; the original 「产物 / 用户 / 模型」 entries stay.

### 22.5 Rollout steps (order matters)

```bash
# 1) 先迁移(新表/新列);没迁移就发代码,后台用户列表与大盘会 500
npm run db:migrate:analytics:staging
# 2) 再发 Worker
npm run typecheck && npm run build && npm run deploy:staging
# 3) 上线生产时同样先迁移,再部署
npm run db:migrate:analytics:remote
```

The migration file is incremental `ALTER TABLE` + `CREATE TABLE IF NOT EXISTS`; idempotency rests on "run it only once";
don't repeat `ALTER TABLE` (SQLite reports duplicate column). Fresh databases can run `schema.sql` directly — it already
contains the same columns and tables.

### 22.6 Known limits

- `user_daily_active` starts accumulating from this launch; but the activity definition already UNIONs `jobs` / `user_events`, so T-1 and historical DAU can still be back-computed (only users who visited but neither generated nor triggered a key event can't be traced).
- `checkout_start` is only recorded after launch; before launch there is only "paid", no "checkout started", so historical checkout conversion is missing.
- Generated sites (PV/UV) are out of scope for this dashboard: that would require visit counting in `serve.ts` or Cloudflare Web Analytics.
- Channel / UTM isn't collected, so per-channel acquisition and retention are unavailable for now.
- The dashboard is a read-only admin API with no per-user drill-down; use `/admin/users/:id` when you need to drill down.

### 22.7 Platform page views / country distribution (Cloudflare Web Analytics)

The platform's own PV/UV, visitor countries, sources and paths go through Cloudflare Web Analytics and **do not enter this
dashboard API**. The dashboard page `/admin/dashboard` has a 「Cloudflare 访问统计 ↗」 link at the top that jumps straight to
that account's Web Analytics page:
`https://dash.cloudflare.com/?to=/:account/web-analytics` (production: pick the `app.1forgen.site` card, staging:
`app-staging.1forgen.site` — for details).

Why the data doesn't flow into `/admin/dashboard`: Web Analytics has no official "site statistics" REST query API;
to show it in-app, you'd have to go through the Cloudflare GraphQL Analytics API (`rumPageloadEventsAdaptiveGroups`,
filtered by `siteTag` + `requestHost`), which requires creating a separate API token with Account Analytics: Read.
For now we chose to use the dashboard first, avoiding the introduction of another external credential.

Integration (manual snippet, **do not use auto-injection**):

1. Dashboard → Web Analytics → add site (one each for production `app.1forgen.site` and staging
   `app-staging.1forgen.site`) → for injection choose "Enable with manual snippet".
2. Copy the token into `wrangler.jsonc`'s `vars.WEB_ANALYTICS_TOKEN` for the matching environment (top level = production,
   `env.staging` = staging; binding-type config must be written on both sides, no inheritance).
3. Takes effect after `npm run deploy` / `npm run deploy:staging`.

Why manual rather than auto-injection: the platform is a `BrowserRouter` SPA, and the beacon needs `spa:true` to report
pageviews on frontend route changes; auto-injection doesn't guarantee that parameter and would only record the initial full page load.
The frontend `web/src/components/CloudflareAnalytics.tsx` fetches the token from `GET /api/auth/config` and dynamically loads
`beacon.min.js` — the token is delivered at runtime, so production and staging sharing one `web/dist` still won't cross wires (AGENTS.md §2).

Known limitations:

- The token is a public value (it appears in the browser), not a secret.
- Ad blockers block `static.cloudflareinsights.com`; treat the numbers as a **lower bound** (commonly 25%–40% blocked).
- Country is approximated from IP; VPN/proxy users get attributed to the exit country; no cross-day user identification, no cookies.
- The beacon doesn't cover `/s/:slug` generated sites (that would need separate server-side counting in `serve.ts`).

## 23. Homepage showcase and cloning (2026-10-23)

Goal: let operations tag published artifacts in the admin and decide whether they go on the homepage; the homepage shows real cases,
and logged-in users can clone an example's source and build artifacts with one click, then keep chatting in the workspace to turn it
into their own site.

### 23.1 Data layer

`projects` gains three columns (incremental migration `schema.migrate-showcase.sql`; a fresh `schema.sql` already includes them):

| Column | Meaning |
| --- | --- |
| `featured` | 1 = featured on the homepage; default 0 |
| `featured_tags` | Comma-separated display tags, at most 5, 20 characters each (normalized before writing) |
| `featured_at` | Time it was featured; the homepage sorts by it descending; cleared when unfeatured |

Index `idx_projects_featured(featured, featured_at)`.

### 23.2 Admin

- `POST /api/admin/projects/:id/featured` (`requireAdmin`, body `{ featured?, tags? }`):
  - `featured=true` requires the project to be `status='published'` with `published_version >= 1`, otherwise 400;
  - an empty `tags` string = clear; omitting it keeps the current value;
  - `updated_at` is not touched (tagging shouldn't reorder the user's project list).
- The `/admin` list gains a 「首页」 column (quick feature/unfeature + tag summary); `/admin/projects/:id` gains a 「首页展示」 panel
  (tag input, save tags, feature/unfeature). The admin console stays Chinese, no i18n.

### 23.3 Public API and homepage

- `GET /api/showcase` (public): returns only `featured = 1` published projects with `published_version >= 1`,
  at most 12 by `featured_at DESC`; fields limited to `id/slug/name/description/tags/featured_at/updated_at`.
- The homepage (`Landing.tsx`) renders 「精选案例」 between the example-ideas and pricing sections; when the list is empty the whole
  block isn't rendered. The card cover is a **live preview** of the online site: `<iframe src="/s/:slug/">` mounted at 400% size then
  `scale(0.25)` shrunk into an `aspect-[16/10]` box (equivalent to a 1200px-wide desktop viewport), with `loading="lazy"` so it loads
  only when scrolled near. There is no screenshot service, so live embedding is the only implementation where "content updates with
  the site"; the site itself is served by the server with `Content-Security-Policy: sandbox …` (opaque origin), so the embedded page
  can't reach this page's origin. The card keeps only "name + one line of tags/description + clone"; clicking the cover opens the site
  in a new tab.

### 23.4 Cloning

`POST /api/showcase/:id/clone` (logged-in users):

1. Re-validate that the source project is still "featured + published";
2. Create a new project (new UUID, unique slug, reuse name/description);
3. Write the source project's **online version's** `src_json` / `manifest_json` as the new project's draft `versions(version_no = 0)`;
4. Copy build artifacts into the new project's draft directory with `copyArtifactsAcross` (R2 has no server-side copy — only
   get + put one by one);
5. On any step's failure, roll back the project row and the R2 objects already written.

Not copied: site data (per-project SQLite), connectors, chat history, `prompt`; no credits charged (no model calls).
The new project has `current_version = 0` + a draft → the workspace opens straight into preview, and the input box goes through
`chat` (with the draft as baseline) instead of re-running `generate`.

Clicking 「克隆同款」 while logged out → `/login?clone=<id>`; the login page stashes the id in `sessionStorage`
(`web/src/lib/pendingClone.ts`), so the flow **still resumes** after email-verification signup or a Google OAuth callback:
`CloneResumer` in `App.tsx` picks up the pending clone once a session exists, calls the clone API and jumps into the new project's
workspace. When the current URL already carries a `clone` parameter, the login page handles it itself (it needs to show the
「正在克隆」 state) and `CloneResumer` skips to avoid cloning twice. The pending item lives only in sessionStorage; closing the
tab abandons it.

### 23.5 Rollout order

```bash
# 1) 先迁移
npm run db:migrate:showcase:staging
# 2) 再发 Worker
npm run typecheck && npm run build && npm run deploy:staging
# 3) 生产同样先迁移
npm run db:migrate:showcase:remote
```

### 23.6 Known limits

- If a featured project is later unpublished/deleted: the homepage hides it automatically and the clone API returns 404 — no extra cleanup needed;
- Cloning doesn't copy site data, so dynamic data in the example starts empty in the new project;
- No per-user clone cap (cloning incurs no model cost); add one if project spam shows up;
- No screenshot service for homepage cards: the cover is a live iframe of `/s/:slug/` (`loading="lazy"`), and the cost is that when a
  visitor scrolls near a card, that generated app's assets and data endpoints get loaded (once per card). To cut traffic later, you could
  give cards an IntersectionObserver that mounts only the 1–2 in view, or hook up a screenshot pipeline instead; real thumbnails require
  building one (this design is live preview only).

## 24. Source-available licensing and the self-hosting boundary (2026-11-03)

The repo is publicly maintained by the GitHub Organization **Pixie Agent** under a "source-available + noncommercial license" model
rather than OSI-defined open source:

- Worker, Web, Agent and the rest of the platform code are covered by **PolyForm Noncommercial 1.0.0**; personal, educational, research
  and other noncommercial use is granted per `LICENSE`, while commercial deployment, enterprise internal use, hosted services, paid
  integrations and the like require a separately signed written commercial license (`COMMERCIAL-LICENSE.md`).
- `agent/template/` gets exported with the source into users' generated apps, so it is separately **Apache-2.0**. The `LICENSE`,
  `THIRD_PARTY_NOTICES.md` and `package-lock.json` inside the template are copied along by `copyTemplate()` and protected from model
  rewrites by `restorePlatformFiles()`, ending up in the source tree and the download ZIP; the Vite build also copies the license and
  notices into `dist`, shipped with published artifacts. This guarantees users can use their generated app standalone, without the
  platform's noncommercial restrictions propagating to the artifact.
- Third-party dependencies keep their own licenses; the root `THIRD_PARTY_NOTICES.md` is only an entry point — exact versions are
  governed by the four lockfiles. Distributing the Cloud Run image additionally requires scanning Node/Debian and the template's `node_modules`.
- External code contributions may be reviewed but not merged until a CLA mechanism is in place, preventing external contributions'
  copyright from blocking Pixie Agent's commercial re-licensing. Public collaboration rules live in `CONTRIBUTING.md`, `SECURITY.md`
  and `.github/`.

The public self-hosting entry points are `wrangler.example.jsonc` and `docs/SELF_HOSTING.md`; the repo's current `wrangler.jsonc`
remains the runtime config for Pixie Agent-maintained environments. Resource IDs, service URLs, product IDs and the Analytics token
are not secrets, but self-hosters must not reuse them. Real secrets may only go into Cloudflare secrets, Google Secret Manager, the
ignored `.dev.vars`, or `agent/.env`.

Unified local entry points:

- `npm run bootstrap`: installs Worker / Web / Agent / template dependencies per the four lockfiles;
- `npm run dev:agent`: loads `agent/.env` and converts local template paths to absolute ones;
- a local `.dev.vars` must explicitly point both `AGENT_URL` and `AGENT_URL_FREE` at `http://localhost:8080`; the top-level
  `wrangler.jsonc` already has a production `AGENT_URL_FREE`, and without overriding it, free jobs would be mis-dispatched to the
  production executor;
- `npm run check`: Worker + Web + Agent typecheck, then builds Web, Agent and templates;
- GitHub Actions runs the same `check` against `main`, `staging` and PRs.

So that a fork can't keep borrowing the 1forgen identity when mail config is missing, Resend sending now requires both
`RESEND_API_KEY` and `EMAIL_FROM`; payment-arrival notifications use only the required `PUBLIC_BASE_URL` and no longer fall back to
`app.1forgen.site`. Without mail configured, the original degradation semantics still apply: the account is persisted, the API
reports send failure and allows retry.

The Agent dependency moved from the deprecated `@mariozechner/pi-coding-agent@0.66.1` to `@earendil-works/pi-coding-agent@^1.5.0`;
the SDK embedding approach is unchanged, and the runtime vulnerabilities the old scope reported in npm audit were cleared.
`npm run check` is still mandatory before a production release, and Agent changes get validated on staging first.

Forge Agent's local startup now compiles TypeScript first and then runs `dist/index.js`; Node's strip-types doesn't map `.js`
imports in source to `.ts`, and running `src/index.ts` directly fails with `ERR_MODULE_NOT_FOUND`.

All three stages of the Cloud Run image pin `node:22.22.1-bookworm-slim`, dependency installation switched to `npm ci` to lock the
dependency tree, and the final process runs as the image's built-in non-root `node` user; the workspace is still writable only at
`/tmp/forge-agent`, and the template directory is read-only and reused. Docker builds must keep excluding the host `node_modules`
via `.dockerignore` / `.gcloudignore`.
