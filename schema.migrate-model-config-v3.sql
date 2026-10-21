-- 任务并发(2026-10-21):每个通道同时执行的任务数上限,与 Cloud Run 资源并发解耦。
--
-- 两件事不要再混:
--   - 资源并发:Cloud Run --concurrency / --max-instances / CPU / 内存,决定「能同时接多少请求」,在资源侧扩缩容;
--   - 任务并发:本列,决定「真正同时跑几个任务」,由 Worker 随每次派发下发给执行体。
--
-- 0 = 不限制(VIP 行为);N > 0 = 同时跑 N 个,其余在免费执行体进程内 FIFO 等待。
-- 免费通道默认 2(原来固定 1,排队体验太差);后台可随时改,下一次任务生效,无需重新部署。
ALTER TABLE model_configs ADD COLUMN queue_concurrency INTEGER NOT NULL DEFAULT 0;

UPDATE model_configs SET queue_concurrency = 2 WHERE channel = 'free' AND enabled = 1;
