import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from '@platform/app/App'
import { ErrorBoundary } from '@platform/app/ErrorBoundary'
import '@platform/shared/theme/global.css'

// Rezekme Stays (owner decision 2026-10-22): the full platform app (the one on sybnb.app), built
// with the Rezekme brand and STAYS_ONLY, so guests and hosts get every stays feature. The older
// stays-only copy in this folder (App.tsx, pages/, Shell.tsx) is no longer the entry point.
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
