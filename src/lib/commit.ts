/** 任务终态落定:由 agent 的 commit/fail 回调触发(见 docs/FORGE2.md) */

import type { Env, Plan } from '../types'
import { insertMessage } from './jobHelpers'
import { deductCredit } from './credits'
import { clearArtifacts, DRAFT_VERSION_NO, putArtifacts } from './artifacts'
import type { AgentRunResult, FileMap } from './agent'

interface JobRow {
  id: string
  project_id: string
  user_id: string
  type: string
  payload: string
  status: string
}

/** 任务落定结果:把产物写入「草稿」(源码树进 D1、构建产物进 R2)、补 assistant 消息、扣积分。幂等:非活动任务直接忽略 */
export async function commitJob(env: Env, jobId: string, body: Partial<AgentRunResult>): Promise<{ ok: boolean; version?: number; reason?: string }> {
  const db = env.DB
  const src = body.src as FileMap | undefined
  const dist = body.dist as FileMap | undefined
  if (!src || typeof src !== 'object' || !dist || typeof dist !== 'object' || !Object.keys(dist).length) {
    throw new Error('产物不完整(缺源码树或构建产物)')
  }
  const entry = body.manifest?.entry || 'index.html'

  const job = await db
    .prepare('SELECT id, project_id, user_id, type, payload, status FROM jobs WHERE id = ?')
    .bind(jobId)
    .first<JobRow>()
  if (!job) throw new Error('任务不存在')
  if (job.status !== 'running' && job.status !== 'pending') return { ok: true, reason: 'already-settled' }

  const payload = JSON.parse(job.payload) as { idea?: string; message?: string }
  const prompt = String(payload.idea ?? payload.message ?? '')
  const plan = (body.plan ?? null) as Plan | null

  // 生成/对话都落到「草稿」(version_no = 0):可被后续对话反复覆盖,不产生正式版本、不动 current_version。
  // 草稿即工作副本,预览/续聊都以它为准;用户点「生成新版本」时才由 /api/projects/:id/commit 快照为正式版本。
  // 覆盖前先清空草稿目录,避免上一轮删掉的文件残留在预览里。
  const meta = await db.prepare('SELECT p.id FROM projects p WHERE p.id = ?').bind(job.project_id).first()
  if (!meta) throw new Error('项目不存在')

  await clearArtifacts(env, job.project_id, DRAFT_VERSION_NO)
  const bytes = await putArtifacts(env, job.project_id, DRAFT_VERSION_NO, dist)
  const files = Object.keys(dist)
    .map((path) => ({ path, size: new TextEncoder().encode(dist[path]).byteLength }))
    .sort((a, b) => a.path.localeCompare(b.path))
  const manifestJson = JSON.stringify({ entry, buildHash: body.manifest?.buildHash ?? '', bytes, files })

  await db.batch([
    db
      .prepare(
        `INSERT INTO versions (id, project_id, version_no, src_json, manifest_json, bytes, prompt, created_at)
         VALUES (?, ?, 0, ?, ?, ?, ?, datetime('now'))
         ON CONFLICT (project_id, version_no) DO UPDATE SET
           src_json = excluded.src_json, manifest_json = excluded.manifest_json,
           bytes = excluded.bytes, prompt = excluded.prompt, created_at = datetime('now')`
      )
      .bind(crypto.randomUUID(), job.project_id, JSON.stringify(src), manifestJson, bytes, prompt),
    // 不含 current_version:草稿不自动成为正式版本;generate 时顺带更新工作标题(名称/标语)
    job.type === 'generate' && plan
      ? db
          .prepare('UPDATE projects SET updated_at = datetime(\'now\'), name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?')
          .bind(plan.name, plan.tagline, job.project_id)
      : db.prepare("UPDATE projects SET updated_at = datetime('now') WHERE id = ?").bind(job.project_id),
  ])

  // 守卫式落定:被兜底判死但回调最终到达的行允许复活交付
  const claim = await db
    .prepare(
      `UPDATE jobs SET status = 'succeeded', result_version = ?, error = NULL,
       plan_json = COALESCE(?, plan_json), files_preview = NULL, updated_at = datetime('now')
       WHERE id = ? AND status IN ('pending','running')`
    )
    .bind(DRAFT_VERSION_NO, plan ? JSON.stringify(plan) : null, jobId)
    .run()
  if (!claim.meta.changes) return { ok: true, reason: 'already-settled' }

  const name = plan?.name ?? ''
  // 优先用 agent 的交付说明(带 Markdown 的详细回复,对话体验更好);缺失时回退到简短系统文案
  const summary = typeof body.summary === 'string' ? body.summary.trim() : ''
  const assistantText =
    summary ||
    (job.type === 'generate'
      ? `已完成「${name || '应用'}」初稿并写入草稿。满意后点「生成新版本」保存为正式版本,再发布上线。`
      : `已按「${prompt.slice(0, 30)}」更新草稿。满意后点「生成新版本」保存为正式版本。`)
  await insertMessage(db, job.project_id, 'assistant', assistantText)
  await deductCredit(db, job.user_id)
  return { ok: true, version: DRAFT_VERSION_NO }
}

/**
 * 失败落定:仅活动任务才置失败,避免覆盖已达终态的任务。返回是否真的从活动态迁移到失败
 * (重放/已终态返回 false)。失败态由前端从任务快照还原成"未完成卡片 + 重试",刷新后仍在,
 * 不会出现"失败了界面上什么都没留下"的情况。
 */
export async function markJobFailed(env: Env, jobId: string, error: string): Promise<boolean> {
  const res = await env.DB
    .prepare(`UPDATE jobs SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ? AND status IN ('pending','running')`)
    .bind(error.slice(0, 300), jobId)
    .run()
    .catch(() => null)
  return !!res?.meta.changes
}

/** 失败落定(agent fail 回调入口) */
export async function failJobWith(env: Env, jobId: string, error: string): Promise<void> {
  await markJobFailed(env, jobId, error)
}