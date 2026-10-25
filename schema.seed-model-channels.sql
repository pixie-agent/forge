-- 通道默认配置(生产,2026-10-23):免费 = MiniMax-M3.1-Flash(排队执行体),VIP = DeepSeek V4.1-Flash。
--
-- 幂等:固定 id + INSERT OR IGNORE;若该通道已有 enabled = 1 的配置(部分唯一索引),
-- 这次插入会被忽略,不会出现两条生效配置。先执行 schema.migrate-model-config.sql / v2 / v3。
--
-- 注意:行里的 base_url / model_id 只是「下发给 agent 的覆盖」;密钥用 api_key_env 选择
-- 执行体上绑定的 Secret 变量名(表里不存密钥值):
--   - VIP 执行体 forge-agent        → LLM_API_KEY / LLM_API_KEY_DEEPSEEK(Secret llm-api-key)
--   - 免费执行体 forge-agent-free   → LLM_API_KEY_MINIMAX(Secret llm-api-key-minimax)、
--                                     LLM_API_KEY_GLM(Secret llm-api-key-free)
-- 所以换供应商只改后台这一行即可(执行体必须已绑定对应变量);从未绑定过的供应商仍需给
-- 执行体加一次 Secret 绑定(见 package.json 的 agent:deploy:*)。

INSERT OR IGNORE INTO model_configs
  (id, name, channel, provider_id, base_url, api_dialect, model_id, thinking_level,
   thinking_format, api_key_env, max_tokens, reasoning, image_input, design_review,
   max_run_ms, polish_max_ms, queue_concurrency, input_price, output_price, cache_read_price, cache_write_price, enabled)
VALUES
  ('cfg-vip-deepseek-flash', 'VIP · DeepSeek V4.1-Flash', 'vip', 'forge',
   'https://api.deepseek.com/anthropic', 'anthropic-messages', 'deepseek-flash', 'medium',
   '', 'LLM_API_KEY', 16384, 1, 0, 'generate',
   3000000, 300000, 0, 0.22, 0.66, 0.007, 0, 1),
  ('cfg-free-minimax-m3-1-flash-low', '免费 · MiniMax-M3.1-Flash(排队, low)', 'free', 'forge',
   'https://api.minimaxi.com/anthropic', 'anthropic-messages', 'MiniMax-M3.1-Flash', 'low',
   '', 'LLM_API_KEY_MINIMAX', 16384, 1, 0, 'generate',
   1500000, 300000, 2, 0, 0, 0, 0, 1);
