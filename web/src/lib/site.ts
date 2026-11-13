/**
 * 公开站点信息(页脚 / 法务页面共用)。
 *
 * ⚠️ `SUPPORT_EMAIL` 必须与 Creem 店铺 business details 里填写的支持邮箱**完全一致**,
 * 否则 Creem 账户复审会以「网站上展示的邮箱与店铺信息不一致」打回。改这里时同步改 Creem 后台。
 */
export const SITE_NAME = 'Forge'
export const SITE_URL = 'https://app.1forgen.site'
export const SUPPORT_EMAIL = 'support@1forgen.site'
export const GITHUB_URL = 'https://github.com/pixie-agent/forge'

/**
 * 运营主体:必须与 Creem onboarding 的 Business Details 完全一致。
 * 2026-11-14 起切换为 Pixie Agent org(站点先行,Creem 后台随后经 CLI 同步);
 * Creem 复审会因为「网站上的运营方与登记主体不一致」打回,改这里时同步核对后台。
 */
export const LEGAL_ENTITY = 'Pixie Agent'
export const BUSINESS_NAME = 'Pixie Agent'
export const OPERATOR_COUNTRY = 'Hong Kong SAR'
