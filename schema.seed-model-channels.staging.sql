-- 通道默认配置(staging,2026-10-21)。
--
-- staging 只有一把 GLM key(llm-api-key-staging),没有 DeepSeek key,所以两个通道都用
-- GLM-5.3-Flash:验证的是「免费/VIP 分流 + 免费执行体排队」这条链路,而不是模型差异。
-- 生产用 schema.seed-model-channels.sql(VIP = DeepSeek)。
--
-- 幂等:固定 id + INSERT OR IGNORE;该通道已有 enabled = 1 时本次插入被忽略。

INSERT OR IGNORE INTO model_configs
  (id, name, channel, provider_id, base_url, api_dialect, model_id, thinking_level,
   thinking_format, max_tokens, reasoning, image_input, design_review,
   max_run_ms, polish_max_ms, queue_concurrency, input_price, output_price, cache_read_price, cache_write_price, enabled)
VALUES
  ('cfg-vip-glm-staging', 'VIP · GLM-5.3-Flash(staging)', 'vip', 'forge',
   'https://open.bigmodel.cn/api/paas/v4', 'openai-completions', 'glm-5.3-flash', 'medium',
   'zai', 16384, 1, 1, 'generate',
   1500000, 300000, 0, 0, 0, 0, 0, 1),
  ('cfg-free-glm-staging-low', '免费 · GLM-5.3-Flash(staging,排队, low)', 'free', 'forge',
   'https://open.bigmodel.cn/api/paas/v4', 'openai-completions', 'glm-5.3-flash', 'low',
   'zai', 16384, 1, 1, 'generate',
   1500000, 300000, 2, 0, 0, 0, 0, 1);
