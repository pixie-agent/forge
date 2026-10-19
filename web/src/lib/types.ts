export interface User {
  id: string
  email: string
  credits: number
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
  /** cancelled = 用户手动停止的终态(不扣积分、不写产物) */
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  stage: 'planning' | 'coding' | 'building'
  /** 人读的分段进度(如「正在编写 src/App.jsx」),无则回退到按 stage 推导的文案 */
  progress: string | null
  /** 原始想法(generate 任务);失败续聊时作为继续的锚点 */
  idea: string | null
  /** 本次任务的输入文本(generate=idea / chat=message);失败重试时原样重发 */
  prompt: string | null
  /** agent 最近写入的源文件(路径 + 内容),流式看代码用;终态后清空 */
  files_preview: { path: string; content: string } | null
  /** agent 的流式输出(thinking/正文/工具调用),服务端保留尾部;仅活动任务期间有值 */
  agent_log: string | null
  plan: Plan | null
  error: string | null
  version: number | null
  elapsed: number
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
}

/** 用户详情:用量聚合 + 该用户的项目 + 最近任务时间线 */
export interface AdminUserDetail {
  user: AdminUser
  projects: AdminUserProject[]
  jobs: AdminJob[]
}
