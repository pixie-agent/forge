CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  -- 邮箱/密码登录的 PBKDF2 摘要;Google 登录创建的账号无密码,此处存空串 ''
  -- (verifyPassword 对空串直接判否),以兼容历史上 password_hash 的 NOT NULL 约束
  password_hash TEXT NOT NULL,
  -- Google OIDC 的 sub(唯一账号标识);邮箱/密码注册的用户为 NULL,首次用 Google 登录时回填
  google_sub    TEXT,
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
  status         TEXT NOT NULL DEFAULT 'pending',  -- pending | running | succeeded | failed | cancelled(用户手动停止)
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

-- 生成过程中用户「追加的要求」投递队列(见 docs/FORGE2.md §5.2):
-- agent 每 5s 轮询 /internal/jobs/:id/state 取走未消费的行,交给 pi 的 session.steer()。
-- attachments 里是 base64(上限 1.2MB),生命周期只到任务落定 —— 落定时整表按 job_id 清掉。
CREATE TABLE IF NOT EXISTS job_messages (
  id           TEXT PRIMARY KEY,
  job_id       TEXT NOT NULL REFERENCES jobs(id),
  content      TEXT NOT NULL,
  attachments  TEXT,                        -- JSON:[{name,mimeType,data}],无附件为 NULL
  consumed_at  TEXT,                        -- 已被 agent 取走(仅防重复投递,不代表消息已删除)
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 连接器(见 docs/CONNECTORS.md §4):账号级连接 + 项目级绑定。
-- 要授权的才算「连接」(auth: oauth);只让用户填个 ID 的(GA4 measurementId / Stripe 付款链接)
-- 没有 connections 行,只是 project_connectors.config_json 里的一段配置。
CREATE TABLE IF NOT EXISTS connections (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  provider      TEXT NOT NULL,                    -- ga4 | stripe | github | supabase
  account_label TEXT NOT NULL,                    -- "acme.com" / "me@x.com",仅展示
  scopes        TEXT NOT NULL DEFAULT '',         -- 记下来才能显示「只读 / 可写」
  credentials   TEXT NOT NULL,                    -- JSON,AES-GCM 密文(public 值也走这里,统一路径)
  status        TEXT NOT NULL DEFAULT 'active',   -- active | revoked | error
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, provider, account_label)
);

CREATE TABLE IF NOT EXISTS project_connectors (
  project_id  TEXT NOT NULL REFERENCES projects(id),
  provider    TEXT NOT NULL,
  env         TEXT NOT NULL DEFAULT 'live',       -- draft | live,与数据层同口径
  config_json TEXT NOT NULL DEFAULT '{}',         -- 非密配置:measurementId / paymentLink / connectionId
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, provider, env)
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
-- google_sub 唯一(允许多个 NULL:邮箱/密码账号未绑定 Google),防止同一 Google 账号绑定到两个用户
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub);

CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs(project_id, status);
CREATE INDEX IF NOT EXISTS idx_jobs_user    ON jobs(user_id, status);
-- cron 每分钟按 status + updated_at 清扫,走此索引避免全表扫描
CREATE INDEX IF NOT EXISTS idx_jobs_sweep   ON jobs(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_connections_user ON connections(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_project_connectors_project ON project_connectors(project_id, env);