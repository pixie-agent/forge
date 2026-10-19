/**
 * 连接器在 agent 侧的落盘约定(见 docs/CONNECTORS.md §6b)。
 *
 * Worker 只在本条 dispatch 请求里带上「本轮已授权的连接器」(凭证明文);
 * 这里把它写成工作目录下的 `.forge/connectors.json`,并给提示词一段用法说明。
 *
 * 三条边界:
 *   1) `.forge` 进 SKIP_DIRS:不收集进源码树、不进产物、不写回版本库。
 *   2) 提示词明确禁止把凭证复制进 src/ 或交付说明(源码树会进 D1 与 R2)。
 *   3) 无连接器时不落盘、不加提示词 —— 行为与从前逐字一致(零回归)。
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ConnectorGrant } from './types.js'

/** 连接器在工作目录中的存放路径(相对工作目录,整体跳过收集) */
export const CONNECTOR_DIR = '.forge'
export const CONNECTOR_FILE = `${CONNECTOR_DIR}/connectors.json`

/**
 * 把本轮连接器落到 `<workspace>/.forge/connectors.json`。
 * 文件形状:{ [providerId]: { accountLabel, scopes, writable, credentials, config, hint } },
 * 与 provider 定义一一对应,agent 用 read/bash 读它即可。
 */
export async function materializeConnectors(workspace: string, grants: ConnectorGrant[] | undefined): Promise<void> {
  if (!grants?.length) return
  const payload: Record<string, Omit<ConnectorGrant, 'provider'>> = {}
  for (const g of grants) {
    payload[g.provider] = {
      accountLabel: g.accountLabel,
      scopes: g.scopes,
      writable: Boolean(g.writable),
      credentials: g.credentials,
      config: g.config,
      hint: g.hint,
    }
  }
  const abs = join(workspace, CONNECTOR_FILE)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, JSON.stringify(payload, null, 2), 'utf8')
}

/**
 * 提示词里的连接器清单:让模型一开工就知道「本轮能用哪些外部系统、怎么用、什么不能做」。
 * 每个 provider 的 `hint` 由平台 provider 定义提供(见 src/lib/connectors/providers/*)。
 */
export function connectorsBrief(grants: ConnectorGrant[] | undefined): string {
  if (!grants?.length) return ''
  const blocks = grants.map((g) => {
    const perm = g.writable ? '可写' : '只读'
    const head = `### ${g.provider}(${perm},账号:${g.accountLabel || '已授权'})`
    const hint = g.hint?.trim()
    return hint ? `${head}\n${hint}` : head
  })
  return `【本轮已为用户接好 ${grants.length} 个外部连接器,凭证与配置在 \`${CONNECTOR_FILE}\`】
${blocks.join('\n\n')}

连接器硬规则(违反会被判为交付不合格):
- 需要外部数据/能力时**优先用上面这些真实连接**,而不是编数据或写"接入后即可"的空壳。
- 凭证只在 \`${CONNECTOR_FILE}\` 里:**禁止**写进 src/ 下任何文件、禁止写进交付说明、禁止 echo 到日志。生成的应用**不得**携带任何密钥。
- **可写**连接器的每一步写操作(下单、退款、建仓库、改配置…)动手前先停下来一句话说明将要做什么、影响什么,再执行;不确定就不做,在交付说明里写清楚。
- 取不到数据(403/404/网络失败)时如实说明原因,**禁止编造**数字或结果。`
}
