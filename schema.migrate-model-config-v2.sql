-- 模型配置 v2(2026-10-21):补齐 pi 自身的两个模型字段
--
-- 只加 pi 原生支持的字段,不额外发明抽象:
--   thinking_format = Model.compat.thinkingFormat(pi-ai types.d.ts:240-241)
--                    空串 = 交给 pi 按 baseUrl 自动推断
--   max_tokens      = Model.maxTokens(pi-ai types.d.ts:291)
--                    思考档位会从这部分预算里划 thinkingBudget,太小会把输出挤掉
ALTER TABLE model_configs ADD COLUMN thinking_format TEXT NOT NULL DEFAULT '';
ALTER TABLE model_configs ADD COLUMN max_tokens INTEGER NOT NULL DEFAULT 16384;
