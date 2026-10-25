/** 任务终态落定:由 agent 的 commit/fail 回调触发(见 docs/FORGE2.md) */

import type { Env, Plan } from '../types'
import { clearJobMessages, insertMessage } from './jobHelpers'
import { releaseJobCredits } from './credits'
import { langOfPayload, srv, type Lang } from './i18n'
import { clearArtifacts, DRAFT_VERSION_NO, putArtifacts } from './artifacts'
import { deleteCheckpoint } from './checkpoints'
import { logEvent } from './events'
import type { AgentRunResult, FileMap } from './agent'

interface JobRow {
  id: string
  project_id: string
  user_id: string
  type: string
  payload: string
  status: string
}

/** 任务落定结果:把产物写入「草稿」(源码树进 D1、构建产物进 R2)、补 assistant 消息。
 *  幂等:非活动任务直接忽略。这里**不再扣积分** —— 发起任务时冻结的那笔就是这次的账(见 src/lib/credits.ts)。 */
export async function commitJob(env: Env, jobId: string, body: Partial<AgentRunResult>): Promise<{ ok: boolean; version?: number; reason?: string }> {
  const db = env.DB
  // 先取任务:语言随 payload 落库,后面的报错文案要按任务发起时的语言渲染
  const job = await db
    .prepare('SELECT id, project_id, user_id, type, payload, status FROM jobs WHERE id = ?')
    .bind(jobId)
    .first<JobRow>()
  if (!job) throw new Error(srv('zh', 'commit.noJob'))
  const lang = langOfPayload(job.payload)

  const src = body.src as FileMap | undefined
  const dist = body.dist as FileMap | undefined
  if (!src || typeof src !== 'object' || !dist || typeof dist !== 'object' || !Object.keys(dist).length) {
    throw new Error(srv(lang, 'commit.incomplete'))
  }
  const entry = body.manifest?.entry || 'index.html'

  if (job.status !== 'running' && job.status !== 'pending') return { ok: true, reason: 'already-settled' }

  // 任务到此为止:追加要求的投递队列(含附件 base64)可以整批释放了
  await clearJobMessages(db, jobId)

  const payload = JSON.parse(job.payload) as { idea?: string; message?: string; resumeOf?: string }
  const prompt = String(payload.idea ?? payload.message ?? '')
  const plan = (body.plan ?? null) as Plan | null

  // 生成/对话都落到「草稿」(version_no = 0):可被后续对话反复覆盖,不产生正式版本、不动 current_version。
  // 草稿即工作副本,预览/续聊都以它为准;用户点「生成新版本」时才由 /api/projects/:id/commit 快照为正式版本。
  // 覆盖前先清空草稿目录,避免上一轮删掉的文件残留在预览里。
  const meta = await db.prepare('SELECT p.id FROM projects p WHERE p.id = ?').bind(job.project_id).first()
  if (!meta) throw new Error(srv(lang, 'commit.noProject'))

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

  // 守卫式落定:被兜底判死但回调最终到达的行允许复活交付。
  // 刻意不在这里写 checkpoint_key(增量迁移列):迁移没跑时会让整个 commit 失败(no such column)。
  // 断点对象由下面的 deleteCheckpoint 清理,残留指针不影响任何查询,cron 会兜底清空。
  const claim = await db
    .prepare(
      `UPDATE jobs SET status = 'succeeded', result_version = ?, error = NULL,
       plan_json = COALESCE(?, plan_json), files_preview = NULL, updated_at = datetime('now')
       WHERE id = ? AND status IN ('pending','running')`
    )
    .bind(DRAFT_VERSION_NO, plan ? JSON.stringify(plan) : null, jobId)
    .run()
  if (!claim.meta.changes) return { ok: true, reason: 'already-settled' }

  // 交付成功:本次断点已无用(源码树已进草稿),被续跑的旧任务断点也一并清掉。
  // R2 删除失败只影响存储占用,由 cron 的 7 天兜底清理;绝不能让「清理」把已落定的成功变失败。
  await deleteCheckpoint(env, job.project_id, jobId)
  if (payload.resumeOf) await deleteCheckpoint(env, job.project_id, payload.resumeOf)

  const name = plan?.name ?? ''
  // 优先用 agent 的交付说明(带 Markdown 的详细回复,对话体验更好);缺失时回退到简短系统文案。
  // 回退文案按任务发起时的语言渲染 —— 回调是 agent/cron 触发的,不知道用户此刻用什么语言,
  // 所以语言随 payload 落库(见 src/lib/i18n.ts)。
  const summary = typeof body.summary === 'string' ? body.summary.trim() : ''
  const assistantText =
    summary ||
    (job.type === 'generate'
      ? srv(lang, 'commit.generate', { name: name || srv(lang, 'commit.defaultAppName') })
      : srv(lang, 'commit.chat', { prompt: prompt.slice(0, 30) }))
  await insertMessage(db, job.project_id, 'assistant', assistantText)
  // 不在这里扣积分:积分在任务发起时就已经冻结(见 src/lib/credits.ts 的冻结-结算模型),
  // 成功落定即等于收费 —— 冻结那条流水就是这次的账。
  return { ok: true, version: DRAFT_VERSION_NO }
}

/**
 * 失败落定:仅活动任务才置失败,避免覆盖已达终态的任务。返回是否真的从活动态迁移到失败
 * (重放/已终态返回 false)。失败态由前端从任务快照还原成"未完成卡片 + 重试",刷新后仍在,
 * 不会出现"失败了界面上什么都没留下"的情况。
 * 真的完成迁移时退还该任务的冻结积分(失败不收费;计时/失联判死走同一条路径)。
 */
export async function markJobFailed(env: Env, jobId: string, error: string): Promise<boolean> {
  const row = await env.DB
    .prepare(
      `UPDATE jobs SET status = 'failed', error = ?, updated_at = datetime('now')
       WHERE id = ? AND status IN ('pending','running') RETURNING user_id`
    )
    .bind(error.slice(0, 300), jobId)
    .first<{ user_id: string }>()
    .catch(() => null)
  if (!row) return false
  await clearJobMessages(env.DB, jobId)
  await releaseJobCredits(env.DB, jobId, '任务未完成,已退还积分').catch(() => 0)
  await logEvent(env.DB, row.user_id, 'job_end', { jobId, status: 'failed' })
  return true
}

/** 失败落定(agent fail 回调入口)。error 为空时按任务语言给默认文案。 */
export async function failJobWith(env: Env, jobId: string, error: string): Promise<void> {
  const text = error.trim() || srv(await jobLang(env, jobId), 'job.failed')
  await markJobFailed(env, jobId, text)
}

/** 任务语言:从 payload 里取(任务发起时定的,回调时刻不知道用户此刻在用哪种语言) */
async function jobLang(env: Env, jobId: string): Promise<Lang> {
  const row = await env.DB
    .prepare('SELECT payload FROM jobs WHERE id = ?')
    .bind(jobId)
    .first<{ payload: string | null }>()
    .catch(() => null)
  return langOfPayload(row?.payload)
}

/**
 * 手动停止落定(用户点「停止」):把活动任务置为 cancelled。
 * - 立即释放项目锁(ACTIVE_STATUS_SQL 不再命中 cancelled),用户可以马上发起新任务;
 * - 不写产物,并退还发起时冻结的积分(前端提示的「已停止(未扣除积分)」由此成立);
 * - agent 侧的协作式取消只是"尽快停手";它收尾时会补一份断点快照(源码树进 R2),用户可「从断点继续」。
 *   `files_preview` 刻意不清:刷新后仍能看到最后写入的文件。它的用量照常上报 job_usage,
 *   所以"用户停掉的任务花了多少钱"在后台照样看得到;
 * - 与 commit 的竞态:commit 的落定守卫是 `WHERE status IN ('pending','running')`,先取消则
 *   迟到的 commit 只会返回 already-settled,不会把已停止的任务复活成成功。
 * 返回是否真的从活动态迁移到 cancelled(已终态/不存在返回 false)。
 */
export async function cancelJob(env: Env, jobId: string): Promise<boolean> {
  // 「已手动停止」按任务发起时的语言渲染(语言随 payload 落库,见 src/lib/i18n.ts)
  const lang = await jobLang(env, jobId)
  const res = await env.DB
    .prepare(
      `UPDATE jobs SET status = 'cancelled', error = ?, updated_at = datetime('now')
       WHERE id = ? AND status IN ('pending','running')`
    )
    .bind(srv(lang, 'job.cancelled'), jobId)
    .run()
    .catch(() => null)
  if (!res?.meta.changes) return false
  await clearJobMessages(env.DB, jobId)
  await releaseJobCredits(env.DB, jobId, '已停止,退还积分').catch(() => 0)
  return true
}
