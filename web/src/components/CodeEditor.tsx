import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useT } from '../lib/i18n'
import type { ArtifactManifest } from '../lib/types'

interface Props {
  /** 源码树(路径→内容);非空时展示目录树 + 标签页 + 代码 */
  src: Record<string, string> | null
  /** 生成进行中 agent 最近写入的文件(实时看代码) */
  filesPreview: { path: string; content: string } | null
  manifest: ArtifactManifest | null
  streaming: boolean
  /** 该版本的源码导出(zip)链接:侧栏「下载项目」用 */
  exportHref?: string
}

/** 目录树节点(仅用于渲染,由扁平路径构建) */
interface TreeDir {
  name: string
  path: string
  dirs: TreeDir[]
  files: { name: string; path: string }[]
}

function buildTree(paths: string[]): TreeDir {
  const root: TreeDir = { name: '', path: '', dirs: [], files: [] }
  const map = new Map<string, TreeDir>([['', root]])
  for (const p of paths) {
    const parts = p.split('/')
    let dir = root
    let cur = ''
    for (let k = 0; k < parts.length - 1; k++) {
      cur = cur ? `${cur}/${parts[k]}` : parts[k]
      let child = map.get(cur)
      if (!child) {
        child = { name: parts[k], path: cur, dirs: [], files: [] }
        map.set(cur, child)
        dir.dirs.push(child)
      }
      dir = child
    }
    dir.files.push({ name: parts[parts.length - 1], path: p })
  }
  const sortRec = (d: TreeDir) => {
    d.dirs.sort((a, b) => a.name.localeCompare(b.name))
    d.files.sort((a, b) => a.name.localeCompare(b.name))
    d.dirs.forEach(sortRec)
  }
  sortRec(root)
  return root
}

/** 语法高亮的文件后缀(HTML/CSS 也按 JS 词法近似着色,足够直观) */
function langOf(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase()
  return ext
}

const KEYWORDS =
  'const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|import|from|export|default|class|extends|new|await|async|try|catch|finally|throw|typeof|instanceof|delete|in|of|void|yield|null|undefined|true|false|this|super|static|get|set|interface|type|implements|enum|public|private|readonly|as|satisfies'
const TOKEN_RE = new RegExp(
  '(\\/\\/[^\\n]*|\\/\\*[\\s\\S]*?\\*\\/|<!--[\\s\\S]*?-->)' +
    "|('(?:[^'\\\\\\n]|\\\\.)*'|\"(?:[^\"\\\\\\n]|\\\\.)*\"|`(?:[^`\\\\]|\\\\.)*`)" +
    '|\\b(' +
    KEYWORDS +
    ')\\b' +
    '|\\b(0x[0-9a-fA-F]+|\\d+(?:\\.\\d+)?)\\b',
  'g',
)

/** 轻量词法着色:注释 / 字符串 / 关键字 / 数字;其余原样。输出 React 节点,不用 innerHTML */
function highlight(code: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  let m: RegExpExecArray | null
  TOKEN_RE.lastIndex = 0
  while ((m = TOKEN_RE.exec(code)) !== null) {
    if (m[0] === '') {
      TOKEN_RE.lastIndex++
      continue
    }
    if (m.index > last) out.push(code.slice(last, m.index))
    const cls = m[1] ? 'text-gray-500' : m[2] ? 'text-emerald-300' : m[3] ? 'text-orange-300' : 'text-sky-300'
    out.push(
      <span key={i++} className={cls}>
        {m[0]}
      </span>,
    )
    last = m.index + m[0].length
  }
  if (last < code.length) out.push(code.slice(last))
  return out
}

/** 带行号 + 着色的代码块;垂直/水平滚动由外层容器统一处理 */
function CodeBlock({ content }: { content: string }) {
  const lineCount = content.length ? content.split('\n').length : 0
  const gutter = useMemo(() => Array.from({ length: lineCount }, (_, i) => i + 1).join('\n'), [lineCount])
  const body = useMemo(() => highlight(content), [content])
  return (
    <div className="flex min-h-0 flex-1 overflow-auto font-mono text-xs leading-[1.5]">
      <pre className="sticky left-0 z-10 shrink-0 select-none border-r border-gray-800 bg-gray-950 px-3 py-3 text-right text-gray-600">
        {gutter}
      </pre>
      <pre className="flex-1 whitespace-pre px-3 py-3 text-gray-300">{body}</pre>
    </div>
  )
}

/** 目录树(文件夹可折叠) */
function TreeView({
  dir,
  activeFile,
  collapsed,
  onToggle,
  onOpen,
  depth = 0,
}: {
  dir: TreeDir
  activeFile: string | null
  collapsed: Set<string>
  onToggle: (path: string) => void
  onOpen: (path: string) => void
  depth?: number
}) {
  return (
    <div>
      {dir.dirs.map((d) => {
        const isCollapsed = collapsed.has(d.path)
        return (
          <div key={d.path}>
            <button
              onClick={() => onToggle(d.path)}
              className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-xs text-gray-400 hover:bg-gray-800/60"
              style={{ paddingLeft: 6 + depth * 12 }}
            >
              <span className="text-gray-500">{isCollapsed ? '▸' : '▾'}</span>
              <span className="truncate">{d.name}</span>
            </button>
            {!isCollapsed && (
              <TreeView
                dir={d}
                activeFile={activeFile}
                collapsed={collapsed}
                onToggle={onToggle}
                onOpen={onOpen}
                depth={depth + 1}
              />
            )}
          </div>
        )
      })}
      {dir.files.map((f) => (
        <button
          key={f.path}
          onClick={() => onOpen(f.path)}
          title={f.path}
          className={`flex w-full items-center gap-1 rounded px-1.5 py-1 text-left text-xs ${
            activeFile === f.path ? 'bg-gray-800 text-gray-100' : 'text-gray-400 hover:bg-gray-800/60'
          }`}
          style={{ paddingLeft: 6 + depth * 12 + 12 }}
        >
          <span className="truncate">{f.name}</span>
        </button>
      ))}
    </div>
  )
}

/**
 * 代码视图:
 *  - 生成中:展示 agent 最近写入的文件(实时)
 *  - 完成后:目录树 + 标签页 + 行号着色代码,侧栏可「下载项目」(导出源码 zip)
 *  - 仅有构建产物清单时:列出产物文件
 */
export default function CodeEditor({ src, filesPreview, manifest, streaming, exportHref }: Props) {
  const t = useT()
  const paths = useMemo(() => (src ? Object.keys(src).sort() : []), [src])
  const tree = useMemo(() => buildTree(paths), [paths])
  const [openFiles, setOpenFiles] = useState<string[]>([])
  const [activeFile, setActiveFile] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  useEffect(() => {
    if (!paths.length) {
      setOpenFiles([])
      setActiveFile(null)
      return
    }
    setOpenFiles((prev) => {
      const kept = prev.filter((p) => paths.includes(p))
      return kept.length ? kept : [paths[0]]
    })
    setActiveFile((cur) => (cur && paths.includes(cur) ? cur : paths[0]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  function openFile(path: string) {
    setActiveFile(path)
    setOpenFiles((prev) => (prev.includes(path) ? prev : [...prev, path]))
  }

  function closeTab(path: string) {
    setOpenFiles((prev) => {
      const next = prev.filter((p) => p !== path)
      if (activeFile === path) setActiveFile(next[next.length - 1] ?? null)
      return next
    })
  }

  function toggleDir(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  // 生成中:单文件实时视图
  if (filesPreview) {
    return (
      <div className="flex h-full flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-950">
        <div className="flex shrink-0 items-center gap-2 border-b border-gray-800 px-3 py-2 font-mono text-xs text-gray-400">
          <span className="text-indigo-400">✎</span>
          <span className="truncate">{filesPreview.path}</span>
          {streaming && <span className="ml-auto animate-pulse text-indigo-400">{t('code.liveWriting')}</span>}
        </div>
        <CodeBlock content={filesPreview.content} />
      </div>
    )
  }

  if (paths.length > 0) {
    const active = activeFile && src ? src[activeFile] : ''
    return (
      <div className="flex h-full flex-col gap-3 md:flex-row">
        {/* 侧栏:目录树 + 下载 */}
        <div className="flex h-44 w-full shrink-0 flex-col overflow-hidden rounded-xl border border-gray-800 bg-gray-900 md:h-auto md:w-60">
          <div className="flex shrink-0 items-center justify-between border-b border-gray-800 px-3 py-2">
            <span className="text-xs font-medium text-gray-400">{t('code.files')}</span>
            <span className="text-xs text-gray-600">{paths.length}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-1">
            <TreeView dir={tree} activeFile={activeFile} collapsed={collapsed} onToggle={toggleDir} onOpen={openFile} />
          </div>
          {exportHref && (
            <a
              href={exportHref}
              className="flex shrink-0 items-center justify-center gap-1.5 border-t border-gray-800 px-3 py-2 text-xs text-gray-300 hover:bg-gray-800"
              title={t('code.downloadTitle')}
            >
              {t('code.download')}
            </a>
          )}
        </div>

        {/* 右侧:标签页 + 代码 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-gray-700 bg-gray-950">
          <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-gray-800 bg-gray-900/60 px-1">
            {openFiles.map((p) => (
              <div
                key={p}
                className={`group flex items-center gap-1.5 rounded-t px-2.5 py-1.5 font-mono text-xs ${
                  activeFile === p ? 'bg-gray-950 text-gray-100' : 'text-gray-400 hover:text-gray-200'
                }`}
              >
                <button onClick={() => setActiveFile(p)} title={p} className="max-w-[160px] truncate">
                  {p.split('/').pop()}
                </button>
                <button
                  onClick={() => closeTab(p)}
                  className="text-gray-600 opacity-0 transition-opacity hover:text-gray-300 group-hover:opacity-100"
                  title={t('common.close')}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          {activeFile ? <CodeBlock content={active ?? ''} /> : (
            <div className="flex flex-1 items-center justify-center text-sm text-gray-600">{t('code.pickFile')}</div>
          )}
        </div>
      </div>
    )
  }

  if (manifest) {
    const total = manifest.files.reduce((s, f) => s + f.size, 0)
    return (
      <div className="overflow-hidden rounded-xl border border-gray-700 bg-gray-950">
        <div className="flex items-center justify-between border-b border-gray-800 px-3 py-2 text-xs text-gray-400">
          <span className="font-medium">{t('code.artifacts')}</span>
          <span className="text-gray-600">
            {t('code.artifactsMeta', { entry: manifest.entry, count: manifest.files.length, size: (total / 1024).toFixed(1) })}
          </span>
        </div>
        <ul className="divide-y divide-gray-800">
          {manifest.files.map((f) => (
            <li key={f.path} className="flex items-center justify-between px-3 py-2 font-mono text-xs text-gray-400">
              <span className="truncate">{f.path}</span>
              <span className="ml-3 shrink-0 text-gray-600">{(f.size / 1024).toFixed(1)} KB</span>
            </li>
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-[400px] items-center justify-center text-sm text-gray-500">
      {t('code.empty')}
    </div>
  )
}