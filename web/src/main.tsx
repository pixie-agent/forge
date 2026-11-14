import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import CloudflareAnalytics from './components/CloudflareAnalytics'
import { I18nProvider } from './lib/i18n'
// 自托管字体(不请求 Google CDN):Inter 为全局无衬线,Playfair Display + Noto Serif SC
// 是「Atelier」主题的衬线展示字体;Noto Serif SC 按 unicode-range 切片,只下载用到的字形。
import '@fontsource/inter/400.css'
import '@fontsource/inter/500.css'
import '@fontsource/inter/600.css'
import '@fontsource/playfair-display/500.css'
import '@fontsource/playfair-display/500-italic.css'
import '@fontsource/playfair-display/600.css'
import '@fontsource/noto-serif-sc/600.css'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <CloudflareAnalytics />
      <App />
    </I18nProvider>
  </StrictMode>
)
