-- 人门(HITL)续跑后的总龄判死修正(2026-11-28)。
--
-- 巡检的「任务总龄上限」(VIP 3700s / free 3700s)原本按 jobs.created_at 计算。人门节点暂停后,
-- 同一 job 会在 /respond 时带着恢复上下文重新派发,created_at 不变:用户在门上停留超过约 1 小时,
-- 续跑后的任务总龄一上来就接近上限 —— 心跳一切正常,却会在几分钟内被判「超时」。
--
-- dispatched_at = 最近一次派发时间:建单时写 created_at,人门续跑时刷新为 now;总龄上限改按它算。
-- created_at 保持任务创建时间不动(看板统计、事件审计仍用它)。
-- 存量行回填为 created_at,行为与迁移前完全一致。
ALTER TABLE jobs ADD COLUMN dispatched_at TEXT;

UPDATE jobs SET dispatched_at = created_at WHERE dispatched_at IS NULL;
