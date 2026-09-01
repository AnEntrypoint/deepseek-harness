/**
 * Shared tsdown preset for UI plugin client bundles. Emits a closure-factory
 * artifact: the bundle calls window.__ModuleLoader__.load({id, factory}) and
 * resolves externals through the injected require (loader module table —
 * cordis DI entities, no globals, no import map).
 */
import { readFile } from 'node:fs/promises'
import { existsSync, globSync, readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { basename, dirname, isAbsolute, relative, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { optionalStringArray } from './modules/src/client/manifest.js'
import { PLATFORM_MODULES, PRELOADED_CLIENT_EXTERNALS } from './web/src/platform.js'
import { clientBuildEnvironmentDefines } from '../../scripts/client-build-environment.ts'

/**
 * Wire/type layers a client bundle may inline: browser-safe contracts
 * with no runtime identity to share (no Symbol/instanceof/singleton state).
 * Everything else under @deepseek-ai/* is either a module-table entry
 * (external) or a leak the purity gate rejects.
 */
export const INLINE_SAFE = /^@deepseek-ai\/dsh-(host-apiproxy|file-reference|session|llm|tools|brand)(\/|$)/

/**
 * Vendored framework libraries: rescoped into @deepseek-ai, so the gate below
 * would read them as plugin packages. They carry no cross-plugin runtime
 * identity to share — the framework itself is a requested module-table row
 * (external), while these are ordinary libraries a browser bundle inlines.
 */
const VENDORED_LIBRARY = /^@deepseek-ai\/(cosmokit|schemastery)(\/|$)/

/** Generated descriptor/codec contribution with no shared runtime identity. */
const GENERATED_REMOTE = /^@deepseek-ai\/dsh-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/

/**
 * Workspace mode replaces an empty config array with the root defaults. A
 * falsey entry instead removes this package before entry resolution.
 */
const SKIP_WORKSPACE_BUILD = { entry: '' }

const REPOSITORY_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** Rebase a physical lib-relative source onto a browser URL that mirrors the repository directories. */
function browserSourcePath(source, sourcemapPath) {
  if (!source.startsWith('.')) return source
  const physicalSource = resolvePath(dirname(sourcemapPath), source)
  const repositoryPath = relative(REPOSITORY_ROOT, physicalSource).split(sep).join('/')
  return repositoryPath.startsWith('packages/') ? `../../../${repositoryPath}` : source
}

/**
 * Build the tsdown config for one UI plugin package: the node-half lib build
 * plus the browser client bundle. Client packages emit both halves during the
 * Client pass by default; packages needed for Host reflection may opt into the
 * earlier Host pass. A package-level tsdown.config.ts REPLACES the root
 * workspace layout, so the lib half must be restated here — dropping it leaves
 * the package without lib/index.js and the host Loader cannot import its node
 * half.
 * @param id - plugin id (package name), stamped into the __ModuleLoader__.load
 * handoff and onto the injected style tags.
 * @param libEntry - node-half entries, spelled at the call site so the
 * package-invariants gate can see `src/invariant.js` in each package's own
 * tsdown.config.ts (a preset-side glob hides it from the mechanical check).
 * @param options - phase placement, lib overrides, and companion Node configs.
 * @returns ENV-selected tsdown config for the current build face.
 */
export function clientBundle(id, libEntry, options = {}) {
  const lib = clientLibraryConfig(id, libEntry, options.lib)
  return ({ env }) => {
    const face = buildFace(env?.DSH_BUILD_FACE)
    const clientEntry = options.clientEntry ?? 'src/client/index.js'
    const client = clientConfig(id, clientEntry)
    const node = [lib, ...(options.companions ?? [])]
    if (face === 'host') return options.hostPhase === true ? node : [SKIP_WORKSPACE_BUILD]
    if (face === 'client') {
      return options.hostPhase === true ? [client] : [...node, client]
    }
    return [...node, client]
  }
}

/**
 * Build the tsdown config for a client library the compile shell links
 * statically (the static assembly channel: `apps/web` resolves the package
 * name, bundles the artifact, and owns the chunk layout).
 *
 * Calling this preset is what puts a package in the static assembly channel,
 * so the call sites are the roster: gates read it through
 * {@link isStaticLinkedConfig} rather than a second hand-kept list. A package on
 * this roster must not be a module-table row as well — the browser would take
 * the statically linked copy and a provider's bytes would sit unused in its
 * bundle.
 *
 * Contracts:
 * 1. every bare specifier stays an import. The shell attributes chunk bytes by
 *    `node_modules/<pkg>`, so a dependency inlined into a workspace file is
 *    attributed to no npm package and its bytes fall into the index chunk,
 *    which collapses the vendor/index cache split.
 * 2. `esm` on `platform: 'browser'` — the shell is the only consumer.
 * @param id - package name, used in tsdown diagnostics.
 * @param libEntry - emitted JavaScript entries, one bundle each: a multi-entry
 * build would emit a hash-named shared chunk that the exact `files` list
 * cannot publish.
 * @returns ENV-selected tsdown config for the Client build face.
 */
export function staticLinked(id, libEntry) {
  // Each entry names its own output file, so two entries with the same basename
  // would overwrite one artifact instead of emitting two.
  const names = new Set(libEntry.map(entry => basename(entry, '.js')))
  if (names.size !== libEntry.length) {
    throw new Error(`tsdown: ${id} entries collide on an output name: ${libEntry.join(', ')}`)
  }
  return clientOnly(libEntry.map(entry => staticLinkedConfig(id, entry)))
}

/**
 * Whether a package's tsdown configs put it in the static assembly channel.
 * The roster has no separate list: gates load each package's own
 * `tsdown.config.ts`, call it for the Client face, and ask this.
 * @param configs - configs a package's build-face function returned.
 * @returns true when at least one config was built by {@link staticLinked}.
 */
export function isStaticLinkedConfig(configs) {
  return configs.some(config => (config.plugins ?? [])
    .some(plugin => plugin.name === STATIC_LINKED_PLUGIN))
}

/**
 * Build a Client-only Node library during the Client pass.
 * @param id - Package name used in tsdown diagnostics.
 * @param libEntry - Emitted JavaScript entries.
 * @returns ENV-selected tsdown config for the Client build face.
 */
export function clientLibrary(id, libEntry) {
  const lib = clientLibraryConfig(id, libEntry)
  return clientOnly([lib])
}

/**
 * Select arbitrary package-local configs only during the Client pass.
 * @param configs - Node-side configs emitted after Client tsc.
 * @returns ENV-selected tsdown config for the Client build face.
 */
export function clientOnly(configs) {
  return ({ env }) => buildFace(env?.DSH_BUILD_FACE) === 'host'
    ? [SKIP_WORKSPACE_BUILD]
    : [...configs]
}

function buildFace(value) {
  if (value === undefined || value === 'host' || value === 'client') return value
  throw new Error(`tsdown: --env.DSH_BUILD_FACE must be host or client, received ${String(value)}`)
}

function clientLibraryConfig(id, libEntry, overrides = {}) {
  const isProductionDependency = specifier =>
    matchesSpecifier(productionExternals(id), specifier)
  return {
    name: id,
    entry: [...libEntry],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: {
      // The Node half runs from a real install: a production dependency is on
      // disk there and stays an import, everything else inlines. Stating both
      // halves takes the artifact off tsdown's getProductionDeps fallback, where
      // moving a dependency between npm sections silently re-bundles it.
      // Builtins keep tsdown's own handling (neither side claims them).
      neverBundle: isProductionDependency,
      alwaysBundle: specifier => !isBuiltin(specifier) && !isProductionDependency(specifier),
    },
    ...overrides,
  }
}

function staticLinkedConfig(id, entry, outputName = basename(entry, '.js')) {
  return {
    name: id,
    entry: { [outputName]: entry },
    outDir: 'lib',
    format: ['esm'],
    platform: 'browser',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
    plugins: [{
      // Contract 1. `pre` because tsdown's own deps plugin would otherwise
      // resolve and inline every specifier missing from the npm production
      // sections, which is the coupling this preset exists to remove. The name
      // is also the roster marker {@link isStaticLinkedConfig} reads.
      name: STATIC_LINKED_PLUGIN,
      resolveId: {
        order: 'pre',
        handler(source, importer) {
          // An entry arrives without an importer and must stay internal.
          if (importer === undefined) return null
          return isBareSpecifier(source) ? { id: source, external: true } : null
        },
      },
    }],
  }
}

/** Whether a specifier names a package rather than a file next to its importer. */
function isBareSpecifier(specifier) {
  return !specifier.startsWith('.') && !specifier.startsWith('\0') && !isAbsolute(specifier)
}

/** The manifest fields the build faces read to state their own module edges. */
const manifestCache = new Map()
const productionExternalCache = new Map()
const clientExternalCache = new Map()

/**
 * Read one workspace package's manifest. Located by package name rather than by
 * cwd, because tsdown evaluates every package config with the repository root as
 * `process.cwd()` during a workspace build. Callers read it on the first
 * resolveId of a build, not while a config is built, so selecting a build face
 * never touches a manifest.
 * @param id - package name, as spelled at the preset call site.
 * @returns the parsed manifest.
 * @throws {Error} when no workspace package declares that name.
 */
function workspaceManifest(id) {
  const cached = manifestCache.get(id)
  if (cached !== undefined) return cached
  for (const manifestPath of globSync('packages/*/*/package.json', { cwd: REPOSITORY_ROOT })) {
    const manifest = JSON.parse(readFileSync(resolvePath(REPOSITORY_ROOT, manifestPath), 'utf8'))
    if (manifest.name !== id) continue
    manifestCache.set(id, manifest)
    return manifest
  }
  throw new Error(`tsdown: no packages/*/*/package.json declares the name ${id}`)
}

/**
 * External patterns for one package's Node half: its own production sections,
 * subpaths included.
 * @param id - package name, as spelled at the preset call site.
 * @returns one `^name(/|$)` pattern per production dependency, name-sorted.
 */
function productionExternals(id) {
  const cached = productionExternalCache.get(id)
  if (cached !== undefined) return cached
  const manifest = workspaceManifest(id)
  const names = new Set([
    ...Object.keys(manifest.dependencies ?? {}),
    ...Object.keys(manifest.peerDependencies ?? {}),
    ...Object.keys(manifest.optionalDependencies ?? {}),
  ])
  const patterns = [...names].sort().map(name => new RegExp(`^${escapeSpecifier(name)}(/|$)`))
  productionExternalCache.set(id, patterns)
  return patterns
}

/**
 * Module-table specifiers one `dsh.client` declaration requests. Matching is
 * exact, never normalized: a package declares the specifier its own code
 * imports, and the loader keys static entries the same way.
 * @param subject - package name, used in diagnostics.
 * @param declaration - the package's `dsh.client` object.
 * @returns the requested specifiers, empty when the package declares none.
 * @throws {Error} when `external` is not a string array.
 */
export function requestedExternals(subject, declaration) {
  return new Set(optionalStringArray(subject, 'dsh.client.external', declaration.external) ?? [])
}

/**
 * Module-table specifiers one package requests. The shell baseline is implicit
 * for every dynamic bundle; `dsh.client.external` only adds package-specific
 * dynamic rows or subpaths.
 * @param id - package name, as spelled at the preset call site.
 * @returns the baseline plus the package's explicit requests.
 */
function clientExternals(id) {
  const cached = clientExternalCache.get(id)
  if (cached !== undefined) return cached
  const externals = new Set([
    ...PLATFORM_MODULES,
    ...PRELOADED_CLIENT_EXTERNALS,
    ...requestedExternals(id, workspaceManifest(id).dsh?.client ?? {}),
  ])
  clientExternalCache.set(id, externals)
  return externals
}

/** Escape a package name for literal use inside a RegExp source. */
function escapeSpecifier(name) {
  return name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Whether an import specifier is the package a pattern names, or one of its subpaths. */
function matchesSpecifier(patterns, specifier) {
  return patterns.some(pattern => pattern.test(specifier))
}

function clientConfig(id, entry) {
  const isRequested = specifier => clientExternals(id).has(specifier)
  return {
    name: `${id}/client`,
    entry: { client: entry },
    // Browser bundle lands next to the node half (single lib/ artifact dir;
    // the entryFileNames pin keeps it exactly lib/client.js). clean must stay
    // off — a default clean would wipe the node-half output emitted above.
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    // Plugin code is fetched outside a bundler's module graph, so its own
    // bundle must carry its own source map.
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: isRequested,
      // Anything NOT requested from the loader module table must inline
      // (wire/type layers, zod, clsx — every non-shared dep). A require() the
      // table cannot answer is a guaranteed runtime throw, so the rule is the
      // package's own request list: requested specifiers stay imports,
      // everything else is bundled.
      alwaysBundle: specifier => !isRequested(specifier),
    },
    // Browser bundles inline node-idiom deps (zustand/immer read
    // process.env.NODE_ENV; zustand's esm build also probes
    // import.meta.env.MODE, which a CJS output cannot carry — rolldown flags
    // EMPTY_IMPORT_META). tsdown inlining needs the substitutions here or the
    // factory throws ReferenceError at boot. Both keys honor the build's
    // NODE_ENV so a dev build keeps the dev-branch semantics; artifacts
    // default to production. The bare `import.meta.env` key is required
    // alongside the precise MODE key: zustand probes
    // `import.meta.env ? import.meta.env.MODE : ...`, and the truthiness
    // probe would otherwise survive as an empty import.meta.
    define: {
      ...clientBuildEnvironmentDefines(process.env),
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    plugins: [{
      // Bundle purity gate (build-time mirror of the module-edge rules): the
      // baseline and package-specific requests stay external, inline-safe wire layers
      // inline, and every other @deepseek-ai value import is a build error — a
      // cross-plugin value import either inlines a duplicate runtime instance
      // or requires a specifier the module table cannot answer for this package.
      // Cross-plugin collaboration goes through cordis services instead.
      name: 'dsh-client-bundle-purity',
      resolveId(source) {
        if (!source.startsWith('@deepseek-ai/')) return null
        if (isRequested(source)) return null // requested module-table row: external wins
        if (VENDORED_LIBRARY.test(source)) return null // vendored library: inline, no shared identity
        if (INLINE_SAFE.test(source) || GENERATED_REMOTE.test(source)) return null // wire contribution: inline is the point
        throw new Error(
          `client bundle purity: "${source}" is not in the default client externals or ${id}'s dsh.client.external, an inline-safe wire layer, or a generated /remote contribution — `
          + 'cross-plugin value imports are forbidden; declare a non-default module request or collaborate through cordis services '
          + '(type-only imports are erased and never reach this gate)',
        )
      },
    }],
    outputOptions: {
      entryFileNames: 'client.js',
      // The map is served from /plugins/<scoped-package>/client.js.map. The
      // browser resolves its local sources back into URLs that mirror the
      // /packages/<group>/<package>/src directories; sourcesContent keeps them usable
      // without exposing that tree as an HTTP route.
      sourcemapPathTransform: browserSourcePath,
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  }
}

/** Plugin name carrying contract 1, and the marker that identifies a statically linked config. */
const STATIC_LINKED_PLUGIN = 'dsh-static-linked-external'
