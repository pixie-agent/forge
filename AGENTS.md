# AGENTS.md — Forge 2.0 开发约束

本项目是 **Forge 2.0**:Cloudflare Worker(`forge-v2`,Hono + D1 + R2 + KV + 每项目 × 每环境 Durable Object SQLite)负责编排,Google Cloud Run 上的 `pi` coding agent(`forge-agent`)负责执行。

架构与设计细节全在 `docs/FORGE2.md`(改动平台行为时**必须**同步更新它)。本文件只放**必须遵守的约束**。

---

## 1. 环境与分支(最重要的约束)

两套**完全隔离**的环境,同一仓库、同一份 `web/dist`、同一份 `agent/` 源码:

| | 生产 | staging |
| --- | --- | --- |
| 分支 | `main` | `staging` |
| Worker | `forge-v2` | `forge-v2-staging` |
| 对外域名 | `app.1forgen.site`(Custom Domain,根域名留空) | `app-staging.1forgen.site`(同上) |
| workers.dev | `forge-v2.needle.workers.dev`(保留,旧链接依赖它) | `forge-v2-staging.needle.workers.dev`(同上) |
| wrangler 环境 | 顶层(不带 `--env`) | `env.staging` |
| Cloud Run(VIP 通道) | `forge-agent` | `forge-agent-staging`(`--max-instances 1`) |
| Cloud Run(免费通道) | `forge-agent-free`(GLM,`--timeout 3600 --concurrency 8 --no-cpu-throttling --max-instances 1`;任务并发由后台 free 配置的 `queue_concurrency` 下发,env `AGENT_QUEUE_CONCURRENCY` 只是回落值) | `forge-agent-free-staging`(同左) |
| D1 | `forge-v2`(`6fd724ad-…`) | `forge-v2-staging`(`da94e0ba-…`) |
| R2 | `forge-v2-artifacts` | `forge-v2-artifacts-staging` |
| KV | `f6b66c90…` | `67e46b44…` |
| 内部密钥 | Secret `agent-secret` | Secret `agent-secret-staging` |
| LLM 密钥 | Secret `llm-api-key`(DeepSeek,VIP 执行体);免费执行体另需 Secret `llm-api-key-free`(GLM) | Secret `llm-api-key-staging`(GLM,两个执行体共用) |
| LLM 模型 | VIP `deepseek-flash`(Anthropic 方言);免费 `glm-5.3-flash`(OpenAI 兼容 + `zai`) | 两个通道暂都用 `glm-5.3-flash`(staging 没有 DeepSeek key) |
| 用户上传图片给模型看 | **关闭**(`PI_MODEL_INPUT_IMAGE` 未设) | 开启(`PI_MODEL_INPUT_IMAGE=true`) |
| 计费收款(MoR) | Creem **live 门店**:Secret `CREEM_API_KEY` / `CREEM_WEBHOOK_SECRET`;`vars.CREEM_API_BASE=https://api.creem.io`;`vars.CREEM_PRODUCTS` 填 live 商品 id | Creem **测试门店**:两个 secret 加 `--env staging` 单独写,值用 test 模式;`CREEM_API_BASE=https://test-api.creem.io`;`CREEM_PRODUCTS` 填 test 商品 id |
| 注册验证邮件 | Resend Secret `RESEND_API_KEY` + `vars.EMAIL_FROM=noreply@1forgen.site`(域名需在 Resend 后台验证) | 同左(secret 不可继承,`--env staging` 单独写) |
| 环境标识 | 不设 `ENVIRONMENT` | `ENVIRONMENT=staging` |

### 分支模型

**`staging` 分支开发测试 → 验证通过合并到 `main` → 从 `main` 上线。**

- `main` 是「可上线」基线:每个提交都应已验收、可随时部署。不要在 `main` 上攒未验证的改动。
- **「分支」管哪份代码,「wrangler 环境」管哪套资源,两者是独立的轴。** `staging` 分支不会自动发到 staging 环境——发到哪里由敲哪条命令决定;反之,在 `staging` 分支上敲 `npm run deploy` 会被守卫拦下。

### 上线流程

```bash
git switch staging                                              # 1) 开发
npm run typecheck && npm run build
npm run deploy:staging                                          # 2) 发测试环境验证
npm run agent:deploy:staging                                    #    只在改了 agent/ 时需要
git switch main && git merge staging && git push origin main    # 3) 验证通过才合并
npm run deploy                                                  # 4) 从 main 上线
npm run agent:deploy:prod                                       #    只在改了 agent/ 时需要
```

### 部署生产的硬门槛(脚本强制,不要绕)

`npm run deploy` 的 `predeploy` 钩子 `scripts/guard-prod-deploy.mjs` 强制两条,任一不满足即中止:

1. 当前分支必须是 `main`
2. 工作区必须干净(无未提交改动)

**不要为了部署去改守卫、`git stash` 或部分提交。** 唯一正确的路径是把改动合并到 `main`。`npm run deploy:staging` / `npm run agent:deploy:staging` 故意**不挂**守卫——未合并、未提交的改动正是要靠它验证。

### 禁止自动部署生产

**不要主动执行 `npm run deploy` / `npm run agent:deploy:prod`。** 先说明要发什么、影响范围,等用户明确放行(例如「发布吧」)后再执行。staging 部署不需要这道放行。

---

## 2. 隔离纪律

- **环境差异只能来自运行时配置**(wrangler 绑定 / `vars` / Cloud Run 的 env 与规格)。两套环境共用同一份 `web/dist` 与 `agent/` 源码,所以**禁止**用构建期变量(如 Vite `import.meta.env`)表达环境差异——那会把 staging 的东西打进生产包。
- **wrangler 的绑定类配置不可继承**:`vars` / `d1_databases` / `kv_namespaces` / `r2_buckets` / `durable_objects` / secrets 必须在顶层与 `env.staging` 里**各写一遍**。漏写不会在部署时报错,而是运行时 `c.env.XXX === undefined`(例如漏 `PROJECT_DB` 会让生成应用的数据面板直接 500)。**新增任何绑定必须两边同时加。**
- **`routes` 反过来是「可继承」的**:顶层写了 `routes`,`env.staging` 不显式覆盖就会继承 → 发 staging 会去抢生产的域名;而且 `publishCustomDomains` 是 `replace_state` 语义,会把该 Worker 上**没写进配置**的 Custom Domain 删掉。所以两套环境各写各的 `routes`。
- **配了 `routes` 就必须显式 `workers_dev: true`**:wrangler 的规则是「配置里有 routes 时 workers.dev 默认关闭」,不写会把 `*.needle.workers.dev` 关掉,已发布链接与还没切过去的回调地址一起断。
- **前端环境角标**走运行时下发:staging 的 `vars.ENVIRONMENT=staging` → `GET /api/auth/config` 返回 `environment` → `<EnvBadge>` 渲染琥珀色角标。生产不设该变量,回落 `production`、不渲染。
- **Worker secret 只写不可读**:没有任何 API 或命令能把已写入的 secret 读回来(`secrets` 接口只返回名字)。换环境只能由持有原始值的人重新输入,不要承诺「把生产的复制过去」。
- **模型的多模态能力也是环境差异**:`PI_MODEL_INPUT_IMAGE=true` 才会在 `models.json` 里声明 `input: ['text','image']`。上游网关方言不一定认 image 块,声明了却发不出去会直接 400,所以**不要为了「保持一致」把生产的这个开关打开**——先实测生产端点。

---

## 3. 数据层 / schema

- 已存在的库改 schema 用**增量迁移** `schema.migrate-*.sql`;直接跑 `schema.sql` 会在已有库上报 `no such column`。全新库才用 `schema.sql`。staging 对应 `db:init:staging` / `db:migrate:google:staging`。
- `wrangler d1 execute --remote --file=…` 前面加 `yes |`,否则会卡在交互确认。
- **已部署的 Durable Object 类名与 migration tag 一经部署即固化**,不可改名或改 tag(会要求删库重来)。DO 数据在 Cloudflare 面板不可见,平台自己的 SQL 控制台是唯一入口。

---

## 4. 改完必做

- `npm run typecheck && npm run build` 必须通过再部署。
- 多文件改动后重新 `grep` / `read` 确认真的落盘(发生过编辑静默失败)。
- 平台行为、部署方式、资源拓扑有变 → 同步 `docs/FORGE2.md`;本文件里的行事规则有变 → 同步本文件。

---

## 5. 常用命令

```bash
npm run typecheck               # 前后端类型检查
npm run build                   # 构建 web/dist(生产与 staging 共用同一份产物)
npm run deploy                  # 生产 Worker(守卫:必须 main 且工作区干净)
npm run deploy:staging          # staging Worker(无守卫)
npm run agent:deploy:prod       # 生产 Cloud Run agent(VIP 通道)
npm run agent:deploy:staging    # staging Cloud Run agent(VIP 通道)
npm run agent:deploy:free:prod     # 生产免费通道执行体(GLM + 进程内排队)
npm run agent:deploy:free:staging  # staging 免费通道执行体
npm run db:init:staging         # staging 库初始化(幂等)
npm run db:migrate:google:staging
```

---

## 6. 多语言(中 / 英)

- **用户可见文案一律走词典**,不许在组件里写死中文。词典在 `web/src/lib/i18n/`(`dict.zh.ts` 是基准,`dict.en.ts` 用 `Record<DictKey, string>` 约束,**漏译即编译错误**)。新增词条只改这两份文件 + 在组件里 `useT()`,加语言不必动组件。
- **`/admin` 六个管理页面刻意保持中文**(面向中文运营),不要给它们接 i18n。
- 带行内格式的词条用 `web/src/components/RichText.tsx`(`**加粗**` / `` `代码` ``);**不要**往 DOM 里注入 HTML 字符串。列表连接符走词条 `chat.listSep`,不要写死 `、`。
- 非组件代码(如 `lib/api.ts`)取词条用 `tStatic()`,写库前要定语言的文案见 `src/lib/i18n.ts`(Worker 侧那份独立于前端,两者不共享模块)。

---

## 7. 不要做

- **不要自动部署生产**(见 §1)。
- 不要复用线上旧服务 `forge` 的任何 Worker / D1 / secrets / Cloud Run 服务;本项目资源全部自建。
- **不要把 staging 的 `AGENT_MAX_RUN_MS` 调得比生产小**:真实的多文件生成需要 6 分钟以上,切短会被自身超时掐死(踩过:设 300s 时正常任务失败),失去验证价值。滥用闸门是 `--max-instances 1`,不是把超时切短。
- 不要为了让部署通过而修改 `scripts/guard-prod-deploy.mjs`,或带着未完成的工作区部署。
