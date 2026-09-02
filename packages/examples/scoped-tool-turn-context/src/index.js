/**
 * Reference tool for a freddie ("github:AnEntrypoint/freddie") consumer
 * migrating a `toolCtx`-reading handler onto deepseek-harness's SDK
 * protocol. This is intentionally a small, worked translation of ONE real
 * pattern from casey's `case_get` (`case-tools.js`) — not a port of casey
 * itself, which owns its own domain package and migration.
 *
 * freddie shape (for comparison):
 *   defTool('case_get', 'cases', description, parameters,
 *     async ({ id }, ctx) => {
 *       const author = ctx?.author || ctx?.principal?.id
 *       const owns = ownsCase(record.externalId, author)
 *       return owns ? fullRecord(record) : redactedRecord(record)
 *     })
 * — `ctx` is a plain object freddie's `runTurn` threads through every tool
 * call for that turn (`toolCtx` in the SDK client's `run()` call).
 *
 * deepseek-harness has no threaded per-call argument for caller-defined
 * data (`session.header` is a closed, fixed schema — see
 * `@freddie/freddie-session`'s `Session.prepare`). The equivalent is
 * `turnContextFor(exec.agent)` (`@freddie/freddie-sdk-jsonrpc-server`):
 * a caller sets it once via `session/prompt`'s `turnContext` param (it
 * persists for the session until overridden — see that package's
 * `turn-context.js`), and any tool's `execute(args, exec)` reads it back
 * by the same live `Agent` object `exec.agent` already carries.
 *
 * `enabledTools`/`disabledTools` (same `session/prompt` params) are the
 * `restrict()`-backed equivalent of freddie's per-toolset `enabledToolsets`
 * — deepseek-harness has no toolset-category concept, so the caller passes
 * concrete tool NAMES instead (e.g. `['record_get', 'record_list']`).
 *
 * @module @freddie/freddie-scoped-tool-turn-context-demo
 */

import z from '@freddie/schemastery'
import { defineTool } from '@freddie/freddie-tools'
import { turnContextFor } from '@freddie/freddie-sdk-jsonrpc-server'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'scoped-tool-turn-context-demo'

/** Services required to register a model-facing tool. */
export const inject = ['tools']

export const Config = z.object({})

/**
 * A record is "owned" by `author` when their id matches the record's
 * external id exactly, or appears as one colon-separated part of it — the
 * same ownership test casey's `ownsCase` applies before deciding between a
 * full record and a PII-free projection.
 * @param externalId - the record's stored external identity.
 * @param author - the caller identity from this turn's context, or undefined.
 * @returns whether `author` owns the named record.
 */
export function owns(externalId, author) {
  if (!author) return false
  const ext = String(externalId ?? '')
  const who = String(author)
  return ext === who || ext.split(':').includes(who) || ext.endsWith(`:${who}`)
}

/** In-memory demo store standing in for casey's real CaseStore/thatcher backend. */
const demoRecords = new Map([
  ['REC-1', { id: 'REC-1', externalId: 'whatsapp:+27-worker-a', title: 'broken pump', detail: 'field notes only the owner should see' }],
])

/**
 * Register the `record_get` demo tool: fetches a record, returning the full
 * body only when this turn's `turnContext.author` owns it (matching
 * `session/prompt`'s `turnContext` param — see the module doc above), else a
 * redacted projection.
 * @param ctx - the plugin context; the tool registers as one of its effects.
 */
export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: 'record_get',
    description: 'Fetch a record by id. The caller only sees full detail for a record they own; anyone else gets a redacted summary.',
    parameters: {
      id: { type: 'string', required: true, description: 'Record id.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          id: { type: 'string', required: true },
          title: { type: 'string', required: true },
          owned: { type: 'boolean', required: true },
          detail: {
            required: true,
            oneOf: [{ type: 'string' }, { type: 'null' }],
          },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.detail === null
          ? `Record ${value.id}: "${value.title}" (redacted — not owned by this caller)`
          : `Record ${value.id}: "${value.title}"\n${value.detail}`,
      }],
    },
    async execute(args, exec) {
      const record = demoRecords.get(args.id)
      if (record === undefined) throw new Error(`no record ${args.id}`)
      // The turnContext idiom this whole package demonstrates: read by the
      // live Agent object the execution carries, set by whichever
      // session/prompt call started this turn — no threaded argument.
      const turnContext = turnContextFor(exec.agent)
      const isOwner = owns(record.externalId, turnContext?.author)
      return {
        id: record.id,
        title: record.title,
        owned: isOwner,
        detail: isOwner ? record.detail : null,
      }
    },
  }))
}
