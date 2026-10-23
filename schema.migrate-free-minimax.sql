-- 免费通道切到 MiniMax-M3.1-Flash(生产,2026-10-23)
--
-- 前提:免费执行体 forge-agent-free 已换成 MiniMax 网关 + Secret llm-api-key-minimax:
--   npm run agent:deploy:free:prod
-- model_configs 里没有密钥,只改这张表不会换 key;两件事必须一起做,否则免费任务会 401。
-- 旧的 GLM free 行保留但置 enabled = 0(历史 job_usage.model_config_id 仍可追溯)。
-- 回滚:执行体重新绑 llm-api-key-free 并部署,再把本行 disable、旧 GLM 行 enable。
--
-- 注意:MiniMax 只接受 Anthropic 方言(官方 coding plan 端点),
-- thinking_format 留空(Anthropic 方言不读 thinkingFormat),thinking 由 pi 发 budget_tokens。

UPDATE model_configs SET enabled = 0, updated_at = datetime('now') WHERE channel = 'free' AND enabled = 1;

INSERT OR REPLACE INTO model_configs
  (id, name, channel, provider_id, base_url, api_dialect, model_id, thinking_level,
   thinking_format, max_tokens, reasoning, image_input, design_review,
   max_run_ms, polish_max_ms, queue_concurrency, input_price, output_price, cache_read_price, cache_write_price, enabled)
VALUES
  ('cfg-free-minimax-m3-1-flash-low', '免费 · MiniMax-M3.1-Flash(排队, low)', 'free', 'forge',
   'https://api.minimaxi.com/anthropic', 'anthropic-messages', 'MiniMax-M3.1-Flash', 'low',
   '', 16384, 1, 0, 'generate',
   1500000, 300000, 2, 0, 0, 0, 0, 1);
