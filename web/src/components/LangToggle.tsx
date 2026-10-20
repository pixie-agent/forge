import { LANG_OPTIONS, useI18n } from '../lib/i18n'

/** 中/英切换按钮:显示「另一种语言」的短名,点一下切过去(两种语言时比下拉更省事) */
export default function LangToggle() {
  const { lang, setLang, t } = useI18n()
  const next = LANG_OPTIONS.find((o) => o.code !== lang) ?? LANG_OPTIONS[0]
  return (
    <button
      onClick={() => setLang(next.code)}
      title={t('common.language')}
      aria-label={t('common.language')}
      className="flex h-7 items-center justify-center rounded-full border border-gray-700 px-2 text-xs text-gray-300 hover:bg-gray-800"
    >
      {next.label}
    </button>
  )
}
