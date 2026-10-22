-- 用户大盘/分析埋点(2026-10-22)
-- 已存在的库跑本文件;全新库跑 schema.sql(含同样的列与表)。见 AGENTS.md §3。
--   staging: npm run db:migrate:analytics:staging
--   生产:    npm run db:migrate:analytics:remote
--
-- 为什么需要这些结构:
--   - users.last_active_at:现有的「最近活跃」只能用 MAX(jobs.created_at) 推,登录后只看不生成的用户会被误判流失;
--   - projects.published_at:published_version 只记结果、不记时间,算不了每日发布数与发布耗时;
--   - user_daily_active:按天去重的活跃表,DAU/WAU/MAU 与留存都从它算,避免扫全量 session/请求日志;
--   - user_events:关键行为流水(注册验证/建项目/建任务/发布/结账/支付/订阅),用于漏斗与转化回算。
--
-- 口径统一按 Asia/Shanghai(UTC+8)切日:day 存 'YYYY-MM-DD',由 Worker 侧按 UTC+8 生成;
-- 查询用 date(created_at, '+8 hours') 对齐。D1 里所有 datetime('now') 都是 UTC。

ALTER TABLE users ADD COLUMN last_active_at TEXT;
ALTER TABLE projects ADD COLUMN published_at TEXT;

-- 每日活跃:一个用户一天一行。UNIQUE 主键让重复上报天然幂等。
CREATE TABLE IF NOT EXISTS user_daily_active (
  user_id       TEXT NOT NULL,
  day           TEXT NOT NULL,              -- UTC+8 的 YYYY-MM-DD
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, day)
);
CREATE INDEX IF NOT EXISTS idx_user_daily_active_day ON user_daily_active(day);

-- 关键行为流水:只记少量高价值动作,不是全量请求日志。
--   register / register_verified / login
--   project_create / job_create / job_end / version_create / publish
--   checkout_start / order_paid / subscription_change
CREATE TABLE IF NOT EXISTS user_events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  props      TEXT NOT NULL DEFAULT '{}',    -- JSON,便于以后扩字段而不用改表
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_user_events_name ON user_events(name, created_at);
CREATE INDEX IF NOT EXISTS idx_user_events_user ON user_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_user_events_created ON user_events(created_at);
