#!/usr/bin/env node
/**
 * Closed-runtime JSON-RPC agent bin. Bare plugins resolve from the installed
 * runtime closure while relative plugins remain configuration-relative.
 *
 * @module @freddie/freddie-sdk-jsonrpc-demo/packaged-bin
 */

import { runJsonrpcAgent } from './runner.js'

/* v8 ignore next -- exercised through the built Python runtime carriers */
await runJsonrpcAgent(import.meta.url)
