-- 全局编排流水线(2026-11-16):把生成过程从「写死在 agent 代码里的三节点」变成后台可编辑的数据。
--
-- 与模型配置(model_configs)解耦:全平台一份,独立存储、独立后台、独立下发(body.pipeline 顶层字段)。
-- pipeline_json 是一份 JSON 对象(teamai workflow 子集,见 docs/FORGE2.md §17.9):
--   {
--     "schemaVersion": "v1alpha1",
--     "name": "generate",
--     "description": "…",
--     "steps": [
--       { "id": "planner", "agent": "planner", "prompt": "{{ idea }}", "images": true },
--       { "id": "coder", "needs": ["planner"], "agent": "coder", "prompt": "…", "deliver": true },
--       { "id": "baseline", "needs": ["coder"], "command": "build" },
--       { "id": "reviewer", "needs": ["baseline"], "agent": "reviewer", "prompt": "…", "continue_on_failure": true },
--       { "id": "rebuild", "needs": ["reviewer"], "command": "build", "rollback": true }
--     ]
--   }
--
-- 空串 = 用 agent 内置默认编排(Planner → Coder → build → Reviewer → rebuild)。
-- 填了 = 完全按这份定义执行;agent 逐节点校验,任一节点非法则整份回落默认,不让脏配置打断生成。
CREATE TABLE IF NOT EXISTS platform_pipeline (
  id TEXT PRIMARY KEY,
  pipeline_json TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO platform_pipeline (id, pipeline_json) VALUES ('global', '');
