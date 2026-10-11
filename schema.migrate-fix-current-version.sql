-- 一次性数据修复:纠正 projects.current_version 与「实际最大正式版本号」不一致的历史漂移。
-- 背景:早期某次部署的 /commit 未把 current_version 推进到新版本,导致下拉里「最新」标签标错
--       (例:项目存在 v4,但 current_version 仍是 3)。
-- 非破坏性:只把落后的 current_version 抬到该项目的最大正式版本号;没有正式版本的项目(current_version=0)不受影响。
-- 之后再生成版本时,后端 /commit 会用同样的口径写当前版本,漂移不会复发。

UPDATE projects
SET current_version = (
  SELECT COALESCE(MAX(version_no), 0)
  FROM versions
  WHERE project_id = projects.id AND version_no > 0
)
WHERE current_version < (
  SELECT COALESCE(MAX(version_no), 0)
  FROM versions
  WHERE project_id = projects.id AND version_no > 0
);