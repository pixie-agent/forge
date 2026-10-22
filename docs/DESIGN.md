# Forge 设计说明:实现思路 · 完成度 · 扩展路线

> 面向后续维护者。**部署与配置速查**见 README 与 [docs/FORGE2.md](FORGE2.md);本文记录「为什么这么做」「做到哪了」「接下来怎么走」。
> 更新于 2026-10-11,对应 **Forge 2.0** 架构(Cloudflare 编排 + Cloud Run 跑 pi coding agent),产物为**多文件 React 应用**。
> 迁移前的 v1(单 HTML + Workflows 分段生成)已被取代,仅作历史参考。

## 一、系统是什么

用户输入一句想法 → agent 规划(`plan.json`)→ 在隔离工作目录里写**多文件 React 应用** → 平台侧 `vite build` → 在线预览、对话迭代、发布到 `/s/:slug`;生成的应用可读写平台后端(数据库 / 键值 / 对象存储)。

技术底座:

| 层 | 组件 | 职责 |
| --- | --- | --- |
| 前端 | React + Vite + Tailwind(Workers Assets) | 落地页、工作台(预览/代码/数据)、项目页、管理后台 |
| 编排与持久化 | Cloudflare Worker `forge-v2`(Hono) | 鉴权、项目/版本/任务、SSE 进度、发布 `/s/:slug`、草稿预览 `/p/:token`、站点数据 API、任务派发(`waitUntil`)+ 内部回调 + cron 巡检。**不跑任何 LLM 调用。** |
| AI 执行体 | Google Cloud Run `forge-agent` | 唯一的 AI 交互执行体:pi coding agent 在隔离工作目录写代码,平台侧构建,回传源码树与产物 |
| 持久层 | D1 / R2 / KV / Durable Object(SQLite) | 平台元数据 / 构建产物与上传对象 / 键值 / 每项目×每环境独立 SQLite(文档集合 + owner SQL 控制台) |
| 模型网关 | OpenAI 兼容 或 Anthropic 兼容 | 当前 DeepSeek `deepseek-flash`(Anthropic 方言) |

**边界规则**:持久化与权限逻辑只留在 Cloudflare;Cloud Run 只回传原始产物(`src`/`dist`/`manifest`/`plan`)与进度。详见 FORGE2 §2。

## 二、实现思路与关键取舍

### 1. 为什么把 agent 放到 Cloud Run(而不是留在 Worker)
免费版 Worker 有三道硬墙:**10ms CPU**、`waitUntil` 约 2~4 分钟被回收、**没有文件系统/不能跑命令**。真正的 coding agent 循环(读写文件、跑 bash、多轮工具调用)在 Worker 里跑不动。Cloud Run 反过来:容器有文件系统、可跑任意命令、请求超时最高 60 分钟、缩容到 0——**一次请求 = 一个 job 的完整生命周期,执行完即销毁**。

### 2. 交付以回调为准,不依赖 HTTP 响应体
Cloudflare 对 Worker 的出站请求会超时掐断(524),但**掐断不影响 Cloud Run 继续跑**(handler 未返回就持续执行并保持 CPU)。于是:
- Worker 侧 `generate`/`chat` 在 `waitUntil` 里发起 `POST /run`,**不等待、不阻塞**对浏览器的响应。
- 任务**终态只由 `commit` / `fail` 回调落定**(幂等):成功才补 assistant 消息 + 扣积分;失败/判死不扣。
- 回调带守卫(`WHERE status IN ('pending','running')`):迟到回调不复活已判死任务,但「判死后又收到 commit」的迟到成功仍可**复活交付**。

### 3. 多文件产物(取代单 HTML)
版本从「一段 HTML」升级为 **源码树 + 构建产物**:`src_json`(路径→内容,作为续聊基线)+ 构建产物存 R2 + `manifest`。前端 `预览` 用 `/p/:token/` iframe(不再是 srcDoc 单 HTML),`代码` 在生成中展示 agent 实时写入的文件、完成后展示产物清单。

**为什么选 SPA + 平台通用 API,而不是 SSR**:SSR 让产物应用更简单,但让平台侧更重(绑死框架 runtime、丢掉「边写边看」的即时静态预览、agent 生成成功率下降)。SPA 产物即静态文件,发布零子域名、预览是发文件,是最薄的承载模型。完整对照见 FORGE2 §13。

### 4. 平台提供通用数据 API,而不是每项目手写后端
后端是**平台能力**(按项目 × 环境命名空间化的 D1/KV/R2),不是每个项目各写一套接口。agent 只调固定端点:
- `/db/:collection` 文档集合(增删改查)
- `/kv/:key` 键值
- `/blob/:key` 对象存储

所以不存在「每项目都要设计前后端契约」的负担——这正是规避 SSR 复杂度的关键点。生成应用用 `src/lib/store.js` 的 `useCollection` 统一管理列表状态。详见 FORGE2 §13.7、§14.1。

### 5. 每项目 × 每环境一个独立 SQLite(Durable Object)
生成应用的数据(文档集合)从共享 D1 表迁到**每项目 × 每环境一个独立 SQLite 库**,由 DO `ProjectDb` 承载,实例名 `${projectId}:${env}`。项目之间、测试(draft)/线上(live)之间是**物理隔离**,不靠 `WHERE` 过滤。owner 另有 **DBeaver 风格 SQL 控制台**,可建表/建索引/执行任意 SQL。详见 FORGE2 §15。

### 6. 恢复与判死
- **实例内**:交给 coding agent 自身在单次执行内重试/续写(v1 的 `sections_json` 断点复用机制在 v2 废弃)。
- **跨任务**:`jobs` 表心跳 + cron 每分钟巡检,实例异常/丢失但行仍活动的任务**判死解锁**。
- **迟到成功可复活**:见 §二.2。

### 7. 三个执行阶段(planning → coding → building)
对齐状态显示与真实进度,前端据此渲染阶段指示:

| 阶段 | 触发 | 前端显示 |
| --- | --- | --- |
| `planning` | `agent_start` / 首次写 `plan.json` | 规划卡片(计划项实时勾选) |
| `coding` | 写/改源文件 | 「正在编写 {path}」+ 代码页随写随看 |
| `building` | 结束前平台侧 `vite build` | 「正在构建应用产物」 |

`chat`(对话修改)是单阶段,直接进入 `coding`(不重新规划)。三个阶段的切换与进度文案都由 agent 在 `agent/src/runner.ts` 里主动上报,前端只是如实渲染,不存在「显示还在 plan、实际已经编码」的状态错位。

### 8. 安全模型
- 发布页 `/s/:slug` 走 `CSP: sandbox`(opaque origin),生成的 JS 读不到主站凭证。
- Worker ↔ Cloud Run:共享密钥 `X-Agent-Secret` 双向校验;`/internal/*` 不挂用户鉴权、不读 cookie。
- 管理后台与用户体系**完全隔离**:口令来自 `ADMIN_PASSWORD` secret,校验后下发由口令派生的 HttpOnly cookie(改口令即全体失效,无需会话表)。
- 生成的代码被提示词禁止收集密码/支付等敏感数据。

## 三、当前完成程度

### 已完成(生产可用)
- 注册/登录/积分(成功扣 1 分)、项目与版本、发布、草稿预览、站点数据双环境
- **多文件生成全链路**:agent 写多文件 React → 平台 `vite build` → commit 回调落版本(源码进 D1、产物进 R2、生成 manifest)
- **规划卡片**(计划项实时勾选)、**代码页**随写随看(agent 最近写入文件)、**三阶段进度**
- **前端过程展示**(类 Coze):思考折叠、工具调用(编写/查看/运行…)、工具结果、已改动文件列表(由 `agent_log` 解析为结构化事件,见 §四.1)
- **对话式迭代** + **版本历史**(编号 `MAX(version_no)+1`、以当前生效版本为基线、查看/恢复、导出 zip)
- **平台后端能力**:生成应用可用 `/db` `/kv` `/blob`;每项目×每环境独立 SQLite + owner DBeaver 风格 SQL 控制台
- **管理后台(只读)**:产物列表/详情、全部版本源码 + iframe 预览、对话记录、任务、agent 流式日志尾部、站点数据
- **亮/暗主题**(默认暗色,切换持久化)
- 可观测性:agent 流式日志(`agent_log`,尾部 20000 字符原子追加)、`wrangler tail` 日志、错误透传

### 未做 / 受约束
| 项 | 原因 |
| --- | --- |
| 逐 token 流式上屏 | 现有为「阶段 + 日志增量」,非 token 级渲染;真流式需付费版 Worker(30s+ CPU)转发 |
| 每个产物一个独立用户 Worker | 阶段二,需 Workers for Platforms;当前是平台单 Worker 按命名空间隔离 |
| 图片素材 | 提示词禁外部图片(渐变/SVG/emoji);未接图片生成或图库 |
| 版本回滚 UI | versions 数据已存,工作台已支持「恢复为当前版本」,缺时间线式回滚界面 |
| OIDC 双向鉴权 / VPC egress | 路线图;当前用共享密钥 + 允许未认证访问 |

## 四、扩展路线与优先级

判断标准:用户痛点 × 实现成本 × 平台约束。

### P0 — 直接解决已知痛点
1. **多模型路由 / 稳定性**:规划和正文用不同模型(强模型规划、快模型写码);对不认 `developer` 角色或 `reasoning_effort` 的网关用 `compat` 开关。切换模型 = 改 Cloud Run 环境变量(`LLM_BASE_URL` / `LLM_MODEL` / `PI_LLM_API`),无需改代码。
2. **按文件/板块的局部修改**:把「整包重写」收敛为「对话指定改哪个文件/组件」,只重写被点名部分回传,修改从分钟级变为秒级。
3. **版本时间线 + 一键回滚**:数据层已就绪,补 UI。

### P1 — 产品完整性
4. **真流式输出**:升级 Workers 付费(CPU 30s+),消费 pi 的 token 增量并节流转发,逐字上屏。
5. **规划可编辑**:生成前允许用户增删/改写计划项再继续,人对齐质量的把控点。
6. **图片能力**:接图片生成 API 或免费图库,资源进 R2,解除「无图网站」的最大观感限制。

### P2 — 规模化与演化
7. **阶段二:Workers for Platforms**:把每个产物的后端打包成独立用户 Worker,绑共享资源,挂 `{slug}.域名`。
8. **配额与治理**:并发限制、注册审核、积分付费、滥用防护。
9. **可观测性深化**:agent 执行轨迹可视化(耗时、工具调用分布)、失败归因统计。

## 五、前端展示:把「生成过程」讲清楚

类比 Coze 等主流平台,聊天区不再只回一句结果,而是就地展示过程:

- **阶段条**:planning → coding → building,当前阶段高亮,配合耗时。
- **思考**:`💭` 起头的思维链折叠显示(默认收起,点开看)。
- **工具调用**:`🔧 write src/App.jsx` 渲染为「正在编写 src/App.jsx」,结果回填 `✓/✗`。
- **已改动文件**:从工具事件里提取写/改过的文件去重列出。

数据源是 agent 写进 `jobs.agent_log` 的流式日志,前端 `web/src/lib/agentLog.ts` 解析成结构化事件(`thinking` / `say` / `tool`);**解析失败即退化为原文,纯展示,绝不影响生成功能**。日志格式约定见 FORGE2 §4。展示层改动不触碰核心生成链路。

## 附:运维速查

```bash
# ── Cloudflare ──────────────────────────────────────────────
npm run deploy                       # 构建前端 + 部署 Worker(forge-v2)
npx wrangler tail                    # 实时日志
npx wrangler d1 execute DB --remote --command "…"   # 查平台元数据(users/projects/versions/jobs/messages)

# 数据库迁移(一次性、幂等;全新安装直接 schema.sql)
npm run db:migrate:remote                                   # schema.migrate-multifile.sql(重建 versions/jobs)
npx wrangler d1 execute DB --remote --file=schema.migrate-published-version.sql
npx wrangler d1 execute DB --remote --file=schema.migrate-fix-current-version.sql

# secrets(明文地址变量写在 wrangler.jsonc vars 里)
npx wrangler secret put AGENT_SECRET         # 与 Cloud Run 侧同名同值
npx wrangler secret put ADMIN_PASSWORD       # 未设置则管理后台整体不可用

# ── Google Cloud Run(agent)───────────────────────────────
gcloud run deploy forge-agent --source agent --region us-central1 \
  --timeout 3600 --concurrency 1 --min-instances 0 --max-instances 5 \
  --cpu 1 --memory 1Gi \
  --set-env-vars LLM_BASE_URL=https://api.deepseek.com/anthropic,LLM_MODEL=deepseek-flash,PI_LLM_API=anthropic-messages,PI_PROVIDER_ID=forge,PI_MODEL_REASONING=true,AGENT_MAX_RUN_MS=1500000,WORKSPACE_ROOT=/tmp/forge-agent \
  --set-secrets LLM_API_KEY=llm-api-key:latest,AGENT_SECRET=agent-secret:latest

# 换模型/密钥(不必重建镜像)
printf '%s' "$LLM_API_KEY" | gcloud secrets versions add llm-api-key --data-file=-
gcloud run services update forge-agent --region us-central1 --update-env-vars LLM_MODEL=…
```

Agent 侧超时/思考级别等参数集中在 `agent/src/config.ts`(环境变量);提示词在 `agent/src/prompt.ts`。Worker 侧回调与状态机在 `src/lib/commit.ts` / `src/lib/jobs.ts` / `src/routes/internal.ts`。改完各自重新部署即生效。

> 部署细节(全新环境搭建、GCP 权限、成本、回滚)全部见 [docs/FORGE2.md](FORGE2.md) §7–§9。