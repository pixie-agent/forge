/**
 * 后台「加积分到账」通知邮件。
 *
 * **为什么它不跟界面语言走**:这封邮件是运营在后台手动触发的,收件人没有对应的
 * 界面语言上下文,所以固定中英双语(与既有行为一致)。
 */
export const grant = {
  zh: {
    subject: '你的 Forge 积分已到账',
    text:
      '你的 Forge 账户已增加 {amount} 积分,当前余额 {balance} 积分。\n\n积分可用于生成与修改应用:{link}\n\n如有疑问,请联系我们的支持。',
    html:
      '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">' +
      '<h2 style="margin:0 0 12px">你的 Forge 积分已到账</h2>' +
      '<p style="margin:0 0 12px;line-height:1.6">已为你的账户增加 <strong>{amount}</strong> 积分,当前余额 <strong>{balance}</strong> 积分。</p>' +
      '<p style="margin:0 0 20px"><a href="{link}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">去使用积分</a></p>' +
      '<p style="margin:0;font-size:12px;color:#666;line-height:1.6">积分可用于生成与修改应用。如有疑问,请联系我们的支持。</p>' +
      '</div>',
  },
  en: {
    subject: 'Credits added to your Forge account',
    text:
      '{amount} credits have been added to your Forge account. Your balance is now {balance} credits.\n\nUse them to generate and update apps: {link}\n\nIf you have any questions, please contact our support.',
    html:
      '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">' +
      '<h2 style="margin:0 0 12px">Credits added to your Forge account</h2>' +
      '<p style="margin:0 0 12px;line-height:1.6"><strong>{amount}</strong> credits have been added to your account. Your balance is now <strong>{balance}</strong> credits.</p>' +
      '<p style="margin:0 0 20px"><a href="{link}" style="display:inline-block;background:#4f46e5;color:#fff;text-decoration:none;padding:10px 20px;border-radius:8px">Use credits</a></p>' +
      '<p style="margin:0;font-size:12px;color:#666;line-height:1.6">Use credits to generate and update apps. If you have any questions, please contact our support.</p>' +
      '</div>',
  },
}

export type GrantMsgKey = keyof (typeof grant)['zh']
