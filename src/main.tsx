import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { ErrorBoundary } from './app/ErrorBoundary'
import './shared/theme/global.css'

// Standalone SR / STR app variants (Android flavors append SYBNBMode/<mode> to the user agent):
// open straight into that service when no route is set.
const modeMatch = /SYBNBMode\/(sr|str)/.exec(navigator.userAgent)
if (modeMatch && !window.location.hash.replace(/^#/, '').replace(/^\//, '')) {
  window.location.hash = modeMatch[1] === 'sr' ? '/ride' : '/stays'
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)
