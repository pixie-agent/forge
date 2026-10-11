-- Forge 2.0 迁移:单 HTML 版本 → 多文件版本(src_json + manifest_json + 构建产物走 R2)
--
-- ⚠️ 破坏性:下方 DROP TABLE versions / jobs 会**永久删除**旧单文件产物与任务历史,已发布站点也会随之 404。
-- 执行前务必确认没有需要保留的已发布站点;若有,先把旧版本导出留档:
--   npx wrangler d1 execute DB --remote --json \
--     --command "SELECT project_id, version_no, html FROM versions" > versions-backup.json
-- (或直接用 D1 Time Travel:`wrangler d1 time-travel restore DB --timestamp=...`,保留 30 天)
--
-- 说明:本仓库的 D1 是隔离的 v2 环境,按原计划不保留旧单文件产物与任务历史;
-- versions/jobs 直接重建,projects / users / messages / sessions / site_data 不受影响。
-- 全新安装无需执行本文件(直接 schema.sql 即可)。

DROP TABLE IF EXISTS versions;
CREATE TABLE versions (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  version_no    INTEGER NOT NULL,
  src_json      TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  bytes         INTEGER NOT NULL DEFAULT 0,
  prompt        TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, version_no)
);

DROP TABLE IF EXISTS jobs;
CREATE TABLE jobs (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id),
  user_id        TEXT NOT NULL REFERENCES users(id),
  type           TEXT NOT NULL,
  payload        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  stage          TEXT NOT NULL DEFAULT 'planning',
  progress       TEXT,
  plan_json      TEXT,
  files_preview  TEXT,
  agent_log      TEXT,
  error          TEXT,
  result_version INTEGER,
  started_at     TEXT,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_versions_project ON versions(project_id);
CREATE INDEX IF NOT EXISTS idx_jobs_project     ON jobs(project_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_user        ON jobs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_sweep       ON jobs(status, updated_at);