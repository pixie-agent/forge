{{ briefs }}

工作目录下已有一个现成的 React 应用源码(使用本模板的设计系统与组件库)。请只按下面的要求修改它,其余文案、结构、风格尽量保持原样。{{ history }}

修改要求:{{ requirement }}

注意:
- 改动写回对应源文件(入口仍是 src/App.jsx),不要改动 LICENSE / THIRD_PARTY_NOTICES.md / package.json / package-lock.json / vite.config.js / src/main.jsx 与平台文件(src/components/ui/**、src/lib/**、src/styles/ 除 tokens.css 的 --brand/--accent 外)。
- 新 UI **优先复用** './components/ui/index.js' 里的组件与现有语义类名;不要引入新的颜色体系、不要写 gray-*/写死 hex,保持全站视觉一致。
- 若应用使用了 src/lib/forge.js 或 src/lib/store.js 的数据接口,保持调用方式与集合名/键名原样,不要删除相关代码;改数据逻辑时优先用新能力:db.list 的 limit/offset/q 与 total、db.count、counter.incr、blob.url/blob.list、useCollection 的 query/setQuery/hasMore/loadMore。
- 本次**新增或修改**的文案用 {{ langName }} 写;已有文案保持原样(不要顺手把整站翻掉)。除非用户明确要求换语言。
- 改动涉及列表/统计时,保证新增、修改、删除后列表与所有计数依然联动一致。
- 改动完成后确认 loading / empty / error 三态仍然齐全,移动端布局没有被破坏。
- 修改后不要运行构建命令。

提醒:你的最终回复(交付说明)必须用 {{ langName }} 写。
