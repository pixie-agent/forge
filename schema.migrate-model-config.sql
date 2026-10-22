-- 模型配置与用量观测(2026-10-21)
--
-- 目标:模型/网关/思考档位/复查轮/价格从「部署命令里的环境变量」变成后台可配置的数据,
-- 并把每次任务实际使用的配置记到 job_usage,后台才能按模型/配置看成本。
--
-- 生效规则:同一 channel 下 enabled = 1 的那一行生效;表为空或读取失败时回落 Cloud Run env。
-- 配置行可在后台原地编辑;历史成本在用量上报时已落 job_usage,不会因后来改价而重算。
CREATE TABLE IF NOT EXISTS model_configs (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,                       -- 后台展示名
  channel            TEXT NOT NULL DEFAULT 'default',     -- 预留 free / vip;当前一律 default
  provider_id        TEXT NOT NULL DEFAULT 'forge',
  base_url           TEXT NOT NULL,
  api_dialect        TEXT NOT NULL DEFAULT 'openai-completions',
  model_id           TEXT NOT NULL,
  thinking_level     TEXT NOT NULL DEFAULT 'medium',
  reasoning          INTEGER NOT NULL DEFAULT 1,
  image_input        INTEGER NOT NULL DEFAULT 0,
  design_review      TEXT NOT NULL DEFAULT 'generate',
  max_run_ms         INTEGER NOT NULL DEFAULT 1500000,    -- 必须 < Cloud Run --timeout 3600s
  polish_max_ms      INTEGER NOT NULL DEFAULT 300000,
  input_price        REAL NOT NULL DEFAULT 0,             -- USD / 1M tokens
  output_price       REAL NOT NULL DEFAULT 0,
  cache_read_price   REAL NOT NULL DEFAULT 0,
  cache_write_price  REAL NOT NULL DEFAULT 0,
  enabled            INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
-- 每个通道最多一条生效配置(部分唯一索引;后台启用新配置时先把旧的置 0)
CREATE UNIQUE INDEX IF NOT EXISTS idx_model_configs_active
  ON model_configs(channel) WHERE enabled = 1;

-- 任务落配置快照:派发时写入,用量回调据此取当时的单价
ALTER TABLE jobs ADD COLUMN model_config_id TEXT NOT NULL DEFAULT '';
ALTER TABLE job_usage ADD COLUMN model_config_id TEXT NOT NULL DEFAULT '';

-- 后台按时间/模型聚合
CREATE INDEX IF NOT EXISTS idx_job_usage_created ON job_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_job_usage_config ON job_usage(model_config_id, created_at);
