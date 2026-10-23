import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@platform/shared/theme/global.css'
import './app.css'
import { installNativeLinkHandler } from '@platform/shared/native/nativeShell'
import { App } from './App'

// Store app only: https://rides.rezekme.com links (e.g. Stripe's "payment done" return) open inside the app.
installNativeLinkHandler()

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
