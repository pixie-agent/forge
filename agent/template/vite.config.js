import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// base './' 产出相对路径资源;产物由平台托管在同源子路径下(见 src/routes/serve.ts)

/**
 * 产物语言:agent 在构建时用 FORGE_LOCALE 传进来(见 agent/src/runner.ts)。
 * 写进 <html lang> —— 屏幕阅读器与浏览器翻译提示在**首屏**就能拿到正确语言。
 * (运行时的 setLocale 也会改,但那时首屏 HTML 已经到了。)
 */
const LOCALE = process.env.FORGE_LOCALE === 'en' ? 'en' : 'zh-CN'

function htmlLang() {
  return {
    name: 'forge-html-lang',
    transformIndexHtml(html) {
      if (/<html[^>]*\slang="[^"]*"/i.test(html)) {
        return html.replace(/<html([^>]*)\slang="[^"]*"/i, `<html$1 lang="${LOCALE}"`)
      }
      return html.replace(/<html/i, `<html lang="${LOCALE}"`)
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), htmlLang()],
  build: { outDir: 'dist', emptyOutDir: true },
})