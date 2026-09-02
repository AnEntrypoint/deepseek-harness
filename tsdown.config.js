import { defineConfig } from 'tsdown'

function isBuildFaceClient(value) {
  if (value === undefined || value === 'host') return false
  if (value === 'client') return true
  throw new Error(`tsdown: --env.FREDDIE_BUILD_FACE must be host or client, received ${String(value)}`)
}

/**
 * The ordinary workspace build bundles each package's own JavaScript source.
 * The Client pass selects packages that declare a browser bundle and lets
 * their package-local configs emit both their Node loader entry and browser
 * artifact.
 *
 * Typert artifact generation (packages/typert/generator) is no longer run
 * here: it inferred Zod validation schemas from TypeScript types, and this
 * workspace's source is buildless plain JS now, so it has nothing left to
 * analyze. The 6 packages that expose a ./typert or ./remote RPC-schema
 * export (session-reference, message-feedback, goal, commands,
 * cordis-host-runner, plugin-inventory) now hand-own a static
 * src/typert.host.js / src/typert.remote-client.js pair instead of a
 * generated one -- typert-loader and typert-registry (the real runtime RPC
 * dispatch machinery) are unaffected and keep reading whichever module the
 * package's own ./typert export points at.
 */
export default defineConfig(({ env }) => {
  const client = isBuildFaceClient(env?.FREDDIE_BUILD_FACE)
  return {
    workspace: ['vendor/*', 'packages/*/*', 'apps/cli'],
    // Most packages ship plain buildless src/*.js directly; vendor/* stays
    // TypeScript-authored (out of scope for the buildless conversion, its
    // own build stack per vendor/AGENTS.md), so the glob covers both.
    entry: client ? '' : ['src/{index,invariant,startup}.{js,ts}'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  }
})
