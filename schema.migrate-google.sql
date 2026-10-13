-- 增量迁移:引入 Google 登录(OIDC),与邮箱/密码登录共存、可合并同一邮箱。
-- 非破坏性:不删表、不动既有用户与密码摘要。
--   · 新增 users.google_sub:Google OIDC 的唯一账号标识(sub);
--   · 邮箱/密码注册的老用户为 NULL,首次用 Google 登录时按邮箱回填(账号合并);
--   · 同一 Google 账号只能绑定一个用户 → 唯一索引(SQLite 允许多个 NULL,故不影响老用户);
--   · 纯 Google 账号无密码,password_hash 存空串 ''(不用 NULL,兼容历史 NOT NULL 约束;
--     verifyPassword 对空串直接判否,密码登录对该类账号自然不可用)。

ALTER TABLE users ADD COLUMN google_sub TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub);