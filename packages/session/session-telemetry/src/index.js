/**
 * SessionTelemetryBackend Service Definition for the DeepSeek Harness.
 *
 * This package owns the CAPTURE side of session-event reporting — which records
 * exist (the chunk projection), what they carry (the logical record), when
 * they are captured (adoption, the per-append firehose, lifecycle
 * forwarding), live versus on-demand canonical-log capture, and the HMR
 * cursor. Everything downstream of
 * {@link SessionTelemetryBackend.emit} — batching, retry, queueing, and loss policy — is the
 * reporting SDK's territory and is deliberately not modelled here. The
 * design and its trade-offs are pinned in
 * .agents/notes/implemented/feature/2026-07-23-session-telemetry-otel-revival.md.
 *
 * @module @deepseek-ai/dsh-session-telemetry
 */

import { Service } from '@deepseek-ai/cordis'

/**
 * Severity of a telemetry record, pre-mapped at capture so a receiver can
 * alert with zero configuration: `error` for events whose own outcome flag
 * says so (the tool-result block's `isError`, `turn/end` error reasons) and for
 * `agent-error` operational records. Captured events otherwise default to
 * `info`; `warn` remains available to `session-telemetry/record` policies and
 * backends.
 */

/**
 * One logical record handed to a backend — the capture contract's whole outbound
 * vocabulary. Ledger records mirror session-log events one-to-one;
 * operational records (`channel: 'ops'`) carry the two signals with no log
 * home (`agent-error`, `shutdown`) and deliberately omit `event.seq`-style
 * identity so they can never be mistaken for ledger rows.
 *
 * Shape:
 * - channel: 'ledger' | 'ops' — Ledger (session-log mirror) or ops (operational signal) channel; backends keep the two under separate instrumentation scopes.
 * - time: number — Unix epoch milliseconds — the source event's append time for ledger records, the emission time for ops records.
 * - severity: 'info' | 'warn' | 'error' — Pre-mapped alerting severity.
 * - attributes: Record<string, string | number> — Identity attributes, deliberately minimal: ledger records carry
 *   `session.id`, `event.type`, `event.seq`, plus `session.cwd` /
 *   `session.parent_id` / `session.seed_length` when the header has them;
 *   ops records carry `telemetry.op`, `session.id`, and (for `agent-error`)
 *   `agent.id`, `turn`, `step`, `error.name`. Anything recoverable from the
 *   body is intentionally NOT duplicated here.
 * - body: unknown — The complete payload: a deep copy of the session event's `data` for
 *   ledger records (JSON-serializable by `Session.append`'s own
 *   validation), or the op payload for ops records. Never mutated after
 *   handoff.
 */

/**
 * The minimum backend contract the coordinator requires. {@link SessionTelemetryBackend} is
 * its service-registered form; tests compose the coordinator with a bare
 * implementation of this interface.
 *
 * Contract:
 * - emit(record): Hand one record to the backend's pipeline. MUST be a non-blocking
 *   enqueue — the coordinator calls this synchronously from the
 *   `session/event` hot path or an explicit canonical-log capture, so anything
 *   slower than a queue push would tax the agent loop or feedback handling.
 *   Errors thrown here are contained by the coordinator and logged; they
 *   never reach the loop.
 * - flush?(): Optional hint that a turn ended. A backend may forward it to its SDK's
 *   flush so records are exported after each turn. Called
 *   fire-and-forget; implementations must not block and must not throw
 *   meaningfully (the coordinator contains exceptions). Most backends should
 *   leave this unimplemented and let their SDK's own batching cadence govern
 *   export timing: a backend that does implement it owns the interaction
 *   between its concurrent flushes and `shutdown`'s drain (the OTel
 *   backend leaves it unimplemented for exactly that hazard — see the
 *   revival Agent Note).
 * - shutdown(): Forward the fiber's disposal to the SDK: flush whatever is queued and
 *   reach quiescence, per the SDK's own shutdown contract. Everything
 *   emitted before this call must still be delivered — including records
 *   enqueued while a `flush` hint is in flight, so a backend whose SDK
 *   guards against concurrent flushes orders behind the outstanding one (the
 *   coordinator emits its dispose-time `shutdown` markers immediately before
 *   calling this). Awaited by the coordinator's dispose; a rejection is
 *   logged as a warning and never fails application teardown.
 *   The coordinator captures dispose-time shutdown markers immediately before
 *   this call for live capture; on-demand capture creates no ops records.
 *   Returns a Promise that resolves when the backend's pipeline has quiesced.
 */

/**
 * Deployment-selected session-sharing policy disclosed by a mounted
 * {@link SessionTelemetryBackend} backend to human-facing acknowledgement surfaces (the
 * `/feedback` command's confirmation text). The seam owns the vocabulary so
 * any backend can disclose a policy without depending on the OTel package;
 * the values mirror the OTel backend's serialized `SessionTelemetryMode` choices.
 * One of: 'full' | 'feedback-only' | 'disabled'
 */

/**
 * Loadable form of the backend contract: one implementation per context —
 * the cordis `Service` registration under the `telemetry` key throws on a
 * duplicate, cordis' standard behavior. A backend composes a
 * {@link SessionTelemetryCoordinator} in its constructor to install the capture side.
 *
 * Subclasses must implement:
 * - `sharing` (readonly) — deployment-selected session-sharing policy, disclosed for
 *   acknowledgement surfaces that report whether recorded feedback leaves the process.
 * - `emit(record)` — see the sink contract above; that declaration is the contract's one home.
 * - `shutdown()` — see the sink contract above.
 *
 * `flush()` is optional; see the sink contract above.
 */
export class SessionTelemetryBackend extends Service {
  constructor(ctx) {
    super(ctx, 'sessionTelemetry')
  }
}

export { SessionTelemetryCoordinator } from './coordinator.js'
