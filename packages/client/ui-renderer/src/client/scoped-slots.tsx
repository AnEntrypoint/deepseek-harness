/**
 * webjsx renderer for declarative slots. Per-entry bindings enforce child
 * authorization, and entry boundaries contain registrant failures.
 *
 * Converted from React to webjsx (see docs on each outlet class below for the
 * concrete pattern each replaces): HostContext/SessionContext become
 * explicit `host`/`info` fields threaded through render calls (no context);
 * useSyncExternalStore becomes explicit subscribe in connectedCallback +
 * unsubscribe in disconnectedCallback, triggering `#render()`
 * (Toast.tsx/CodeBlock.tsx's pattern); the SlotErrorBoundary React class
 * becomes a manual try/catch around the guarded render call, rendering the
 * crash-face markup on catch; entry-identity-keyed remounting is manual DOM
 * teardown (`replaceChildren`) when the winning entry's identity changes.
 *
 * webjsxSlot() indirection: KEPT. 14 registrant packages call
 * `webjsxSlot('tag-name')` directly at their `register()` call site — that
 * marker function returns `null` and carries `WEBJSX_SLOT_TAG`, so it is
 * fundamentally different from a plain function registrant (which webjsx
 * itself also uses for its "create-or-update, return as JSX.Element" idiom,
 * see Toast.tsx/Menu.tsx/CodeBlock.tsx's exported helpers). The dispatch
 * layer below still branches on `webjsxSlotTagOf(component)`: tagged means
 * "create/reuse this custom-element tag", untagged means "call this function
 * with composed props and use the returned VNode". Both paths are now
 * webjsx-native — the former React bridge component (WebjsxBridge) is
 * removed; a tagged entry's custom element is created directly and updated
 * via its `setProps` (or plain field assignment), uniformly with how
 * ui-primitives' own registrants already work.
 */
import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import {
  SlotOwnershipError, StaleAuthorizationError, webjsxSlotTagOf,
  type ChainRenderOpts, type HostObservable, type LocaleFace, type RenderOpts,
  type SessionMaybeProvideInfo, type SessionProvideInfo, type SlotRenderer, type SlotRendererHost,
  type SlotScope, type StoredEntry, type Translate,
} from '@deepseek-ai/dsh-client-ui-slots'
import {
  SlotAssemblyError, currentSessionMaybeProvideInfo, maybeObservableHook, observableHook, projectionHook,
  sessionProviderFor,
} from './session-provider.tsx'

type InjectedProps = Record<string, unknown>

type SlotHookFactory = (standard: InjectedProps, hookContext: unknown) => unknown
type SlotHookFactories = Readonly<Record<string, SlotHookFactory>>

interface BoundSlotInject {
  readonly props: InjectedProps
  readonly slotHookFactories?: SlotHookFactories | undefined
}

/**
 * Per-entry renderSlot / renderSlotChain bindings, called from inside a
 * registrant's render body. Each returns a `<dsh-slot-outlet>` VNode (a
 * custom element that owns its own dispatch/subscription lifecycle) instead
 * of React elements — applyDiff reconciles it by `key` like any other node.
 */
type RenderSlotBinding = (key: string, owner: object, opts?: RenderOpts) => VNode
type RenderSlotChainBinding = (key: string, owner: object, opts?: ChainRenderOpts) => VNode

const renderSlotCache = new WeakMap<StoredEntry, RenderSlotBinding>()

function boundRenderSlot(host: SlotRendererHost, entry: StoredEntry): RenderSlotBinding {
  let binding = renderSlotCache.get(entry)
  if (!binding) {
    binding = (key, owner, opts) => {
      if (!host.isLive(entry)) {
        throw new StaleAuthorizationError(`renderSlot('${key}') from a disposed registration`)
      }
      const declared = entry.children?.[key]
      if (declared === undefined) {
        throw new SlotOwnershipError(`slot '${key}' is not declared by this entry's children`)
      }
      if (declared.kind === 'chain') {
        throw new SlotOwnershipError(`slot '${key}' is declared 'chain' — use renderSlotChain`)
      }
      return slotOutletVNode(host, key, owner, opts)
    }
    renderSlotCache.set(entry, binding)
  }
  return binding
}

const renderSlotChainCache = new WeakMap<StoredEntry, RenderSlotChainBinding>()

function boundRenderSlotChain(host: SlotRendererHost, entry: StoredEntry): RenderSlotChainBinding {
  let binding = renderSlotChainCache.get(entry)
  if (!binding) {
    binding = (key, owner, opts) => {
      if (!host.isLive(entry)) {
        throw new StaleAuthorizationError(`renderSlotChain('${key}') from a disposed registration`)
      }
      const declared = entry.children?.[key]
      if (declared === undefined) {
        throw new SlotOwnershipError(`slot '${key}' is not declared by this entry's children`)
      }
      if (declared.kind !== 'chain') {
        throw new SlotOwnershipError(`slot '${key}' is declared '${declared.kind}', not 'chain' — use renderSlot`)
      }
      return slotOutletVNode(host, key, owner, opts)
    }
    renderSlotChainCache.set(entry, binding)
  }
  return binding
}

const rootInjectCache = new WeakMap<StoredEntry, InjectedProps>()
const sessionInjectCache = new WeakMap<StoredEntry, WeakMap<SessionProvideInfo, InjectedProps>>()
const sessionMaybeInjectCache = new WeakMap<StoredEntry, WeakMap<SessionMaybeProvideInfo, InjectedProps>>()

const EMPTY_INJECTED_PROPS: InjectedProps = {}

function runInject(entry: StoredEntry, info: SessionMaybeProvideInfo | undefined, actions: object | undefined): InjectedProps {
  const inject = entry.inject
  if (!inject) return EMPTY_INJECTED_PROPS
  const args: unknown[] = []
  if (info !== undefined) args.push(info.sessionId)
  if (actions !== undefined) args.push(actions)
  return bindInjectHooks((inject as (...args: unknown[]) => InjectedProps)(...args))
}

function bindInjectHooks(face: InjectedProps): InjectedProps {
  const sources = face['hooks']
  if (sources === undefined) return face
  const { hooks: _hooks, ...rest } = face
  const bound: InjectedProps = rest
  for (const [name, source] of Object.entries(sources as Record<string, HostObservable<unknown>>)) {
    const hookName = `use${name[0]?.toUpperCase() ?? ''}${name.slice(1)}`
    bound[hookName] = observableHook(source)
  }
  return bound
}

const slotInjectCache = new WeakMap<object, BoundSlotInject>()
const EMPTY_SLOT_INJECT: BoundSlotInject = { props: EMPTY_INJECTED_PROPS }

function cachedSlotInject(face: object | undefined): BoundSlotInject {
  if (face === undefined) return EMPTY_SLOT_INJECT
  let bound = slotInjectCache.get(face)
  if (bound !== undefined) return bound
  const definitions = (face as InjectedProps)['hooks']
  if (definitions === undefined) {
    bound = { props: face as InjectedProps }
    slotInjectCache.set(face, bound)
    return bound
  }
  const { hooks: _hooks, ...rest } = face as InjectedProps
  const props: InjectedProps = rest
  let factories: Record<string, SlotHookFactory> | undefined
  for (const [name, definition] of Object.entries(definitions as Record<string, unknown>)) {
    const hookName = `use${name[0]?.toUpperCase() ?? ''}${name.slice(1)}`
    if (typeof definition === 'function') {
      factories ??= {}
      factories[name] = definition as SlotHookFactory
    } else {
      props[hookName] = observableHook(definition as HostObservable<unknown>)
    }
  }
  bound = factories === undefined
    ? { props }
    : { props, slotHookFactories: factories }
  slotInjectCache.set(face, bound)
  return bound
}

function bindSlotHookFactories(
  factories: SlotHookFactories,
  standard: InjectedProps,
  hookContext: unknown,
): InjectedProps {
  const hooks: InjectedProps = {}
  for (const [name, factory] of Object.entries(factories)) {
    const hookName = `use${name[0]?.toUpperCase() ?? ''}${name.slice(1)}`
    hooks[hookName] = factory(standard, hookContext)
  }
  return hooks
}

function cachedRootInject(entry: StoredEntry, actions: object | undefined): InjectedProps {
  let props = rootInjectCache.get(entry)
  if (!props) {
    props = runInject(entry, undefined, actions)
    rootInjectCache.set(entry, props)
  }
  return props
}

function cachedSessionInject(entry: StoredEntry, info: SessionProvideInfo, actions: object | undefined): InjectedProps {
  let perInfo = sessionInjectCache.get(entry)
  if (!perInfo) {
    perInfo = new WeakMap()
    sessionInjectCache.set(entry, perInfo)
  }
  let props = perInfo.get(info)
  if (!props) {
    props = runInject(entry, info, actions)
    perInfo.set(info, props)
  }
  return props
}

function cachedSessionMaybeInject(
  entry: StoredEntry,
  info: SessionMaybeProvideInfo,
  actions: object | undefined,
): InjectedProps {
  let perInfo = sessionMaybeInjectCache.get(entry)
  if (!perInfo) {
    perInfo = new WeakMap()
    sessionMaybeInjectCache.set(entry, perInfo)
  }
  let props = perInfo.get(info)
  if (!props) {
    props = runInject(entry, info, actions)
    perInfo.set(info, props)
  }
  return props
}

const localeSeatCache = new WeakMap<LocaleFace, Map<string, { revision: number; t: Translate }>>()

function localeSeat(face: LocaleFace, ns: string): Translate {
  let perNs = localeSeatCache.get(face)
  if (!perNs) {
    perNs = new Map()
    localeSeatCache.set(face, perNs)
  }
  const revision = face.getSnapshot().revision
  const cached = perNs.get(ns)
  if (cached && cached.revision === revision) return cached.t
  const bound = face.bind(ns)
  const t: Translate = (key, params) => bound(key, params)
  perNs.set(ns, { revision, t })
  return t
}

/**
 * Entry-identity keys for entry boundaries — unchanged plain-JS WeakMap
 * cache. An outlet remounts its boundary fresh whenever the winning entry's
 * identity changes (re-election, shadowing fallback, HMR re-registration),
 * so a boundary that failed on entry A never survives to black out entry B.
 */
let nextEntryKey = 0
const entryKeys = new WeakMap<StoredEntry, number>()

function entryKeyOf(entry: StoredEntry): number {
  let key = entryKeys.get(entry)
  if (key === undefined) {
    key = nextEntryKey++
    entryKeys.set(entry, key)
  }
  return key
}

interface StandardPropsCache {
  readonly root: InjectedProps
  readonly session: WeakMap<SessionMaybeProvideInfo, InjectedProps>
  readonly sessionMaybe: WeakMap<SessionMaybeProvideInfo, InjectedProps>
}

const standardPropsCache = new WeakMap<SlotRendererHost, StandardPropsCache>()

function standardProps(
  host: SlotRendererHost,
  scope: SlotScope,
  info: SessionMaybeProvideInfo | undefined,
): InjectedProps {
  let cache = standardPropsCache.get(host)
  if (cache === undefined) {
    cache = {
      root: {
        useSessions: observableHook(host.sessions.list),
        useWorkspaces: observableHook(host.workspaces.list),
      },
      session: new WeakMap(),
      sessionMaybe: new WeakMap(),
    }
    standardPropsCache.set(host, cache)
  }
  if (scope === 'root') return cache.root
  if (info === undefined) throw new SlotAssemblyError(`scope '${scope}' rendered without session provide info`)
  const byInfo = scope === 'session' ? cache.session : cache.sessionMaybe
  let standard = byInfo.get(info)
  if (standard !== undefined) return standard
  standard = { ...cache.root }
  for (const [name, source] of Object.entries(info.hooks)) {
    const hookName = `use${name[0]?.toUpperCase() ?? ''}${name.slice(1)}`
    if (scope === 'session-maybe') {
      standard[hookName] = maybeObservableHook(source)
    } else {
      if (source === undefined) throw new SlotAssemblyError(`strict session hook '${name}' has no source`)
      standard[hookName] = observableHook(source)
    }
  }
  Object.assign(standard, info.props)
  standard['sessionId'] = info.sessionId
  standard['useProjection'] = projectionHook(info)
  byInfo.set(info, standard)
  return standard
}

function standardKit(
  host: SlotRendererHost,
  entry: StoredEntry,
  scope: SlotScope,
  info: SessionMaybeProvideInfo | undefined,
): {
  kit: InjectedProps
  standard: InjectedProps
  actions: object | undefined
} {
  const standard = standardProps(host, scope, info)
  const kit: InjectedProps = { ...standard }
  if (entry.locale !== undefined) {
    const face = host.locale
    if (face === undefined) {
      throw new SlotAssemblyError(
        `entry declares locale namespace '${entry.locale}' but no locale face is installed (locale plugin missing from the composition?)`)
    }
    kit['t'] = localeSeat(face, entry.locale)
  }
  const store = scope === 'session-maybe' && info?.sessionId === undefined
    ? undefined
    : host.storeOf(entry, info?.sessionId)
  if (store !== undefined) {
    kit['useStore'] = observableHook(store)
    kit['actions'] = store.actions
    kit['subscribeStore'] = (fn: () => void) => store.subscribe(fn)
  }
  if (entry.children !== undefined) {
    kit['renderSlot'] = boundRenderSlot(host, entry)
    if (Object.values(entry.children).some(spec => spec.kind === 'chain')) {
      kit['renderSlotChain'] = boundRenderSlotChain(host, entry)
    }
    if (Object.values(entry.children).some(spec => spec.scope === 'session')) {
      kit['SessionProvider'] = sessionProviderFor(host)
    }
  }
  return { kit, standard, actions: store?.actions }
}

/**
 * Compose one entry's full props object (standard kit + cached entry inject +
 * common slot inject + contextual slot hooks + owner props, owner wins).
 * Pure data assembly — no rendering; the caller decides how to turn this into
 * a VNode (bare-function call vs. tagged-custom-element props).
 */
function composeEntryProps(
  kit: InjectedProps,
  standard: InjectedProps,
  injected: InjectedProps,
  slotInjected: BoundSlotInject,
  ownerProps: object,
  hookContext: unknown,
  hasHookContext: boolean,
  slotKey: string,
): InjectedProps {
  let contextual: InjectedProps = EMPTY_INJECTED_PROPS
  if (slotInjected.slotHookFactories !== undefined) {
    if (!hasHookContext) {
      throw new SlotAssemblyError(`slot '${slotKey}' has contextual injected Hooks but no hookContext`)
    }
    contextual = bindSlotHookFactories(slotInjected.slotHookFactories, standard, hookContext)
  }
  return { ...kit, ...injected, ...slotInjected.props, ...contextual, ...ownerProps }
}

/**
 * Render one entry to a VNode. `entry.component` is either:
 *  - a bare function registrant (call it with the composed props, use the
 *    returned VNode directly — the webjsx-JSX-returning-stateless-function
 *    convention every converted registrant package now follows), or
 *  - a `webjsxSlot(tag)` marker: create (or reuse, keyed by entry identity)
 *    the named custom element and drive it via `setProps`/plain-field
 *    assignment (same convention as ui-primitives' own `renderMenu`/
 *    `renderCodeBlock`/`mountToast` helpers), returned as a keyed VNode so
 *    applyDiff preserves its identity across re-renders of the parent.
 */
function renderEntryVNode(
  entry: StoredEntry,
  props: InjectedProps,
  entryKey: number,
): VNode {
  const tag = webjsxSlotTagOf(entry.component)
  if (tag !== undefined) {
    return <dsh-entry-host key={entryKey} tag={tag} entryProps={props} /> as unknown as VNode
  }
  const Comp = entry.component as (p: InjectedProps) => VNode
  return Comp(props)
}

/**
 * Custom element hosting one webjsxSlot(tag)-tagged entry: creates the named
 * tag on connect (or reuses it across `applyDiff` updates via its stable
 * `key`), and drives it through `setProps` when present, else plain-field
 * assignment — the exact convention `WebjsxBridge` used to bridge into
 * React, now the terminal case (no bridge needed, webjsx owns the whole tree).
 */
class DshEntryHost extends HTMLElement {
  #tag = ''
  #entryProps: InjectedProps = EMPTY_INJECTED_PROPS
  #el: HTMLElement | null = null
  // JSX attribute declaration order (`tag` before `entryProps`) drives which
  // setter webjsx's applyDiff invokes first on initial mount — `tag` always
  // fires first for this element's call sites. Without this flag, `set tag`'s
  // own #applyProps() call would drive the freshly-created element's
  // setProps() with the still-default EMPTY_INJECTED_PROPS (no useStore/
  // actions/etc.), one JS tick before `set entryProps` ever runs. Real props
  // apply only once `entryProps` has been assigned at least once; `set tag`
  // just creates the element and waits.
  #propsAssigned = false

  set tag(value: string) {
    if (value === this.#tag && this.#el !== null) return
    this.#tag = value
    this.#el?.remove()
    this.#el = document.createElement(value)
    this.appendChild(this.#el)
    if (this.#propsAssigned) this.#applyProps()
  }

  set entryProps(value: InjectedProps) {
    this.#entryProps = value
    this.#propsAssigned = true
    this.#applyProps()
  }

  #applyProps(): void {
    const el = this.#el
    if (el === null) return
    const target = el as Partial<{ setProps: (p: InjectedProps) => void }>
    if (typeof target.setProps === 'function') {
      target.setProps(this.#entryProps)
    } else {
      for (const [k, v] of Object.entries(this.#entryProps)) {
        (el as unknown as Record<string, unknown>)[k] = v
      }
    }
  }
}
if (typeof customElements !== 'undefined' && customElements.get('dsh-entry-host') === undefined) {
  customElements.define('dsh-entry-host', DshEntryHost)
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      /** Tagged-webjsxSlot entry host; props flow through the `tag`/`entryProps` setters, not JSX attributes. */
      'dsh-entry-host': { key?: string | number; tag?: string; entryProps?: InjectedProps }
    }
  }
}

/**
 * Per-entry crash boundary: wraps `render()` in try/catch. On crash it
 * renders the `data-slot-error` crash face and reports through
 * `onEntryError` — the manual replacement for React's
 * getDerivedStateFromError/componentDidCatch. This does not catch errors
 * thrown later from async work or from inside a custom element's own
 * lifecycle callbacks (only the synchronous render call is guarded) — an
 * accepted, documented gap matching the earlier blocked attempt's own
 * conclusion.
 */
function guardedRender(slotKey: string, onEntryError: (error: unknown) => void, render: () => VNode): VNode {
  try {
    return render()
  } catch (error) {
    if (error instanceof SlotAssemblyError) throw error
    console.error(`slot entry crashed in '${slotKey}':`, error)
    onEntryError(error)
    return <div data-slot-error={slotKey} /> as unknown as VNode
  }
}

/**
 * Session-maybe identity: adoption — the ONLY behavior (there is no
 * hold-identity-forever mode). An incarnation born session-less ADOPTS the
 * first session that arrives: identity holds across that one transition
 * (undefined → first id). From then on the entry behaves exactly like a
 * strict session entry: switching to a DIFFERENT session remounts, and
 * dropping back to no-session remounts into a fresh blank incarnation, which
 * will adopt again. Bookkeeping now lives on the owning outlet instance
 * (`#maybeIncarnation`) instead of a React child component's setState-in-render
 * trick — the outlet already tracks winner identity per render, so this is
 * one more piece of the same imperative bookkeeping.
 */
interface MaybeIncarnation {
  readonly adopted: string | undefined
  readonly epoch: number
}
const FIRST_INCARNATION: MaybeIncarnation = { adopted: undefined, epoch: 0 }

function nextIncarnation(state: MaybeIncarnation, sessionId: string | undefined): MaybeIncarnation {
  if (sessionId !== undefined && state.adopted === undefined) {
    return { adopted: sessionId, epoch: state.epoch }
  }
  if (state.adopted !== undefined && sessionId !== undefined && sessionId !== state.adopted) {
    return { adopted: sessionId, epoch: state.epoch + 1 }
  }
  if (state.adopted !== undefined && sessionId === undefined) {
    return { adopted: undefined, epoch: state.epoch + 1 }
  }
  return state
}

/**
 * Anchor style shared by every outlet: `display:contents` keeps the wrapper
 * out of layout, so the anchor is purely addressable surface.
 */
const ANCHOR_STYLE = 'display: contents'

/**
 * Slot outlet custom element — replaces the React `SlotOutlet` function
 * component. `host`/`slotKey`/`ownerProps`/`opts` land as plain instance
 * fields (webjsx property convention, see Toast.tsx's `setProps`); the
 * registration-version and locale-revision `useSyncExternalStore`
 * subscriptions become explicit `host.subscribe`/locale-face `subscribe`
 * calls bound in `connectedCallback` and torn down in
 * `disconnectedCallback`, each re-invoking `#render()` on notification.
 */
/**
 * Prune stale duplicate `[data-slot]` wrapper children an outlet's applyDiff
 * pass may have left behind (see the callers' comments for the observed
 * webjsx diff-cache desync this guards). Keeps the last child — the wrapper
 * the render just produced or updated — and removes any earlier ones.
 * A no-op when the element already has zero or one child (the normal case).
 */
function pruneStaleOutletChildren(el: HTMLElement): void {
  while (el.children.length > 1) {
    const stale = el.children[0]
    if (stale === undefined) break
    stale.remove()
  }
}

/**
 * Reset webjsx's internal per-element diff bookkeeping (the
 * `__webjsx_childNodes` cache `applyDiff` reads as its "previous render"
 * baseline) to match what the DOM actually holds right now. Safe no-op on
 * the normal path (cache already agrees with the DOM); guards specifically
 * against the observed desync where a burst of re-renders leaves the cache
 * reporting a stale child count.
 */
function resyncOutletDiffCache(el: HTMLElement): void {
  const cache = (el as unknown as { __webjsx_childNodes?: unknown[] }).__webjsx_childNodes
  const live = [...el.childNodes]
  if (cache !== undefined && cache.length === live.length && cache.every((n, i) => n === live[i])) return
  ;(el as unknown as { __webjsx_childNodes?: unknown[] }).__webjsx_childNodes = live
}

/**
 * Owns one outlet's version + locale subscription lifecycle, shared by
 * DshSlotOutlet and DshRootOutlet: connect binds both and renders once
 * already-seen, disconnect tears both down, and locale rebinds fresh on
 * every call (the face itself may change or (dis)appear between renders).
 */
class OutletSubscriptions {
  #unsubscribeVersion: (() => void) | null = null
  #unsubscribeLocale: (() => void) | null = null

  connect(bindVersion: () => void, host: () => SlotRendererHost | null, onChange: () => void): void {
    bindVersion()
    this.bindLocale(host, onChange)
  }

  disconnect(): void {
    this.#unsubscribeVersion?.()
    this.#unsubscribeVersion = null
    this.#unsubscribeLocale?.()
    this.#unsubscribeLocale = null
  }

  bindVersion(unsubscribe: (() => void) | null): void {
    this.#unsubscribeVersion?.()
    this.#unsubscribeVersion = unsubscribe
  }

  bindLocale(host: () => SlotRendererHost | null, onChange: () => void): void {
    this.#unsubscribeLocale?.()
    const face = host()?.locale
    this.#unsubscribeLocale = face === undefined ? null : face.subscribe(onChange)
  }
}

export class DshSlotOutlet extends HTMLElement {
  #host: SlotRendererHost | null = null
  #slotKey = ''
  #ownerProps: object = {}
  #opts: (RenderOpts & ChainRenderOpts) | undefined
  #subscriptions = new OutletSubscriptions()
  #maybeIncarnation: MaybeIncarnation = FIRST_INCARNATION

  // setProps() runs synchronously inside webjsx's own createDOMElement (via
  // the `ref` callback), i.e. BEFORE this element is inserted into the real
  // document — connectedCallback fires only afterward, once insertion lands.
  // Rendering in both places double-renders the very first mount: the
  // pre-connection render's applyDiff(this, vdom) runs against a detached
  // node, then connectedCallback's applyDiff runs again immediately after
  // insertion. webjsx's diff cache (element.__webjsx_childNodes, a plain
  // instance property, not DOM-derived) should stay consistent across that
  // sequence, but empirically it does not: the live DOM ends up with two
  // `[data-slot]` children while the cache reports only one, i.e. the two
  // back-to-back applyDiff calls around the detach→attach boundary produce a
  // duplicate node webjsx's own bookkeeping never sees. Skipping the second,
  // now-redundant render on first connect (setProps already rendered
  // everything connectedCallback would) removes the double-render window
  // entirely; later re-renders (subscriptions, setProps updates) are
  // untouched.
  #renderedOnce = false

  setProps(props: {
    host: SlotRendererHost
    slotKey: string
    ownerProps: object
    opts?: (RenderOpts & ChainRenderOpts) | undefined
  }): void {
    this.#host = props.host
    this.#slotKey = props.slotKey
    this.#ownerProps = props.ownerProps
    this.#opts = props.opts
    this.#bindVersion()
    this.#subscriptions.bindLocale(() => this.#host, () => { this.#render() })
    this.#render()
  }

  // Required HTMLElement lifecycle hook name; body is unavoidably the same
  // shape as DshRootOutlet's (both delegate to the shared OutletSubscriptions
  // helper above) since custom-element lifecycle methods cannot be inherited
  // from a shared base without a larger structural change.
  connectedCallback(): void {
    this.#subscriptions.connect(
      () => { this.#bindVersion() },
      () => this.#host,
      () => { if (this.#renderedOnce) this.#render() },
    )
  }

  disconnectedCallback(): void { this.#subscriptions.disconnect() }

  #bindVersion(): void {
    const host = this.#host
    this.#subscriptions.bindVersion(host === null ? null : host.subscribe(this.#slotKey, () => { this.#render() }))
  }

  #render(): void {
    const host = this.#host
    if (host === null) return
    // Defensive, BEFORE diffing: webjsx's per-element diff cache
    // (element.__webjsx_childNodes / __webjsx_props.children) has been
    // observed to desync from this outlet's live DOM across a burst of
    // rapid re-renders (e.g. many renders queued in the same tick) —
    // `applyDiff` then reads a stale "one child" bookkeeping against
    // whatever the DOM actually holds, and depending on which desynced it
    // either orphans an extra `[data-slot]` wrapper alongside the current
    // one (duplicate content) or loses track of the real one entirely
    // (content vanishes). Resetting the cache to exactly what the live DOM
    // holds right before diffing gives every render pass a consistent,
    // correct baseline regardless of how many renders raced before it.
    resyncOutletDiffCache(this)
    const sessionInfo = currentSessionMaybeProvideInfo(host)
    const content = renderOutletContent(host, this.#slotKey, this.#ownerProps, this.#opts, sessionInfo, this.#maybeIncarnation, (next) => {
      this.#maybeIncarnation = next
    })
    const vdom = (
      <div data-slot={this.#slotKey} style={ANCHOR_STYLE}>
        {content}
      </div>
    )
    applyDiff(this, vdom)
    pruneStaleOutletChildren(this)
    this.#renderedOnce = true
  }
}
if (typeof customElements !== 'undefined' && customElements.get('dsh-slot-outlet') === undefined) {
  customElements.define('dsh-slot-outlet', DshSlotOutlet)
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      /** Ordinary slot outlet; props flow through the `ref`-driven `setProps` call, not JSX attributes. */
      'dsh-slot-outlet': { key?: string | number; ref?: (node: DshSlotOutlet | null) => void }
      /** Root outlet; props flow through the `ref`-driven `setProps` call, not JSX attributes. */
      'dsh-root-outlet': { ref?: (node: DshRootOutlet | null) => void }
    }
  }
}

/**
 * Build a `<dsh-slot-outlet>` VNode for one renderSlot/renderSlotChain call
 * site. The host API and dispatch opts are multi-field, must-update-together
 * state, so they route through the `ref` callback's imperative `setProps`
 * call (the same pattern ui-primitives' own `renderMenu`/`renderCodeBlock`
 * helpers use for their complex prop objects) rather than as individual JSX
 * attributes — this is the direct replacement for `WebjsxBridge`'s React
 * indirection, now the terminal case.
 */
function slotOutletVNode(
  host: SlotRendererHost,
  slotKey: string,
  ownerProps: object,
  opts: (RenderOpts & ChainRenderOpts) | undefined,
): VNode {
  return (
    <dsh-slot-outlet
      ref={(node) => {
        node?.setProps({ host, slotKey, ownerProps, opts })
      }}
    /> as unknown as VNode
  )
}

/** Kind dispatch behind the outlet anchor (single/keyed/list/chain, fallbacks, crash faces). */
function renderOutletContent(
  host: SlotRendererHost,
  slotKey: string,
  ownerProps: object,
  opts: (RenderOpts & ChainRenderOpts) | undefined,
  sessionInfo: SessionMaybeProvideInfo,
  maybeIncarnation: MaybeIncarnation,
  setMaybeIncarnation: (next: MaybeIncarnation) => void,
): VNode | VNode[] | null {
  const spec = host.specOf(slotKey)
  if (!spec) return null
  const strictSessionAbsent = spec.scope === 'session' && sessionInfo.sessionId === undefined
  if (strictSessionAbsent && (spec.kind !== 'chain' || !opts?.overlay)) {
    return (opts?.fallback as VNode | null | undefined) ?? null
  }
  const entries = strictSessionAbsent ? [] : host.entriesOf(slotKey)
  const slotInjected = cachedSlotInject(spec.inject)

  // The outer wrapper is keyed by entry identity (entryKeyValue): a winner
  // change (re-election, shadowing fallback, HMR re-registration) gets a
  // DIFFERENT key, so applyDiff creates a fresh subtree instead of updating
  // the previous winner's DOM in place — the manual equivalent of React's
  // key-driven remount, since webjsx's own keyed-list diffing (verified
  // above in applyDiff.js) only reuses a node when the new key matches an
  // existing one.
  const guarded = (entry: StoredEntry, entryKeyValue: string | number, owner: object = ownerProps, matched?: unknown): VNode => {
    const hasHookContext = opts !== undefined && Object.hasOwn(opts, 'hookContext')
    const hookContext = opts?.hookContext
    const onEntryError = (error: unknown) => {
      host.reportEntryError(slotKey, entry, error, { abdicate: spec.kind !== 'chain' })
    }
    const inner = guardedRender(slotKey, onEntryError, () => {
      if (spec.scope === 'session') {
        if (sessionInfo.sessionId === undefined) return <></> as unknown as VNode
        const info = sessionInfo as SessionProvideInfo
        const { kit, standard, actions } = standardKit(host, entry, 'session', info)
        const injected = cachedSessionInject(entry, info, actions)
        const props = composeEntryProps(kit, standard, injected, slotInjected,
          matched === undefined ? owner : { ...owner, matched }, hookContext, hasHookContext, slotKey)
        return (
          <div key={info.sessionId}>
            {renderEntryVNode(entry, props, entryKeyOf(entry))}
          </div>
        ) as unknown as VNode
      }
      if (spec.scope === 'session-maybe') {
        const next = nextIncarnation(maybeIncarnation, sessionInfo.sessionId)
        if (next !== maybeIncarnation) setMaybeIncarnation(next)
        const infoForRender: SessionMaybeProvideInfo = { ...sessionInfo, sessionId: next.adopted }
        const { kit, standard, actions } = standardKit(host, entry, 'session-maybe', infoForRender)
        const injected = cachedSessionMaybeInject(entry, infoForRender, actions)
        const props = composeEntryProps(kit, standard, injected, slotInjected,
          matched === undefined ? owner : { ...owner, matched }, hookContext, hasHookContext, slotKey)
        return (
          <div key={next.epoch}>
            {renderEntryVNode(entry, props, entryKeyOf(entry))}
          </div>
        ) as unknown as VNode
      }
      const { kit, standard, actions } = standardKit(host, entry, 'root', undefined)
      const injected = cachedRootInject(entry, actions)
      const props = composeEntryProps(kit, standard, injected, slotInjected,
        matched === undefined ? owner : { ...owner, matched }, hookContext, hasHookContext, slotKey)
      return renderEntryVNode(entry, props, entryKeyOf(entry))
    })
    return <div key={entryKeyValue}>{inner}</div> as unknown as VNode
  }

  const deadCell = (): VNode => <div data-slot-error={slotKey} /> as unknown as VNode

  if (spec.kind === 'single') {
    const entry = host.entriesOfSlot(slotKey)[0]
    if (!entry) return entries.length > 0 ? deadCell() : ((opts?.fallback as VNode | null | undefined) ?? null)
    return guarded(entry, entryKeyOf(entry))
  }
  if (spec.kind === 'keyed') {
    const entry = host.entriesOfSlot(slotKey).find(e => e.options.key === opts?.entryKey)
    if (!entry) {
      const occupied = entries.some(e => e.options.key === opts?.entryKey)
      return occupied ? deadCell() : ((opts?.fallback as VNode | null | undefined) ?? null)
    }
    return guarded(entry, entryKeyOf(entry))
  }
  if (spec.kind === 'chain') {
    let elected: VNode | null = null
    for (const entry of entries) {
      let matched: unknown
      try {
        matched = (entry.select as (owner: object) => unknown)(ownerProps)
      } catch (error) {
        console.error(
          `chain selector crashed in '${slotKey}' (${entry.registrant ?? 'unknown registrant'}), treating as declined:`,
          error)
        continue
      }
      if (matched !== null) {
        elected = guarded(entry, entryKeyOf(entry), ownerProps, matched)
        break
      }
    }
    if (opts?.overlay) {
      const fallbackStyle = `display: ${elected === null ? 'contents' : 'none'}`
      return [
        <div data-chain-overlay-fallback={slotKey} style={fallbackStyle}>
          {(opts.fallback as VNode | null | undefined) ?? null}
        </div>,
        elected,
      ] as unknown as VNode[]
    }
    return elected ?? ((opts?.fallback as VNode | null | undefined) ?? null)
  }
  // list: one row per id cell.
  const winners = host.entriesOfSlot(slotKey)
  const rows: { entry: StoredEntry | undefined; id: string | undefined; order: number }[] = winners.map(entry => ({
    entry,
    id: entry.options.id,
    order: entry.options.order ?? 0,
  }))
  const rowIds = new Set(rows.map(row => row.id))
  for (const entry of entries) {
    if (rowIds.has(entry.options.id)) continue
    rowIds.add(entry.options.id)
    rows.push({ entry: undefined, id: entry.options.id, order: entry.options.order ?? 0 })
  }
  let list = [...rows].sort((a, b) => a.order - b.order)
  if (opts?.only !== undefined) list = list.filter(item => item.id === opts.only)
  if (list.length === 0) return (opts?.fallback as VNode | null | undefined) ?? null
  return list.map(item => item.entry !== undefined
    ? guarded(item.entry, `e${entryKeyOf(item.entry)}`)
    : (<div data-slot-error={slotKey} key={`x${item.id}`} /> as unknown as VNode)) as unknown as VNode[]
}

/**
 * Root outlet custom element — replaces the React `RootOutlet` function
 * component. Same subscribe/render lifecycle as `DshSlotOutlet`; kept
 * distinct because 'root' has its own boot-order assembly-failure contract
 * (throwing before any registration exists) that ordinary slots don't.
 */
export class DshRootOutlet extends HTMLElement {
  #host: SlotRendererHost | null = null
  #ownerProps: object = {}
  #subscriptions = new OutletSubscriptions()
  // See DshSlotOutlet's #renderedOnce: setProps() renders synchronously
  // pre-connection (webjsx's ref callback fires inside createDOMElement,
  // before insertion); connectedCallback firing #render() again right after
  // desyncs webjsx's own diff cache from the live DOM and duplicates the
  // rendered subtree. Skip the redundant first connectedCallback render.
  #renderedOnce = false

  setProps(props: { host: SlotRendererHost; ownerProps: object }): void {
    this.#host = props.host
    this.#ownerProps = props.ownerProps
    this.#bindVersion()
    this.#subscriptions.bindLocale(() => this.#host, () => { this.#render() })
    this.#render()
  }

  // Required HTMLElement lifecycle hook name; body is unavoidably the same
  // shape as DshSlotOutlet's (both delegate to the shared OutletSubscriptions
  // helper above) since custom-element lifecycle methods cannot be inherited
  // from a shared base without a larger structural change.
  // oxlint-disable-next-line sonarjs/no-identical-functions
  connectedCallback(): void {
    this.#subscriptions.connect(
      () => { this.#bindVersion() },
      () => this.#host,
      () => { if (this.#renderedOnce) this.#render() },
    )
  }

  disconnectedCallback(): void { this.#subscriptions.disconnect() }

  #bindVersion(): void {
    const host = this.#host
    this.#subscriptions.bindVersion(host === null ? null : host.subscribe('root', () => { this.#render() }))
  }

  #render(): void {
    const host = this.#host
    if (host === null) return
    resyncOutletDiffCache(this)
    const entry = host.entriesOfSlot('root')[0]
    let content: VNode
    if (!entry) {
      if (host.entriesOf('root').length > 0) {
        content = <div data-slot-error="root" /> as unknown as VNode
      } else {
        throw new SlotAssemblyError("renderSlot('root') before any 'root' registration (boot order)")
      }
    } else {
      const onEntryError = (error: unknown) => {
        host.reportEntryError('root', entry, error, { abdicate: true })
      }
      content = guardedRender('root', onEntryError, () => {
        const { kit, standard, actions } = standardKit(host, entry, 'root', undefined)
        const injected = cachedRootInject(entry, actions)
        const props = composeEntryProps(kit, standard, injected, EMPTY_SLOT_INJECT,
          this.#ownerProps, undefined, false, 'root')
        return renderEntryVNode(entry, props, entryKeyOf(entry))
      })
    }
    const vdom = (
      <div data-slot="root" style={ANCHOR_STYLE}>
        {content}
      </div>
    )
    applyDiff(this, vdom)
    // See DshSlotOutlet's identical call for why this is needed.
    pruneStaleOutletChildren(this)
    this.#renderedOnce = true
  }
}
if (typeof customElements !== 'undefined' && customElements.get('dsh-root-outlet') === undefined) {
  customElements.define('dsh-root-outlet', DshRootOutlet)
}

/**
 * Build the renderer the shell installs into the runtime SlotRegistry
 * (ctx.slots.install(createSlotRenderer()) at boot).
 * @returns the renderer.
 */
export function createSlotRenderer(): SlotRenderer {
  return {
    renderRoot(host, ownerProps) {
      return (
        <dsh-root-outlet
          ref={(node) => {
            node?.setProps({ host, ownerProps })
          }}
        />
      ) as unknown as VNode
    },
  }
}
