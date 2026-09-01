/**
 * Public agent types and live-runtime events. Durable transcript facts and
 * turn/step boundaries remain `@deepseek-ai/dsh-session` events.
 *
 * This module is intentionally empty at runtime: in the TypeScript source it
 * carried only compile-time constructs (the `Agent`/`AgentOptions`/
 * `CancelOptions`/etc. interfaces and type aliases, plus `declare module`
 * augmentations of `@deepseek-ai/dsh-system-prompt`'s `AssembleContext` and
 * `@deepseek-ai/cordis`'s `Events`), none of which have a JavaScript
 * representation. The event vocabulary they documented
 * (`agent/created`, `agent/disposed`, `agent/status`, `agent/inbox/*`,
 * `agent/session-start`, `agent/pre-step`, `agent/request`,
 * `agent/request-error`, `agent/turn-stopping`, `agent/error`) is emitted at
 * runtime by the agent-loop implementation, not by this package.
 *
 * @module @deepseek-ai/dsh-agent
 */
export {}
