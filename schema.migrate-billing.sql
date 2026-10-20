-- 计费与用量:任务用量/成本、积分账本、充值订单。
-- 已存在的库跑本文件(增量);全新库跑 schema.sql(含同样的建表语句)。见 AGENTS.md §3。
--   staging: npm run db:migrate:billing:staging
--   生产:    npm run db:migrate:billing:remote

-- 每个任务一行的真实用量与成本:agent 上报 token 与耗时,Worker 按 src/lib/pricing.ts 换算成钱。
-- 刻意不做 status 守卫 —— 失败与用户停止同样烧 LLM 与实例时间,漏记就算不出真实毛利。
-- 幂等:agent 每次收尾都会上报,Worker 按 job_id upsert。
CREATE TABLE IF NOT EXISTS job_usage (
  job_id         TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL,
  project_id     TEXT NOT NULL,
  model          TEXT NOT NULL DEFAULT '',
  input_tokens   INTEGER NOT NULL DEFAULT 0,   -- 未命中缓存的输入 token
  output_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_read     INTEGER NOT NULL DEFAULT 0,
  cache_write    INTEGER NOT NULL DEFAULT 0,
  turns          INTEGER NOT NULL DEFAULT 0,   -- assistant 消息条数,≈ 轮次
  run_ms         INTEGER NOT NULL DEFAULT 0,   -- agent 侧整体耗时(算 Cloud Run 实例成本)
  llm_cost_usd   REAL NOT NULL DEFAULT 0,
  gcp_cost_usd   REAL NOT NULL DEFAULT 0,
  cost_usd       REAL NOT NULL DEFAULT 0,      -- 上面两项之和
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_job_usage_user ON job_usage(user_id, created_at);

-- 积分账本:只追加,不修改(退还、退款都是新的一行)。
-- 余额以 users.credits 为准(所有读写都在一条条件 UPDATE 上,并发安全);账本是审计与对账真相。
--   signup              注册 / Google 首次登录赠送
--   job_hold            发起任务时冻结(成功即等于收费)
--   job_release         任务失败 / 用户停止时退还
--   purchase            充值到账(阶段四接 MoR 时使用)
--   refund | admin_grant | expire
CREATE TABLE IF NOT EXISTS credit_ledger (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  delta         INTEGER NOT NULL,                  -- 正数入账、负数出账
  reason        TEXT NOT NULL,
  ref_type      TEXT NOT NULL DEFAULT '',          -- job | order | ''
  ref_id        TEXT NOT NULL DEFAULT '',
  balance_after INTEGER NOT NULL,                  -- 该笔之后的余额(对账用)
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON credit_ledger(user_id, created_at);
-- 同一任务最多各有一条冻结与一条退还:回调重放 / 重复落定都不会重复记账
CREATE UNIQUE INDEX IF NOT EXISTS idx_ledger_job_once
  ON credit_ledger(ref_id, reason) WHERE ref_type = 'job';

-- 充值订单(阶段四接 MoR 时启用)。
-- provider_ref 唯一索引是 webhook 幂等的唯一依据:支付平台重放通知是常态,靠数据库挡掉。
CREATE TABLE IF NOT EXISTS orders (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  provider      TEXT NOT NULL,                     -- creem | dodo | paddle | stripe
  provider_ref  TEXT NOT NULL,                     -- MoR 侧订单 / 结账会话 id
  amount_minor  INTEGER NOT NULL,                  -- 最小货币单位(美分)
  currency      TEXT NOT NULL DEFAULT 'USD',
  credits       INTEGER NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending',   -- pending | paid | failed | refunded
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at       TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_provider_ref ON orders(provider, provider_ref);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at);

-- 订阅档位状态(阶段四接 MoR 时用):只记录状态,**不发积分** ——
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
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
