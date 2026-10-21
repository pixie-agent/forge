-- 通道分流(2026-10-21):把每个任务走的通道落到 jobs,便于巡检与后台归因
--
-- 通道取值:''(旧任务/未分流)| free(免费积分用户)| vip(已付费用户)
-- 派发时写入;只在 Worker 侧使用,不影响 agent 协议。
ALTER TABLE jobs ADD COLUMN channel TEXT NOT NULL DEFAULT '';

-- 巡检按通道区分超龄阈值,后台按通道看任务量
CREATE INDEX IF NOT EXISTS idx_jobs_channel ON jobs(channel, status, created_at);
