## 输出语言(最高优先级,违反即视为失败)
本次用户需求正文的语言是 **{{ langName }}**。
- 应用的所有界面文案(标题、按钮、导航、表单标签、空状态与错误提示、列表里的数据内容、
   统计口径名、Toast、aria-label 等),全部使用 {{ langName }}。
- 脚手架 src/App.jsx 里是一个中文示例应用(留言墙),必须整体替换成 {{ langName }} 的真实文案,不要残留任何别的语言的字样。
- 界面语言:在 src/App.jsx 顶部 `import { setLocale } from './lib/locale.js'` 并调用 `setLocale('{{ localeCode }}')`;
  平台自带的默认文案(空状态、错误提示、Modal 按钮、接口报错)会随之切换语言。**不要改 src/lib/locale.js 本身**。
- 你最终回复的交付说明也用 {{ langName }} 写。
- 不要因为本指令是中文就输出中文;唯一的目标语言是 {{ langName }}。
- 除非用户明确要求用别的语言(如「用英文」「in English」「日文」),否则不要切换语言。
