CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  -- 邮箱/密码登录的 PBKDF2 摘要;Google 登录创建的账号无密码,此处存空串 ''
  -- (verifyPassword 对空串直接判否),以兼容历史上 password_hash 的 NOT NULL 约束
  password_hash TEXT NOT NULL,
  -- Google OIDC 的 sub(唯一账号标识);邮箱/密码注册的用户为 NULL,首次用 Google 登录时回填
  google_sub    TEXT,
  -- 注册赠送(= src/lib/credits.ts 的 SIGNUP_CREDITS,两处必须一致):1 积分 = 1 次生成
  credits       INTEGER NOT NULL DEFAULT 5,
  -- 邮箱验证:1 = 已验证(新代码注册时显式写 0,验证链接消费后置 1)
  email_verified INTEGER NOT NULL DEFAULT 1,
  -- 最近活跃时间(UTC);登录后只看不生成也能算进 DAU/流失,见 schema.migrate-analytics.sql
  last_active_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  token      TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);

-- 一次性邮箱验证 token(只存 SHA-256;used_at 非空 = 已消费)
CREATE TABLE IF NOT EXISTS email_verifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  ip         TEXT NOT NULL DEFAULT '',
  idea       TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  -- 1 = 邮件已成功交给 Email Sending;0 = 投递失败(仍保留 token,重发可立即进行)
  sent       INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_email_verifications_ip   ON email_verifications(ip, created_at);

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
  -- 发布时刻(UTC):published_version 只记结果、不记时间,大盘的每日发布数用它
  published_at    TEXT,
  -- 首页精选(见 schema.migrate-showcase.sql):只有已发布项目能上首页;
  -- featured_tags 是逗号分隔的展示标签(最多 5 个),featured_at 用于首页排序
  featured        INTEGER NOT NULL DEFAULT 0,
  featured_tags   TEXT NOT NULL DEFAULT '',
  featured_at     TEXT,
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
  agent_log      TEXT,                      -- agent 里程碑日志(关键节点/告警);完整过程只写 Cloud Run stdout
  error          TEXT,
  result_version INTEGER,
  model_config_id TEXT NOT NULL DEFAULT '',  -- 派发时使用的后台模型配置快照(见 schema.migrate-model-config.sql)
  channel        TEXT NOT NULL DEFAULT '',  -- '' | free | vip(见 schema.migrate-model-channel.sql)
  checkpoint_key TEXT,                      -- R2 断点快照键 cp/<projectId>/<jobId>.json(见 schema.migrate-checkpoint.sql)
  checkpoint_files INTEGER,                 -- 快照里的源码文件数
  checkpoint_bytes INTEGER,                 -- 快照字节数
  checkpoint_at  TEXT,                      -- 最后一次快照时间(cron 清理 7 天前的快照)
  started_at     TEXT,
  -- 最近一次派发时间:建单与人门续跑各写一次;总龄上限按它算,不把等用户作答的时间计进去
  -- (见 schema.migrate-dispatched-at.sql)。created_at 保持任务创建时间不动(看板统计/事件审计用它)。
  dispatched_at  TEXT,
  updated_at     TEXT NOT NULL DEFAULT (datetime('now')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
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

-- 模型配置(与 schema.migrate-model-config.sql 同内容):后台可增删启停的运行时配置,
-- 每个 channel 最多一条 enabled = 1;表为空时 agent 回落 Cloud Run env 默认模型。
CREATE TABLE IF NOT EXISTS model_configs (
  id                 TEXT PRIMARY KEY,
  name               TEXT NOT NULL,
  channel            TEXT NOT NULL DEFAULT 'default',
  provider_id        TEXT NOT NULL DEFAULT 'forge',
  base_url           TEXT NOT NULL,
  api_dialect        TEXT NOT NULL DEFAULT 'openai-completions',
  model_id           TEXT NOT NULL,
  thinking_level     TEXT NOT NULL DEFAULT 'medium',
  thinking_format    TEXT NOT NULL DEFAULT '',   -- pi compat.thinkingFormat;空 = 按 baseUrl 自动推断
  api_key_env        TEXT NOT NULL DEFAULT 'LLM_API_KEY', -- 该行使用的密钥环境变量名(执行体上绑定的 Secret),不含密钥值
  max_tokens         INTEGER NOT NULL DEFAULT 16384,
  reasoning          INTEGER NOT NULL DEFAULT 1,
  image_input        INTEGER NOT NULL DEFAULT 0,
  design_review      TEXT NOT NULL DEFAULT 'generate',
  max_run_ms         INTEGER NOT NULL DEFAULT 1500000,
  polish_max_ms      INTEGER NOT NULL DEFAULT 300000,
  queue_concurrency  INTEGER NOT NULL DEFAULT 0,   -- 任务并发(0=不限);仅 free 生效,与 Cloud Run 资源并发无关
  input_price        REAL NOT NULL DEFAULT 0,
  output_price       REAL NOT NULL DEFAULT 0,
  cache_read_price   REAL NOT NULL DEFAULT 0,
  cache_write_price  REAL NOT NULL DEFAULT 0,
  enabled            INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_model_configs_active
  ON model_configs(channel) WHERE enabled = 1;

-- 全局编排流水线(teamai workflow 子集,见 docs/FORGE2.md §17.9)。
-- 与模型配置解耦:全平台一份,pipeline_json 为空 = 用 agent 内置默认编排。与 schema.migrate-pipeline.sql 同内容。
CREATE TABLE IF NOT EXISTS platform_pipeline (
  id            TEXT PRIMARY KEY,
  pipeline_json TEXT NOT NULL DEFAULT '',
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT OR IGNORE INTO platform_pipeline (id, pipeline_json) VALUES ('global', '');

-- 计费与用量(与 schema.migrate-billing.sql 同内容:新库跑本文件,已有库跑那个增量文件)。
-- job_usage:每个任务的真实 token 用量与成本(agent 上报;成功/失败/取消都要记,它们都烧钱);
-- credit_ledger:积分只追加账本,余额以 users.credits 为准;orders:充值订单(接 MoR 时启用)。
CREATE TABLE IF NOT EXISTS job_usage (
  job_id         TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  project_id     TEXT NOT NULL,
  model          TEXT NOT NULL DEFAULT '',
  model_config_id TEXT NOT NULL DEFAULT '',  -- 计价所用的后台配置快照(id 为空 = env 默认/旧数据)
  input_tokens   INTEGER NOT NULL DEFAULT 0,
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_read     INTEGER NOT NULL DEFAULT 0,
  cache_write    INTEGER NOT NULL DEFAULT 0,
  turns          INTEGER NOT NULL DEFAULT 0,
  run_ms         INTEGER NOT NULL DEFAULT 0,
  llm_cost_usd   REAL NOT NULL DEFAULT 0,
  gcp_cost_usd   REAL NOT NULL DEFAULT 0,
  cost_usd       REAL NOT NULL DEFAULT 0,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS credit_ledger (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  delta         INTEGER NOT NULL,
  reason        TEXT NOT NULL,                     -- signup | job_hold | job_release | purchase | refund | admin_grant | expire
  ref_type      TEXT NOT NULL DEFAULT '',
  ref_id        TEXT NOT NULL DEFAULT '',
  balance_after INTEGER NOT NULL,
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  provider      TEXT NOT NULL,
  provider_ref  TEXT NOT NULL,
  amount_minor  INTEGER NOT NULL,
  currency      TEXT NOT NULL DEFAULT 'USD',
  credits       INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | paid | failed | refunded
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at       TEXT
);

-- 订阅档位状态(阶段四接 MoR 时启用):只记录状态,**不发积分** ——
-- 积分只在 subscription.paid 时发(每次成功扣款一笔),这张表是给界面看「订阅还在不在」。
CREATE TABLE IF NOT EXISTS subscriptions (
  id                 TEXT PRIMARY KEY,              -- MoR 侧订阅 id(sub_...)
  user_id            TEXT NOT NULL REFERENCES users(id),
  provider           TEXT NOT NULL DEFAULT 'creem',
  product_id         TEXT NOT NULL DEFAULT '',      -- MoR 商品 id
  catalog_id         TEXT NOT NULL DEFAULT '',      -- 本地目录 id(plan_plus / plan_pro)
  status             TEXT NOT NULL DEFAULT '',      -- active | canceled | past_due | unpaid | expired | paused | ...
  current_period_end TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
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

-- 用户大盘埋点(与 schema.migrate-analytics.sql 同内容;已有库跑那个增量文件,新库跑本文件)。
--   user_daily_active:按天去重的活跃表,DAU/WAU/MAU 与留存从它算,避免扫全量 session;
--   user_events:关键行为流水(注册验证/建项目/建任务/发布/结账/支付/订阅),不是全量请求日志。
-- day 是 UTC+8 的 'YYYY-MM-DD',由 Worker 侧生成。
CREATE TABLE IF NOT EXISTS user_daily_active (
  user_id       TEXT NOT NULL,
  day           TEXT NOT NULL,
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, day)
);

CREATE TABLE IF NOT EXISTS user_events (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL,
  name       TEXT NOT NULL,
  props      TEXT NOT NULL DEFAULT '{}',    -- JSON,便于扩字段而不用改表
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
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

CREATE INDEX IF NOT EXISTS idx_job_usage_user ON job_usage(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_job_usage_created ON job_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_job_usage_config ON job_usage(model_config_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ledger_user    ON credit_ledger(user_id, created_at);
-- 同一任务最多各有一条冻结与一条退还(job_hold / job_release):重复回调不会重复记账
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_job_once
  ON credit_ledger(ref_id, reason) WHERE ref_type = 'job';
-- webhook 幂等的唯一依据:支付平台重放通知是常态
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_provider_ref ON orders(provider, provider_ref);
CREATE INDEX IF NOT EXISTS idx_orders_user    ON orders(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);

CREATE INDEX IF NOT EXISTS idx_user_daily_active_day ON user_daily_active(day);
CREATE INDEX IF NOT EXISTS idx_user_events_name ON user_events(name, created_at);
CREATE INDEX IF NOT EXISTS idx_user_events_user ON user_events(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_user_events_created ON user_events(created_at);