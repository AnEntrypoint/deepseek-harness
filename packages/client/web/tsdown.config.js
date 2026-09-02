import { staticLinked } from '../tsdown.client.js'

export default staticLinked(
  '@freddie/freddie-client-web',
  ['src/index.js', 'src/invariant.js'],
)
