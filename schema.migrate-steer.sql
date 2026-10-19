-- 增量迁移:生成过程中「追加要求」的投递队列(见 docs/FORGE2.md §5.2)
-- 已存在的库执行本文件;全新库直接跑 schema.sql 即可(两处定义保持一致)。
--   npm run db:migrate:steer:staging
--   npm run db:migrate:steer:remote
--
-- 幂等:重复执行不会报错。

CREATE TABLE IF NOT EXISTS job_messages (
  id           TEXT PRIMARY KEY,
  job_id       TEXT NOT NULL REFERENCES jobs(id),
  content      TEXT NOT NULL,
  attachments  TEXT,
  consumed_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_job_messages_job ON job_messages(job_id, consumed_at);
