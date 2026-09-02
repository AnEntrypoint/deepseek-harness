/**
 * Shared tsdown preset for UI plugin client bundles. Emits a closure-factory
 * artifact: the bundle calls window.__ModuleLoader__.load({id, factory}) and
 * resolves externals through the injected require (loader module table —
 * cordis DI entities, no globals, no import map).
 */
import { readFile } from 'node:fs/promises'
import { existsSync, globSync, readFileSync } from 'node:fs'
import { isBuiltin } from 'node:module'
import { dirname, relative, resolve as resolvePath, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { optionalStringArray } from './modules/src/client/manifest.js'
import { PLATFORM_MODULES, PRELOADED_CLIENT_EXTERNALS } from './web/src/platform.js'
import { clientBuildEnvironmentDefines } from '../../scripts/client-build-environment.js'

/**
 * Wire/type layers a client bundle may inline: browser-safe contracts
 * with no runtime identity to share (no Symbol/instanceof/singleton state).
 * Everything else under @freddie/* is either a module-table entry
 * (external) or a leak the purity gate rejects.
 */
export const INLINE_SAFE = /^@freddie\/freddie-(host-apiproxy|file-reference|session|llm|tools|brand)(\/|$)/

/**
 * Vendored framework libraries: rescoped into @freddie, so the gate below
 * would read them as plugin packages. They carry no cross-plugin runtime
 * identity to share — the framework itself is a requested module-table row
 * (external), while these are ordinary libraries a browser bundle inlines.
 */
const VENDORED_LIBRARY = /^@freddie\/(cosmokit|schemastery)(\/|$)/

/** Generated descriptor/codec contribution with no shared runtime identity. */
const GENERATED_REMOTE = /^@freddie\/freddie-[a-z0-9]+(?:-[a-z0-9]+)*\/remote$/

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
    const face = buildFace(env?.FREDDIE_BUILD_FACE)
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

function buildFace(value) {
  if (value === undefined || value === 'host' || value === 'client') return value
  throw new Error(`tsdown: --env.FREDDIE_BUILD_FACE must be host or client, received ${String(value)}`)
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
    // Real ESM: the browser loads this bundle through a native import()
    // against an import-map-resolved URL (see
    // packages/client/modules/src/client/system.js), not a CJS
    // window.__ModuleLoader__ registration — externals resolve at the
    // browser's own module-graph layer through the same import map, so no
    // synchronous require/factory wrapper is needed.
    format: 'esm',
    platform: 'browser',
    dts: false,
    // Plugin code is fetched outside a bundler's module graph, so its own
    // bundle must carry its own source map.
    sourcemap: true,
    clean: false,
    deps: {
      neverBundle: isRequested,
      // Anything NOT requested from the loader module table must inline
      // (wire/type layers, zod, clsx — every non-shared dep). An import the
      // page's import map cannot answer is a guaranteed runtime 404, so the
      // rule is the package's own request list: requested specifiers stay
      // imports, everything else is bundled.
      alwaysBundle: specifier => !isRequested(specifier),
    },
    // Bakes build-time FREDDIE_CLIENT_* values (title, brand profile, commit
    // hash) into the bundle: browser code has no real process.env, so these
    // are genuine build-time substitutions, not a runtime environment probe.
    define: clientBuildEnvironmentDefines(process.env),
    plugins: [{
      // Bundle purity gate (build-time mirror of the module-edge rules): the
      // baseline and package-specific requests stay external, inline-safe wire layers
      // inline, and every other @freddie value import is a build error — a
      // cross-plugin value import either inlines a duplicate runtime instance
      // or imports a specifier the page's import map cannot answer for this
      // package. Cross-plugin collaboration goes through cordis services
      // instead. This is a fast, clear build-time error; the import map is
      // the runtime enforcement of the same rule (an unlisted specifier
      // fails resolution at import() time), so this check is a diagnostic
      // convenience, not the sole enforcement.
      name: 'dsh-client-bundle-purity',
      resolveId(source) {
        if (!source.startsWith('@freddie/')) return null
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
    },
  }
}
