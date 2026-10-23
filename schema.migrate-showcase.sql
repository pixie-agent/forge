-- 首页精选案例 + 后台标签(2026-10-23)
-- 已存在的库跑本文件;全新库跑 schema.sql(含同样的列与索引)。见 AGENTS.md §3。
--   staging: npm run db:migrate:showcase:staging
--   生产:    npm run db:migrate:showcase:remote
--
-- 为什么需要这些列:
--   - featured:运营在后台决定哪些已发布产物上首页;只有 featured = 1 且已发布才对外展示;
--   - featured_tags:首页卡片上的分类标签(逗号分隔,最多 5 个),纯展示、不参与筛选逻辑;
--   - featured_at:上首页的时间,用于首页排序(最近精选的靠前)。
--
-- 约束不在数据库层做:是否已发布由接口校验(下线/删除后首页自动隐藏,克隆接口也会拒绝)。

ALTER TABLE projects ADD COLUMN featured INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN featured_tags TEXT NOT NULL DEFAULT '';
ALTER TABLE projects ADD COLUMN featured_at TEXT;

CREATE INDEX IF NOT EXISTS idx_projects_featured ON projects(featured, featured_at);
