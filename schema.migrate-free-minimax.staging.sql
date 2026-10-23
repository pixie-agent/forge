-- 免费通道切到 MiniMax-M3.1-Flash(staging,2026-10-23)
--
-- 前提:staging 免费执行体已换成 MiniMax 网关 + Secret llm-api-key-minimax-staging:
--   npm run agent:deploy:free:staging
-- model_configs 里没有密钥,只改这张表不会换 key;两件事必须一起做,否则免费任务会 401。
-- staging 免费执行体保持 PI_MODEL_INPUT_IMAGE=true(已实测 MiniMax 端点接受 image 块),
-- 所以 image_input = 1;生产免费执行体不开图,保持 0。
--
-- 旧的 GLM free 行保留但置 enabled = 0(历史 job_usage.model_config_id 仍可追溯)。

UPDATE model_configs SET enabled = 0, updated_at = datetime('now') WHERE channel = 'free' AND enabled = 1;

INSERT OR REPLACE INTO model_configs
  (id, name, channel, provider_id, base_url, api_dialect, model_id, thinking_level,
   thinking_format, max_tokens, reasoning, image_input, design_review,
   max_run_ms, polish_max_ms, queue_concurrency, input_price, output_price, cache_read_price, cache_write_price, enabled)
VALUES
  ('cfg-free-minimax-m3-1-flash-low', '免费 · MiniMax-M3.1-Flash(staging,排队, low)', 'free', 'forge',
   'https://api.minimaxi.com/anthropic', 'anthropic-messages', 'MiniMax-M3.1-Flash', 'low',
   '', 16384, 1, 1, 'generate',
   1500000, 300000, 2, 0, 0, 0, 0, 1);
