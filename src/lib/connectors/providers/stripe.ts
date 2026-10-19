/**
 * Stripe(第一个 auth:'apikey' provider —— 用户把自己的密钥贴进来,平台不去外部登记任何东西)。
 *
 * 为什么用它打头验证「自带密钥」这条路:
 *   - 它是用户最先想到的"接支付",而且**天生就是密钥制**:Stripe 控制台里就能自建
 *     sk_test_/sk_live_,不像 GA4 那样必须由平台先申请 OAuth 客户端并登记回调地址。
 *   - 密钥的用途天然分两半,正好演示平台的两条通道:
 *       · `publishableKey`(pk_,公开)→ 随页面下发(§6a),前端 Stripe.js 用;
 *       · `secretKey`(sk_,保密)→ 只在**生成期**交给 agent,用来建商品/价格/收款链接,
 *         再把 Stripe 返回的公开 URL 写进页面按钮。密钥不进产物、不进版本库。
 *   - **平台不代持资金密钥**:密钥是用户自己的、加密存在我们这,收款直接进用户自己的 Stripe 账号,
 *     平台既不碰钱也不做运行期代理(运行期只有 Stripe 自己托管的 Checkout 页面)。见 CONNECTORS.md §0/§9。
 *
 * 可写(writeScopes 非空):用 sk_ 建商品/收款链接是**真实外部副作用**,所以按 §7 的分档
 * 默认**不**在生成时带上 —— 用户要在能力条上本轮点亮它,agent 动手前还要先说明将要做什么。
 */

import type { ConnectorProvider } from '../registry'

export const stripe: ConnectorProvider = {
  id: 'stripe',
  name: 'Stripe',
  blurb: '用你自己的密钥生成收款入口;密钥只在生成期使用,不进产物',
  auth: 'apikey',
  // 密钥的读写范围由用户在 Stripe 控制台自己限定,这里只用于展示;真正的写能力见 writeScopes
  scopes: [],
  writeScopes: ['products.write', 'prices.write', 'payment_links.write'],
  configFields: [
    {
      key: 'publishableKey',
      label: 'Publishable key(可选)',
      placeholder: 'pk_test_… 或 pk_live_…',
      hint: '公开值,会随页面下发,给 Stripe.js 用;没有它页面也能靠收款链接跳转',
      public: true,
    },
  ],
  secretFields: ['secretKey'],
  secretInputs: [
    {
      key: 'secretKey',
      label: 'Secret key',
      placeholder: 'sk_test_… 或 sk_live_…',
      required: true,
      hint: 'Stripe 控制台 → 开发者 → API 密钥。建议先用 sk_test_(测试模式);key 会加密存储,只用于生成期,不会写进你的站点代码',
    },
  ],
  agentHint: [
    'Stripe(可写):本次已接入一个 Stripe 账号,密钥在 `.forge/connectors.json` 的 `stripe.credentials.secretKey`。',
    '- 只用 bash + curl 直连 Stripe API(不要自己新写后端),用 `-u "$SECRET_KEY:"` 鉴权:',
    '  1) 建商品:curl -s https://api.stripe.com/v1/products -u "$SECRET_KEY:" -d "name=..." -d "description=..."',
    '  2) 建价格:curl -s https://api.stripe.com/v1/prices  -u "$SECRET_KEY:" -d "currency=cny" -d "unit_amount=<分>" -d "product=<prod_…>"',
    '  3) 建收款链接:curl -s https://api.stripe.com/v1/payment_links -u "$SECRET_KEY:" \\',
    '       -d "line_items[0][price]=<price_…>" -d "line_items[0][quantity]=1"',
    '- 把返回的 `payment_links.url`(https://buy.stripe.com/…)写进页面的「立即购买」按钮,`target="_blank"` 打开,付款在 Stripe 自己的页面完成。',
    '- **绝不要把 secretKey 写进任何源文件、全局变量或交付说明**;页面里只允许出现 publishable key,且要通过 `src/lib/connectors.js` 的 `connector(\'stripe\')?.publishableKey` 读(平台已随页面下发)。',
    '- 先判断密钥是 `sk_test_` 还是 `sk_live_`:live 会**真的**在你的账号里创建商品与收款链接,动手前必须先向用户说明将创建什么。',
    '- 用户的站点是静态页,运行期不能携带密钥;运行期收款只靠上面的公开收款链接。',
  ].join('\n'),
}
