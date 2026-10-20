// Loads a TypeScript/TSX module for node:test by bundling it with esbuild (already a dev dependency of vite).
// Used only by the admin console unit tests; React and ReactDOM stay external so the repo's copy is used.
import { buildSync } from 'esbuild'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export async function loadTs(entry, { dev = false } = {}) {
  const out = buildSync({
    entryPoints: [resolve(entry)], bundle: true, write: false, format: 'esm', platform: 'node', jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react-dom/server'],
    define: { 'import.meta.env': JSON.stringify({ DEV: dev, VITE_ADMIN_FIXTURES: dev ? '1' : '' }) },
    logLevel: 'silent',
  })
  // Inside node_modules so the bundle's bare `react` imports resolve to the repo's own copy.
  const base = resolve('node_modules', '.cache', 'adm-ts')
  mkdirSync(base, { recursive: true })
  const dir = mkdtempSync(join(base, 'b-'))
  const file = join(dir, 'm.mjs')
  // Resolve bare imports (react) from the repo, not from the temp dir.
  writeFileSync(file, out.outputFiles[0].text)
  return import(pathToFileURL(file).href + `?t=${Date.now()}`)
}
