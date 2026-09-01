/**
 * @deepseek-ai/dsh-client-vendor-modules — serves the vendored ESM copies of
 * every bare-specifier npm package the client bundle imports at runtime, and
 * injects the `<script type="importmap">` row that resolves those specifiers
 * to their `/vendor/` URLs.
 * @module @deepseek-ai/dsh-client-vendor-modules
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cssLinks, importMapExact, importMapPrefix, vendorPackages } from './manifest.js'

export { cssLinks, importMapExact, importMapPrefix, vendorPackages } from './manifest.js'

/** Stable Cordis plugin name. */
export const name = 'vendor-modules'

/** Service required to register the route and index injection. */
export const inject = ['webServer']

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const vendorRoot = join(packageRoot, 'vendor')

const PREFIX = '/vendor/'

const MIME_BY_EXTENSION = {
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
}
const JS_MIME = 'text/javascript; charset=utf-8'

function contentTypeFor(relPath) {
  const dot = relPath.lastIndexOf('.')
  const ext = dot === -1 ? '' : relPath.slice(dot)
  return MIME_BY_EXTENSION[ext] ?? JS_MIME
}

const serveVendor = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405)
    res.end()
    return
  }
  /* v8 ignore next -- node:http always sets url on server requests */
  const pathname = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
  if (!pathname.startsWith(PREFIX)) {
    res.writeHead(404)
    res.end()
    return
  }
  const relPath = pathname.slice(PREFIX.length)
  if (relPath.includes('..')) {
    res.writeHead(403)
    res.end()
    return
  }
  const filePath = join(vendorRoot, relPath)
  try {
    const body = await readFile(filePath)
    // The version segment is baked into the URL path itself, so a change in
    // content always ships under a new URL — immutable caching is safe.
    res.writeHead(200, {
      'content-type': contentTypeFor(relPath),
      'cache-control': 'public, max-age=31536000, immutable',
    })
    res.end(body)
  } catch {
    res.writeHead(404)
    res.end()
  }
}

function escapeHtmlAttribute(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function renderImportMap() {
  const imports = { ...importMapExact, ...importMapPrefix }
  const json = JSON.stringify({ imports }).replaceAll('<', '\\u003c')
  return `<script type="importmap">${json}</script>`
}

// @deepseek-ai/cordis-plugin-loader (vendored, host-oriented) reads
// `process.env.CORDIS_SHARED`, `process.execArgv`, and
// `process.versions.node` unconditionally in module-level or
// field-initializer code, even on the browser boot path that never actually
// takes their Node-only branches. Vite's old build erased these through a
// compile-time `define` (see the removed vite.config.ts); buildless has no
// such step, so the same three values are supplied as a runtime global here
// instead — a minimal process stand-in, not a general Node polyfill.
const PROCESS_SHIM = "<script>globalThis.process ??= { env: {}, execArgv: [], versions: { node: '0.0.0' } }</script>"

const DEFAULT_CLIENT_TITLE = 'DSH Local Build'

function renderTitle() {
  const title = escapeHtmlAttribute(process.env.DSH_CLIENT_TITLE ?? DEFAULT_CLIENT_TITLE)
  return `<title>${title}</title>`
}

/**
 * Claim the /vendor prefix route and push the import-map script tag into
 * the index injection table.
 * @param ctx - plugin context carrying the webServer service.
 */
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/vendor', handler: serveVendor }), 'vendor-modules: vendor route')
  ctx.on('webserver/index-inject', (table) => {
    table.push({
      kind: 'html',
      placement: 'head',
      html: renderTitle(),
    })
    table.push({
      kind: 'html',
      placement: 'head',
      html: PROCESS_SHIM,
    })
    table.push({
      kind: 'html',
      placement: 'head',
      html: renderImportMap(),
    })
    for (const href of cssLinks) {
      table.push({
        kind: 'html',
        placement: 'head',
        html: `<link rel="stylesheet" href="${escapeHtmlAttribute(href)}">`,
      })
    }
  })
}
