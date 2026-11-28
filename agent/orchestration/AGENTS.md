# Orchestration directory — pipeline + prompts + agents (one editable home)

This directory is the **single runtime source of truth** for the three data layers that drive how a Forge generation job runs. It is meant to be opened directly by a coding agent (Claude Code / pi): edit the files here, verify with the commands below, done. No special entry file is required.

```
agent/orchestration/
├── AGENTS.md               ← this file (read me first)
├── pipeline.default.json   ← the built-in default pipeline (DAG data)
├── prompts/                ← the prompt file tree ({{variable}} templates)
│   ├── shared/  system/  user/
├── agents/                 ← named-agent registry (one .json per extra agent; see agents/README.md)
├── skills/                 ← pi skills delivered per job (skills/<name>/SKILL.md, R2 skillset.zip)
├── mcp.json                ← platform MCP config (name → stdio/http server, R2 mcpset.json)
└── debug.mjs               ← OPTIONAL helper (render / run). Everything it does is
                              also reachable via npm scripts below.
```

## How to work in this directory (for a coding agent)

1. **Edit the data files** — `pipeline.default.json` and/or `prompts/*.md` and/or `agents/*.json`. They are loaded at job time by the agent; no recompile is needed to iterate.
2. **Verify offline** (no LLM, no server, no `.env` needed):
   ```bash
   npm run orchestration:check     # build agent + assert pipeline/prompts parse & stay in sync (~35 assertions)
   npm run orchestration:render    # print what each pipeline node resolves to (system + user prompts)
   npm run orchestration:render -- --type chat --message "加一个深色模式"
   ```
   Equivalent direct forms (same thing, no npm):
   ```bash
   npm --prefix agent run build
   node agent/scripts/pipeline-check.mjs
   node agent/orchestration/debug.mjs render --type chat --message "…"
   ```
3. **Verify live** (real LLM, the same POST /run the Worker sends):
   ```bash
   # terminal 1, repo root
   npm run dev:agent
   # terminal 2
   npm run orchestration:run -- --idea "做一个宠物领养网站"
   npm run orchestration:run -- --type chat --message "把首页改成深色" --no-review
   ```

`debug.mjs` is just one way to run steps 2–3; the npm scripts are the canonical entry points. Use whichever you prefer.

## The three layers and how they relate

A generation job is assembled from **three orthogonal data layers**:

| | Pipeline (`pipeline.default.json`) | Prompts (`prompts/`) |
| --- | --- | --- |
| Answers | **who runs, in what order, with what budget** | **what each runner says** |
| Shape | TeamAI-workflow JSON subset: `steps[]` with `id` + `needs` (DAG edges) | A tree of `.md` files, each a `{{变量}}` template |
| Node kinds | `agent` step (a named sub-agent + a user prompt) · `command: "build"` step (platform deterministic build) · `approve`/`choose` gate step (pause for the user) | `system/*.md` (per-agent system prompt) · `user/*.md` (per-turn user prompt) · `shared/*.md` (fragments) |
| Edited at | `/admin/orchestration?r=pipeline` (D1 `platform_pipeline`) or this file | `/admin/orchestration?r=prompts` (R2 `promptset.zip`) or this tree |
| Runtime fallback | empty/invalid → this file's steps → hardcoded `DEFAULT_PIPELINE` | missing file → the default shipped in the image (this tree) |

A third, optional layer sits alongside them — **named agents** (`agents/*.json`):

| | Agents (`agents/*.json`) |
| --- | --- |
| Answers | **what extra agents exist** (beyond built-in planner/coder/reviewer) and each one's tools/system prompt |
| Shape | flat JSON `{ "<name>": { systemPrompt?, tools?, skills?, mcp?, model? } }` (see `agents/README.md`) |
| Edited at | `/admin/orchestration?r=agents` (R2 `agentset.json`) or this directory |
| Runtime fallback | absent/unknown name → coder default + a warning, never a failure |

They meet in **three binding points** (see `agent/src/pipeline.ts` + `agent/src/prompts.ts` + `agent/src/runner.ts`):

1. **Agent name → system prompt.** A pipeline step declares `"agent": "coder"`; the runner loads that agent's system prompt from `prompts/system/coder.md`. The name is arbitrary: a custom name resolves through the `agents/` registry → `prompts/system/<name>.md` → coder (see binding 3). This binding is by name and happens regardless of the step's `prompt` field.
2. **`{{ }}` placeholder → user prompt.** The built-in pipeline writes `"prompt": "{{ plannerPrompt }}"` etc. The loader resolves those against `prompts/user/*.md`:

| placeholder | resolves to |
| --- | --- |
| `{{ plannerPrompt }}` | `prompts/user/planner.md` |
| `{{ coderPrompt }}` | `prompts/user/generate.md` (generate) / `prompts/user/chat.md` (chat) |
| `{{ reviewerPrompt }}` | `prompts/user/polish.md` |

A custom pipeline can also reference raw request fields directly (`{{ idea }}`, `{{ note }}`, `{{ message }}`, `{{ history }}`, `{{ connectors }}`, `{{ attachments }}`, `{{ langName }}`…), skipping the user-prompt files entirely. `prompts/user/delivery-note.md` is used only by the final delivery-note language retry, not by any pipeline step.

3. **`"agent": "<name>"` → agent definition.** A custom name resolves to `agents/<name>.json` (delivered per job as `body.agents`) or, failing that, to `prompts/system/<name>.md`; an inline `{ systemPrompt, tools }` object in the step skips the registry entirely. Unknown names fall back to the coder default.

4. **`skills` / `mcp` / `output` / `if` / gate** (P2–P5, see `docs/FORGE2.md` §17.12–§17.14): an agent step's
   `skills: ["forge-ui"]` injects that skill's `SKILL.md` into the system prompt; `mcp: ["search"]` mounts
   that server's tools; `output: ["sections"]` captures the step's closing JSON into
   `{{ steps.<id>.outputs.sections }}` for downstream prompts (plus the always-present
   `{{ steps.<id>.outputs.summary }}`); `if: "{{ answer }} == 确认"` skips the step when false; a gate node
   `approve`/`choose` pauses the run and waits for the user (resumed via
   `POST /api/projects/:id/respond`, same job id).

**So:** the pipeline decides *who/when/how much*, the prompts decide *what is said*, the agents decide *who the extra roles are*. Edit any one without the others; each has its own fallback so a broken file never blocks a job.

## How a job actually starts (the path the debug commands mirror)

```
Worker (src/routes/generate.ts → src/lib/agent.ts dispatchAgent)
  └─ POST {AGENT_URL}/run   header X-Agent-Secret, body = RunRequest
       body.pipeline        ← JSON string (global pipeline from D1, may be empty)
       body.promptFiles     ← path→content map (R2 zip unzipped, may be absent)
       body.agents          ← name→definition map (R2 agentset.json, may be absent)
       body.idea/message/…  ← the user's request
  Agent (agent/src/index.ts → runJob)
       ├─ req.pipeline ? parsePipeline : defaultPipeline(→ pipeline.default.json)
       └─ loadPromptSet(promptsDir, …, overrideDir from req.promptFiles)
```

## Debug commands (closed loop)

### render — offline, no LLM, no server, no `.env`

Shows, for the current files, what each pipeline node resolves to (system prompt + interpolated user prompt). Fails loudly on DAG errors (cycle / dangling `needs` / bad node). `--pipeline <file>` selects a pipeline file you made (default `pipeline.default.json`).

```bash
npm run orchestration:render
npm run orchestration:render -- --type chat --message "加一个深色模式"
npm run orchestration:render -- --pipeline pipeline.custom.json
```

Requires a built `agent/dist` — `npm run orchestration:render` builds it for you (or `npm --prefix agent run build`).

### run — live, the same POST /run as the Worker

Starts a real job on a locally running agent (`npm run dev:agent`, listening on `:8080`). For the built-in `pipeline.default.json` it sends **no** `body.pipeline` — the local agent's `defaultPipeline()` reads that file via `ORCHESTRATION_DIR` and applies mode filtering exactly like production's empty-pipeline path; for a custom `--pipeline` file it sends the JSON as `body.pipeline` (same as D1-stored config). Prompts are read by the agent straight from this directory via `ORCHESTRATION_DIR`; pass `--send-files` to exercise the `body.promptFiles` override/zip path instead. The agent streams progress/logs to its own stdout; the final `src`/`dist`/`summary` come back on the HTTP response (same `dispatchAgent` contract).

Flags: `--type generate|chat` (default generate), `--idea …` / `--message …`, `--note …`, `--lang zh|en|…`, `--pipeline <file>`, `--url http://localhost:8080`, `--send-files`, `--no-review` (cheaper: stop after first build). `X-Agent-Secret` is read from `../.env` (`AGENT_SECRET`).

### Worker-side round-trip (the three admin pages)

The same data has a second home in the Worker (admin UI → D1/R2 → `body.pipeline`/`body.promptFiles`/`body.agents`). To test that path, run the Worker locally (`npm run dev`) and hit:

```bash
curl -X POST localhost:8787/api/admin/login -H 'Content-Type: application/json' -d '{"password":"devadmin"}' -i
# then GET/PUT /api/admin/pipeline, /api/admin/agents and /api/admin/prompts
# (the admin UI is one page: web/src/pages/AdminOrchestration.tsx + web/src/components/admin/)
```

The admin UI is a single page, `/admin/orchestration`: a relationship graph (step → agent → prompts → skills / MCP,
with a reference check) on top and the five resource editors below. Its **AI 助手** section takes a natural-language
description, `POST /api/admin/orchestration/suggest` (Worker → agent `POST /suggest` → LLM) returns validated changes,
and they are written into the editors for review — never auto-saved. See `docs/FORGE2.md` §17.15–§17.16.

## Invariants (enforced by code, not by these files)

- `restorePlatformFiles` + `ensureLocaleCall` run before **every** build node; platform-owned files can't be altered by any sub-agent.
- Empty-run detection (generate) runs before the first build; rollback restores the last good baseline on `rollback: true` build failure.
- Invalid pipeline (cycle / dangling needs / bad node) → falls back to `pipeline.default.json` → then `DEFAULT_PIPELINE`. Never blocks generation.
- Unknown agent name → coder default + a `[pipeline]` warning. Never fails a job.
- Prompts must be `shared|system|user/*.md` one level deep; other paths are dropped by the Worker zip validator and ignored by the loader.
- Artifact language follows the user's request body, not the UI language and not these files; keep the language logic in `prompts/shared/lang-block.*.md`.
- `pipeline.default.json` must stay in sync with `DEFAULT_PIPELINE` in `agent/src/pipeline.ts` (the hardcoded fallback) and with the 「填入示例」 in `web/src/pages/AdminPipeline.tsx`. `npm run orchestration:check` asserts the runtime one — run it after edits.
