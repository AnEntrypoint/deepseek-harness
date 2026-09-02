import { clientBundle } from '../tsdown.client.js'

export default clientBundle(
  '@freddie/freddie-client-modules',
  ['src/index.js', 'src/invariant.js'],
)
