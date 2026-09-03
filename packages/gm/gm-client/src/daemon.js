/**
 * Shared gm daemon lifecycle: attach to the already-running, machine-wide
 * `agentplug-runner` if one is live, boot it via the canonical
 * `~/.gm-tools/bootstrap.js` logic otherwise. Never a second bespoke boot
 * implementation — this calls the exact function gm's own CLI calls, so a
 * `~/.gm-tools` update benefits every consumer, this plugin included.
 * @module @freddie/freddie-gm-client/daemon
 */

import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Daemon considered dead if `.status.json`'s `ts` is older than this. */
const STALE_MS = 5 * 60 * 1000

/**
 * Read `.gm/exec-spool/.status.json` if present.
 * @param cwd - project root.
 * @returns the parsed status, or undefined if absent/unreadable.
 */
export async function readStatus(cwd) {
  try {
    const text = await readFile(join(cwd, '.gm', 'exec-spool', '.status.json'), 'utf8')
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Whether the daemon looks alive: a `.status.json` with a fresh `ts` AND a
 * live process at its recorded `pid`. `ts` freshness alone (the gm skill's
 * own documented "dead watcher" signal) has a real blind spot for a daemon
 * killed moments ago — the file isn't rewritten on process death, so a
 * timestamp minutes old still reads "fresh" against a five-minute window.
 * A `process.kill(pid, 0)` liveness probe (signal 0: existence check, no
 * actual signal delivered) closes that gap cheaply.
 * @param cwd - project root.
 * @returns true when a recent status file exists and its pid is running.
 */
export async function isDaemonAlive(cwd) {
  const status = await readStatus(cwd)
  if (status === undefined || typeof status.ts !== 'number') return false
  if (Date.now() - status.ts >= STALE_MS) return false
  if (typeof status.pid !== 'number') return true
  try {
    process.kill(status.pid, 0)
    return true
  } catch {
    return false
  }
}

/**
 * Ensure the shared gm daemon is running for `cwd`, booting it via
 * `~/.gm-tools/bootstrap.js`'s own `startSpoolDaemon` when it isn't already
 * alive. A no-op when the daemon (any project's, since it's
 * `shared_process: true`) already answers fresh.
 *
 * Deliberately does NOT call `bootstrap.js`'s `ensureReady()` — that
 * function does far more than "start the daemon if needed": it also
 * rewrites the calling project's own `CLAUDE.md`/`AGENTS.md` ("next-step
 * wiring", importing a cached copy of gm's current phase prose into the
 * project's own agent docs) and makes a network call to check for a newer
 * gm-plugkit release, both real side effects a lightweight per-activation
 * daemon-ping has no business triggering. `startSpoolDaemon()` alone (spawn
 * the wrapper/supervisor, no doc rewrite, no network call) is the correct
 * scope here — gm's own CLI is the right place for the heavier `ensureReady`
 * install/wiring flow, on first install or explicit update, not this plugin.
 *
 * `startSpoolDaemon` reads `CLAUDE_PROJECT_DIR` (falling back to
 * `process.cwd()`) internally rather than taking a project-dir argument —
 * this function sets `CLAUDE_PROJECT_DIR` for the duration of the call so a
 * boot triggered by a `cwd` that isn't the current process's own working
 * directory still targets the right `.gm/exec-spool`.
 * @param cwd - project root that will own the `.gm/exec-spool` dispatch.
 * @returns `{ alreadyRunning }` after boot completes or is skipped.
 * @throws when `~/.gm-tools/bootstrap.js` is missing (gm has never been installed on this machine), or its wrapper isn't present yet (first-ever install not finished — run gm's own CLI once to complete that).
 */
export async function ensureDaemon(cwd) {
  if (await isDaemonAlive(cwd)) return { alreadyRunning: true }

  const bootstrapPath = join(homedir(), '.gm-tools', 'bootstrap.js')
  let bootstrap
  try {
    // import() requires a file:// URL for an absolute path on Windows --
    // a bare "C:\..." string is parsed as a URL with scheme "c", not a path.
    bootstrap = await import(pathToFileURL(bootstrapPath).href)
  } catch (error) {
    throw new Error(
      `gm-client: no gm installation found at ${bootstrapPath} — install gm first (see https://github.com/AnEntrypoint/gm)`,
      { cause: error },
    )
  }
  const mod = bootstrap.default ?? bootstrap
  if (!mod.isReady()) {
    throw new Error(
      `gm-client: ${bootstrapPath} is present but plugkit.wasm hasn't been fetched yet — run gm's own CLI once to finish the first-time install, then retry`,
    )
  }
  const previousProjectDir = process.env.CLAUDE_PROJECT_DIR
  process.env.CLAUDE_PROJECT_DIR = cwd
  try {
    const started = mod.startSpoolDaemon()
    if (!started.ok) {
      throw new Error(`gm-client: failed to start the gm daemon: ${started.error}`)
    }
    return { alreadyRunning: false, pid: started.pid }
  } finally {
    if (previousProjectDir === undefined) delete process.env.CLAUDE_PROJECT_DIR
    else process.env.CLAUDE_PROJECT_DIR = previousProjectDir
  }
}
