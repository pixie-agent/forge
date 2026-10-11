import { useState } from 'react'
import { api } from '../lib/api'

/** 管理后台独立口令登录(与普通用户体系隔离) */
export default function AdminLogin({ onSuccess }: { onSuccess: () => void }) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!password) return
    setBusy(true)
    setError('')
    try {
      await api('/api/admin/login', { method: 'POST', body: { password } })
      onSuccess()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 px-4 text-gray-100">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl border border-gray-800 bg-gray-900 p-6">
        <h1 className="mb-1 text-lg font-semibold">管理后台</h1>
        <p className="mb-5 text-xs text-gray-500">输入管理员口令,查看全部用户的产物</p>
        <input
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="管理员口令"
          className="mb-3 w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />
        {error && <div className="mb-3 rounded-lg bg-red-500/10 px-3 py-2 text-xs text-red-400">{error}</div>}
        <button
          disabled={busy || !password}
          className="w-full rounded-xl bg-indigo-600 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
        >
          {busy ? '登录中…' : '登录'}
        </button>
      </form>
    </div>
  )
}