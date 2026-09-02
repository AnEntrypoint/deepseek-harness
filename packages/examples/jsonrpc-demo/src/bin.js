#!/usr/bin/env node
/**
 * Generic JSON-RPC agent bin. External configurations own their bare plugin
 * packages; the packaged runtime uses `packaged-bin.js` instead.
 *
 * @module @freddie/freddie-sdk-jsonrpc-demo/bin
 */

import { runJsonrpcAgent } from './runner.js'

await runJsonrpcAgent()
