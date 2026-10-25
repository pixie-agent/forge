-- 模型配置支持「按行选择凭证」(2026-10-25)
--
-- 背景:model_configs 只能切模型/网关/方言,切不了密钥;而密钥是执行体启动时绑定在 Cloud Run 上的。
-- 于是后台把 free 配置切到 GLM 时,请求仍带着 MiniMax 的 key 去请求 bigmodel,pi 把 401 降级成
-- 空轮次,任务仍标 succeeded 并交付脚手架(线上事故)。
--
-- 改法:表里只存**变量名** api_key_env,执行体同时绑定多把 Secret,pi 按变量名解析密钥。
-- 部署脚本见 package.json 的 agent:deploy:* 的 --set-secrets。
--   - LLM_API_KEY          执行体默认(向后兼容)
--   - LLM_API_KEY_MINIMAX  MiniMax key
--   - LLM_API_KEY_GLM      GLM(bigmodel)key
--   - LLM_API_KEY_DEEPSEEK DeepSeek key(VIP)
--
-- 回填规则按模型/网关推断;之后后台可以随时在「凭证」下拉里切换。

ALTER TABLE model_configs ADD COLUMN api_key_env TEXT NOT NULL DEFAULT 'LLM_API_KEY';

UPDATE model_configs
   SET api_key_env = 'LLM_API_KEY_MINIMAX'
 WHERE model_id LIKE 'MiniMax%' OR base_url LIKE '%minimaxi%';

UPDATE model_configs
   SET api_key_env = 'LLM_API_KEY_GLM'
 WHERE model_id LIKE 'glm-%' OR base_url LIKE '%bigmodel%';

-- 生产 free 的 GLM 行曾把 anthropic-messages 配到 OpenAI 端点(/api/paas/v4)。
-- bigmodel 的 Anthropic 兼容端点是 /api/anthropic(已实测 glm-5.3-flash + thinking 可用)。
UPDATE model_configs
   SET base_url = 'https://open.bigmodel.cn/api/anthropic',
       api_dialect = 'anthropic-messages',
       thinking_format = '',
       updated_at = datetime('now')
 WHERE id = 'cfg-free-glm-5-3-flash-low'
   AND base_url LIKE '%/api/paas/v4%';
