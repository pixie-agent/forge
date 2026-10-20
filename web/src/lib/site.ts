/**
 * 公开站点信息(页脚 / 法务页面共用)。
 *
 * ⚠️ `SUPPORT_EMAIL` 必须与 Creem 店铺 business details 里填写的支持邮箱**完全一致**,
 * 否则 Creem 账户复审会以「网站上展示的邮箱与店铺信息不一致」打回。改这里时同步改 Creem 后台。
 */
export const SITE_NAME = 'Forge'
export const SITE_URL = 'https://app.1forgen.site'
export const SUPPORT_EMAIL = 'ttswhh@gmail.com'

/**
 * 运营主体:必须与 Creem onboarding 的 Business Details 完全一致
 * (全名 `Yunus Su`、业务名称 `1forgen`、国家/地区 Hong Kong SAR)。
 * Creem 复审会因为「网站上的运营方与登记主体不一致」打回,改这里时同步核对后台。
 */
export const LEGAL_ENTITY = 'Yunus Su'
export const BUSINESS_NAME = '1forgen'
export const OPERATOR_COUNTRY = 'Hong Kong SAR'
