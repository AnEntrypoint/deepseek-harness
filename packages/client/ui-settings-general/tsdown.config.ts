import { clientBundle } from '../tsdown.client.js'

export default clientBundle(
  '@deepseek-ai/dsh-client-ui-settings-general',
  ['src/index.js', 'src/invariant.js'],
  { clientEntry: 'src/client/index.js' },
)
