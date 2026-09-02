import { clientBundle } from '../../client/tsdown.client.js'

export default clientBundle(
  '@freddie/freddie-api-gateway',
  ['src/index.js', 'src/invariant.js'],
  { clientEntry: 'src/client/index.js' },
)
