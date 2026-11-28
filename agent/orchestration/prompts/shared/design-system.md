模板已经内置一套「token-first」设计系统,你的任务不是从头设计视觉,而是**严格执行**它——这是本项目美观度的第一保障。

配色(唯一来源:src/styles/tokens.css)
  - 开工第一步:把 plan.json 的 palette 写进 src/styles/tokens.css 顶部的两行 `--brand`(主色)/ `--accent`(辅色)。
    其它派生色由平台算法生成,**不要手改**;这是你唯一允许修改的平台文件(只改这两行)。
  - 页面里一律使用下列语义类名,**禁止** gray-*/slate-*/zinc-*/neutral-*/blue-500 这类 Tailwind 固定色板,禁止写任意 hex、任意 rgb()、任意 px 阴影:
      底色  bg-canvas(页面) / bg-panel(卡片) / bg-panel-2(次级填充) / bg-brand-soft(品牌浅底)
      描边  border-line
      文字  text-ink(正文标题) / text-muted(次要) / text-brand / text-brand-600 / text-accent / text-success / text-warning / text-danger
      圆角  rounded-card(卡片/大容器) / rounded-field(按钮与输入框) / rounded-pill(胶囊/头像/开关)
      阴影  shadow-card(静止卡片) / shadow-lift(hover 抬升) / shadow-pop(弹层)
      缓动  ease-soft(大多数) / ease-spring(弹入)
      字体  font-sans(默认) / font-num(数字、代码、金额)
  - 品牌色只做重点:主 CTA、选中态、图标底、强调数字。大面积底色用 canvas/panel,不要让整页都是品牌色。

排版
  - 每页**只有一个 h1**(Hero 大标题);每个区段一个 h2 + 一句话副标题(p 用 text-muted)。
  - 正文 15–17px、行高 leading-relaxed;数字(统计、价格、计数)一律加 `tnum` 类,保证对齐不跳动。
  - 大标题用现成的 `.display-1`(Hero) / `.display-2`(区段),不要自己拼 font-size;行宽控制在 max-w-2xl/3xl 以内。

节奏与布局(参考苹果官网:大留白、强层级、克制的装饰)
  - 区段统一 <Section>;卡片 padding 用 Card 默认值或 padding="lg",不要逐处手写 p-*。
  - 栅格 gap-4 md:gap-6,明细列表 space-y-4;内容容器一律 <Container> 或 <Section>,不要自己算 max-width。
  - 响应式必须认真做:手机为单列、触控目标 ≥44px、正文不横向滚动;桌面(≥1280px)要有留白与多列,不能只是"放大的手机版"。
  - 视觉锚点用 CSS 渐变、`bg-brand-soft`、内联 SVG、emoji、大号数字构成;**禁止引用任何外部图片/字体/CDN**。

动效(克制:只做位移与淡入,时长 ≤500ms)
  - 区段/卡片组用 <Reveal>(或 <Stagger>+<StaggerItem>)做一次性进场;hover 用 `shadow-lift`/`-translate-y-0.5`;不要写超过 500ms 的动画,不要让动画成为传达信息的唯一手段(系统「减少动态效果」已有全局兜底)。

动效与视觉的"加分项"(有条件就用,不要硬凑):Hero 一层极淡的品牌色径向光晕(见模板 App.jsx 写法)、统计数字滚动(<Stat> 已内置)、吸顶毛玻璃导航(`.glass`)、选中态下划线滑动(<Tabs> 已内置)。
