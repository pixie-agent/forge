# Forge 连接器设计

> 状态:**v0(框架 + GA4)与 v0.1(`apikey` 形态 + Stripe 自带密钥)已实现并部署到 staging**(2026-10-19)。平台侧实现与运行约束见 `docs/FORGE2.md` §19。
> 本文回答四件事:连接器是什么、Forge 这版怎么做、交互为什么这样设计、**哪些明确不做**。
> 背景与取舍见 `docs/DESIGN.md`(薄承载模型)、`docs/FORGE2.md`(生成链路与数据层)。

---

## 0. 结论速览

| 问题 | 结论 |
| --- | --- |
| 是 MCP 吗? | **不是。** MCP 是给 LLM 客户端用的工具协议,浏览器里的静态页面不是 MCP client;而 agent 侧的 pi 明确「No MCP」(`pi-coding-agent/README.md:446`)。连接器 = 平台手写的 provider 适配器。 |
| 第三方系统一般会提供 MCP 吗? | 一线 SaaS(Stripe/Linear/Notion/GitHub/Cloudflare/Sentry)大多有,**长尾系统基本没有**;而且就算有,那也是「让 agent 操作你自己账号」的通道,**不是访客付款通道**。所以「等对方提供 MCP」不是一条可依赖的扩展路径。 |
| 每个连接器都要平台后台适配吗? | **不用。** 分两类:`oauth` 形态需平台为该 provider 登记客户端(有审批/回调成本);**`apikey` 形态零平台侧登记** —— 用户从对方控制台生成密钥自己贴进来,平台只做加密存储与生成期下发。**长尾一律走 `apikey`。** |
| 平台替用户保管支付密钥吗? | **不代持资金闭环**:不做运行期代理、不碰钱。但用户**自带**的密钥(如自己的 Stripe `sk_`)会加密存在平台,仅供**生成期** agent 使用,用完即弃;收款直接进用户自己的账号。 |
| 连接是账号级还是项目级? | 账号级连接 + 项目级绑定。一个 Stripe/Google 账号可服务多个项目,避免 n 个项目走 n 次接入。 |
| 用户每次生成都要选连接器吗? | **不用。** 绑定即默认全生效;per-turn 只是"临时关掉/临时点亮"的开关。**只读默认开,可写默认问。** |
| 为什么第一个做 GA4? | 只读、零资金风险、同时验证"注入 public 值"与"生成期读真实数据"两条链路,且**逼不出任何平台侧后端**。 |
| 为什么第二个做 Stripe(自带密钥)? | 它是 `apikey` 形态的样板:密钥在对方控制台自建、无需平台登记,且天然分「publishable(下发页面)+ secret(只生成期用)」两半,一次把两条通道都验完。 |

判断标准(两条,后续加 provider 一律照此):

1. **不产生外部副作用的能力默认开,产生的默认问**(可写 = 建商品/推仓库/退款)。
2. **要授权的才叫连接器,填个 ID 的事叫配置**(后者不进 `connections` 表、没有 OAuth 流程)。

---

## 1. 两个轴:别把 MCP 用错地方

| 轴 | 谁在调外部系统 | 何时发生 | MCP 位置 |
| --- | --- | --- | --- |
| **A 生成期** | agent(Cloud Run 里写代码的模型) | 生成/改代码那几分钟 | 合理,但 v0 用不上(见 §3) |
| **B 运行期** | 生成出来的站点(访客打开的静态页面) | 上线之后每一次访问 | 不适用 |

行业现状(2026-09 口径):一线 SaaS 基本都发官方 MCP server(Stripe `mcp.stripe.com`、Linear / Notion / GitHub / Cloudflare / Sentry),生态 13 万+ server —— 但那是**给 agent 操作你自己的账号**用的(开商品、退款、读报表),**不是访客付款通道**。访客付款走的是 Checkout / Payment Links,与 MCP 无关。长尾小系统普遍没有 MCP,得自己包。

**所以"MCP 吗"的答案是:连接器面板不是 MCP 商店,列表短是常态** —— 每个 provider 都要人肉对接、写文档、扛 quirk,不取决于对方有没有 MCP。

---

## 2. 连接器的三种形态(成本差一个数量级)

| 形态 | 例子 | 需要什么凭证 | 运行期要不要平台出后端 |
| --- | --- | --- | --- |
| **A 纯注入** | GA4 的 `G-XXXX`、Stripe Payment Link、地图 key | 全是 public 值 | 不需要 |
| **B 生成期授权** | GA4 Data API、Search Console、GitHub | OAuth,**生成时用完即弃** | 不需要 |
| **C 运行期闭环** | Stripe Checkout + webhook、Supabase | 含 secret,**必须服务端保管** | 平台代理 **或** 用户自带 |

分期就按 A → B → C。

### 2.1 另一个轴:鉴权方式 `auth`(决定平台侧成本)

形态说的是「这个连接器干什么」;**鉴权方式说的是「平台要为它做多少事」**,两者正交:

| `auth` | 谁提供凭证 | 平台侧成本 | 例子 |
| --- | --- | --- | --- |
| `config` | 用户填个非密值 | 零(schema 都不用进) | GA4 `measurementId`、付款链接 |
| `oauth` | 用户授权外部账号 | **平台要登记 OAuth 客户端 + 回调地址**(常伴审批) | GA4、GitHub |
| `apikey` | **用户从对方控制台生成密钥自己贴** | **零登记、零审批、不改 schema** | Stripe、Supabase、各类长尾 SaaS |

**这是本设计里最关键的一条扩展策略**:`oauth` 只留给「对方只支持 OAuth / 值得平台去登记」的那几个;
**其余一律 `apikey`**。用户既然已经在对方控制台有了账号,让他复制一个 key 的成本,
远低于让平台去替每个 provider 走一遍客户端申请与回调登记 —— 后者不可能对长尾成立。

`apikey` 复用 `oauth` 的整条存储链路(同一个 `connections` 表、同一套 AES-GCM 加密、
同一个 `resolveGrants`),唯一区别是凭证来源:从「上游换回的 token」变成「用户贴上来的 key」。

---

## 3. 为什么不用 MCP 实现

- **pi 没有 MCP,且是刻意的**:`pi-coding-agent/README.md:446`「**No MCP.** Build an extension that adds MCP support」。当前会话只挂 `createCodingTools`(`agent/src/session.ts:94`),工具集是 read/write/edit/bash/find/grep/ls。
- 要接 MCP 得自己写 pi 扩展(`defineTool` / `ExtensionFactory`,`pi-coding-agent/dist/core/extensions/types.d.ts:311,913`)——**能写,但 v0 不值**。同样的能力用"平台注入凭证 + 提示词说明 + agent 自带 bash"就能验证,而 MCP 客户端还会引入进程生命周期、鉴权、工具命名冲突三摊新问题。
- **留一条后路**:如果生成期接入的 provider 超过 3 个、提示词开始膨胀,再把它们收进一个平台的 pi 扩展(或 MCP 客户端)。判据是"提示词里连接器章节超过 ~1KB"或"provider ≥ 4 个",不是"别人都在用"。

---

## 4. 数据模型

```sql
-- 账号级:一个 Google/Stripe 账号可被多个项目复用;换账号只在这改一次
CREATE TABLE IF NOT EXISTS connections (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  provider      TEXT NOT NULL,                    -- ga4 | stripe | github | supabase
  account_label TEXT NOT NULL,                    -- "acme.com" / "me@x.com",仅展示
  scopes        TEXT NOT NULL DEFAULT '',         -- 记下来才能显示「只读 / 可写」
  credentials   TEXT NOT NULL,                    -- JSON,AES-GCM 密文(public 值也走这里,统一路径)
  status        TEXT NOT NULL DEFAULT 'active',   -- active | revoked | error
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, provider, account_label)
);

-- 项目级:决定"这个项目的这一轮生成自动带上什么"
CREATE TABLE IF NOT EXISTS project_connectors (
  project_id  TEXT NOT NULL REFERENCES projects(id),
  provider    TEXT NOT NULL,
  env         TEXT NOT NULL DEFAULT 'live',       -- draft | live,与数据层同口径
  config_json TEXT NOT NULL DEFAULT '{}',         -- 非密配置:measurementId / paymentLink / connectionId
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (project_id, provider, env)
);
```

三个刻意的决定:

1. **必须有 `env` 维度**,与 `p:{projectId}:{env}:`(KV)、`appdata/{projectId}/{env}/`(R2)、`${projectId}:${env}`(DO)完全同口径。没有这一列,迟早出现"草稿的测试付款打进真账"。
2. **凭证放 D1,不放 Worker secret。** Worker secret 是**全局且只写不可读**(AGENTS.md §2),物理上装不下 per-user 凭证。代价:平台主密钥(`CONNECTOR_KEK`,新 secret)能解开所有人的 token —— **这个信任模型必须写在授权页上,不能藏**(见 §8)。
3. **public 值与 secret 走同一条存储路径**,靠 provider 定义的 `secretFields` 标记区分要不要下发到前端 —— 免得每加一个 provider 都要改 schema。

---

## 5. Provider 定义:加一个 provider = 加一个文件

```ts
// src/lib/connectors/providers/ga4.ts
export default {
  id: 'ga4',
  name: 'Google Analytics 4',
  blurb: '让 agent 读到真实访问数据,生成的应用也能上报',
  auth: 'oauth',                     // 'oauth' | 'apikey' | 'config'
  scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
  writeScopes: [],                   // 非空 → 「可写」,默认不自动带上(§7)
  configFields: [                    // 非密;public:true 的会注入生成页(§6a)
    { key: 'measurementId', label: '数据流 ID', public: true },
  ],
  secretFields: ['accessToken', 'refreshToken'], // → 永不进包
  agentHint: '...',                  // 生成期提示词片段(§6b)
}
```

`apikey` 形态多一个 `secretInputs`:声明「要让用户粘贴哪几项密钥」,面板据此渲染密码框:

```ts
// src/lib/connectors/providers/stripe.ts
export default {
  id: 'stripe',
  auth: 'apikey',
  writeScopes: ['payment_links.write'],   // 用 sk_ 建收款链接是真实副作用 → 可写,默认不带上
  configFields: [{ key: 'publishableKey', public: true }],   // pk_ → 随页面下发
  secretInputs: [{ key: 'secretKey', label: 'Secret key', required: true, hint: '…' }],
  secretFields: ['secretKey'],            // → 只进 .forge/connectors.json,永不进包
  agentHint: '用 curl 建 product/price/payment_link,把返回的公开 URL 写进按钮…',
}
```

**A 类不叫连接器**:`auth: 'config'` 的 provider(GA4 的 measurementId、Stripe Payment Link)只是**项目配置**,`connections` 表里没有行、没有 OAuth 流程、UI 上是个输入框。只有 `auth: 'oauth'` / `'apikey'` 才走"接入"。

---

## 6. 三条运行时链路

### a) public 值 → 注入生成页

`src/lib/artifacts.ts` 的 `injectRuntime()` 多注一个全局:

```js
window.__FORGE_CONNECTORS__ = { ga4: { measurementId: "G-XXXX" } }
```

SDK 放 `agent/template/src/lib/connectors.js` —— 放这个目录是**故意的**:`restorePlatformFiles()` 会强制还原 `src/lib/*`,模型只能"用"不能改坏,与 `forge.js` 同一道保险。

### b) agent 生成期读真实数据

`AgentRunRequest`(`src/lib/agent.ts`)加字段,由 `src/routes/generate.ts` 的 `launchJob` 组装:

```ts
connectors?: { provider: string; accountLabel: string; scopes: string[]; token?: string }[]
```

agent 侧把凭证写进工作目录 `.forge/connectors.json`(该目录进 `SKIP_DIRS`,不进源码树、不进产物),并在 system prompt 里列出"本次可用的连接器 + 能做什么"。**token 随容器销毁,不落 D1、不落 R2、不进 versions。**

### c) 运行期需要密钥 → `ext` 代理(本期不做)

设计上落在 `src/lib/appdata.ts` 的 switch 里加 `ext` 分支(`/s/:slug/api/ext/:provider/*`),由平台代调、代验签。**本期不做**,理由见 §0 与 §8。

---

## 7. 交互设计:默认继承,override 才动手

### 核心规则

> **默认从上下文继承,只有 override 才需要动手。**

这条规则是为了消灭"每次交互都要用户去选"。今天 Forge 里最典型的受害者是**附件**(每条消息都要重选,失败重试还要重传)。连接器绝不能变成第二个。

### 能力条(Composer 上层)

`web/src/components/ChatPanel.tsx`,与附件入口同一行区域,不新增第二排控件:

```
┌──────────────────────────────────────────────────┐
│ 🔌 GA4 只读 ✓   Stripe 测试 ✓   + 连接           │  ← 高亮 = 本轮生效
├──────────────────────────────────────────────────┤
│ [ 输入框                                 ] [发送] │
└──────────────────────────────────────────────────┘
```

| 状态 | 行为 |
| --- | --- |
| 未绑定 | 只有一个 `+ 连接` chip,点开是 provider 列表 |
| 已绑定(只读) | **默认全亮**,用户零操作;点一下变灰 = 本轮临时关闭,**不落库** |
| 已绑定(可写) | 默认不自动带上;要用得在本轮点亮,且 agent 触发写操作时弹确认卡 |
| 任务生成中 | chip 只读(steering 的凭证在 dispatch 时已定,不能中途换);hover 说明原因 |
| 本轮结束 | 临时开关自动复位回默认(与 steer 的输入框状态复位同一套路) |

chip 永远带权限徽标:`只读` / `可写`。

### 完整管理放项目级

顶栏(与「发布」并列)一个「连接器」入口,管慢变量:换账号、撤销授权、重新上传密钥、draft/live 各配什么、A 类配置。**对话栏只做开关,不做配置** —— 这是分工,不是重复。

### 但「第一次接上」不该把人支使到面板 —— 对话内凭证卡片

用户的原话是「不想让用户在页面上填这些东西」。所以拆成两层:

| 场景 | 在哪完成 | 组件 |
| --- | --- | --- |
| **第一次接入某个系统**(高频、一次性) | **对话流里**,不离开对话 | `web/src/components/ConnectorCard.tsx` |
| 换账号 / 撤销 / 重新上传 / draft 与 live 分开配(低频、慢变量) | 顶栏「连接器」面板 | `web/src/components/ConnectorsPanel.tsx` |

流程:能力条的「+ 连接」展开**内联 provider 列表**(不用浮层,移动端不会被视口裁掉)→ 选中某个 provider → 对话流末尾展开一张卡片:

```text
┌─ 接入 Stripe ────────────────────────── ✕ ┐
│ 可写 · 用你自己的密钥生成收款入口            │
│ 接入到  (草稿/测试)  (线上)                 │
│ 你的账号里已保存过 Stripe 的凭证:           │
│   [ 🔑 我的 Stripe(test)        接入 ▸ ]   │
│ 或粘贴一把新密钥:                          │
│ Secret key *  [ ••••••••••• ]  保密        │
│ 名称(可选)    [ 我的 Stripe ]              │
│ Publishable key  [ pk_live_… ] 会在页面上公开 │
│ [保存并接入] [取消]                         │
│ 密钥只用于生成时调用 Stripe,加密存放…       │
└────────────────────────────────────────────┘
```

**安全边界(这张卡片存在的真正理由)**:密钥**只上行、永不回显**,而且**不走对话消息链路** ——
卡片直接 `POST /api/connections/:provider/secret`,明文**不进 `messages` 表、不进 prompt、不进 `agent_log`**。
如果改成"让用户在聊天框里把 key 打给 agent",同一段文本会同时:落 D1 消息表、被拼进 prompt 发给模型厂商、
经 `agent_log` 流式回显到前端 —— 三重泄露。用户视角一样省事,安全上差一个量级。

卡片的两个配套决定:

- **默认绑 `draft`**(测试环境),要发线上得显式点「线上」并看到「访客打开公开页时就会生效」的提醒 —— 与 `env` 列的初衷一致。
- **卡片只处理 `apikey` / `config` 两种形态的"新建";`oauth` 只给一个「前往授权」按钮** —— 授权必须跳到对方页面,卡片里做不完,但至少不用再去找面板。
- **复用排在新建前面**:账号下已保存过该 provider 的凭证时,卡片顶部先列出「🔑 <名称> → 接入 ▸」,点一下只写一条项目级绑定 —— **不重传密钥**;`oauth` 同样适用,选一个已授权账号即可**免二次授权**(同一账号接第二个项目的常见情形)。要换账号/传新密钥才走下面的输入框或授权页。
- **必填配置在卡片里一次填完**:卡片对 `oauth` / `apikey` / `config` 三种形态都渲染非密配置输入框;必填项没填就按死「前往授权 / 保存并接入」。`oauth` 的配置随 `state` 一起往返(见 §8),回调时与 `connectionId` 合并落库 —— 否则用户点完「允许」回来还是"缺必填配置",照样被支使去面板。
- 保存成功后卡片**原地转成完成态**(绿色「🔑 Stripe 已接入 · <名称>」),给这一轮留个痕迹;下一次发起任务时自动收起。

面板里三种 `auth` 对应三种交互:

| 形态 | 面板上的入口 |
| --- | --- |
| `oauth` | 「连接」按钮 → 跳外部授权页(失败时面板直接给出可复制的回调地址) |
| `apikey` | 粘贴密钥的密码框 + 可选名称 → 「保存并绑定」;已保存后折叠,点「重新上传」覆盖轮换;也能「用已有的密钥」把账号级连接直接绑到本项目 |
| `config` | 纯输入框(非密配置) |

已保存的密钥**永不回显** —— 面板只知道「已保存密钥 · <名称>」,值只在保存时上行一次。

### 顺带修掉"消息级重选"

- 附件区加「沿用上一条的附件」(能复用就复用,不能就提示重传);
- 失败卡片的「重试」在原任务带过附件时标注「需重传附件」,而不是静默丢掉。

---

## 8. 安全与滥用

| 项 | 做法 |
| --- | --- |
| OAuth 回调 | 复用 `src/routes/auth.ts` 里 Google 登录那套:state 随机数存 HttpOnly cookie、回调比对。state 里另外带 `projectId~env~非密配置(base64url)`,回调时与 `connectionId` 合并落库(不覆盖已有配置);配置按 provider 白名单过滤,解不开就当空 |
| 默认权限 | 一律 readonly;写权限单独申请,且在对话内二次确认 |
| 撤销 | 用户主动撤销 + provider 返 401/403 → `status='error'`,前端提示重连(不静默生成一堆坏代码) |
| 平台代理频控 | 一旦做 `ext` 分支,必须挂频控 + 每项目配额,否则等于送用户一个免费外呼网关(参 FORGE2 §15.3 现有口径) |
| 提示词 | `agent/src/prompt.ts:59` 那句"禁止收集密码、支付信息"**改成分档**:允许「外链支付按钮」,继续禁止「收集/存储卡号、CVC」 |
| Agent 侧凭证 | 只落 `.forge/connectors.json`(SKIP_DIRS),提示词明确禁止把凭证写进源码;随容器销毁 |
| 自带密钥 | 与 OAuth 凭证**同一条存储路径**(同一张表、同一把 `CONNECTOR_KEK`、同一套 AES-GCM);上传接口只接受 provider 声明过的键、值**只读不回显**,列表接口永不返回 `credentials` |
| 环境隔离 | `CONNECTOR_KEK` 必须在 `wrangler.jsonc` 顶层与 `env.staging` **各写一遍**(绑定类配置不可继承,漏写只在运行时 `undefined`) |
| 信任模型 | 平台主密钥可解开所有用户的连接凭证 —— 授权页必须写明;要规避就得等 Workers for Platforms |

---

## 9. 分期与验收

| 期 | 内容 | 为什么是这个顺序 | 验收判据(staging) |
| --- | --- | --- | --- |
| **v0** | 框架 + GA4(只读,oauth) | 零资金风险;A、B 两条链路都能验;不碰 C 类 | 生成的应用能读到**真实** GA 数字,而非模型编的 |
| **v0.1** | **`apikey` 形态 + Stripe(用户自带密钥)** | 打通"零平台侧登记"的扩展路径;一次验完 publishable 下发 + secret 生成期使用 | 贴入 `sk_test_` → 能力条点亮 → 生成的应用出现真实可跳转的收款链接;源码里搜不到 `sk_` |
| **v2** | GitHub(oauth) | 账号授权里最有用的一类:生成完直接推用户仓库 | 一次授权 → 生成 → 代码出现在用户仓库 |
| **v3** | Supabase(用户自带后端,apikey) | 责任推给上游;平台只做加密存储与生成期下发 | 用户贴 URL + service key → agent 建表 → 页面用 anon key 读写 |

**明确不做**:平台代持 `sk_live` 做资金闭环。理由:爆炸半径是所有用户的收款密钥,而 Worker 无 KMS;这与 Forge 的薄承载模型(`docs/DESIGN.md` §二.3)冲突,收益远小于风险。

---

## 10. 落地清单

**新增**
- `src/lib/connectors/{crypto,registry,store}.ts` + `providers/{ga4,stripe}.ts`
- `src/routes/connections.ts`(list / oauth start / callback / **apikey 上传** / revoke / A 类配置)
- `agent/template/src/lib/connectors.js`
- `schema.migrate-connectors.sql`(增量迁移,两个建表语句)
- `web/src/components/{ConnectorChips,ConnectorsPanel}.tsx`

**改动**
- `src/types.ts`(`Env` 加 `CONNECTOR_KEK`)
- `wrangler.jsonc`(顶层与 `env.staging` 各写一遍)
- `src/index.ts`(挂 `/api/connections`)
- `package.json`(迁移脚本)
- `src/lib/artifacts.ts` `injectRuntime()`(注入 `__FORGE_CONNECTORS__`)
- `src/routes/serve.ts`(取项目配置传给 `injectRuntime`)
- `src/lib/agent.ts` + `src/routes/generate.ts`(dispatch 带连接器)
- `agent/src/{types,runner,prompt}.ts`(落 `.forge/connectors.json` + SKIP_DIRS + 提示词分档)
- `agent/template/src/lib/forge.js`(connectors 读取入口)
- `web/src/{lib/api.ts,components/ChatPanel.tsx,pages/Workspace.tsx}`

**文档**
- 完成后同步 `docs/FORGE2.md`(新增一节);规则成型后按需进 `AGENTS.md`

---

## 11. 待用户在平台侧完成的配置(v0 依赖)

1. **Google Cloud Console**:在自有 OAuth 客户端中追加当前部署的两个回调 URI
   - `${STAGING_PUBLIC_BASE_URL}/api/connections/ga4/callback`(staging)
   - `${PRODUCTION_PUBLIC_BASE_URL}/api/connections/ga4/callback`(生产)
   - 旧回调只有在仍有调用方时才保留;实际生效地址由各环境 `PUBLIC_BASE_URL` 决定。
2. **启用 Google Analytics Data API**(`analyticsdata.googleapis.com`)—— 不启用则生成期读数为 403。
3. `CONNECTOR_KEK` 在两个环境各写一次(`wrangler secret put`,值只需随机 32 字节,**换掉即所有连接需重新授权**)。
4. 若 `analytics.readonly` 触发 Google 的敏感 scope 审核:未验证应用仅限测试用户可用 —— 影响范围只在"谁能连",不影响生成链路。

---

## 12. 一手依据

- pi 不启用 MCP:以 `@earendil-works/pi-coding-agent` 对应版本的上游文档为准,本项目也没有注册 MCP 工具。
- 扩展 API:以 `@earendil-works/pi-coding-agent` 导出的类型与上游文档为准,不要引用未跟踪的 `node_modules` 固定行号。
- 生成应用当前后端能力仅 `db|kv|blob`:`src/lib/appdata.ts:285`
- 发布页沙箱 CSP:`src/routes/serve.ts:16`
- 运行时注入:`src/lib/artifacts.ts` 的 `injectRuntime()`
- 提示词禁区:`agent/src/prompt.ts:59`(支付/密码)、`:86,:140`(外部 CDN/img)
- 对标产品:Atoms 连接器面板(**版本级**绑定,是我们不抄的地方);Lovable 的 Stripe 两档(官方文档:Payment Link 直贴 vs Supabase Edge Function + secret)
