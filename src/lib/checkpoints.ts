/**
 * 断点快照:任务运行期间 agent 每 60s 把当前源码树整份上报,这里存进 R2。
 *
 * 为什么要存:失败 / 用户手动停止的任务原先「中间结果一并丢弃」,用户只能从头再来。
 * 有了断点,前端可以在未完成卡片上给「从断点继续」——下一轮 chat 任务直接以这份源码树为
 * 基线,agent 接着改,而不是从模板脚手架重写。
 *
 * 生命周期:
 *  - 任务成功落定(commit)→ 删除该任务的快照(产物已进草稿,断点没用了);
 *  - 失败 / 停止 → 保留 7 天,由 cron 巡检清理(见 src/lib/jobs.ts 的 sweepJobs);
 *  - 续跑成功时,被续跑的那个旧任务的快照也一并删掉(见 src/lib/commit.ts)。
 *
 * 与构建产物同用 ARTIFACTS 桶,但前缀独立(`cp/`),不会混进 p/ 的版本清理逻辑。
 */

import type { Env } from '../types'
import type { FileMap, ResumeContext } from './agent'

const encoder = new TextEncoder()

/** 单个任务一个快照对象:后一次覆盖前一次,不按版本累积 */
export function checkpointKey(projectId: string, jobId: string): string {
  return `cp/${projectId}/${jobId}.json`
}

/** HITL 门节点暂停时落盘的恢复上下文(见 docs/FORGE2.md §17.14),键独立于源码快照 */
function resumeKey(projectId: string, jobId: string): string {
  return `cp/${projectId}/${jobId}.resume.json`
}

/** 紧凑等待信息(仅 question/options/kind),单独一个小对象,供任务快照轮询廉价读取 */
function waitingKey(projectId: string, jobId: string): string {
  return `cp/${projectId}/${jobId}.waiting.json`
}

/** 人门节点在任务快照里呈现给前端的等待信息 */
export interface WaitingInfo {
  question: string
  options?: string[]
  kind: 'approve' | 'choose'
}

/** 写恢复上下文(覆盖式);失败抛错,由 /wait 处理器决定是否让任务失败 */
export async function putResume(env: Env, projectId: string, jobId: string, resume: ResumeContext): Promise<void> {
  await env.ARTIFACTS.put(resumeKey(projectId, jobId), encoder.encode(JSON.stringify(resume)), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  })
}

/** 写紧凑等待信息(与恢复上下文同落,供快照轮询) */
export async function putWaiting(env: Env, projectId: string, jobId: string, waiting: WaitingInfo): Promise<void> {
  await env.ARTIFACTS.put(waitingKey(projectId, jobId), encoder.encode(JSON.stringify(waiting)), {
    httpMetadata: { contentType: 'application/json; charset=utf-8' },
  })
}

/** 读恢复上下文;对象不存在或内容损坏返回 null */
export async function loadResume(env: Env, projectId: string, jobId: string): Promise<ResumeContext | null> {
  const obj = await env.ARTIFACTS.get(resumeKey(projectId, jobId))
  if (!obj) return null
  try {
    const value = (await obj.json()) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    return value as ResumeContext
  } catch {
    return null
  }
}

/** 读紧凑等待信息;不存在返回 null */
export async function loadWaiting(env: Env, projectId: string, jobId: string): Promise<WaitingInfo | null> {
  const obj = await env.ARTIFACTS.get(waitingKey(projectId, jobId))
  if (!obj) return null
  try {
    const value = (await obj.json()) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    return value as WaitingInfo
  } catch {
    return null
  }
}

/** 删恢复上下文与紧凑等待信息(用户已作答 / 任务被判死 / 被取消);不存在也算成功 */
export async function deleteResume(env: Env, projectId: string, jobId: string): Promise<void> {
  await Promise.all([
    env.ARTIFACTS.delete(resumeKey(projectId, jobId)).catch(() => {}),
    env.ARTIFACTS.delete(waitingKey(projectId, jobId)).catch(() => {}),
  ])
}

export interface CheckpointMeta {
  key: string
  files: number
  bytes: number
}

/** 写入快照(覆盖式),返回文件数与字节数;失败时抛错,由调用方决定是否忽略 */
export async function putCheckpoint(
  env: Env,
  projectId: string,
  jobId: string,
  source: FileMap,
): Promise<CheckpointMeta> {
  const key = checkpointKey(projectId, jobId)
  const body = encoder.encode(JSON.stringify(source))
  await env.ARTIFACTS.put(key, body, { httpMetadata: { contentType: 'application/json; charset=utf-8' } })
  return { key, files: Object.keys(source).length, bytes: body.byteLength }
}

/** 读取快照;对象不存在或内容损坏返回 null */
export async function loadCheckpoint(env: Env, projectId: string, jobId: string): Promise<FileMap | null> {
  const obj = await env.ARTIFACTS.get(checkpointKey(projectId, jobId))
  if (!obj) return null
  try {
    const value = (await obj.json()) as unknown
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    return value as FileMap
  } catch {
    return null
  }
}

/** 删除快照;不存在也算成功 */
export async function deleteCheckpoint(env: Env, projectId: string, jobId: string): Promise<void> {
  await env.ARTIFACTS.delete(checkpointKey(projectId, jobId)).catch(() => {})
}
