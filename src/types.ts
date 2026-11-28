export type Env = {
  DB: D1Database
  ASSETS: Fetcher
  /** R2:多文件产物的构建产物(dist),按 p/{projectId}/v/{versionNo}/{path} 存放 */
  ARTIFACTS: R2Bucket
  /** R2:提示词文件树压缩包(见 docs/FORGE2.md §17.10),键 promptset.zip */
  PROMPTS: R2Bucket
  /** KV:生成应用的后端键值存储,键为 p/{projectId}:{env}:{key} */
  APPDATA: KVNamespace
  /** 每项目 × 每环境一个独立 SQLite(Durable Object,SQLite 后端);见 src/lib/projectDb.ts */
  PROJECT_DB: DurableObjectNamespace
  /** Cloud Run agent service 的基址,如 https://forge-agent-xxx.run.app */
  AGENT_URL: string
  /** 免费通道的独立执行体(便宜模型 + 1 并发进程内排队);不配则免费任务也走 AGENT_URL */
  AGENT_URL_FREE?: string
  /** 与 agent 共享的内部密钥:Worker→Cloud Run 与 Cloud Run→Worker(/internal/*)双向校验 */
  AGENT_SECRET: string
  /** Worker 对外基址,下发给 agent 用于进度回调,如 https://forge-v2.xxx.workers.dev */
  PUBLIC_BASE_URL: string
  /** 管理后台独立口令(`wrangler secret put ADMIN_PASSWORD`);未设置则后台不可用 */
  ADMIN_PASSWORD: string
  /** Resend API key(Worker secret `RESEND_API_KEY`,免费档 3,000 封/月、100 封/天)。
   *  未配置时注册仍会建号,但验证邮件发不出去 —— 接口返回 verificationSent:false,前端提供重发。 */
  RESEND_API_KEY?: string
  /** 验证邮件发件地址;必须在 Resend 后台完成域名验证(vars.EMAIL_FROM) */
  EMAIL_FROM?: string
  /** Google OAuth 2.0 客户端 ID(Worker secret `GOOGLE_CLIENT_ID`);未设置则不提供 Google 登录 */
  GOOGLE_CLIENT_ID?: string
  /** Google OAuth 2.0 客户端密钥(Worker secret `GOOGLE_CLIENT_SECRET`);与上面成对配置 */
  GOOGLE_CLIENT_SECRET?: string
  /** 连接器凭证的加密主密钥(Worker secret `CONNECTOR_KEK`,32 字节随机值的 hex/base64 文本)。
   *  未设置时连接器整体不可用(接口返回明确错误),不影响其他功能。
   *  注意:Worker secret 全局、只写不可读 —— 它装不下 per-user 凭证,所以用户凭证加密后存 D1,
   *  这把密钥只用来加解密;换掉它 = 所有用户连接需重新授权。见 docs/CONNECTORS.md §4/§8 */
  CONNECTOR_KEK?: string
  /** Creem(MoR)API key(Worker secret `CREEM_API_KEY`)。未设置则结账接口返回明确错误,不影响其他功能。
   *  生产用 live key、staging 用 test key,各写各的。见 docs/FORGE2.md §20.7 */
  CREEM_API_KEY?: string
  /** Creem webhook 签名密钥(Worker secret `CREEM_WEBHOOK_SECRET`):校验 `creem-signature` 头 */
  CREEM_WEBHOOK_SECRET?: string
  /** Creem API 基址;生产 https://api.creem.io,staging 用 https://test-api.creem.io(不设则按生产) */
  CREEM_API_BASE?: string
  /** 本地目录 id → Creem 商品 ID 的 JSON 映射,如 {"pack_20":"prod_xxx"};两套门店的商品 ID 不同,故走 vars */
  CREEM_PRODUCTS?: string
  /** 可选:派发到 Cloud Run 的 fetch 超时(毫秒) */
  AGENT_DISPATCH_TIMEOUT_MS?: string
  /** 可选:平台部署环境标记。只有 staging 的 vars 里设成 'staging',生产不设(按 production 处理);
   *  前端据此显示环境角标,避免在错误的域名上做测试。生产与 staging 共用同一份 web/dist,
   *  所以环境名只能这样运行时下发,不能用构建期变量 */
  ENVIRONMENT?: string
  /** Cloudflare Web Analytics beacon token(vars,非密)。只在生产配置;staging 留空 → 不加载 beacon。
   *  平台是 SPA,必须走手动 snippet 才能带 `spa:true` 统计前端路由切换;自动注入只记首次加载。 */
  WEB_ANALYTICS_TOKEN?: string
}

export interface SessionUser {
  id: string
  email: string
  credits: number
  /** 是否已设置邮箱密码;纯 Google 账号为 false(可借此在账号页判断「设置」还是「修改」) */
  has_password: boolean
}

export type AppEnv = {
  Bindings: Env
  Variables: { user: SessionUser }
}

export interface UserRow {
  id: string
  email: string
  password_hash: string
  /** Google OIDC sub;邮箱/密码账号未绑定时为 null */
  google_sub: string | null
  credits: number
  /** 1 = 邮箱已验证(注册时显式写 0,验证通过后置 1;Google 登录创建的账号直接为 1) */
  email_verified: number
  created_at: string
}

export interface ProjectRow {
  id: string
  user_id: string
  slug: string
  name: string
  description: string
  status: 'draft' | 'published'
  /** 最新生成/编辑基线版本(预览与续聊以此为准) */
  current_version: number
  /** 线上版本:发布页服务的版本;点「发布此版本」才推进,生成不会自动上线 */
  published_version: number
  created_at: string
  updated_at: string
}

export interface MessageRow {
  id: string
  project_id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface Plan {
  name: string
  tagline: string
  palette: string[]
  /** 计划项;done/error 由前端按生成情况回填(现由 agent 的 plan.json 提供) */
  sections: { title: string; summary: string; done?: boolean; error?: boolean }[]
}

/** 多文件版本:源码树(路径→内容)+ 构建产物清单(内容在 R2) */
export interface VersionRow {
  id: string
  project_id: string
  version_no: number
  /** JSON:源码树 { "src/App.jsx": "...", "index.html": "..." } */
  src_json: string
  /** JSON:{ entry: string; buildHash: string; bytes: number; files: { path: string; size: number }[] } */
  manifest_json: string
  prompt: string
  created_at: string
}

/** 构建产物清单(存 versions.manifest_json,构建产物本体在 R2) */
export interface ArtifactManifest {
  /** 入口 HTML(默认 index.html) */
  entry: string
  buildHash: string
  bytes: number
  files: { path: string; size: number }[]
}

// ─────────────────────────── 连接器(见 docs/CONNECTORS.md)───────────────────────────

/** 账号级连接:用户授权过的外部系统账号(一个账号可服务多个项目) */
export interface ConnectionRow {
  id: string
  user_id: string
  provider: string
  account_label: string
  scopes: string
  credentials: string
  status: 'active' | 'revoked' | 'error'
  created_at: string
  updated_at: string
}

/** 项目级绑定:决定「这个项目的这一轮生成自动带上什么」 */
export interface ProjectConnectorRow {
  project_id: string
  provider: string
  env: 'draft' | 'live'
  config_json: string
  created_at: string
}

/**
 * 派发给 agent 的一份「本次可用能力」。只读默认带上;可写要用户在本轮显式点亮(见 §7)。
 * 含 token 的字段**只存在于这一条 dispatch 请求里**,随 Cloud Run 容器销毁,不落 D1/R2/versions。
 */
export interface ConnectorGrant {
  provider: string
  accountLabel: string
  scopes: string[]
  /** true = 本次含可写能力(agent 触发写操作前应先取得用户确认) */
  writable?: boolean
  /** 凭证明文(仅 auth: oauth 的 provider);agent 侧落到 .forge/connectors.json,用完即弃 */
  credentials?: Record<string, string>
  /** 非密配置(measurementId / paymentLink 等),agent 侧可直接读 */
  config?: Record<string, string>
  /** 生成期用法说明(来自 provider 定义的 agentHint) */
  hint?: string
}