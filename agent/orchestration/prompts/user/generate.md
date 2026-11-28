{{ briefs }}

请围绕以下想法从零构建一个**多文件 React 应用**,视觉与交互要对齐苹果官网的水准(大留白、强层级、克制精致),功能要完整可用并真实落库。

应用想法:{{ ideaWithNote }}

规划已经完成:工作目录里有 `spec.md`(需求说明书,含核心功能、明确不做什么、关键假设)和 `plan.json`(收敛方案:配色 palette 与数据能力 data)。**先读它们,严格按它们实现,不要另起炉灶。**

步骤:
1. 读脚手架与规划:src/App.jsx、src/components/ui/index.js、src/styles/tokens.css、src/lib/store.js、spec.md、plan.json —— 看清可用的组件、语义类名与已确定的方案。
2. 把 plan.json 的 palette[0] / palette[1] 写进 src/styles/tokens.css 的 --brand / --accent 两行(只改这两行)。
3. 实现应用:重写 src/App.jsx,按需在 src/components/ 下新增页面级组件文件(如 components/Hero.jsx、components/TaskList.jsx);按上面的「设计系统契约」「组件库目录」「页面结构」「交互与状态覆盖」「数据层」执行,结构必须与 plan.json 的 sections 一一对应,并保证状态联动正确。
4. 最后按「结束前必须自查」逐条走查一遍。

提醒:你的最终回复(交付说明)必须用 {{ langName }} 写。
