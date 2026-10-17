export type Env = {
  DB: D1Database
  ASSETS: Fetcher
  /** R2:多文件产物的构建产物(dist),按 p/{projectId}/v/{versionNo}/{path} 存放 */
  ARTIFACTS: R2Bucket
  /** KV:生成应用的后端键值存储,键为 p/{projectId}:{env}:{key} */
  APPDATA: KVNamespace
  /** 每项目 × 每环境一个独立 SQLite(Durable Object,SQLite 后端);见 src/lib/projectDb.ts */
  PROJECT_DB: DurableObjectNamespace
  /** Cloud Run agent service 的基址,如 https://forge-agent-xxx.run.app */
  AGENT_URL: string
  /** 与 agent 共享的内部密钥:Worker→Cloud Run 与 Cloud Run→Worker(/internal/*)双向校验 */
  AGENT_SECRET: string
  /** Worker 对外基址,下发给 agent 用于进度回调,如 https://forge-v2.xxx.workers.dev */
  PUBLIC_BASE_URL: string
  /** 管理后台独立口令(`wrangler secret put ADMIN_PASSWORD`);未设置则后台不可用 */
  ADMIN_PASSWORD: string
  /** Google OAuth 2.0 客户端 ID(Worker secret `GOOGLE_CLIENT_ID`);未设置则不提供 Google 登录 */
  GOOGLE_CLIENT_ID?: string
  /** Google OAuth 2.0 客户端密钥(Worker secret `GOOGLE_CLIENT_SECRET`);与上面成对配置 */
  GOOGLE_CLIENT_SECRET?: string
  /** 可选:派发到 Cloud Run 的 fetch 超时(毫秒) */
  AGENT_DISPATCH_TIMEOUT_MS?: string
  /** 可选:平台部署环境标记。只有 staging 的 vars 里设成 'staging',生产不设(按 production 处理);
   *  前端据此显示环境角标,避免在错误的域名上做测试。生产与 staging 共用同一份 web/dist,
   *  所以环境名只能这样运行时下发,不能用构建期变量 */
  ENVIRONMENT?: string
}

export interface SessionUser {
  id: string
  email: string
  credits: number
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