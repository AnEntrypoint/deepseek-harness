import { clientBundle } from '../../client/tsdown.client.ts'

export default clientBundle(
  '@deepseek-ai/dsh-api-remotes',
  ['src/index.js', 'src/invariant.js'],
  { hostPhase: true, clientEntry: 'src/client/index.js' },
)
