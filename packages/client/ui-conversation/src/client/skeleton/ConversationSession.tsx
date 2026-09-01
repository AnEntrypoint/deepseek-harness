/** Strict per-session header/body content inserted into the resident conversation layout.
 *
 * Converted from React hooks components to webjsx custom elements: the
 * `useSyncExternalStore(views.subscribe, ...)` subscription becomes an
 * explicit `views.subscribe` call in `connectedCallback` (unsubscribed in
 * `disconnectedCallback`, ReadBlock.tsx's grammar-subscription pattern), and
 * the mount-only draft-mirror / image-release effects become
 * connectedCallback/disconnectedCallback bodies.
 */

import { applyDiff } from 'webjsx'
import clsx from 'clsx'
import type { SessionId, SessionListState, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  ConversationSessionHeaderSlotProps, ConversationSessionSlotProps,
} from '../contract/slots.ts'
import type { ViewTab } from '../contract/views.ts'
import type { InputState } from '../input/contract.ts'
import css from './ConversationRoot.css.ts'

/** Full props composed from the strict session body contract. */
export type ConversationSessionProps = ConversationSessionSlotProps

/** Full props composed from the strict session header contract. */
export type ConversationSessionHeaderProps = ConversationSessionHeaderSlotProps

interface Breadcrumb {
  readonly id: SessionId
  readonly displayTitle: string
  readonly subagent: boolean
}

const DEFAULT_VIEW_ID = 'chat'

/** Resolve by id and keep stale persisted selections on the stable Chat fallback. */
function resolveActiveView(tabs: readonly ViewTab[], selectedId: string | null): ViewTab | undefined {
  const requestedId = selectedId ?? DEFAULT_VIEW_ID
  return tabs.find(view => view.id === requestedId)
    ?? tabs.find(view => view.id === DEFAULT_VIEW_ID)
}

function deriveAncestry(list: SessionListState, id: SessionId): readonly Breadcrumb[] {
  const chain: Breadcrumb[] = []
  const seen = new Set<SessionId>()
  let cursor: SessionId | undefined = id
  while (cursor !== undefined) {
    if (seen.has(cursor)) break
    seen.add(cursor)
    const summary: SessionSummary | undefined = list.byId[cursor]
    if (summary === undefined) break
    chain.unshift({
      id: summary.id,
      displayTitle: summary.displayTitle,
      subagent: summary.origin === 'subagent',
    })
    if (summary.origin !== 'subagent') break
    cursor = summary.parentId
  }
  return chain
}

/**
 * Session header chrome custom element: subscribes to the view ledger for its
 * only reactive input beyond the standard session kit.
 */
export class DshConversationSessionHeader extends HTMLElement {
  #props: ConversationSessionHeaderProps | null = null
  #unsubscribeViews: (() => void) | null = null
  #unsubscribeStore: (() => void) | null = null

  setProps(props: ConversationSessionHeaderProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    if (this.#props !== null) {
      this.#unsubscribeViews = this.#props.views.subscribe(() => { this.#render() })
      // The active tab (chat store's `view` field) is written by
      // actions.setView but `useStore` is a plain non-subscribing reader
      // (bind.ts) — without this the tab bar never learns a click landed.
      this.#unsubscribeStore = this.#props.subscribeStore(() => { this.#render() })
    }
    this.#render()
  }

  disconnectedCallback(): void {
    this.#unsubscribeViews?.()
    this.#unsubscribeViews = null
    this.#unsubscribeStore?.()
    this.#unsubscribeStore = null
  }

  #render(): void {
    if (this.#props === null) return
    const { sessionId, useSession, useSessions, useStore, actions, renderSlot, views, open, t } = this.#props
    const tabs = views.list()
    const selectedId = useStore(s => s.view)
    const active = resolveActiveView(tabs, selectedId)
    // Custom equality (breadcrumb id+title) dropped: #render is only invoked
    // on an actual props/subscription change, not on every session-store
    // tick, so the extra-render guard the comparator existed for is moot here.
    const ancestry = useSessions(s => deriveAncestry(s, sessionId))
    const composerPhase = useSession(s => s.composerPhase)
    const blank = useSession(s => s.blank)
    const hideChrome = blank && composerPhase === 'blank'

    const vdom = (
      <header
        class={clsx(css.header, hideChrome && css.headerHidden)}
        aria-hidden={hideChrome || undefined}
      >
        {!hideChrome && [
          <div class={css.titleRow ?? ''}>
            <div class={css.titleCluster ?? ''}>
              <nav class={css.crumbs ?? ''} aria-label={t('session.hierarchy')}>
                {ancestry.map((summary, index) => {
                  const last = index === ancestry.length - 1
                  const title = (
                    <button
                      type="button"
                      class={clsx(
                        css.crumb,
                        summary.subagent && css.crumbSubagent,
                        last && css.crumbCurrent,
                      )}
                      disabled={last}
                      onclick={() => { open(summary.id) }}
                    >
                      {summary.displayTitle}
                    </button>
                  )
                  const lineage = last || summary.subagent
                  const lineageOwner = {
                    lineageSessionId: summary.id,
                    displayTitle: summary.displayTitle,
                    ...last ? {} : { openTitle: () => { open(summary.id) } },
                  }
                  return (
                    <span key={summary.id} class={css.crumbSeg ?? ''}>
                      {index > 0 && <span class={css.crumbSep ?? ''}>/</span>}
                      {lineage
                        ? summary.subagent
                          ? renderSlot(
                            'conversation.session.header.lineage',
                            lineageOwner,
                            { fallback: title },
                          )
                          : [
                            title,
                            renderSlot(
                              'conversation.session.header.lineage',
                              lineageOwner,
                              { fallback: null },
                            ),
                          ]
                        : title}
                    </span>
                  )
                })}
                {ancestry.length === 0 && <span class={css.crumbCurrent ?? ''}>{sessionId}</span>}
              </nav>
              <div class={css.headerActions ?? ''}>
                {renderSlot('conversation.session.header.actions', {})}
              </div>
            </div>
            <div class={css.headerUtilities ?? ''}>
              {renderSlot('conversation.session.header.utilities', {})}
            </div>
          </div>,
          tabs.length > 1 && (
            <div class={css.tabs ?? ''} role="tablist">
              {tabs.map(viewTab => (
                <button
                  key={viewTab.id}
                  type="button"
                  role="tab"
                  aria-selected={viewTab.id === active?.id}
                  class={clsx(css.tab, viewTab.id === active?.id && css.tabActive)}
                  onclick={() => { actions.setView(viewTab.id) }}
                >
                  {viewTab.label}
                </button>
              ))}
            </div>
          ),
        ]}
      </header>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-conversation-session-header') === undefined) {
  customElements.define('dsh-conversation-session-header', DshConversationSessionHeader)
}

/**
 * Renders Session header chrome above the resident conversation scrollport.
 * @param props - Strict Session store, view ledger, navigation, render, and locale shares.
 * @returns the hidden blank-session header or visible title and tabs.
 */
export function ConversationSessionHeader(props: ConversationSessionHeaderProps): JSX.Element {
  const el = document.createElement('dsh-conversation-session-header') as DshConversationSessionHeader
  el.setProps(props)
  return el as unknown as JSX.Element
}

/**
 * Strict session body custom element: subscribes to the view ledger, seeds
 * the draft mirror once per mount, and releases session images on unmount
 * (the two former mount-only effects).
 */
export class DshConversationSession extends HTMLElement {
  #props: ConversationSessionProps | null = null
  #unsubscribeViews: (() => void) | null = null
  #unsubscribeStore: (() => void) | null = null
  #unmirror: (() => void) | null = null
  #mirrorBoundActions: ConversationSessionProps['actions'] | null = null

  setProps(props: ConversationSessionProps): void {
    this.#props = props
    this.#syncMirror()
    this.#render()
  }

  connectedCallback(): void {
    if (this.#props !== null) {
      this.#unsubscribeViews = this.#props.views.subscribe(() => { this.#render() })
      // See DshConversationSessionHeader: useStore never re-renders on its
      // own, so the active-view content needs its own direct subscription
      // to hear actions.setView / actions.setInspect mutations.
      this.#unsubscribeStore = this.#props.subscribeStore(() => { this.#render() })
    }
    this.#syncMirror()
    this.#render()
  }

  disconnectedCallback(): void {
    this.#unsubscribeViews?.()
    this.#unsubscribeViews = null
    this.#unsubscribeStore?.()
    this.#unsubscribeStore = null
    this.#unmirror?.()
    this.#unmirror = null
    if (this.#props !== null) this.#props.releaseSessionImages(this.#props.sessionId)
  }

  /** Mount-only seed + mirror bind: rebinds only when `actions` identity changes
   * (mirrors the original effect's `[inputActions]` dep pin). */
  #syncMirror(): void {
    if (this.#props === null) return
    if (this.#props.actions !== this.#mirrorBoundActions) {
      const inputState: InputState = this.#props.useInput(s => s)
      const storedDraft = this.#props.useStore(s => s.draft)
      this.#unmirror?.()
      if (inputState.draft === '' && storedDraft !== '') this.#props.inputActions.setDraft(storedDraft)
      this.#unmirror = this.#props.bindDraftMirror(this.#props.actions.setDraft)
      this.#mirrorBoundActions = this.#props.actions
    }
  }

  #render(): void {
    if (this.#props === null) return
    const { sessionId, useSession, useStore, actions, renderSlot, views } = this.#props
    const tabs = views.list()
    const selectedId = useStore(s => s.view)
    const active = resolveActiveView(tabs, selectedId)
    const composerPhase = useSession(s => s.composerPhase)
    const blank = useSession(s => s.blank)
    // `?? null`: persisted snapshots from before the inspect field rehydrate without it.
    const inspect = useStore(s => s.inspect ?? null)
    void sessionId

    if (blank && composerPhase === 'blank') {
      applyDiff(this, <div />)
      return
    }
    const vdom = (
      <div class={css.viewArea ?? ''}>
        {active !== undefined && renderSlot('conversation.view', {
          inspect,
          onInspectDone: () => { actions.setInspect(null) },
        }, { only: active.id })}
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-conversation-session') === undefined) {
  customElements.define('dsh-conversation-session', DshConversationSession)
}

/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft mirrored while blank Hero chrome is visible.
 * @param props - Strict Session input/store, view ledger, and render shares.
 * @returns the active view area, or null while the Session remains blank.
 */
export function ConversationSession(props: ConversationSessionProps): JSX.Element {
  const el = document.createElement('dsh-conversation-session') as DshConversationSession
  el.setProps(props)
  return el as unknown as JSX.Element
}
