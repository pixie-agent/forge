# Configurable orchestration — target architecture

Status: **shipped** (P1–P5). This document fixed the target for making Forge's generation orchestration
**fully configurable** — agents, tools, skills, MCP, and workflows — and the admin UI + CLI to edit it. The
shipped implementation is documented in `docs/FORGE2.md` §17.9–§17.14; the sections below are kept as the
design record. One deviation from the original plan: rather than a single `orchestration.zip` bundle, the
resources ship as separate objects — `platform_pipeline` (D1) + `promptset.zip` / `agentset.json` /
`skillset.zip` / `mcpset.json` (R2 `PROMPTS` bucket).

## 1. Goal

Today the pipeline DAG and the prompt text are already data (editable at `/admin` and via
`agent/orchestration/push.mjs`). But the *executors* are not: **agent names, tools, skills, and MCP
are hardcoded or disabled**. A configurable DAG whose nodes can only be one of three hardcoded agents
with a 7-tool allowlist is not meaningfully configurable. The goal is to make the whole
**orchestration bundle** editable — pipeline + agents + skills + MCP + prompts — from the admin UI and
the CLI, matching teamai's "resources as files in one repo" model.

## 2. Current state vs. target

| Dimension | Today (hardcoded / off) | Target (configurable) |
| --- | --- | --- |
| Agent names | `planner \| coder \| reviewer` only (`agent/src/pipeline.ts` `AGENT_NAMES`, `AGENTS`) | named agents defined in the bundle, referenced by id |
| Agent definition | name → hardcoded default tools (`AGENTS` map) | per-agent: system prompt + tools + model + skills + mcp |
| Tools | allowlist `{read,bash,edit,write,grep,find,ls}` (`AGENT_TOOLS`) | pi's `ToolLoadout`, per-agent, from the allowlist of pi built-ins |
| Skills | disabled (`session.ts` `noSkills: true`) | re-enable pi `loadSkillsFromDir`, deliver `skills/*/SKILL.md` in the bundle |
| MCP | not wired (pi has `createMcpExtension`, unused) | `mcp` config in the bundle, credentials via the connectors discipline |
| HITL (human-in-the-loop) | none (prompts literally say "non-interactive, never ask") | `approve` / `choose` step kinds that pause and wait for the user |
| Step outputs | implicit, via shared-workspace files (`spec.md`/`plan.json`) | typed `output` per step (deferred; reserve the field) |
| Prompt text | bundle (`promptset.zip`, partial override) | unchanged (kept as-is) |
| Admin UI | JSON textarea for pipeline + file editor for prompts | structured editors per resource + JSON fallback |
| CLI | `push.mjs` (pipeline + prompts), `forge-orchestration`/`forge-prompts` skills | one bundle push + per-resource edit/verify |

## 3. The orchestration bundle

Adopt teamai's "one versioned bundle" shape. A single zip (R2 object, versioned like today's
`promptset.zip`) carries everything a job needs; one version = one consistent point-in-time.

```
orchestration.zip
  pipeline.json              # v1alpha2 (see §4)
  agents/<name>.yaml         # agent definitions (see §5)
  skills/<name>/SKILL.md     # pi skills, delivered to the skill loader
  mcp.yaml                   # MCP server declarations (see §6)
  prompts/                   # existing prompt tree, unchanged (§17.10)
```

Delivery stays per-job: the Worker reads the bundle from R2 and ships it as `body.bundle` (or the
existing `body.pipeline` + `body.promptFiles` extended). The agent materializes it into the workspace
before the run. Empty/absent = built-in defaults (current behavior), so a dirty bundle never blocks
generation.

Migration path: today `platform_pipeline` (D1) and `promptset.zip` (R2) are two surfaces. The bundle
becomes the single source of truth; D1 `platform_pipeline` is kept read-only during the transition and
later removed. Admin saves atomically as one R2 version (like `promptset.zip` today), which also fixes
the current split-brain where a pipeline can reference prompt files from a different version.

## 4. Pipeline schema v1alpha2

Increment `schemaVersion` to `v1alpha2`. Changes are additive; v1alpha1 remains parseable.

- **Agent reference**: a step's `agent` may be a string id into `agents/<name>.yaml`, or an **inline
  object** `{ systemPrompt, tools, model, skills, mcp }`. The `AGENT_NAMES` allowlist is lifted; an
  unknown id fails validation at save time.
- **HITL step kinds** (teamai's `approve`/`choose`):
  - `{ id, needs, approve: "按这个方案继续?" }` — pauses the run and waits for the user.
  - `{ id, needs, choose: { prompt, options: [...] } }` — pause with a fixed choice list.
  - Requires a pause/resume protocol (see §7), the biggest new mechanism.
- **Typed `output`** (reserved, not implemented in phase 1): `{ output: { sections: [...], ... } }`,
  read downstream as `{{ steps.<id>.outputs.<field> }}` — teamai's structured inter-step data. Forge
  currently passes data via shared-workspace files; typed outputs replace that for new steps.
- Keep: `command: build`, `needs`, `continue_on_failure`, `rollback`, `budget_ms`/`min_budget_ms`,
  `progress`, `images`, `deliver`.

## 5. Agents (`agents/<name>.json`) — shipped in P1

Named agents are now **data**. A pipeline step's `agent` is either a string name (built-in
`planner|coder|reviewer`, or a name in the platform registry) or an **inline object**. The registry
is a flat JSON map stored in the `PROMPTS` R2 bucket as `agentset.json` (reusing the existing bucket —
no new binding), edited at `/admin/orchestration?r=agents`, pushed by `agent/orchestration/push.mjs`, and delivered
per job as `body.agents`.

```
{
  "reviewer": {
    "systemPrompt": "…inline system prompt text…",   // optional; falls back to prompts/system/<name>.md
    "tools": ["read", "edit", "write"],              // optional; ⊆ {read,bash,edit,write,grep,find,ls}
    "skills": ["review-notes"],                      // wired (P2): selects from the skillset (§17.12)
    "mcp": ["search"],                               // wired (P3): selects from mcpset.json (§17.13)
    "model": { "name": "deepseek-flash", "effort": "high" }  // reserved: validated, not wired
  }
}
```

Resolution order (`resolveAgent` in `agent/src/runner.ts`): built-in name → registry entry → inline
object → coder default (with a warning; an unknown name never fails a job). The built-in three stay
hardcoded as the safe fallback, so `agents/` holds *additional* agents. The seeded
`agent/orchestration/agents/clarify.json` is a read-only example, not wired into the default pipeline.
JSON, not YAML: the repo is JSON-consistent (the pipeline DSL is JSON) and adding a YAML parser to
both sides isn't worth it. This is the foundation for a future "clarify" agent
(the requirement-confirmation round the user asked for).

## 6. MCP — shipped in P3 (`mcpset.json`)

Shipped shape is JSON `mcpset.json` (`{ "servers": { "<name>": {…} } }`), see FORGE2.md §17.13; the yaml
sketch below was the original target. Credentials stay as `${NAME}` placeholders resolved from Cloud Run
Secrets; Forge forces `exposure: "direct"` (pi's default `codemode` hides tools from a headless agent).

```
servers:
  search:
    transport: stdio | http
    command: npx -y @some/mcp-server            # stdio
    url: https://...                            # http/sse
    env: { TOKEN: "{{ secret.TOKEN }}" }        # optional
    expose: [tool-a, tool-b]                    # optional allowlist
```

Credential discipline mirrors `docs/CONNECTORS.md` §6b: secrets live only in one dispatch request,
never in D1/R2/artifacts; the bundle stores **placeholders**, the Worker/agent injects the real value
from a Secret. Security review is required before enabling any MCP server (a stdio server is arbitrary
code execution inside the sandbox; an http server is an external trust surface).

## 7. HITL pause/resume — shipped in P4

Implemented as described below; the shipped detail (resume context fields, `waiting_human` semantics, the
24h reply-timeout sweep, usage `accumulate`) lives in FORGE2.md §17.14.

**Cost model — two requests per HITL round, split at the human gate.** Holding a Cloud Run instance
idle while the user decides burns request-time for nothing, and `--timeout 3600` would eventually kill
the wait anyway. So a HITL node **ends** the first run, and a **fresh** Cloud Run request resumes after
the answer:

1. **Reach the gate.** The agent runs the DAG until a HITL node (`approve`/`choose`). It takes a forced
   source-tree snapshot (existing `checkpoint_key`, unchanged), builds a *resume context*, reports
   `waiting_human` via a new `/internal/jobs/:id/wait` callback, then returns 200. Cloud Run frees the
   instance — zero idle cost while the user decides.
2. **Answer resumes.** `POST /api/projects/:id/respond { jobId, option, answer }` flips the job back to
   `running` and dispatches a fresh `/run` carrying the snapshot as `currentFiles`, the resume context,
   and the answer. A new instance restores state and continues the DAG after the gate — the **same
   job id**, so the launch-time credit freeze remains the single charge point.

**Resume context** (`cp/<projectId>/<jobId>.resume.json`, written only at pause time; the periodic
60s snapshot stays a bare source tree):

- `doneStepIds` — steps already finished, so resume skips them and their dependents see `needs` as
  satisfied;
- `gateStepId` + `question` + `options` — the HITL node and what the user is answering;
- `deliverSummary` / `lastAgentSummary` — accumulated delivery text (plain strings, serializable);
- `baseline` + `built` — the last successful build source and flag, so a downstream `rollback` node
  can still roll back;
- `remainingMs` — budget left, clamped into the resumed run's `maxRunMs` so a resume cannot get a
  fresh 3600s.

**`waiting_human` is dormant, not dead, and still holds the project lock.** Split the two meanings of
the current status set:

- `ACTIVE_STATUS_SQL` → `IN ('pending','running','waiting_human')` — project lock (no second
  generation while waiting) and UI "active job" recovery.
- new `RUNNABLE_STATUS_SQL` → `IN ('pending','running')` — the heartbeat/timeout sweeps (45s / 180s /
  3700s) must **not** judge a waiting job dead.

A cron sweep marks `waiting_human` older than a configurable timeout (default 24h) as failed: refunds
credits, releases the lock, deletes the resume object. "The user never replies" therefore costs
nothing and leaks nothing. The delivery-summary language-retry can't reuse the pre-pause
`AgentSession` (not serializable); on resume it degrades to the current step's session or is skipped.

## 8. Admin UI and CLI

> **Shipped (2026-11-23, revised 2026-11-28):** the per-resource pages were merged into one page,
> `/admin/orchestration`, with a client-side relationship graph + reference check on top (see
> `docs/FORGE2.md` §17.16). Its AI assist section (`?r=assistant`) takes the change in one sentence; the agent
> generates the config, the Worker re-validates it with the same schema used at save time, and it fills
> the editor for review — never auto-saved. The structured DAG editors below remain future work.

**Admin UI** — replace the two raw pages with one `/admin/orchestration` (or tabbed page):

- **Pipeline**: structured DAG editor (add/reorder/link nodes, per-node fields) + JSON fallback + the
  existing validation messages.
- **Agents**: list + YAML/JSON editor with validation.
- **Skills**: list + `SKILL.md` editor.
- **MCP**: server editor + credential placeholder + expose allowlist.
- **Prompts**: the existing file editor (unchanged).

All resources edit one bundle; "Save" validates the whole bundle (schema + cross-references) and
archives one R2 version.

**CLI** — extend `agent/orchestration/push.mjs` to push the whole bundle (pipeline + agents + skills +
mcp + prompts) as one version, keeping the existing `--env`/`--pipeline-only`/`--prompts-only` flags
and adding `--bundle-only`/`--agents-only`/`--mcp-only`. The `forge-orchestration` and `forge-prompts`
skills gain the new resources; `orchestration:check`/`orchestration:render` extend to validate/render
agents, skills, and mcp references.

## 9. Security and cost (non-functional)

- Every newly-configurable capability widens what the coding agent can do in its isolated workspace.
  MCP and custom tools are the highest-risk additions and are treated like connectors (secret hygiene,
  per-request lifetime, no persistence).
- More agent nodes / skills / MCP calls mean more tokens and rounds; `max_run_ms` and per-node budgets
  stay the guardrails and must be re-checked when the schema grows.

## 10. Phased roadmap

| Phase | Scope | Deliverable |
| --- | --- | --- |
| **1** | agents + tools configurable (**done** — inline agent defs + named `agents/*.json`, lifted allowlists) | add a named agent without code; first use = clarify agent |
| **2** | skills (**done** — re-enable pi skills, deliver `skills/` in the bundle) | SKILL.md delivered per job |
| **3** | MCP (**done** — wire `createMcpExtension` + credential placeholders) | MCP tools available to agents |
| **4** | HITL (**done** — `approve`/`choose` + two-request pause/resume, see §7) | `waiting_human` state, `/internal/jobs/:id/wait` + `POST /:id/respond`, R2 resume context, 24h reply-timeout sweep, project-page confirm UI |
| **5** | typed `output` + `if` (**done** — structured inter-step data) | drop shared-workspace file handoffs |

All five phases are shipped. Phases 1–2 were additive (no new protocol); phases 3–5 introduced new
mechanisms (MCP connection, pause/resume, typed data), each of which landed behind its own design review.

## 11. Non-goals (for now)

- Per-step workspace isolation / true parallel branches (teamai's `workspace: new` + worktrees) — Forge
  shares one workspace and runs the DAG serially; unchanged until a separate decision.
- Scorers / benchmarks / self-improvement (teamai's "Team Improvement" layer).
- A git-repo-based sync protocol (`teamai pull/push` over git) — Forge keeps R2 as the store.
