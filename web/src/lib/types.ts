export interface User {
  id: string
  email: string
  credits: number
  /** 是否已设置邮箱密码;false = 纯 Google 账号,可在这里设置初始密码 */
  has_password: boolean
}

export interface Project {
  id: string
  slug: string
  name: string
  description: string
  status: 'draft' | 'published'
  /** 当前生效的正式版本;生成/对话只改草稿,不会自动推进它,点「生成新版本」才推进 */
  current_version: number
  /** 线上版本:公开页当前服务的版本;点「发布此版本」才推进 */
  published_version: number
  /** 列表接口附带:是否存在未生成版本的草稿(详情等接口不返回) */
  has_draft?: boolean
  created_at: string
  updated_at: string
}

/** 首页精选案例(公开接口 GET /api/showcase;不含属主/源码等非展示字段) */
export interface ShowcaseItem {
  id: string
  slug: string
  name: string
  description: string
  /** 后台打的展示标签(逗号分隔的库字段已拆成数组) */
  tags: string[]
  featured_at: string | null
  updated_at: string
}

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  created_at: string
}

export interface Plan {
  name: string
  tagline: string
  palette: string[]
  /** 计划项;done/error 由后端回填,卡片实时渲染勾选与失败标记 */
  sections: { title: string; summary: string; done?: boolean; error?: boolean }[]
}

/** 构建产物清单(与后端 versions.manifest_json 对应);产物本体在 R2,经 /p/:token/ 访问 */
export interface ArtifactManifest {
  /** 入口 HTML(默认 index.html) */
  entry: string
  buildHash: string
  bytes: number
  files: { path: string; size: number }[]
}

/** 后台生成任务的状态快照(轮询/SSE 响应体,与服务端 jobSnapshot 对应) */
export interface JobSnapshot {
  id: string
  type: 'generate' | 'chat'
  /** cancelled = 用户手动停止的终态(不扣积分、不写产物);waiting_human = 人门节点暂停等作答 */
  status: 'pending' | 'running' | 'waiting_human' | 'succeeded' | 'failed' | 'cancelled'
  stage: 'planning' | 'coding' | 'building'
  /** 人读的分段进度(如「正在编写 src/App.jsx」),无则回退到按 stage 推导的文案 */
  progress: string | null
  /** 原始想法(generate 任务);失败续聊时作为继续的锚点 */
  idea: string | null
  /** 本次任务的输入文本(generate=idea / chat=message);失败重试时原样重发 */
  prompt: string | null
  /** agent 最近写入的源文件(路径 + 内容),流式看代码用;终态后清空 */
  files_preview: { path: string; content: string } | null
  /** agent 的里程碑日志(阶段/复查等少量关键行);完整过程在 Cloud Run 日志里,不进 D1 */
  agent_log: string | null
  plan: Plan | null
  error: string | null
  version: number | null
  elapsed: number
  /** 人门节点暂停时的等待信息(问题/选项/门类型);非等待态为 null */
  waiting: { question: string; options?: string[]; kind: 'approve' | 'choose' } | null
  /** 是否有可读的断点快照(只有失败/手动停止的任务快照会带) */
  resumable?: boolean
  /** 断点快照里的源码文件数(「从断点继续」按钮旁展示) */
  checkpoint_files?: number | null
}

/** 草稿(工作副本):生成/对话实时写入的未确认内容;点「生成新版本」才快照为正式版本 */
export interface ProjectDraft {
  bytes: number
  prompt: string
  created_at: string
}

export interface ProjectDetail {
  project: Project
  messages: Message[]
  /** 全部正式版本(倒序);不含草稿,用于版本切换 */
  versions: VersionMeta[]
  /** 当前展示内容(草稿优先,否则当前生效版本)的构建产物清单;无内容时为 null */
  manifest: ArtifactManifest | null
  /** 当前展示内容的源码树(路径→内容),代码页展示用;无内容时为 null */
  src: Record<string, string> | null
  /** 草稿预览令牌:拼接 /p/{token}/ 即在同一 iframe 中预览当前展示内容(env=draft) */
  previewToken: string | null
  /** 未确认的草稿;为 null 表示没有未生成版本的修改 */
  draft: ProjectDraft | null
}

/** 版本元信息(列表项,不含内容) */
export interface VersionMeta {
  version_no: number
  bytes: number
  prompt: string
  created_at: string
}

/** 单个历史版本的完整内容(源码树 + 产物清单 + 预览令牌) */
export interface ProjectVersionDetail {
  version_no: number
  bytes: number
  prompt: string
  created_at: string
  manifest: ArtifactManifest | null
  src: Record<string, string>
  previewToken: string
}

/** 站点数据(生成页面通过平台数据接口收集的访问者数据) */
export type SiteDataEnv = 'draft' | 'live'

export interface SiteCollection {
  env: SiteDataEnv
  collection: string
  count: number
}

export interface SiteDataItem {
  id: string
  data: Record<string, unknown>
  created_at: string
}

/** 项目级键值(KV)键元信息 */
export interface KvKeyMeta {
  key: string
  expiration: number | null
}

/** 项目级对象存储(R2)对象元信息 */
export interface BlobObjectMeta {
  key: string
  size: number
  uploaded: string
}

/** 项目 SQLite(SQL 控制台)一次执行的结果 */
export interface SqlResult {
  columns: string[]
  rows: Record<string, unknown>[]
  rowsRead: number
  rowsWritten: number
  durationMs: number
}

/** 项目 SQLite 里的一个对象(表/索引/视图/触发器) */
export interface SqlObject {
  type: 'table' | 'index' | 'view' | 'trigger'
  name: string
  sql: string
  count: number | null
}

// ---------- 连接器(外部系统接入,见 docs/CONNECTORS.md) ----------

/** 连接器形态:oauth=授权外部账号;apikey=用户粘贴自己的密钥;config=只要用户填个值 */
export type ConnectorAuth = 'oauth' | 'apikey' | 'config'

/** provider 的一个配置项(非密);public=true 的值会随生成页下发 */
export interface ConnectorConfigField {
  key: string
  label: string
  hint?: string
  placeholder?: string
  public?: boolean
  required?: boolean
}

/** auth='apikey' 时要用户粘贴的一项密钥(密码输入框,值只上行、永不回显) */
export interface ConnectorSecretField {
  key: string
  label: string
  hint?: string
  placeholder?: string
  required?: boolean
}

/** provider 的对外形状(不含任何内部定义) */
export interface ConnectorProviderProfile {
  id: string
  name: string
  blurb: string
  auth: ConnectorAuth
  /** true = 含可写能力:绑定后不默认生效,需在本轮显式点亮 */
  writable: boolean
  configFields: ConnectorConfigField[]
  /** 该 provider 需要 OAuth 客户端而平台未配置(前端据此禁用「连接」按钮) */
  needsOauthClient: boolean
  /** OAuth 回调地址:需在外部控制台原样登记,未登记会 400 redirect_uri_mismatch */
  redirectUri?: string
  /** auth='apikey' 时由用户粘贴的密钥项 */
  secretInputs?: ConnectorSecretField[]
}

/** 账号级连接(一个外部账号可服务多个项目);凭证永不出现在响应里 */
export interface ConnectorConnection {
  id: string
  provider: string
  accountLabel: string
  scopes: string[]
  status: 'active' | 'revoked' | 'error'
}

/** 项目级绑定(按 env 区分,与预览/线上同口径) */
export interface ProjectConnectorBinding {
  config: Record<string, string>
  connectionId: string
  /** 绑定的外部账号名;未绑或连接已删为 null */
  accountLabel: string | null
  /** missing = 绑了 provider 但还没授权账号 */
  connectionStatus: 'active' | 'revoked' | 'error' | 'missing' | null
  /** 必填但尚未填写的配置项 key */
  missing: string[]
  createdAt: string
}

export interface ProjectConnectorProvider extends ConnectorProviderProfile {
  binding: ProjectConnectorBinding | null
}

/** GET /api/projects/:id/connectors 的响应(按 env 各取一次) */
export interface ProjectConnectorsResponse {
  enabled: boolean
  /** enabled=false 时的原因(如未配置 CONNECTOR_KEK) */
  reason?: string
  env: SiteDataEnv
  providers: ProjectConnectorProvider[]
  connections: ConnectorConnection[]
}

// ---------- 管理后台(只读) ----------

/** 草稿(工作副本,version_no = 0)的元信息;has_artifacts=false 时 preview_token 为 null */
export interface AdminDraftMeta {
  version_no: number
  bytes: number
  prompt: string
  created_at: string
  has_artifacts: boolean
  /** 预览令牌,拼成 /p/:token/ 即可打开草稿;无构建产物时为 null */
  preview_token: string | null
}

export interface AdminProject {
  id: string
  slug: string
  name: string
  description: string
  status: 'draft' | 'published'
  current_version: number
  published_version: number
  /** 1 = 上首页精选(只有已发布项目可开启,见后台打标签接口) */
  featured: number
  /** 逗号分隔的展示标签,首页拆成小胶囊 */
  featured_tags: string
  created_at: string
  updated_at: string
  user_id: string
  owner_email: string
  versions_count: number
  messages_count: number
  data_count: number
  /** 未生成正式版本的草稿(工作副本);没有草稿时为 null */
  draft: AdminDraftMeta | null
}

/** 全站统计(后台列表页头部) */
export interface AdminStats {
  projects: number
  users: number
  versions: number
  jobs: number
  jobs_succeeded: number
  jobs_failed: number
  jobs_7d: number
  active_users_7d: number
}

/** 用户使用情况(服务端聚合,后台用户列表/详情) */
export interface AdminUser {
  id: string
  email: string
  credits: number
  created_at: string
  projects_count: number
  versions_count: number
  messages_count: number
  jobs_total: number
  jobs_generate: number
  jobs_chat: number
  jobs_succeeded: number
  jobs_failed: number
  jobs_7d: number
  jobs_30d: number
  bytes_total: number
  /** 最近活跃:最后一次任务时间;无任务时回退注册时间 */
  last_active_at: string
}

/** 用户详情页里的项目行:项目指标 + 构建产物字节 + 数据行数 */
export interface AdminUserProject {
  id: string
  slug: string
  name: string
  status: 'draft' | 'published'
  current_version: number
  published_version: number
  created_at: string
  updated_at: string
  versions_count: number
  messages_count: number
  bytes: number
  data_count: number
  /** 未生成正式版本的草稿(工作副本);没有草稿时为 null */
  draft: AdminDraftMeta | null
}

export interface AdminVersionMeta {
  version_no: number
  bytes: number
  prompt: string
  created_at: string
}

/** 单个版本的完整内容:源码树(路径→内容)+ 构建产物清单 */
export interface AdminVersionDetail {
  version_no: number
  bytes: number
  prompt: string
  created_at: string
  src: Record<string, string>
  manifest: ArtifactManifest | null
  /** 该版本的草稿预览令牌:后台 iframe 用 /p/:token/ 预览任意版本;无构建产物时为 null */
  previewToken: string | null
}

export interface AdminJob {
  id: string
  type: string
  status: string
  stage: string
  progress: string | null
  error: string | null
  result_version: number | null
  agent_log: string | null
  created_at: string
  updated_at: string
  /** 用户详情页的任务时间线附带所属项目(项目详情页的任务不含) */
  project_slug?: string
  project_name?: string
}

export interface AdminProjectDetail {
  project: AdminProject & { user_id: string }
  versions: AdminVersionMeta[]
  /** 草稿(工作副本),与 versions 并列,便于直接预览;无草稿时为 null */
  draft: AdminDraftMeta | null
  messages: Message[]
  jobs: AdminJob[]
  collections: SiteCollection[]
  /** 部署环境(local/staging/production);仅 local 时后台展示完整实时日志 */
  environment?: string
}

/** 单条积分流水(credit_ledger 的只读投影;reason 见服务端 src/lib/credits.ts) */
export interface AdminCreditLog {
  id: string
  /** 正数为加、负数为扣 */
  delta: number
  reason: string
  ref_type: string
  ref_id: string
  balance_after: number
  note: string
  created_at: string
}

/** 用户详情:用量聚合 + 该用户的项目 + 最近任务时间线 + 积分流水 */
export interface AdminUserDetail {
  user: AdminUser
  projects: AdminUserProject[]
  jobs: AdminJob[]
  /** 最近 30 条积分流水(后台加积分后用于核对) */
  credits_log: AdminCreditLog[]
  /** 部署环境(local/staging/production);仅 local 时后台展示完整实时日志 */
  environment?: string
}

// ─────────────────────────── 计费(见 docs/FORGE2.md §20)───────────────────────────

/** 一次性充值包。价格是**占位值**,阶段四接入 MoR 时以对方后台商品为准(服务端 src/lib/plans.ts) */
export interface CreditPack {
  id: string
  credits: number
  /** 最小货币单位(美分):$9.00 → 900 */
  priceMinor: number
  badge: 'popular' | 'bestValue' | ''
}

/** 按月订阅档位:每月自动到账 creditsPerPeriod 分,可随时取消 */
export interface SubscriptionPlan {
  id: string
  name: string
  creditsPerPeriod: number
  priceMinor: number
  period: 'month'
  badge: 'popular' | 'bestValue' | ''
}

export interface BillingPlans {
  currency: string
  jobCost: Record<string, number>
  packs: CreditPack[]
  plans: SubscriptionPlan[]
  /** 支付通道是否已开通(服务端 Creem 密钥与商品映射就绪);未开通时禁用结账按钮 */
  checkoutReady: boolean
}

/** 账本流水类型,与 src/lib/credits.ts 的 LedgerReason 对应(前端据此选文案) */
export type LedgerReason = 'signup' | 'job_hold' | 'job_release' | 'purchase' | 'refund' | 'admin_grant' | 'expire'

export interface LedgerEntry {
  id: string
  delta: number
  reason: LedgerReason
  refType: string
  refId: string
  balanceAfter: number
  note: string
  createdAt: string
}

export interface BillingOrder {
  id: string
  provider: string
  amountMinor: number
  currency: string
  credits: number
  status: 'pending' | 'paid' | 'failed' | 'refunded'
  createdAt: string
  paidAt: string | null
}

export interface BillingSummary {
  credits: number
  ledger: LedgerEntry[]
  orders: BillingOrder[]
}

// ---------- 管理后台 · 用户大盘(见 docs/FORGE2.md §22) ----------

export interface AdminDashboardSeriesPoint {
  day: string
  new_users: number
  active_users: number
  active_job_users: number
  jobs: number
  succeeded: number
  failed: number
  revenue_minor: number
  paid_users: number
  publishes: number
  checkout_starts: number
}

export interface AdminDashboardOverview {
  users_total: number
  users_verified: number
  new_users_today: number
  new_users_7d: number
  projects_total: number
  projects_published: number
  jobs_total: number
  jobs_succeeded: number
  jobs_failed: number
  jobs_cancelled: number
  jobs_today: number
  jobs_7d: number
  dau: number
  wau: number
  mau: number
  dau_jobs: number
  wau_jobs: number
  mau_jobs: number
  stickiness: number | null
  paid_users_total: number
  conversion_rate: number | null
  revenue_total_minor: number
  revenue_30d_minor: number
  active_subscriptions: number
  mrr_minor: number
  cost_30d_usd: number
  cost_per_success_30d_usd: number | null
}

export interface AdminDashboardFunnel {
  registered: number
  verified: number
  has_project: number
  has_job: number
  has_succeeded: number
  has_version: number
  has_published: number
  has_paid: number
}

export interface AdminDashboardActivation {
  users: number
  activated: number
  activated_24h: number
  activated_7d: number
  median_ttv_hours: number | null
  p90_ttv_hours: number | null
}

export interface AdminDashboardRetentionRow {
  cohort: string
  size: number
  d1: number | null
  d3: number | null
  d7: number | null
  d14: number | null
  d30: number | null
}

export interface AdminDashboardMonetization {
  paying_users: number
  paid_users_30d: number
  conversion_rate: number | null
  paying_penetration_30d: number | null
  revenue_30d_minor: number
  revenue_total_minor: number
  arppu_minor: number | null
  arpu_30d_minor: number | null
  refunded_orders: number
  refund_rate: number | null
  first_purchase_median_days: number | null
  active_subscriptions: number
  mrr_minor: number
  subscription_plans: { catalog_id: string; name: string; count: number; mrr_minor: number }[]
  consumed_credits_30d: number
  purchased_credits_30d: number
  users_with_usage: number
  zero_balance_users: number
  exhausted_users: number
  exhausted_paid_users: number
  revenue_per_credit_minor: number | null
  consumed_revenue_30d_minor: number
  cash_margin_30d_usd: number
  consumed_margin_30d_usd: number
}

export interface AdminDashboardQuality {
  jobs: number
  succeeded: number
  failed: number
  cancelled: number
  success_rate: number | null
  avg_run_ms: number
  p50_run_ms: number | null
  p90_run_ms: number | null
  avg_queue_ms: number
  p50_queue_ms: number | null
  p90_queue_ms: number | null
  by_type: { type: string; channel: string; jobs: number; succeeded: number; failed: number; cancelled: number }[]
  top_errors: { error: string; count: number }[]
  tokens: { input: number; output: number; cache_read: number; cache_write: number }
  cost: { llm_usd: number; gcp_usd: number; total_usd: number; per_success_usd: number | null }
}

export interface AdminDashboard {
  generated_at: string
  days: number
  /** 统计日偏移:0=今天,1=昨天(T-1) */
  end: number
  timezone: 'UTC+8'
  overview: AdminDashboardOverview
  series: AdminDashboardSeriesPoint[]
  funnel: AdminDashboardFunnel
  activation: AdminDashboardActivation
  retention: AdminDashboardRetentionRow[]
  monetization: AdminDashboardMonetization
  quality: AdminDashboardQuality
}
