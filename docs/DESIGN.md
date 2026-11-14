# Forge Design Notes: Approach · Completeness · Roadmap

> For future maintainers. For **deployment and configuration quick reference** see the README and [docs/FORGE2.md](FORGE2.md); this document records "why it's done this way", "how far it's gotten", and "what comes next".
> Updated 2026-10-11, reflecting the **Forge 2.0** architecture (Cloudflare orchestration + Cloud Run running the pi coding agent); artifacts are **multi-file React apps**.
> The pre-migration v1 (single HTML + segmented Workflows generation) is superseded and kept only as historical reference.

## I. What the system is

The user enters a one-line idea → the agent plans (`plan.json`) → writes a **multi-file React app** in an isolated working directory → platform-side `vite build` → online preview, conversational iteration, publish to `/s/:slug`; generated apps can read and write the platform backend (database / key-value / object storage).

Technical foundations:

| Layer | Component | Responsibility |
| --- | --- | --- |
| Frontend | React + Vite + Tailwind (Workers Assets) | Landing page, workspace (preview/code/data), project pages, admin console |
| Orchestration & persistence | Cloudflare Worker `forge-v2` (Hono) | Auth, projects/versions/jobs, SSE progress, publish `/s/:slug`, draft preview `/p/:token`, site data API, job dispatch (`waitUntil`) + internal callbacks + cron inspection. **Runs no LLM calls at all.** |
| AI executor | Google Cloud Run `forge-agent` | The sole AI-interaction executor: the pi coding agent writes code in an isolated working directory, the platform builds, the source tree and artifacts are sent back |
| Persistence | D1 / R2 / KV / Durable Objects (SQLite) | Platform metadata / build artifacts and upload objects / key-value / per-project × per-environment isolated SQLite (document collections + owner SQL console) |
| Model gateway | OpenAI-compatible or Anthropic-compatible | Currently DeepSeek `deepseek-flash` (Anthropic dialect) |

**Boundary rule**: persistence and permission logic stay on Cloudflare only; Cloud Run returns only raw artifacts (`src`/`dist`/`manifest`/`plan`) and progress. Details in FORGE2 §2.

## II. Approach and key trade-offs

### 1. Why the agent lives on Cloud Run (not in the Worker)
The free Worker tier has three hard walls: **10ms CPU**, `waitUntil` reclaimed after roughly 2–4 minutes, and **no filesystem / no command execution**. A real coding-agent loop (reading and writing files, running bash, multi-round tool calls) cannot run inside the Worker. Cloud Run is the reverse: containers have a filesystem, can run arbitrary commands, request timeouts up to 60 minutes, scale to zero — **one request = the full lifecycle of one job, destroyed when done**.

### 2. Delivery is decided by callbacks, not the HTTP response body
Cloudflare cuts off the Worker's outbound requests on timeout (524), but **the cutoff does not stop Cloud Run from continuing** (as long as the handler hasn't returned, it keeps executing and holds CPU). Therefore:
- On the Worker side, `generate`/`chat` fire `POST /run` inside `waitUntil`, **never waiting on or blocking** the response to the browser.
- A job's **terminal state is settled only by the `commit` / `fail` callbacks** (idempotent): only success appends the assistant message and deducts credits; failure or a declared-dead job does not.
- Callbacks carry a guard (`WHERE status IN ('pending','running')`): late callbacks cannot revive a declared-dead job, but a late success — "commit arriving after the death verdict" — can still **revive the delivery**.

### 3. Multi-file artifacts (replacing single HTML)
A version upgrades from "a blob of HTML" to a **source tree + build artifacts**: `src_json` (path → content, the baseline for follow-up turns) + build artifacts in R2 + a `manifest`. The frontend `preview` uses a `/p/:token/` iframe (no longer srcDoc single HTML), and `code` shows the files the agent is writing in real time during generation, then the artifact inventory after completion.

**Why SPA + a platform-wide generic API rather than SSR**: SSR would make the generated app simpler but the platform heavier (locked to a framework runtime, losing the instant static "watch it being written" preview, lower agent generation success rates). An SPA artifact is just static files — publishing needs zero subdomains and previewing is serving files: the thinnest possible bearer model. Full comparison in FORGE2 §13.

### 4. The platform provides a generic data API, not a hand-written backend per project
The backend is a **platform capability** (D1/KV/R2 namespaced by project × environment), not a bespoke API per project. The agent only calls fixed endpoints:
- `/db/:collection` document collections (CRUD)
- `/kv/:key` key-value
- `/blob/:key` object storage

So there is no "design a frontend/backend contract for every project" burden — this is the key to sidestepping SSR complexity. Generated apps manage list state uniformly via `useCollection` in `src/lib/store.js`. Details in FORGE2 §13.7, §14.1.

### 5. One isolated SQLite per project × environment (Durable Object)
Generated-app data (document collections) moved from a shared D1 table to **one isolated SQLite database per project × environment**, carried by the `ProjectDb` DO, instance name `${projectId}:${env}`. Projects, and test (draft) vs live, are **physically isolated** — not filtered by `WHERE`. Owners additionally get a **DBeaver-style SQL console** to create tables/indexes and run arbitrary SQL. Details in FORGE2 §15.

### 6. Recovery and death verdicts
- **Within an instance**: left to the coding agent itself to retry/continue within a single execution (v1's `sections_json` checkpoint-reuse mechanism is retired in v2).
- **Across jobs**: heartbeat in the `jobs` table + a per-minute cron inspection; jobs whose instance died or went missing while the row is still active get a **death verdict and unlock**.
- **Late successes can revive**: see §II.2.

### 7. Three execution stages (planning → coding → building)
Keeps the status display aligned with real progress; the frontend renders stage indicators from it:

| Stage | Trigger | Frontend display |
| --- | --- | --- |
| `planning` | `agent_start` / first write of `plan.json` | plan card (checklist ticks in real time) |
| `coding` | writing/editing source files | "writing {path}" + code page updating live as files land |
| `building` | platform-side `vite build` before finishing | "building app artifacts" |

`chat` (conversational edits) is single-stage, going straight to `coding` (no re-planning). Stage transitions and progress copy are reported by the agent itself in `agent/src/runner.ts`; the frontend merely renders them faithfully, so there is no "display says planning but it's actually coding" mismatch.

### 8. Security model
- Published pages `/s/:slug` use `CSP: sandbox` (opaque origin); generated JS cannot read main-site credentials.
- Worker ↔ Cloud Run: shared secret `X-Agent-Secret` verified in both directions; `/internal/*` has no user auth and reads no cookies.
- The admin console and the user system are **fully isolated**: the password comes from the `ADMIN_PASSWORD` secret; after verification the Worker issues an HttpOnly cookie derived from it (rotating the password invalidates all sessions at once, no session table needed).
- Generated code is prompt-forbidden from collecting passwords, payment data and other sensitive information.

## III. Current completeness

### Done (production-ready)
- Signup/login/credits (1 credit deducted on success), projects and versions, publishing, draft preview, site data in both environments
- **The full multi-file generation pipeline**: the agent writes a multi-file React app → platform `vite build` → commit callback lands a version (source into D1, artifacts into R2, manifest generated)
- **Plan card** (checklist ticks in real time), **code page** updating live (agent's most recently written files), **three-stage progress**
- **Frontend process display** (Coze-like): collapsible thinking, tool calls (write/read/run…), tool results, changed-file list (`agent_log` parsed into structured events, see §IV.1)
- **Conversational iteration** + **version history** (numbered `MAX(version_no)+1`, baseline = current effective version, view/restore, zip export)
- **Platform backend capabilities**: generated apps can use `/db` `/kv` `/blob`; per-project × per-environment isolated SQLite + owner DBeaver-style SQL console
- **Admin console (read-only)**: artifact list/detail, all version sources + iframe preview, conversation records, jobs, tail of the agent's streaming log, site data
- **Light/dark themes** (dark by default, toggle persisted)
- Observability: agent streaming log (`agent_log`, atomic append, last 20000 chars), `wrangler tail` logs, error pass-through

### Not done / constrained
| Item | Reason |
| --- | --- |
| Token-by-token streaming to the screen | current display is "stage + log deltas", not token-level rendering; true streaming needs a paid Worker tier (30s+ CPU) to forward |
| One dedicated user Worker per artifact | phase two, requires Workers for Platforms; today a single platform Worker isolates by namespace |
| Image assets | prompts forbid external images (gradients/SVG/emoji); no image generation or stock-library integration yet |
| Version rollback UI | versions data is stored and the workspace supports "restore as current version"; a timeline-style rollback interface is missing |
| OIDC mutual auth / VPC egress | roadmap; currently shared secret + unauthenticated access allowed |

## IV. Roadmap and priorities

Criteria: user pain × implementation cost × platform constraints.

### P0 — directly solving known pain
1. **Multi-model routing / stability**: different models for planning and body (strong model plans, fast model writes code); a `compat` switch for gateways that don't honor the `developer` role or `reasoning_effort`. Switching models = changing Cloud Run env vars (`LLM_BASE_URL` / `LLM_MODEL` / `PI_LLM_API`), no code changes.
2. **Per-file/section partial edits**: narrow "rewrite the whole bundle" down to "the conversation names which file/component to change"; rewrite and return only the named parts, taking edits from minutes to seconds.
3. **Version timeline + one-click rollback**: the data layer is ready; add the UI.

### P1 — product completeness
4. **True streaming output**: upgrade to paid Workers (CPU 30s+), consume pi's token deltas with throttled forwarding, paint character by character.
5. **Editable planning**: let users add/remove/rewrite plan items before generation continues — the human's handle on quality alignment.
6. **Image capability**: integrate an image-generation API or free stock library, assets into R2, lifting the "no-image website" biggest-cosmetic-limit.

### P2 — scale and evolution
7. **Phase two: Workers for Platforms**: package each artifact's backend as an independent user Worker, bind shared resources, serve `{slug}.domain`.
8. **Quotas and governance**: concurrency limits, signup review, paid credits, abuse protection.
9. **Deeper observability**: visualize agent execution traces (time spent, tool-call distribution), failure attribution statistics.

## V. Frontend display: making the "generation process" legible

Following Coze and similar mainstream platforms, the chat area no longer replies with a single result; it shows the process in place:

- **Stage bar**: planning → coding → building, current stage highlighted, with elapsed time.
- **Thinking**: chains of thought prefixed `💭`, collapsed by default (tap to expand).
- **Tool calls**: `🔧 write src/App.jsx` renders as "writing src/App.jsx"; results backfill `✓/✗`.
- **Changed files**: write/edit events extracted from tool events, deduplicated and listed.

The data source is the streaming log the agent writes into `jobs.agent_log`; the frontend `web/src/lib/agentLog.ts` parses it into structured events (`thinking` / `say` / `tool`). **Parse failure degrades to raw text — display only, never affecting generation.** Log format conventions in FORGE2 §4. Display-layer changes never touch the core generation path.

## Appendix: Ops quick reference

```bash
# ── Cloudflare ──────────────────────────────────────────────
npm run deploy                       # build frontend + deploy Worker (forge-v2)
npx wrangler tail                    # live logs
npx wrangler d1 execute DB --remote --command "…"   # query platform metadata (users/projects/versions/jobs/messages)

# Database migrations (one-shot, idempotent; fresh installs use schema.sql directly)
npm run db:migrate:remote                                   # schema.migrate-multifile.sql (rebuilds versions/jobs)
npx wrangler d1 execute DB --remote --file=schema.migrate-published-version.sql
npx wrangler d1 execute DB --remote --file=schema.migrate-fix-current-version.sql

# secrets (plaintext address variables live in wrangler.jsonc vars)
npx wrangler secret put AGENT_SECRET         # same name and value as the Cloud Run side
npx wrangler secret put ADMIN_PASSWORD       # without it the admin console is entirely unavailable

# ── Google Cloud Run (agent)───────────────────────────────
gcloud run deploy forge-agent --source agent --region us-central1 \
  --timeout 3600 --concurrency 1 --min-instances 0 --max-instances 5 \
  --cpu 1 --memory 1Gi \
  --set-env-vars LLM_BASE_URL=https://api.deepseek.com/anthropic,LLM_MODEL=deepseek-flash,PI_LLM_API=anthropic-messages,PI_PROVIDER_ID=forge,PI_MODEL_REASONING=true,AGENT_MAX_RUN_MS=1500000,WORKSPACE_ROOT=/tmp/forge-agent \
  --set-secrets LLM_API_KEY=llm-api-key:latest,AGENT_SECRET=agent-secret:latest

# Switch models/keys (no image rebuild needed)
printf '%s' "$LLM_API_KEY" | gcloud secrets versions add llm-api-key --data-file=-
gcloud run services update forge-agent --region us-central1 --update-env-vars LLM_MODEL=…
```

Agent-side timeout/thinking-level and similar parameters are centralized in `agent/src/config.ts` (env vars); prompts in `agent/src/prompt.ts`. Worker-side callbacks and the state machine live in `src/lib/commit.ts` / `src/lib/jobs.ts` / `src/routes/internal.ts`. Redeploy the changed side and it takes effect.

> Deployment details (fresh environment setup, GCP permissions, costs, rollback) are all in [docs/FORGE2.md](FORGE2.md) §7–§9.
