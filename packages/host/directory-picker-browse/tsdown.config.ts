import { defineConfig } from 'tsdown'

/** Node-only backend: listing and creation primitives over the host filesystem. */
export default defineConfig([
  {
    entry: ['src/index.js', 'src/invariant.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
])
