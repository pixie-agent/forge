import { Hono } from 'hono'
import type { Env } from './types'
import { authRoutes } from './routes/auth'
import { projectRoutes } from './routes/projects'
import { generateRoutes } from './routes/generate'
import { jobRoutes } from './routes/jobs'
import { internalRoutes } from './routes/internal'
import { adminRoutes } from './routes/admin'
import { serveRoutes } from './routes/serve'
import { sweepJobs } from './lib/jobs'

// Durable Object(每项目 × 每环境的 SQLite 库)必须从入口模块导出
export { ProjectDb } from './lib/projectDb'

const app = new Hono<{ Bindings: Env }>()

app.route('/api/auth', authRoutes)
app.route('/api/projects', projectRoutes)
app.route('/api/projects', generateRoutes)
app.route('/api/jobs', jobRoutes)
// 管理后台(只读,独立口令鉴权):跨用户查看产物
app.route('/api/admin', adminRoutes)
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