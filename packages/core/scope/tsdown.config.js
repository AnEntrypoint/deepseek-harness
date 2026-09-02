import { defineConfig } from 'tsdown'

/** Build the package root and optional invariant companion as independent bundles. */
export default defineConfig([
  {
    entry: ['src/index.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
  },
  {
    entry: ['src/invariant.js'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    // Preserve the root entry's carrier WeakMap identity across bundles.
    deps: { neverBundle: ['@freddie/freddie-scope'] },
  },
])
