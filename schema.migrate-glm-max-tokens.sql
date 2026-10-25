-- GLM(Anthropic 方言)单轮输出额度调大(2026-10-25)
--
-- 背景:bigmodel 的 Anthropic 兼容端点不按 pi 下发的 thinking.budget_tokens 收口,
-- glm-5.3-flash 在读完脚手架后会出现单轮思考 > 16k tokens 的情况。max_tokens = 16384 时
-- 整轮输出被截断(stop_reason = max_tokens),模型还没来得及调用 write,源码一个字节没变,
-- 任务被判失败(见 docs/FORGE2.md §21.1)。
--
-- 只改 Anthropic 方言的 GLM 行:OpenAI 兼容 + thinkingFormat=zai 的行由 reasoning_effort
-- 约束思考量,16384 足够,保持原值。pi 会把 Model.maxTokens 再按思考预算加总并封顶 32000:
-- 65536 → 实际请求 max_tokens = 32000 + 8192 = 40192(本地实测可完整跑完)。
UPDATE model_configs
   SET max_tokens = 65536,
       updated_at = datetime('now')
 WHERE (model_id LIKE 'glm-%' OR base_url LIKE '%bigmodel%')
   AND api_dialect = 'anthropic-messages'
   AND max_tokens < 65536;
