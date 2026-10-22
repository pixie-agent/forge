import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import CloudflareAnalytics from './components/CloudflareAnalytics'
import { I18nProvider } from './lib/i18n'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <I18nProvider>
      <CloudflareAnalytics />
      <App />
    </I18nProvider>
  </StrictMode>
)
