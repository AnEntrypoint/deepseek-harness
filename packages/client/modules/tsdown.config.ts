import { clientBundle } from '../tsdown.client.js'

export default clientBundle(
  '@deepseek-ai/dsh-client-modules',
  ['src/index.js', 'src/invariant.js'],
)
