-- 通道默认配置(staging,2026-10-23)。
--
-- staging 的 VIP 通道仍用 GLM-5.3-Flash(staging 没有 DeepSeek key);免费通道已切到
-- MiniMax-M3.1-Flash(Anthropic 方言,独立 Secret llm-api-key-minimax-staging),
-- 与生产免费通道保持一致,验证的是「免费/VIP 分流 + 免费执行体排队」这条链路。
-- 密钥按 api_key_env 选择执行体上的 Secret 变量名(表里不存密钥值):
--   - VIP 执行体 forge-agent-staging     → LLM_API_KEY_GLM(Secret llm-api-key-staging)
--   - 免费执行体 forge-agent-free-staging → LLM_API_KEY_MINIMAX / LLM_API_KEY_GLM
-- 生产用 schema.seed-model-channels.sql(VIP = DeepSeek)。
--
-- 幂等:固定 id + INSERT OR IGNORE;该通道已有 enabled = 1 时本次插入被忽略。

INSERT OR IGNORE INTO model_configs
  (id, name, channel, provider_id, base_url, api_dialect, model_id, thinking_level,
   thinking_format, api_key_env, max_tokens, reasoning, image_input, design_review,
   max_run_ms, polish_max_ms, queue_concurrency, input_price, output_price, cache_read_price, cache_write_price, enabled)
VALUES
  ('cfg-vip-glm-staging', 'VIP · GLM-5.3-Flash(staging)', 'vip', 'forge',
   'https://open.bigmodel.cn/api/paas/v4', 'openai-completions', 'glm-5.3-flash', 'medium',
   'zai', 'LLM_API_KEY_GLM', 16384, 1, 1, 'generate',
   3000000, 300000, 0, 0, 0, 0, 0, 1),
  ('cfg-free-minimax-m3-1-flash-low', '免费 · MiniMax-M3.1-Flash(staging,排队, low)', 'free', 'forge',
   'https://api.minimaxi.com/anthropic', 'anthropic-messages', 'MiniMax-M3.1-Flash', 'low',
   '', 'LLM_API_KEY_MINIMAX', 16384, 1, 1, 'generate',
   1500000, 300000, 2, 0, 0, 0, 0, 1);
