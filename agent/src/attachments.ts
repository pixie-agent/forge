/**
 * 用户附件在 agent 侧的处理约定:统一的落盘目录与文件名规则,
 * 保证「提示词里列出的名字」与「工作目录里真实的文件」一一对应。
 */

import type { RunAttachment } from './types.js'

/** 附件在工作目录中的存放目录(源码收集时整体跳过,不会进交付产物) */
export const ATTACHMENT_DIR = '.attachments'

/**
 * 附件落盘名:加序号前缀避免重名,同时剥掉路径分隔与控制字符
 * (Worker 已做过一次清洗,这里是纵深防御,不信任上游)。
 */
export function attachmentFileName(raw: string, index: number): string {
  const base = (raw.split(/[\\/]/).pop() ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 120)
  return `${index + 1}-${base || 'attachment'}`
}

/** 提示词里的附件清单;图片可能是「模型直接可见」或「只能当文件读」,如实说明 */
export function attachmentsBrief(attachments: RunAttachment[], imageInputEnabled: boolean): string {
  const lines = attachments.map((a, i) => {
    const path = `${ATTACHMENT_DIR}/${attachmentFileName(a.name, i)}`
    if (a.mimeType.startsWith('image/')) {
      return imageInputEnabled
        ? `  · ${path}(图片,已作为图片输入直接提供给你,直接看图理解)`
        : `  · ${path}(图片,但当前模型不支持图片输入,你无法看到画面;如需其内容请让用户补充文字描述)`
    }
    return `  · ${path}(文本,用 read 工具读取)`
  })
  return `【用户随本次需求上传了 ${attachments.length} 个附件,已存放在工作目录下】
${lines.join('\n')}
这些是用户提供的参考材料:图片用于理解视觉风格/截图/设计稿,文本用于理解需求细节。务必先读取/理解再动手;**不要**把附件本身写进 src/ 或当成交付内容。`
}
