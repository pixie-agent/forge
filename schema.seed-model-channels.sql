-- 通道默认配置(生产,2026-10-21):免费 = GLM-5.3-Flash(排队执行体),VIP = DeepSeek V4.1-Flash。
--
-- 幂等:固定 id + INSERT OR IGNORE;若该通道已有 enabled = 1 的配置(部分唯一索引),
-- 这次插入会被忽略,不会出现两条生效配置。先执行 schema.migrate-model-config.sql / v2。
--
-- 注意:行里的 base_url / model_id 只是「下发给 agent 的覆盖」,密钥仍来自执行体的 LLM_API_KEY:
--   - VIP 执行体 forge-agent        → DeepSeek key
--   - 免费执行体 forge-agent-free   → GLM key(Secret llm-api-key-free)
-- 所以免费通道必须部署独立执行体,不能只改这张表。

INSERT OR IGNORE INTO model_configs
  (id, name, channel, provider_id, base_url, api_dialect, model_id, thinking_level,
   thinking_format, max_tokens, reasoning, image_input, design_review,
   max_run_ms, polish_max_ms, queue_concurrency, input_price, output_price, cache_read_price, cache_write_price, enabled)
VALUES
  ('cfg-vip-deepseek-flash', 'VIP · DeepSeek V4.1-Flash', 'vip', 'forge',
   'https://api.deepseek.com/anthropic', 'anthropic-messages', 'deepseek-flash', 'medium',
   '', 16384, 1, 0, 'generate',
   1500000, 300000, 0, 0.22, 0.66, 0.007, 0, 1),
  ('cfg-free-glm-5-3-flash-low', '免费 · GLM-5.3-Flash(排队, low)', 'free', 'forge',
   'https://open.bigmodel.cn/api/paas/v4', 'openai-completions', 'glm-5.3-flash', 'low',
   'zai', 16384, 1, 0, 'generate',
   1500000, 300000, 2, 0, 0, 0, 0, 1);
