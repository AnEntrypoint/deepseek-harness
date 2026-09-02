import { defineConfig } from 'tsdown'

/** Node-only backend; the Win32 dialog worker spawns directly from src/, no separate build. */
export default defineConfig({
  entry: ['src/index.js', 'src/invariant.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
