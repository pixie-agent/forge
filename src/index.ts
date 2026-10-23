import { Hono } from 'hono'
import type { Env } from './types'
import { authRoutes } from './routes/auth'
import { projectRoutes } from './routes/projects'
import { projectConnectorRoutes } from './routes/projectConnectors'
import { connectionRoutes } from './routes/connections'
import { generateRoutes } from './routes/generate'
import { jobRoutes } from './routes/jobs'
import { billingRoutes } from './routes/billing'
import { internalRoutes } from './routes/internal'
import { adminRoutes } from './routes/admin'
import { showcaseRoutes } from './routes/showcase'
import { serveRoutes } from './routes/serve'
import { sweepJobs } from './lib/jobs'

// Durable Object(每项目 × 每环境的 SQLite 库)必须从入口模块导出
export { ProjectDb } from './lib/projectDb'

const app = new Hono<{ Bindings: Env }>()

app.route('/api/auth', authRoutes)
app.route('/api/projects', projectRoutes)
// 项目级连接器(与 projectRoutes 并列挂在同一前缀:GET/PUT/DELETE /api/projects/:id/connectors)
app.route('/api/projects', projectConnectorRoutes)
app.route('/api/projects', generateRoutes)
app.route('/api/jobs', jobRoutes)
// 计费:价目表(公开)、账户摘要、发起结账(阶段三为骨架,结账返回 501;见 docs/FORGE2.md §20)
app.route('/api/billing', billingRoutes)
// 连接器 · 账号级(授权跳转与回调)
app.route('/api/connections', connectionRoutes)
// 管理后台(只读,独立口令鉴权):跨用户查看产物
app.route('/api/admin', adminRoutes)
// 首页精选案例:公开只读列表 + 登录用户克隆(见 docs/FORGE2.md §23)
app.route('/api/showcase', showcaseRoutes)
// 内部回调:Cloud Run agent 上报进度(X-Agent-Secret 保护,不对外)
app.route('/internal', internalRoutes)
// 生成应用的对外服务:发布页 /s/:slug/*、草稿预览 /p/:token/*(含各自的 /api 后端)
app.route('/', serveRoutes)

/** 其余路径交给前端 SPA(assets 已直接命中静态文件,这里兜底);未命中的 /api/* 返回 JSON 404 */
app.get('*', async (c) => {
  if (c.req.path.startsWith('/api/') || c.req.path.startsWith('/internal/')) return c.json({ error: '接口不存在' }, 404)
  return c.env.ASSETS.fetch(new Request(new URL('/', c.req.url)))
})

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: '服务器内部错误' }, 500)
})

export default {
  fetch: app.fetch,
  // cron 每分钟巡检:执行体(Cloud Run)心跳停摆或任务超龄则判死解锁,防止项目被 409 锁死
  scheduled: (event: ScheduledController, env: Env, ctx: ExecutionContext) => {
    ctx.waitUntil(sweepJobs(env))
  },
}