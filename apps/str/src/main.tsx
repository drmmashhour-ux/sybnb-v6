import React from 'react'
import { createRoot } from 'react-dom/client'
import { ErrorBoundary } from '@platform/app/ErrorBoundary'
import '@platform/shared/theme/global.css'
import './app.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
