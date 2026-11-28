# Forge Agent

Forge Agent is the executor running on Google Cloud Run. It uses the [pi coding agent](https://github.com/earendil-works/pi) to generate or modify multi-file React apps inside a disposable working directory, runs the platform-side Vite build, and reports progress, checkpoints and final artifacts back to the Cloudflare Worker.

The Forge web app, accounts, job state, billing, persistence and publishing all live in the Cloudflare Worker at the repository root. For the full architecture see [`../docs/FORGE2.md`](../docs/FORGE2.md).

## Interface

- `GET /health`: public health check, returns `{ "ok": true }`.
- `POST /run`: executes one job; must carry the same `X-Agent-Secret` as the Worker.

The request body type is `RunRequest` in `src/types.ts`. The Agent calls back to the `callbackBase` from the request with:

- Progress and heartbeats
- Follow-up requests during execution and cancellation polling
- Source checkpoint snapshots
- Model usage
- The final `commit` or `fail`

The HTTP request body limit is 24 MiB. The job run budget defaults from environment variables and can be overridden per job by the Worker-provided model configuration, up to 3400 seconds.

## Running locally

Install all dependencies from the repository root:

```bash
npm run bootstrap
cp agent/.env.example agent/.env
```

Edit `agent/.env` with at least:

```text
AGENT_SECRET=same value as the root .dev.vars
LLM_BASE_URL=model API endpoint
LLM_MODEL=model ID
LLM_API_KEY=model API key
WORKSPACE_TEMPLATE_DIR=./template
```

Start from the repository root:

```bash
npm run dev:agent
curl -s http://localhost:8080/health
```

`npm run dev:agent` loads `agent/.env` and converts the template directory to an absolute path. You can also `cd agent/` and run `npm run dev` directly.

## Build

```bash
npm run typecheck
npm run build
```

`npm run check` at the repository root verifies Worker, Web, Agent and template together.

## Cloud Run

General deployment requirements:

- Node.js 22.19+ container (currently pinned to `22.22.1-bookworm-slim`)
- Request timeout of 3600 seconds
- `AGENT_MAX_RUN_MS` or per-job `max_run_ms` below the Cloud Run timeout
- VIP executors usually use `--concurrency 1`
- Model keys and `AGENT_SECRET` injected via Secret Manager
- `WORKSPACE_ROOT` pointing at a writable temp directory

Maintainer-specific deployment parameters live in the root `package.json`. Self-hosters should not reuse its service names, projects or secret names; see [`../docs/SELF_HOSTING.md`](../docs/SELF_HOSTING.md).

The current maintainer deployment allows unauthenticated network access, but `/run` still enforces the shared-secret check. Self-hosted environments should add Cloud Run IAM, restricted ingress, rate limiting and anomaly alerting where possible.

## Layout

| Path | Responsibility |
| --- | --- |
| `src/index.ts` | HTTP, auth, request validation and in-process queue |
| `src/runner.ts` | Working directory, attachments, pi session, build, review and artifact collection |
| `src/session.ts` | pi provider and coding-tool assembly |
| `src/pipeline.ts` | Pipeline DSL: parse/toposort, named agents + default tools, built-in default pipeline |
| `src/prompts.ts` | Prompt filesystem loader: tree read, mode selection, `{{variable}}` interpolation |
| `src/callback.ts` | Progress, heartbeat, polling, checkpoint and terminal callbacks |
| `src/config.ts` | Merging environment variables with per-job model configuration |
| `orchestration/` | Editable pipeline + prompts data (`pipeline.default.json` + `prompts/`), see its `AGENTS.md` |
| `template/` | React template with preinstalled dependencies, copied into every generated project |

## License

The agent platform code is covered by the PolyForm Noncommercial 1.0.0 license at the repository root. `template/` ends up inside users' exported projects and is therefore licensed separately under Apache-2.0.
