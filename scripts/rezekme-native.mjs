#!/usr/bin/env node
// Build a Rezekme store app's web bundle and copy it into its native (Capacitor) projects.
//
//   npm run native:stay              -> Rezekme Stays  (com.rezekme.stay)   native/rezekme-stay/{android,ios}
//   npm run native:rides             -> Rezekme Rides  (com.rezekme.rides)  native/rezekme-rides/{android,ios}
//
// Options (after `--`, e.g. `npm run native:stay -- --android`):
//   --android / --ios   sync only that platform (default: Android, plus iOS when run on a Mac)
//   --no-build          skip the web build (re-sync the last build)
//
// What it does:
//   1. builds the web app with the LIVE API as an absolute URL (inside the app the page origin is
//      capacitor://localhost / https://localhost, so a relative or localhost API would never work);
//   2. removes the 113 MB promo videos from the bundle (the app loads them from the website instead);
//   3. refuses to continue if the bundle still points at a localhost API;
//   4. runs `cap sync` for that app only (CAP_APP=..., see capacitor.config.ts).
// Env overrides: VITE_API_BASE_URL (default https://rezekme-api.onrender.com), VITE_PUBLIC_WEB_URL.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname || new URL('.', import.meta.url).pathname, '..')
const APPS = {
  stay: { slug: 'rezekme-stay', web: 'https://stay.rezekme.com', name: 'Rezekme Stays' },
  rides: { slug: 'rezekme-rides', web: 'https://rides.rezekme.com', name: 'Rezekme Rides' },
}

const [which, ...flags] = process.argv.slice(2)
const app = APPS[which]
if (!app) {
  console.error('Usage: node scripts/rezekme-native.mjs <stay|rides> [--android] [--ios] [--no-build]')
  process.exit(2)
}
const onlyAndroid = flags.includes('--android')
const onlyIos = flags.includes('--ios')
const platforms = onlyAndroid || onlyIos
  ? [onlyAndroid && 'android', onlyIos && 'ios'].filter(Boolean)
  : process.platform === 'darwin' ? ['android', 'ios'] : ['android']

const api = (process.env.VITE_API_BASE_URL || 'https://rezekme-api.onrender.com').replace(/\/+$/, '')
const web = (process.env.VITE_PUBLIC_WEB_URL || app.web).replace(/\/+$/, '')
if (!/^https:\/\/[^/]+$/.test(api)) {
  console.error(`VITE_API_BASE_URL must be an absolute https origin for a store build (got "${api}").`)
  process.exit(2)
}

function run(cmd, args, env = {}) {
  console.log(`\n$ ${[cmd, ...args].join(' ')}`)
  const r = spawnSync(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, ...env }, shell: process.platform === 'win32' })
  if (r.status !== 0) {
    console.error(`\nFailed: ${cmd} ${args.join(' ')}`)
    process.exit(r.status || 1)
  }
}

function filesUnder(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...filesUnder(p))
    else out.push(p)
  }
  return out
}

const dist = join(ROOT, 'dist-apps', app.slug)
if (!flags.includes('--no-build')) {
  run('npm', ['run', `build:${app.slug}`], {
    VITE_API_BASE_URL: api,
    VITE_PUBLIC_WEB_URL: web,
    VITE_MEDIA_BASE_URL: process.env.VITE_MEDIA_BASE_URL || web,
  })
  rmSync(join(dist, 'assets', 'videos'), { recursive: true, force: true })
}
if (!existsSync(join(dist, 'index.html'))) {
  console.error(`No web build at ${dist}. Run without --no-build.`)
  process.exit(1)
}

// Guard: the native bundle must call the live API, never the localhost dev default.
const js = filesUnder(dist).filter((f) => f.endsWith('.js'))
const all = js.map((f) => readFileSync(f, 'utf8')).join('\n')
if (all.includes('127.0.0.1:3051')) {
  console.error('The bundle still contains the localhost API (127.0.0.1:3051). VITE_API_BASE_URL was not applied; not syncing.')
  process.exit(1)
}
if (!all.includes(api)) {
  console.error(`The bundle does not contain ${api}; not syncing.`)
  process.exit(1)
}
const mb = (filesUnder(dist).reduce((n, f) => n + statSync(f).size, 0) / 1e6).toFixed(1)
console.log(`\nWeb bundle OK: ${dist} (${mb} MB), API ${api}, public web ${web}`)

for (const platform of platforms) {
  run('npx', ['cap', 'sync', platform], { CAP_APP: app.slug })
}

console.log(`
${app.name} is synced (${platforms.join(' + ')}). Next, on the Mac:
  Android: open native/${app.slug}/android in Android Studio, or
           cd native/${app.slug}/android && ./gradlew bundleRelease
           -> app/build/outputs/bundle/release/app-release.aab
  iOS:     open native/${app.slug}/ios/App/App.xcworkspace in Xcode -> Product > Archive
See docs/REZEKME_STORE_READINESS.md.`)
