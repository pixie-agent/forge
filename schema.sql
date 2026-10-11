CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  credits       INTEGER NOT NULL DEFAULT 20,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id              TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL REFERENCES users(id),
  slug            TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL DEFAULT '',
  description     TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'draft',
  current_version INTEGER NOT NULL DEFAULT 0,
  -- 线上版本:发布页(/s/:slug)服务的版本;生成只更新 current_version(预览/编辑基线),
  -- 用户点「发布此版本」才把 published_version 指过去 → 线上不会因一次生成被动更新。
  published_version INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 多文件版本:源码树存 D1(src_json),构建产物(dist)存 R2(p/{projectId}/v/{versionNo}/{path})。
-- manifest_json 记录产物清单(入口、哈希、大小、文件列表),R2 读取据此定位。
-- version_no = 0 保留给「草稿」:生成/对话写入的工作副本,可被反复覆盖(ON CONFLICT 更新),不是正式版本;
-- version_no >= 1 是用户点「生成新版本」确认后的正式版本,不可变。
CREATE TABLE IF NOT EXISTS versions (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  version_no    INTEGER NOT NULL,
  src_json      TEXT NOT NULL,                    -- {"src/App.jsx":"...","index.html":"..."}
  manifest_json TEXT NOT NULL,                    -- {"entry","buildHash","bytes","files":[{"path","size"}]}
  bytes         INTEGER NOT NULL DEFAULT 0,       -- 构建产物总字节数(后台列表用)
  prompt        TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, version_no)
);

CREATE TABLE IF NOT EXISTS messages (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  role       TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 后台生成任务:请求只负责建任务并立刻返回,实际生成在 Cloud Run 异步执行,
-- 前端轮询/SSE 任务状态,刷新页面、断网都不丢任务
CREATE TABLE IF NOT EXISTS jobs (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id),
  user_id        TEXT NOT NULL REFERENCES users(id),
  type           TEXT NOT NULL,             -- 'generate' | 'chat'
  payload        TEXT NOT NULL,             -- JSON:{idea} 或 {message}
  status         TEXT NOT NULL DEFAULT 'pending',  -- pending | running | succeeded | failed
  stage          TEXT NOT NULL DEFAULT 'planning', -- planning | coding | building
  progress       TEXT,                      -- 人读的分段进度(agent 写入)
  plan_json      TEXT,
  files_preview  TEXT,                      -- JSON:{path,content} agent 最近写入的源文件,前端实时看代码
  agent_log      TEXT,                      -- agent 的流式输出(thinking/正文/工具调用),服务端保留尾部
  error          TEXT,
  result_version INTEGER,
  started_at     TEXT,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))  -- 任务总龄的计时起点(cron 据此永久判死)
);

-- 生成应用的后端(D1 文档集合),路径 /s/:slug/api/db/:collection 读写
-- env = 'draft'(编辑器预览产生) / 'live'(发布后访客产生),两套数据互不可见
CREATE TABLE IF NOT EXISTS site_data (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  env         TEXT NOT NULL DEFAULT 'live',
  collection  TEXT NOT NULL,
  data        TEXT NOT NULL,
  client_ip   TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_user    ON projects(user_id);
CREATE INDEX IF NOT EXISTS idx_versions_project ON versions(project_id);
CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user    ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_site_data_lookup ON site_data(project_id, collection, created_at);

CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs(project_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_user    ON jobs(user_id, status);
-- cron 每分钟按 status + updated_at 清扫,走此索引避免全表扫描
CREATE INDEX IF NOT EXISTS idx_jobs_sweep   ON jobs(status, updated_at);