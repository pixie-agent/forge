---
name: forge-orchestration
description: "Edit, debug and publish Forge 2.0's generation orchestration — the pipeline DAG (pipeline.default.json) and the prompt file tree (prompts/). Use when asked to change planner/coder/reviewer steps, build/rollback nodes, step budgets, or the {{variable}} prompt templates, or to run the edit→verify→run→push loop for agent/orchestration/."
---

# Forge orchestration — pipeline + prompts

You are working in `agent/orchestration/`, the single runtime source of truth for the two data layers that drive how a Forge generation job runs. Read `AGENTS.md` in this directory for the full picture; this skill is the operational shortcut.

## The two layers

| | Pipeline (`pipeline.default.json`) | Prompts (`prompts/`) |
| --- | --- | --- |
| Answers | who runs, in what order, with what budget | what each runner says |
| Shape | TeamAI-workflow JSON subset: `steps[]` with `id` + `needs` (DAG) | `.md` tree, each a `{{变量}}` template |
| Node kinds | `agent` step (named sub-agent + prompt) · `command: "build"` step | `system/*.md` (per-agent system prompt) · `user/*.md` (per-turn user prompt) · `shared/*.md` (fragments) |

Two binding points connect them:
1. **Agent name → system prompt**: a step with `"agent": "coder"` loads `prompts/system/coder.md`.
2. **`{{ }}` placeholder → user prompt**: `{{ plannerPrompt }}` → `prompts/user/planner.md`; `{{ coderPrompt }}` → `user/generate.md` (generate) / `user/chat.md` (chat); `{{ reviewerPrompt }}` → `user/polish.md`. `user/delivery-note.md` is used only by the final delivery-note retry.

## The loop (edit → verify → run → push)

All commands run from the **repo root**. None of the offline steps need an LLM or `.env`.

```bash
# 1) edit the files here, then verify offline
npm run orchestration:check     # build agent + ~35 assertions (parse, DAG, prompt interpolation, file/code sync)
npm run orchestration:render                          # print each node's resolved system + user prompts
npm run orchestration:render -- --type chat --message "加一个深色模式"

# 2) run a real job locally (needs `npm run dev:agent` in another terminal)
npm run orchestration:run -- --idea "做一个宠物领养网站"
npm run orchestration:run -- --type chat --message "把首页改成深色" --no-review

# 3) publish as runtime data (no deploy; next job dispatch picks it up)
npm run orchestration:push                                        # local (devadmin from .dev.vars)
npm run orchestration:push -- --env staging --password <口令>
npm run orchestration:push -- --env prod --password <口令> --yes
```

Direct equivalents (no npm): `node agent/orchestration/debug.mjs render|run`, `node agent/orchestration/push.mjs`, `node agent/scripts/pipeline-check.mjs`. `debug.mjs`/`push.mjs` are helpers, not required entry points.

## Invariants (enforced by code, not by these files)

- `restorePlatformFiles` + `ensureLocaleCall` run before **every** build node; platform-owned files can't be altered by sub-agents.
- Invalid pipeline (cycle / dangling `needs` / unknown agent / empty prompt) → falls back to `pipeline.default.json` → then hardcoded `DEFAULT_PIPELINE`. Never blocks generation.
- Prompts must be `shared|system|user/*.md` one level deep; anything else is dropped/ignored.
- Artifact language follows the user's request body; keep language logic in `prompts/shared/lang-block.*.md`, never hardcode it.
- `pipeline.default.json` must stay in sync with `DEFAULT_PIPELINE` (agent/src/pipeline.ts) and the 「填入示例」 in `web/src/pages/AdminPipeline.tsx`. `orchestration:check` asserts the runtime one.

## Runtime delivery (what "push" and the admin pages do)

Every job dispatch pulls these live from D1/R2 (no cache): Worker `generate.ts` reads D1 `platform_pipeline` → `body.pipeline` and R2 `promptset.zip` → `body.promptFiles`; the agent uses `body.pipeline` (else the image's `pipeline.default.json`) and overlays `body.promptFiles` on the image's prompt tree. Staging and prod have **separate** D1/R2, so a change pushed to one environment does not affect the other.
