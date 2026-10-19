-- 增量迁移:连接器(见 docs/CONNECTORS.md §4)
-- 已存在的库执行本文件;全新库直接跑 schema.sql 即可(两处定义保持一致)。
--   npm run db:migrate:connectors:staging
--   npm run db:migrate:connectors:remote
--
-- 幂等:重复执行不会报错。

-- 账号级:一个 Google/Stripe 账号可被多个项目复用;换账号只在这改一次
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

-- 项目级:决定「这个项目的这一轮生成自动带上什么」;env 与数据层同口径(草稿用测试凭证)
CREATE TABLE IF NOT EXISTS project_connectors (
  project_id  TEXT NOT NULL REFERENCES projects(id),
  provider    TEXT NOT NULL,
  env         TEXT NOT NULL DEFAULT 'live',       -- draft | live
  config_json TEXT NOT NULL DEFAULT '{}',         -- 非密配置:measurementId / paymentLink / connectionId
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, provider, env)
);

CREATE INDEX IF NOT EXISTS idx_connections_user  ON connections(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_project_connectors_project ON project_connectors(project_id, env);
