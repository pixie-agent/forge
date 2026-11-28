# AGENTS.md — Forge 2.0 development constraints

This project is **Forge 2.0**: a Cloudflare Worker (`forge-v2`, Hono + D1 + R2 + KV + per-project × per-environment Durable Object SQLite) orchestrates, and the `pi` coding agent on Google Cloud Run (`forge-agent`) executes.

All architecture and design details live in `docs/FORGE2.md` (**must** be kept in sync when changing platform behavior). This file holds only the **binding constraints**.

---

## 1. Environments and branches (the most important constraint)

Two **fully isolated** environments sharing the same repository, the same `web/dist`, and the same `agent/` sources:

| | Production | Staging |
| --- | --- | --- |
| Branch | `main` | `staging` |
| Worker | `forge-v2` | `forge-v2-staging` |
| Public domain | `app.1forgen.site` (Custom Domain, apex left empty) | `app-staging.1forgen.site` (same) |
| workers.dev | `forge-v2.needle.workers.dev` (kept — old links depend on it) | `forge-v2-staging.needle.workers.dev` (same) |
| wrangler environment | top level (no `--env`) | `env.staging` |
| Cloud Run (VIP channel) | `forge-agent` (`--timeout 3600 --concurrency 1`; run budget delivered via admin `max_run_ms`, cap 3400s) | `forge-agent-staging` (`--timeout 3600 --concurrency 1 --max-instances 1`) |
| Cloud Run (free channel) | `forge-agent-free` (MiniMax-M3.1-Flash, Anthropic dialect, `--timeout 3600 --concurrency 8 --no-cpu-throttling --max-instances 1`; job concurrency delivered via admin free config `queue_concurrency`, env `AGENT_QUEUE_CONCURRENCY` is only the fallback) | `forge-agent-free-staging` (same, plus `PI_MODEL_INPUT_IMAGE=true`) |
| D1 | `forge-v2` (`6fd724ad-…`) | `forge-v2-staging` (`da94e0ba-…`) |
| R2 | `forge-v2-artifacts` + `forge-v2-prompts` (prompt tree / agentset / mcpset) | `forge-v2-artifacts-staging` + `forge-v2-prompts-staging` |
| KV | `f6b66c90…` | `67e46b44…` |
| Internal secret | Secret `agent-secret` | Secret `agent-secret-staging` |
| LLM keys | VIP executor: `llm-api-key` (DeepSeek) + `llm-api-key-free` (GLM) + `llm-api-key-minimax` (MiniMax); free executor: `llm-api-key-minimax` (MiniMax) + `llm-api-key-free` (GLM). **Each executor binds multiple keys at once**; admin `model_configs.api_key_env` picks the variable name per row (only the variable name is stored, never the key value) | VIP executor: `llm-api-key-staging` (GLM) + `llm-api-key-minimax-staging` (MiniMax); free executor: `llm-api-key-minimax-staging` + `llm-api-key-staging`. Variable names as at left |
| LLM models | VIP `deepseek-flash` (Anthropic dialect); free default `MiniMax-M3.1-Flash` (Anthropic dialect, `api.minimaxi.com/anthropic`), admin can switch to `glm-5.3-flash` (bigmodel Anthropic dialect) | VIP `glm-5.3-flash` (OpenAI-compatible + `zai`); free `MiniMax-M3.1-Flash` (Anthropic dialect) |
| User-uploaded images shown to the model | Decided by admin `model_configs.image_input` (production rows enabled; Cloud Run does not set `PI_MODEL_INPUT_IMAGE`) | Enabled (env switch `PI_MODEL_INPUT_IMAGE=true` + admin row) |
| Billing / collections (MoR) | Creem **live store**: Secrets `CREEM_API_KEY` / `CREEM_WEBHOOK_SECRET`; `vars.CREEM_API_BASE=https://api.creem.io`; `vars.CREEM_PRODUCTS` holds live product IDs | Creem **test store**: both secrets written separately with `--env staging`, test-mode values; `CREEM_API_BASE=https://test-api.creem.io`; `CREEM_PRODUCTS` holds test product IDs |
| Signup verification email | Resend Secret `RESEND_API_KEY` + `vars.EMAIL_FROM=noreply@1forgen.site` (domain must be verified in the Resend console) | Same (secrets are not inherited; write separately with `--env staging`) |
| Environment flag | No `ENVIRONMENT` set | `ENVIRONMENT=staging` |

### Branch model

**Develop and test on the `staging` branch → merge to `main` after verification → release from `main`.**

- `main` is the "releasable" baseline: every commit should be accepted and deployable at any time. Do not pile unverified changes onto `main`.
- **"Branch" decides which code; "wrangler environment" decides which resources — two independent axes.** The `staging` branch is not automatically deployed to the staging environment — the target is decided by which command you run; conversely, running `npm run deploy` while on the `staging` branch is blocked by the guard.

### Release flow

```bash
git switch staging                                              # 1) develop
npm run typecheck && npm run build
npm run deploy:staging                                          # 2) deploy staging and verify
npm run agent:deploy:staging                                    #    only needed when agent/ changed
git switch main && git merge staging && git push origin main    # 3) merge only after verification
npm run deploy                                                  # 4) release from main
npm run agent:deploy:prod                                       #    only needed when agent/ changed
```

### Hard gates for production deploys (script-enforced, do not bypass)

`npm run deploy`, `npm run agent:deploy:prod` and `npm run agent:deploy:free:prod` all run `scripts/guard-prod-deploy.mjs` through their `pre*` hooks, enforcing two rules; failing either aborts:

1. The current branch must be `main`
2. The working tree must be clean (no uncommitted changes)

**Do not modify the guard, `git stash`, or partially commit just to deploy.** The only correct path is merging the changes into `main`. `npm run deploy:staging` / `npm run agent:deploy:staging` / `npm run agent:deploy:free:staging` deliberately have **no** guard — unmerged, uncommitted changes are exactly what staging is for.

### Never auto-deploy production

**Do not run `npm run deploy` / `npm run agent:deploy:prod` / `npm run agent:deploy:free:prod` on your own initiative.** First state what is being released and the blast radius, then wait for explicit user approval (e.g. "release it") before executing. Staging deploys need no such approval.

---

## 2. Isolation discipline

- **Environment differences may come only from runtime configuration** (wrangler bindings / `vars` / Cloud Run env and sizing). Both environments share the same `web/dist` and `agent/` sources, so **never** express environment differences through build-time variables (e.g. Vite `import.meta.env`) — that would bake staging values into the production bundle.
- **wrangler binding-type config does not inherit**: `vars` / `d1_databases` / `kv_namespaces` / `r2_buckets` / `durable_objects` / secrets must be written **twice**, at top level and in `env.staging`. A missing binding does not fail at deploy time; it becomes a runtime `c.env.XXX === undefined` (e.g. missing `PROJECT_DB` makes the generated app's data panel 500 outright). **Any new binding must be added on both sides at once.**
- **`routes` is the opposite — it inherits**: if `routes` is set at top level and `env.staging` does not explicitly override it, staging inherits it → deploying staging steals the production domain; moreover `publishCustomDomains` has `replace_state` semantics and deletes any Custom Domain on that Worker **not present in the config**. So each environment declares its own `routes`.
- **With `routes` set, `workers_dev: true` must be explicit**: wrangler's rule is "workers.dev defaults to off when routes are present"; omitting it turns `*.needle.workers.dev` off, breaking published links and not-yet-migrated callback URLs together.
- **The frontend environment badge is delivered at runtime**: staging's `vars.ENVIRONMENT=staging` → `GET /api/auth/config` returns `environment` → `<EnvBadge>` renders an amber badge. Production does not set it, falls back to `production`, and renders nothing. Local `wrangler dev` additionally sets `ENVIRONMENT=local` in the gitignored `.dev.vars` — this gates the dev-only full-log streaming into `agent_log` (see `docs/FORGE2.md` §4) and an amber `LOCAL` badge; never commit it.
- **Worker secrets are write-only**: no API or command can read a written secret back (the `secrets` API returns names only). Rotating environments requires whoever holds the original value to re-enter it; never promise to "copy production over".
- **Model multimodal capability is also an environment difference**: whether a model declares `input: ['text','image']` is decided by admin `model_configs.image_input` (per-job override of Cloud Run's `PI_MODEL_INPUT_IMAGE`, which is only a fallback). Upstream gateway dialects do not necessarily accept image blocks — declaring them but failing to send yields an immediate 400; on 2026-10-25 production GLM (`open.bigmodel.cn/api/anthropic`) and DeepSeek (`api.deepseek.com/anthropic`) were both verified to accept image blocks, so production rows keep `image_input=1`; re-verify before adopting a new provider.
- **Per-job model parameters come from `model_configs`; Cloud Run env is only a fallback**: `model_id` / `base_url` / `api_dialect` / `thinking_level` / `reasoning` / `image_input` / `max_tokens` / `max_run_ms` / `polish_max_ms` / `queue_concurrency` are delivered with each job and override env (`applyModelOverride` in `agent/src/config.ts`); `api_key_env` only selects which **already-bound** Secret to use — key values still come from Cloud Run. `--timeout 3600s` is the Cloud Run hard cap; admin `max_run_ms` caps at 3400s; env `AGENT_MAX_RUN_MS` (1500s) only backstops when the config row is missing/invalid.

---

## 3. Data layer / schema

- Schema changes on an existing database use **incremental migrations** `schema.migrate-*.sql`; running `schema.sql` directly on an existing DB reports `no such column`. `schema.sql` is for brand-new databases only. Staging equivalents: `db:init:staging` / `db:migrate:google:staging`.
- Prefix `wrangler d1 execute --remote --file=…` with `yes |`, otherwise it hangs on the interactive confirmation.
- **Deployed Durable Object class names and migration tags are immutable once deployed** — renaming either demands wiping the database. DO data is invisible in the Cloudflare dashboard; the platform's own SQL console is the only entry point.

---

## 4. After every change

- `npm run typecheck && npm run build` must pass before deploying.
- After multi-file edits, re-`grep` / re-`read` to confirm the changes actually landed (silent edit failures have happened).
- Platform behavior, deployment method or resource topology changed → update `docs/FORGE2.md`; rules in this file changed → update this file.

### Documentation language policy (since 2026-11-14)

- The repository is **English-first**: `README.md`, `AGENTS.md`, `agent/README.md` and everything in `docs/` are written in English. New docs are English-only; do not create new Chinese docs.
- `README.zh-CN.md` is the maintained Chinese mirror of `README.md` — when the English README changes materially, update the mirror in the same change. No other doc carries a mirror.
- Commit messages are English. Code comments default to English; do not bulk-translate existing Chinese comments opportunistically — rewrite them only when substantially editing the surrounding code.
- Exception: the product's UI dictionaries (`web/src/lib/i18n/`, `src/lib/messages/`, `agent/src/messages/`) and the Chinese-only `/admin` pages (see §6) are **product features, not documentation** — the Chinese source tables and the `/admin` pages keep their Chinese and are untouched by this policy.

---

## 5. Common commands

```bash
npm run typecheck               # Worker + Web + Agent type checks
npm run build                   # build web/dist (production and staging share one artifact)
npm run check                   # type checks + full builds of Web / Agent / generated template
npm run deploy                  # production Worker (guard: must be main with a clean tree)
npm run deploy:staging          # staging Worker (no guard)
npm run agent:deploy:prod       # production Cloud Run agent (VIP channel; guard: main + clean tree)
npm run agent:deploy:staging    # staging Cloud Run agent (VIP channel)
npm run agent:deploy:free:prod     # production free-channel executor (same prod guard + MiniMax-M3.1-Flash + in-process queueing)
npm run agent:deploy:free:staging  # staging free-channel executor
npm run db:init:staging         # staging database init (idempotent)
npm run db:migrate:google:staging
npm run db:migrate:analytics:staging  # user-dashboard analytics (new columns/tables); production uses :remote
npm run db:migrate:pipeline:staging   # orchestration pipeline table (platform_pipeline); production uses :remote
npm run db:migrate:dispatched:staging # jobs.dispatched_at (HITL-aware total-age ceiling); production uses :remote
node agent/orchestration/push.mjs --env staging --agents-only   # seed agents / skills / prompts / MCP into an environment's R2 (also --skills-only / --prompts-only / --pipeline-only / --mcp-only; --env local|staging|prod)
node agent/orchestration/sync.mjs --from staging --to prod --dry-run   # copy the whole orchestration tuned in one env's admin to another (pipeline/agents/MCP/prompts/skills); run with --yes to write
```

---

## 6. Languages (11 UI languages)

- **The platform UI speaks 11 languages**: `zh, en, ja, ko, ru, es, fr, de, it, pt, nl` — the **same set as the artifact language set** (`agent/src/lang.ts`), so the UI language can double as the artifact-language default without a mapping table. The list lives in `web/src/lib/i18n/langs.ts` (`LANGS` / `LANG_OPTIONS`); each language has its own dictionary `web/src/lib/i18n/dict.<lang>.ts`, loaded as a **separate chunk** (dynamic import) so the initial bundle only carries the active language.
- **All user-visible copy goes through the dictionary** — never hardcode Chinese in components. `dict.zh.ts` is the source of truth for the key set (`DictKey = keyof typeof zh`); every other dictionary is typed `Record<DictKey, string>`, so **a missing translation is a compile error**. Adding an entry means editing `dict.zh.ts` + every `dict.<lang>.ts` + using `useT()` in the component; adding a language requires no component changes. Run `npm run i18n:check` after touching dictionaries — it verifies key sets and `{placeholder}` sets across all languages on all three layers (frontend / Worker / agent), which is not checkable by eye at this scale.
- **Legal documents are not in the UI dictionary**: they live in `web/src/lib/i18n/legal/` and only reviewed translations ship (`zh`, `en`); other languages fall back to the English original with a visible notice. Do **not** machine-translate the Privacy Policy / Terms / AUP — Creem's account review depends on the "pornography / adult / NSFW content is prohibited" clauses surviving verbatim.
- **The eight `/admin` pages (artifacts / project detail / users / user detail / models / orchestration / dashboard / login) deliberately stay Chinese** (built for Chinese-speaking operators); do not wire them into i18n.
- Entries with inline formatting use `web/src/components/RichText.tsx` (`**bold**` / `` `code` ``); **never** inject HTML strings into the DOM. List separators use the `chat.listSep` entry, never a hardcoded `、`.
- **拼接两段文案时,空格由词典显式给出**:不要把空格藏在文案值里(首尾空格在编辑、复制粘贴、格式化时最容易悄悄丢掉,英文首屏曾因此渲染成 "Forge your idea intoa shippable website")。约定是加一个显式分隔位条目,如 `landing.heroSep` —— 中日文是空串,拉丁 / 西里尔 / 谚文是单个空格。`scripts/check-i18n.mjs` 会把「值首尾有多余空格」判为失败(碎片型条目 `*Suffix` / `*Prefix` / `*Hint` 与分隔位除外)。
- Non-component code (e.g. `lib/api.ts`) fetches entries with `tStatic()`; copy whose language must be decided before writing to the DB lives in `src/lib/messages/` (the Worker-side copy is independent of the frontend; the two share no modules). The agent's own progress/error copy is a third, independent set: `agent/src/messages/`. All three sets use the same language codes.
- **The language of a generated app is not decided by the UI language**: artifact language follows the body of the user's request (detected agent-side, see `docs/FORGE2.md` §17.8). When editing prompts, never hardcode the language — `systemPrompt(lang, mode)` in `agent/src/prompt.ts` is a function, and the language block is the prompt's first section.

---

## 7. Do not

- **Never auto-deploy production** (see §1).
- Do not reuse any Worker / D1 / secrets / Cloud Run service from the legacy online `forge` service; all resources in this project are standalone.
- **Never set staging's `AGENT_MAX_RUN_MS` below production's**: real multi-file generation takes over 6 minutes; cutting it gets killed by its own timeout (burned once: at 300s normal jobs failed), destroying staging's validation value. The abuse gate is `--max-instances 1`, not shorter timeouts.
- Do not modify `scripts/guard-prod-deploy.mjs` to make a deploy pass, or deploy with unfinished work in the tree.
