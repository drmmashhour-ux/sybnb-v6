import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@platform/app/App'
import { ErrorBoundary } from '@platform/app/ErrorBoundary'
import '@platform/shared/theme/global.css'
import { installNativeLinkHandler } from '@platform/shared/native/nativeShell'

// Rezekme Stays (owner decision 2026-10-22): the full platform app (the one on sybnb.app), built
// with the Rezekme brand and STAYS_ONLY, so guests and hosts get every stays feature. The older
// stays-only copy in this folder (App.tsx, pages/, Shell.tsx) is no longer the entry point.
// Store app only: https://stay.rezekme.com links (e.g. Stripe's "payment done" return) open inside the app.
installNativeLinkHandler()

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
