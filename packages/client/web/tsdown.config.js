import { staticLinked } from '../tsdown.client.js'

export default staticLinked(
  '@deepseek-ai/dsh-client-web',
  ['src/index.js', 'src/invariant.js'],
)
