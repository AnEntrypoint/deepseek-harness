/**
 * Renderer host / session provide-bundle plumbing. Converted from React
 * Context (createContext/useContext) to plain values threaded explicitly
 * through scoped-slots.tsx's render calls — webjsx has no context mechanism,
 * so every former `useHost()`/`useSessionMaybeProvideInfo()` call site now
 * receives its `host`/`info` as an ordinary function parameter instead.
 * `observableHook` stays as a per-source-cached SNAPSHOT READER (no
 * subscription of its own): a registrant custom element that needs to
 * re-render on source changes subscribes to `source.subscribe` itself in its
 * own `connectedCallback` (the Toast.tsx/CodeBlock.tsx pattern) — this module
 * only binds the read side once per source so repeated calls share one
 * cached reader instead of re-wrapping the source every render.
 */
import type {
  HostObservable, MaybeSnapshotSelectorHook, SessionMaybeProvideInfo, SessionProvideInfo,
  SlotRendererHost, SnapshotSelectorHook,
} from '@deepseek-ai/dsh-client-ui-slots'
import { bindSnapshotSelector } from './bind.ts'

/**
 * A missing-provider assembly error: the shell wired the tree wrong. The
 * per-entry crash boundary rethrows this class so misassembly stays
 * fail-loud while registrant errors (inject factories, entry components) are
 * contained per entry.
 */
export class SlotAssemblyError extends Error {}

/**
 * Identity-stable selector reader per host observable, cached by source
 * identity (sources are host-owned singletons) so repeated binds across
 * renders share one reader instance rather than re-wrapping.
 * @param source - host-provided observable.
 * @returns the cached selector reader.
 */
export function observableHook<T>(source: HostObservable<T>): SnapshotSelectorHook<T> {
  let hook = hookCache.get(source)
  if (hook === undefined) {
    hook = bindSnapshotSelector(source)
    hookCache.set(source, hook)
  }
  return hook as SnapshotSelectorHook<T>
}
const hookCache = new WeakMap<object, unknown>()

const absentSource: HostObservable<undefined> = {
  getSnapshot: () => undefined,
  subscribe: () => () => {},
}

/** Bind a source that disappears with the current session to an optional selector reader. */
export function maybeObservableHook<T>(source: HostObservable<T> | undefined): MaybeSnapshotSelectorHook<T> {
  if (source !== undefined) return observableHook(source)
  return useAbsentSnapshot
}

function useAbsentSnapshot<S>(_selector: (snapshot: never) => S, _equal?: (a: S, b: S) => boolean): S | undefined {
  observableHook(absentSource)(() => undefined)
  return undefined
}

/**
 * The useProjection framework seat (docs/subsystems/session-projection.md),
 * one bound function per provide bundle (cached by info identity). Key-
 * addressed: the key resolves a per-session value face off the projection
 * store; the bound selector reader comes from the same per-source cache as
 * every other kit reader. A key no baseline or frame has carried (or a
 * no-session bundle) reads `undefined` — capability absence.
 */
export function projectionHook(info: SessionMaybeProvideInfo): (
  key: string, selector?: (value: unknown) => unknown, eq?: (a: unknown, b: unknown) => boolean,
) => unknown {
  let hook = projectionHookCache.get(info)
  if (hook === undefined) {
    hook = (key, selector, eq) => {
      const useValue = observableHook(info.projections?.faceOf(key) ?? absentSource)
      return useValue(selector ?? (value => value), eq)
    }
    projectionHookCache.set(info, hook)
  }
  return hook
}
const projectionHookCache = new WeakMap<SessionMaybeProvideInfo, (
  key: string, selector?: (value: unknown) => unknown, eq?: (a: unknown, b: unknown) => boolean,
) => unknown>()

/**
 * Read the current-session-optional bundle directly off the host — the
 * former `useSessionMaybeProvideInfo()` context read is now a plain
 * synchronous snapshot read at whatever render call site needs it.
 * @param host - the renderer host.
 * @returns the current bundle.
 */
export function currentSessionMaybeProvideInfo(host: SlotRendererHost): SessionMaybeProvideInfo {
  return observableHook(host.sessions.provideInfo)(s => s)
}

/**
 * Read the current strict session bundle; throws when no session is current
 * (strict session slots must not render without one — same contract the
 * React `useSessionProvideInfo` hook enforced).
 * @param host - the renderer host.
 * @returns the current strict bundle.
 */
export function currentSessionProvideInfo(host: SlotRendererHost): SessionProvideInfo {
  const info = currentSessionMaybeProvideInfo(host)
  if (info.sessionId === undefined) throw new SlotAssemblyError('strict session slot rendered without a session')
  return info as SessionProvideInfo
}

/** SessionProvider API: render-prop body plus the no-session branch. */
export interface SessionProviderProps {
  /** No-session body (also covers a current id whose session cannot be resolved). */
  empty?: (() => unknown) | undefined
  /** Session body; called fresh per session id. */
  children: (sessionId: string) => unknown
}

/**
 * Framework-wired session area component factory: reads the host's current
 * provide source and hands the body function to `children(sessionId)`. Bound
 * per host (a stable reference per renderer instance, matching the old
 * module-level React component's stable-identity contract) so registrants
 * still receive a plain single-argument `SessionProvider` component on their
 * composed props — `standardKit` in scoped-slots.tsx calls this once per
 * host and caches nothing further, since the returned closure is cheap and
 * host identity is itself stable for the renderer's lifetime.
 * @param host - the renderer host.
 * @returns the bound SessionProvider component.
 */
const sessionProviderCache = new WeakMap<SlotRendererHost, (props: SessionProviderProps) => unknown>()

export function sessionProviderFor(host: SlotRendererHost): (props: SessionProviderProps) => unknown {
  let bound = sessionProviderCache.get(host)
  if (bound === undefined) {
    bound = (props) => {
      const info = currentSessionMaybeProvideInfo(host)
      const id = info.sessionId
      if (id === undefined) return props.empty?.() ?? null
      return props.children(id)
    }
    sessionProviderCache.set(host, bound)
  }
  return bound
}
