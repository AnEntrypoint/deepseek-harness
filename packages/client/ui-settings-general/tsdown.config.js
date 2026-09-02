import { clientBundle } from '../tsdown.client.js'

export default clientBundle(
  '@freddie/freddie-client-ui-settings-general',
  ['src/index.js', 'src/invariant.js'],
  { clientEntry: 'src/client/index.js' },
)
