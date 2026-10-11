import { Link } from 'react-router-dom'
import ThemeToggle from './ThemeToggle'

/** 管理后台顶栏:标题 + 退出 */
export default function AdminBar({ subtitle }: { subtitle?: string }) {
  async function logout() {
    await fetch('/api/admin/logout', { method: 'POST' }).catch(() => {})
    location.href = '/admin'
  }

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-gray-800 bg-gray-950 px-4">
      <div className="flex min-w-0 items-center gap-3">
        <Link to="/admin" className="shrink-0 font-semibold">
          Forge 管理后台
        </Link>
        {subtitle && <span className="truncate text-sm text-gray-500">{subtitle}</span>}
      </div>
      <div className="flex shrink-0 items-center gap-3 text-sm">
        <ThemeToggle />
        <Link to="/" className="text-gray-400 hover:text-gray-200">
          返回应用
        </Link>
        <button
          onClick={logout}
          className="rounded-lg border border-gray-700 px-3 py-1.5 text-gray-400 hover:border-red-500/50 hover:text-red-400"
        >
          退出
        </button>
      </div>
    </header>
  )
}