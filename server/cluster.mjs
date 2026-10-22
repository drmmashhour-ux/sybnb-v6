// Optional multi-process entry point (scale, 2026-10-22). One Node process uses one CPU core for
// JavaScript; on an instance with several cores, run `node server/cluster.mjs` with WEB_CONCURRENCY=N
// to serve from N worker processes sharing the same port. State that must be shared already lives in
// Postgres (sessions, rate limits, the dispatch-sweep lease, wallets), so workers are interchangeable.
// Worker 1 runs the background timers; the others are started with BACKGROUND_JOBS=0.
// WEB_CONCURRENCY unset or 1: behaves exactly like `node server/index.mjs`.
import cluster from 'node:cluster'
import { availableParallelism } from 'node:os'

const requested = Number(process.env.WEB_CONCURRENCY || 1)
const workers = Math.max(1, Math.min(Number.isFinite(requested) ? Math.trunc(requested) : 1, availableParallelism() * 2, 16))

if (workers === 1 || !cluster.isPrimary) {
  await import('./index.mjs')
} else {
  const jobsFlag = new Map() // worker id -> BACKGROUND_JOBS value it was started with
  const start = (flag) => jobsFlag.set(cluster.fork({ BACKGROUND_JOBS: flag }).id, flag)
  for (let i = 0; i < workers; i++) start(i === 0 ? (process.env.BACKGROUND_JOBS ?? '1') : '0')
  cluster.on('exit', (worker, code, signal) => {
    if (process.exitCode !== undefined) return
    // replace a crashed worker with the same role, so the background jobs never stop
    const flag = jobsFlag.get(worker.id) ?? '0'
    jobsFlag.delete(worker.id)
    console.error(JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'worker_exit', code, signal, backgroundJobs: flag }))
    start(flag)
  })
  for (const sig of ['SIGTERM', 'SIGINT']) {
    process.on(sig, () => {
      process.exitCode = 0
      for (const w of Object.values(cluster.workers)) w?.process.kill(sig)
    })
  }
}
