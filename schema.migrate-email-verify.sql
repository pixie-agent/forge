-- 邮箱验证(2026-10-21)
--
-- 1) users.email_verified 默认 1:迁移窗口内旧代码(还没部署新版本)注册的账号会被当作已验证,
--    不会一上线就把新用户锁在门外;新代码注册时会**显式写入 0**,验证成功后再置 1。
--    (与 credits 同理:不要依赖列默认值表达业务规则。)
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1;

-- 2) 一次性验证 token。只存 SHA-256,库泄露也拿不到可用链接;used_at 非空 = 已消费。
--    idea 用来在验证完成后继续「登录后继续生成」的流程(可为空)。
CREATE TABLE IF NOT EXISTS email_verifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  ip         TEXT NOT NULL DEFAULT '',
  idea       TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  used_at    TEXT,
  -- 1 = 邮件已成功交给 Resend;0 = 投递失败(仍保留 token,重发可立即进行)
  sent       INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_email_verifications_user ON email_verifications(user_id, created_at);
-- 重发限流按 IP 统计最近一小时
CREATE INDEX IF NOT EXISTS idx_email_verifications_ip   ON email_verifications(ip, created_at);
