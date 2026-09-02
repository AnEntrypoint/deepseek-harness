/**
 * Build the repository's last real build artifacts: the two worker-thread
 * packages whose lib/worker.cjs is loaded by file through @yao-pkg/pkg's VFS
 * Worker hook (standalone .exe packaging), which only supports CJS-bundled
 * worker threads. Every other package ships src/ as-authored — buildless,
 * no compile step.
 */

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pnpmInvocation } from './pnpm-invocation.js'

/** Packages whose lib/ output is a genuine build artifact, not dead weight. */
const WORKER_THREAD_PACKAGES = [
  'packages/code-runtime/code-runtime-worker-thread',
  'packages/workflow/workflow-worker-thread',
]

/** Run tsdown inside one package directory. */
function buildPackage(pkgDir, environment) {
  const invocation = pnpmInvocation(['exec', 'tsdown'], environment)
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: resolve(import.meta.dirname, '..', pkgDir),
    env: environment,
    stdio: 'inherit',
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`build: ${pkgDir} exited with ${String(result.status ?? result.signal)}`)
  }
}

function main() {
  for (const pkgDir of WORKER_THREAD_PACKAGES) buildPackage(pkgDir, process.env)
  console.log(`build: built ${String(WORKER_THREAD_PACKAGES.length)} worker-thread package(s)`)
}

if (import.meta.main) main()
