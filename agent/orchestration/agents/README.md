# Named agents

Each `.json` file here is a **named agent**: a reusable `name → definition` that a pipeline
step can reference with `"agent": "<name>"` (the filename without `.json` is the name).

The three built-in agents (`planner` / `coder` / `reviewer`) are hardcoded as the safe fallback
in `agent/src/pipeline.ts`; they are **not** files here. Files in this directory define
*additional* agents. `agent/orchestration/push.mjs` pushes them to the Worker
(`PUT /api/admin/agents` → R2 `agentset.json`), which delivers them per job as `body.agents`.

## Schema

```json
{
  "systemPrompt": "inline system prompt text",
  "tools": ["read", "bash"],
  "skills": ["review-notes"],
  "mcp": ["search"],
  "model": { "name": "deepseek-flash", "effort": "high" }
}
```

- `systemPrompt` (optional): inline system prompt. If omitted, falls back to
  `prompts/system/<name>.md` (and then to the coder system prompt).
- `tools` (optional): subset of `{read,bash,edit,write,grep,find,ls}`; default = coder's set.
- `skills` / `mcp` are **wired** — they select subsets of the platform skillset (`skillset.zip`) and MCP
  config (`mcpset.json`) to inject/mount for this agent (see `docs/FORGE2.md` §17.12 / §17.13). `model` is
  still **reserved** — validated for shape but not applied.

## Reference from a pipeline

```json
{ "id": "clarify", "agent": "clarify", "prompt": "{{ idea }}" }
```

Or inline the whole definition (no file needed):

```json
{ "id": "clarify", "agent": { "systemPrompt": "…", "tools": ["read"] }, "prompt": "{{ idea }}" }
```

## Seeded example

`clarify.json` is a read-only example. It is **not** wired into the default pipeline — wire it
into a custom pipeline (or inline it) to use it. An unknown agent name never breaks a job: the
runner falls back to the coder default and logs a warning.
