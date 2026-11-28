/**
 * 一次性 LLM 补全(后台「AI 编排助手」用):绕开 pi 的 coding 会话,直连已配置的网关做一次
 * system + user 补全。密钥/方言/模型都来自 config(与 /run 同一套 env),不新增任何密钥面。
 * 见 docs/FORGE2.md §17.15。
 */

import type { AgentConfig } from './config.js'

export interface CompleteOpts {
  system?: string
  prompt: string
  maxTokens?: number
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object'
}

/** 从 content 数组里取文本片段(Anthropic 的 content 是 [{type:'text',text}] 结构) */
function pickTextParts(content: unknown): string {
  if (!Array.isArray(content)) return ''
  return content
    .map((p) => (isRecord(p) && p.type === 'text' && typeof p.text === 'string' ? p.text : ''))
    .join('')
}

/** 从响应体抽出补全文本,兼容 anthropic-messages 与 openai-completions 两种形状 */
function extractText(data: unknown): string {
  if (!isRecord(data)) return ''
  const anthropic = pickTextParts(data.content)
  if (anthropic) return anthropic
  const choice = (data.choices as { message?: { content?: unknown } }[] | undefined)?.[0]?.message?.content
  if (typeof choice === 'string') return choice
  return pickTextParts(choice)
}

/** 尽量透出上游错误信息;没有则回退原始响应片段 */
function extractError(data: unknown, raw: string): string {
  if (isRecord(data)) {
    const err = data.error
    const msg = isRecord(err) && typeof err.message === 'string'
      ? err.message
      : typeof data.message === 'string'
        ? data.message
        : typeof err === 'string'
          ? err
          : ''
    if (msg.trim()) return msg.trim().slice(0, 300)
  }
  return raw.slice(0, 200)
}

export async function completeText(config: AgentConfig, opts: CompleteOpts): Promise<string> {
  const baseUrl = config.llm.baseUrl.replace(/\/+$/, '')
  const maxTokens = Math.min(config.maxTokens, Math.max(256, Math.round(opts.maxTokens ?? 4096)))
  const system = opts.system?.trim() || undefined

  // Anthropic 兼容方言(@anthropic-ai/sdk 约定:baseURL + /v1/messages)
  if (config.llmApi === 'anthropic-messages') {
    const res = await fetch(`${baseUrl}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.llm.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: config.modelId,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: [{ role: 'user', content: opts.prompt }],
      }),
    })
    const raw = await res.text()
    let data: unknown = null
    try {
      data = JSON.parse(raw)
    } catch {
      // 非 JSON 错误体,extractError 会回退到 raw
    }
    if (!res.ok) throw new Error(`LLM 调用失败(${res.status}): ${extractError(data, raw)}`)
    const text = extractText(data)
    if (!text) throw new Error('LLM 返回为空')
    return text
  }

  // OpenAI 兼容方言(默认):baseURL + /chat/completions
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.llm.apiKey}`,
    },
    body: JSON.stringify({
      model: config.modelId,
      max_tokens: maxTokens,
      messages: [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content: opts.prompt }],
    }),
  })
  const raw = await res.text()
  let data: unknown = null
  try {
    data = JSON.parse(raw)
  } catch {
    // 非 JSON 错误体
  }
  if (!res.ok) throw new Error(`LLM 调用失败(${res.status}): ${extractError(data, raw)}`)
  const text = extractText(data)
  if (!text) throw new Error('LLM 返回为空')
  return text
}
