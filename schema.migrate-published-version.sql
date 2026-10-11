-- 增量迁移:引入「线上版本」(published_version),把发布与生成解耦。
-- 非破坏性:不删表、不动既有版本与产物。
--   · 生成/对话修改只推进 current_version(预览与编辑基线),线上不动;
--   · 用户点「发布此版本」才把 published_version 指向被确认的版本;
--   · /s/:slug 服务 published_version 而非 current_version。
-- 迁移前已发布的项目:线上版本沿用其 current_version,保持公开页不变。

ALTER TABLE projects ADD COLUMN published_version INTEGER NOT NULL DEFAULT 0;

UPDATE projects SET published_version = current_version WHERE status = 'published' AND published_version = 0;