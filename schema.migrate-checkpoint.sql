-- 断点续跑(2026-10-25):失败 / 用户手动停止的任务保留最后一次源码树快照,供「从断点继续」
--
-- agent 每 60s(以及异常收尾时)把当前源码树整份上报,Worker 存进 R2 的 cp/<projectId>/<jobId>.json。
-- 这里只记录指针与元信息,源码本体不进 D1(避免又把日志/源码当消息总线写爆)。
-- 任务成功落定时删除;失败/停止保留 7 天,由 cron 巡检清理。
ALTER TABLE jobs ADD COLUMN checkpoint_key TEXT;
ALTER TABLE jobs ADD COLUMN checkpoint_files INTEGER;
ALTER TABLE jobs ADD COLUMN checkpoint_bytes INTEGER;
ALTER TABLE jobs ADD COLUMN checkpoint_at TEXT;

-- cron 按时间清理过期快照
CREATE INDEX IF NOT EXISTS idx_jobs_checkpoint_at ON jobs(checkpoint_at) WHERE checkpoint_key IS NOT NULL;
