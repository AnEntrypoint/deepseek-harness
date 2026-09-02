# @freddie/freddie-scoped-tool-turn-context-demo

A worked, verified translation of ONE real tool from `github:AnEntrypoint/freddie`-consumer `casey`'s `case-tools.js` (`case_get`) onto deepseek-harness's tool and SDK protocol. This is a reference for a `freddie`-consumer's own migration — not a port of casey itself, which owns its domain package and migration.

## The gap this bridges

`freddie`'s `runTurn({ toolCtx, enabledToolsets, ... })` threads a per-call `toolCtx` object into every tool handler for that turn, and scopes tool visibility by named toolset category (`enabledToolsets: ['cases']`). Its consumer casey reads `ctx.author`/`ctx.principal` from that threaded argument to decide whether a caller owns the record they're asking about.

deepseek-harness has neither:

- **No threaded per-call context argument.** A tool's `execute(args, exec)` only carries `exec.agent` (the live `Agent` instance) — no caller-defined payload. `session.header` (`@freddie/freddie-session`) is a closed, fixed schema (`cwd`/`parentSession`/`seedLength`/`origin`/`delegationDepth`/`agentPreset`) that silently drops unknown fields, so it cannot carry arbitrary deployer data either.
- **No toolset-category concept.** `ctx.tools.restrict({ allow, deny })` (`@freddie/freddie-tools`) scopes visibility by individual tool NAME, agent-scoped via `agent.ctx`.

The SDK protocol (`@freddie/freddie-sdk-jsonrpc-server`) now closes both gaps:

- `session/prompt`'s `turnContext` param sets an opaque per-agent value, stored in a module-owned `WeakMap` keyed by the live `Agent` object (`turn-context.js`) — the same idiom `dsh-host-apiproxy`'s own `selectionFor` uses for its per-agent state. A tool reads it back via `turnContextFor(exec.agent)`.
- `session/prompt`'s `enabledTools`/`disabledTools` params apply `ctx.tools.restrict()` on the target agent's scope — a caller passes concrete tool NAMES in place of freddie's toolset categories.

## The translation

**freddie** (`casey/src/case-tools.js`):

```js
defTool('case_get', 'cases', description, parameters,
  async ({ id }, ctx) => {
    const author = ctx?.author || ctx?.principal?.id
    const owns = ownsCase(record.externalId, author)
    return owns ? fullRecord(record) : redactedRecord(record)
  })
```

**deepseek-harness** (this package's `src/index.js`, `record_get`):

```js
ctx.tools.register(defineTool({
  name: 'record_get',
  description, parameters,
  output: { schema, render },
  async execute(args, exec) {
    const turnContext = turnContextFor(exec.agent)
    const isOwner = owns(record.externalId, turnContext?.author)
    return { ...record fields..., owned: isOwner, detail: isOwner ? record.detail : null }
  },
}))
```

The caller side (an SDK client driving this deployment) sets `author` once per session and scopes the toolset:

```js
await session.run(prompt, {
  enabledTools: ['record_get'],
  turnContext: { author: 'whatsapp:+27-worker-a', role: 'worker', tier: 'reporter' },
})
```

## Verified live (no test files — see this repo's own testing discipline)

Booted a real `Context` with `SystemPrompt` + `ToolRuntime` + this plugin, plus `createScope` (`@freddie/freddie-scope`) to mint a real agent-scoped context matching production's `agent.ctx = scope.ctx.extend({ agent: this })`:

- `record_get` registers and resolves through `ToolRuntime.resolveExecution` — the actual dispatch gate, not just schema listing.
- No `turnContext` set → redacted projection (`owned: false`, `detail: null`).
- `turnContext.author` exactly matching the record's owner → full detail.
- A different `turnContext.author` → still redacted.
- Ownership matching is exact-colon-part, not substring: `'worker-a'` against `externalId: 'whatsapp:+27-worker-a'` is `false` (not a colon-separated part); `'+27-worker-a'` is `true` (it IS the second part) — reproducing casey's own `ownsCase` semantics exactly.
- A second, unrelated `Agent` object never inherits the first agent's `turnContext` (per-agent `WeakMap` isolation holds).
- `ctx.tools.restrict({ deny: ['record_get'] })` on an agent-scoped context hides the tool from both `tools.get()` and `tools.resolveExecution()` (the real execution gate) for that agent; the returned disposer restores visibility.

## What this package does NOT do

It is not a port of casey's 1046-line `case-tools.js`, its `CaseStore`/thatcher backend, or its dashboard. It demonstrates the ONE mechanical pattern (`ctx`-reading handler → `turnContextFor(exec.agent)`-reading `execute`) a real migration repeats per tool. A full casey migration is casey's own package and scope.
