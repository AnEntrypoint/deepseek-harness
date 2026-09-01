import { defineConfig } from 'tsdown'

/**
 * acp-agent ships TWO entries: the plugin (`index`) and the CLI `bin` (`bin`),
 * the latter referenced by package.json `bin`/`exports["./bin"]`. The root
 * tsdown builds only `src/index.js`, so this override adds `src/bin.js`.
 */
export default defineConfig({
  entry: ['src/index.js', 'src/invariant.js', 'src/bin.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
