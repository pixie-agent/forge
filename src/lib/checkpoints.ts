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
import type { FileMap } from './agent'

const encoder = new TextEncoder()

/** 单个任务一个快照对象:后一次覆盖前一次,不按版本累积 */
export function checkpointKey(projectId: string, jobId: string): string {
  return `cp/${projectId}/${jobId}.json`
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
