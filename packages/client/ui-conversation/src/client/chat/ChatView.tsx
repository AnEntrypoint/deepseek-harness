// ChatView: the default conversation view — one stable keyed parent list over
// final business Nodes, plus paging, pending steering and bottom-follow.
// Each row dispatches through 'conversation.chat.node'; ui-tool owns the
// tool-call renderer and its recursive root/subcall composition. A Host
// open-path refusal from the injected opener is an in-page dialog here.
//
// Scroll: when nested under `[data-conversation-scroll]` (active conversation
// column), that host is the scrollport and this view is flow content; when
// mounted alone (unit tests), `.scroll` owns overflow. Bottom-follow and
// prepend anchoring always target the resolved scrollport.
//
// Render economics: order changes only when rows enter, leave or move. Each
// ChatNodeSeat subscribes to one Node key, so Assistant deltas and Tool
// lifecycle updates replace only their own row without remounting it.
//
// Converted from a React hooks component to a webjsx custom element: every
// useRef becomes a private field, useState becomes a private field plus
// #render(), and the layout/scroll/resize effects become bind/unbind methods
// driven from connectedCallback/disconnectedCallback (Toast.tsx's pattern).

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import type { ConversationTimelineSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { Button, IconChevronDownOutline14, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps, RenderMessageImages } from '../contract/slots.ts'
import { PendingSteeringBubble } from './MessageItem.tsx'
import { ChatNodeSeat } from './ChatNodeSeat.tsx'
import { formatRunDuration } from './message-chrome.ts'
import css from './ChatView.css.ts'

const FOLLOW_THRESHOLD = 24

/** Active column host when present; otherwise the view-local scroller. */
function scrollerOf(from: HTMLElement): HTMLElement {
  return (from.closest('[data-conversation-scroll]')) ?? from
}

interface PagingAnchor {
  /** Stable node/call identity, independent of boundary-spanning group keys. */
  key: string
  /** Row top relative to the scrollport after the latest user scroll. */
  top: number
}

/** Find an already-rendered settled row without interpolating a selector. */
function anchorElement(list: HTMLElement, key: string): HTMLElement | null {
  for (const row of list.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')) {
    if (row.dataset.chatAnchorKey === key) return row
  }
  return null
}

/** Row position in scrollport coordinates (viewport-independent). */
function flowTop(row: HTMLElement, scrollport: HTMLElement): number {
  return row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top
}

/** Select a visible stable node/call identity, falling back only when layout
 * has not exposed a visible box yet. */
function pagingAnchor(list: HTMLElement, scrollport: HTMLElement): HTMLElement | null {
  const viewport = scrollport.getBoundingClientRect()
  const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
  const visibleBottom = composer?.getBoundingClientRect().top ?? viewport.bottom
  // Scroll events are hot: hit-test a few points through the stretched flow
  // rows before considering the full mounted set. The fallback keeps jsdom
  // and pre-layout states deterministic; a virtualizer naturally bounds it.
  if (typeof document.elementsFromPoint === 'function' && visibleBottom > viewport.top) {
    const content = list.getBoundingClientRect()
    const left = Math.max(viewport.left, content.left)
    const right = Math.min(viewport.right, content.right)
    const x = left + Math.max(0, right - left) / 2
    const height = visibleBottom - viewport.top
    const points = [1, Math.min(32, height / 3), height / 2, Math.max(1, height - 1)]
    for (const offset of points) {
      for (const element of document.elementsFromPoint(x, viewport.top + offset)) {
        const row = element instanceof HTMLElement
          ? element.closest<HTMLElement>('[data-chat-anchor-key]')
          : null
        if (row !== null && list.contains(row)) return row
      }
    }
  }
  const rows = [...list.querySelectorAll<HTMLElement>('[data-chat-anchor-key]')]
  const visibleRows = rows.filter((row) => {
    const rect = row.getBoundingClientRect()
    return rect.bottom > viewport.top && rect.top < visibleBottom
  })
  return visibleRows[0] ?? rows[0] ?? null
}

type ChatScrollPosition = NonNullable<ReturnType<ChatViewSlotProps['chatScroll']['read']>>

/** Capture a reflow-resistant reader position from the current rendered window. */
function scrollPosition(list: HTMLElement, scrollport: HTMLElement): ChatScrollPosition | null {
  const row = pagingAnchor(list, scrollport)
  const anchorKey = row?.dataset.chatAnchorKey
  if (row === null || anchorKey === undefined) return null
  return {
    anchorKey,
    anchorTop: flowTop(row, scrollport),
    scrollTop: scrollport.scrollTop,
  }
}

/** Host/OS refusal text for the file-open dialog; empty throws keep a locale fallback. */
function openFailureMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : String(error)
  return message === '' ? fallback : message
}

/** ProducedFiles opens the session workspace as `.`. */
function isFolderOpenPath(path: string): boolean {
  return path === '.'
}

function runningTurnStartTime(timeline: ConversationTimelineSnapshot): number | null {
  let latest: number | null = null
  for (const turn of timeline.turns.values()) {
    if (turn.status === 'open' && turn.start !== undefined) latest = turn.start.time
  }
  return latest
}

/** Turn-level model activity label custom element: retains elapsed time across
 * first-token, tool, and streaming phases via an internal ticking clock. */
class DshTurnStatus extends HTMLElement {
  #startTime: number | null = null
  #t: ChatViewSlotProps['t'] = (key: string) => key
  #mountedAt = Date.now()
  #elapsedMs = 0
  #tickId: ReturnType<typeof setInterval> | null = null

  setProps(startTime: number | null, t: ChatViewSlotProps['t']): void {
    this.#startTime = startTime
    this.#t = t
    this.#tick()
  }

  connectedCallback(): void {
    this.#mountedAt = Date.now()
    this.#tick()
    this.#tickId = setInterval(() => { this.#tick() }, 1000)
  }

  disconnectedCallback(): void {
    if (this.#tickId !== null) { clearInterval(this.#tickId); this.#tickId = null }
  }

  #tick(): void {
    const anchor = this.#startTime ?? this.#mountedAt
    this.#elapsedMs = Math.max(0, Date.now() - anchor)
    this.#render()
  }

  #render(): void {
    const showClock = this.#elapsedMs >= 15_000
    const vdom = (
      <div class={css.turnStatus ?? ''} role="status" aria-live="polite">
        Deep diving...
        {showClock && (
          <span class={css.turnStatusClock ?? ''} aria-hidden>
            {formatRunDuration(this.#elapsedMs, this.#t)}
          </span>
        )}
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-turn-status') === undefined) {
  customElements.define('dsh-turn-status', DshTurnStatus)
}

function TurnStatus({ startTime, t }: { startTime: number | null; t: ChatViewSlotProps['t'] }): JSX.Element {
  const el = document.createElement('dsh-turn-status') as DshTurnStatus
  el.setProps(startTime, t)
  return el as unknown as JSX.Element
}

/** In-page Host open-path refusal: the wire reason plus a retry of the same path. */
function FileOpenErrorDialog({
  path, message, busy, onClose, onRetry, t,
}: {
  path: string
  message: string
  busy: boolean
  onClose: () => void
  onRetry: () => void
  t: ChatViewSlotProps['t']
}): JSX.Element {
  return (
    <Modal
      open
      onClose={onClose}
      closeLabel={t('close')}
      title={t(isFolderOpenPath(path) ? 'fileOpen.folderTitle' : 'fileOpen.title')}
      description={message}
      footer={[
        <Button variant="outline" class={css.modalAction ?? ''} onclick={onClose}>{t('cancel')}</Button>,
        <Button variant="primary" class={css.modalAction ?? ''} disabled={busy} onclick={onRetry}>{t('retry')}</Button>,
      ]}
    /> as unknown as JSX.Element
  )
}

/**
 * The chat view slot entry custom element: pure component over the composed
 * props; each ordered business Node crosses the keyed renderer seat.
 */
export class DshChatView extends HTMLElement {
  #props: ChatViewSlotProps | null = null

  #fileOpenError: { path: string; message: string } | null = null
  #fileOpenBusy = false
  #fileOpenRequest = 0
  #atBottom = true
  #atBottomRef = true
  #observedTop = 0
  #anchor: PagingAnchor | null = null
  #firstSeq: number | null = null
  #opened = false
  #lastKey: string | null = null
  #lastSteeringId: string | null = null
  #followSig: string | null = null

  #listEl: HTMLDivElement | null = null
  #columnEl: HTMLDivElement | null = null
  #scrollHandler: (() => void) | null = null
  #resizeObserver: ResizeObserver | null = null
  #boundScrollport: HTMLElement | null = null

  setProps(props: ChatViewSlotProps): void {
    this.#props = props
    this.#render()
    // Post-render layout pass (React's useLayoutEffect equivalent): runs
    // synchronously after the DOM has the new rows so anchor/prepend
    // measurement sees the final layout.
    this.#afterRender()
  }

  connectedCallback(): void {
    this.#render()
    this.#afterRender()
  }

  disconnectedCallback(): void {
    this.#unbindScroll()
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
  }

  #toBottom(el: HTMLElement): void {
    this.#anchor = null
    el.scrollTop = el.scrollHeight
    this.#observedTop = el.scrollTop
    this.#atBottomRef = true
    this.#atBottom = true
    this.#props?.chatScroll.save(null)
  }

  #afterRender(): void {
    const props = this.#props
    if (props === null) return
    const { chatScroll, sessionId: _sessionId } = props
    const local = this.#listEl
    if (local === null) return
    const el = scrollerOf(local)

    this.#bindScroll(el)
    this.#bindResize()

    const order = props.useSession(s => s.chat.order)
    const nodeStore = props.useSession(s => s.chat.nodes)
    const running = props.useSession(s => s.running)
    const openState = props.useSession(s => s.openState)
    const inbox = props.useSession(s => s.queue)
    const pendingSteering = inbox.filter(item => item.placement === 'steering')

    const firstKey = order[0]
    const firstSeq = firstKey === undefined ? null : nodeStore.get(firstKey)?.anchorSeq ?? null
    const lastKey = order.at(-1) ?? null
    const lastNode = lastKey === null ? undefined : nodeStore.get(lastKey)
    const lastSteeringId = pendingSteering[pendingSteering.length - 1]?.id ?? null
    const followSig = `${openState}:${firstSeq}:${lastKey}:${order.length}:${running ? 1 : 0}:${lastSteeringId ?? ''}`

    if (openState === 'open' && !this.#opened) {
      this.#opened = true
      const saved = chatScroll.read()
      if (saved === null) {
        this.#toBottom(el)
      } else {
        el.scrollTop = saved.scrollTop
        const row = anchorElement(local, saved.anchorKey)
        if (row !== null) el.scrollTop += flowTop(row, el) - saved.anchorTop
        this.#observedTop = el.scrollTop
        const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD + 1
        this.#atBottomRef = isAtBottom
        this.#atBottom = isAtBottom
        const normalized = isAtBottom ? null : scrollPosition(local, el)
        if (isAtBottom) chatScroll.save(null)
        else if (normalized !== null) chatScroll.save(normalized)
      }
      this.#firstSeq = firstSeq
      this.#lastKey = lastKey
      this.#lastSteeringId = lastSteeringId
      this.#followSig = followSig
      this.#render()
      return
    }

    if (this.#anchor !== null && firstSeq !== null && this.#firstSeq !== null && firstSeq < this.#firstSeq) {
      const anchor = this.#anchor
      this.#anchor = null
      const row = anchorElement(local, anchor.key)
      if (row !== null) el.scrollTop += flowTop(row, el) - anchor.top
      this.#observedTop = el.scrollTop
      this.#firstSeq = firstSeq
      this.#lastKey = lastKey
      this.#lastSteeringId = lastSteeringId
      this.#followSig = followSig
      return
    }

    this.#firstSeq = firstSeq
    const appendedUser = lastKey !== this.#lastKey && lastNode?.kind === 'user'
    const appendedSteering = lastSteeringId !== null && lastSteeringId !== this.#lastSteeringId
    const tipMoved = this.#followSig !== followSig
    this.#lastKey = lastKey
    this.#lastSteeringId = lastSteeringId
    this.#followSig = followSig
    if (appendedUser || appendedSteering || (tipMoved && this.#atBottomRef)) this.#toBottom(el)
  }

  #bindScroll(el: HTMLElement): void {
    if (this.#boundScrollport === el) return
    this.#unbindScroll()
    const onScroll = (): void => { this.#onScroll() }
    el.addEventListener('scroll', onScroll, { passive: true })
    this.#scrollHandler = onScroll
    this.#boundScrollport = el
  }

  #unbindScroll(): void {
    if (this.#scrollHandler !== null && this.#boundScrollport !== null) {
      this.#boundScrollport.removeEventListener('scroll', this.#scrollHandler)
    }
    this.#scrollHandler = null
    this.#boundScrollport = null
  }

  #bindResize(): void {
    if (this.#resizeObserver !== null) return
    const column = this.#columnEl
    const local = this.#listEl
    if (column === null || local === null || typeof ResizeObserver === 'undefined') return
    const scrollport = scrollerOf(local)
    const composer = scrollport.querySelector<HTMLElement>('[data-composer-seat]')
    const observer = new ResizeObserver(() => { this.#follow() })
    observer.observe(column)
    if (composer !== null) observer.observe(composer)
    this.#resizeObserver = observer
  }

  #follow(): void {
    const local = this.#listEl
    if (local !== null && this.#atBottomRef) {
      const el = scrollerOf(local)
      el.scrollTop = el.scrollHeight
      this.#observedTop = el.scrollTop
      this.#props?.chatScroll.save(null)
    }
  }

  #onScroll(): void {
    const local = this.#listEl
    if (local === null) return
    const el = scrollerOf(local)
    const floor = Math.max(0, el.scrollHeight - el.clientHeight)
    const movedByReader = Math.abs(el.scrollTop - Math.min(this.#observedTop, floor)) > 0.5
    const isAtBottom = movedByReader
      ? floor - el.scrollTop <= FOLLOW_THRESHOLD + 1
      : this.#atBottomRef
    if (!movedByReader && isAtBottom) {
      this.#toBottom(el)
      this.#render()
      return
    }
    this.#atBottomRef = isAtBottom
    this.#atBottom = isAtBottom
    const position = isAtBottom ? null : scrollPosition(local, el)
    if (isAtBottom) {
      this.#anchor = null
    } else if (position !== null) {
      this.#anchor = { key: position.anchorKey, top: position.anchorTop }
    }
    if (isAtBottom) this.#props?.chatScroll.save(null)
    else if (position !== null) this.#props?.chatScroll.save(position)
    this.#observedTop = el.scrollTop
    this.#render()
  }

  #requestOpenFile(path: string): void {
    const props = this.#props
    if (props === null) return
    const id = ++this.#fileOpenRequest
    this.#fileOpenBusy = true
    this.#render()
    void props.openFile(path).then(
      () => {
        if (id !== this.#fileOpenRequest) return
        this.#fileOpenError = null
        this.#fileOpenBusy = false
        this.#render()
      },
      (error: unknown) => {
        if (id !== this.#fileOpenRequest) return
        this.#fileOpenError = {
          path,
          message: openFailureMessage(
            error,
            props.t(isFolderOpenPath(path) ? 'fileOpen.folderUnknown' : 'fileOpen.unknown'),
          ),
        }
        this.#fileOpenBusy = false
        this.#render()
      },
    )
  }

  #closeFileOpenError(): void {
    this.#fileOpenRequest += 1
    this.#fileOpenError = null
    this.#fileOpenBusy = false
    this.#render()
  }

  #loadOlderAnchored(): void {
    const props = this.#props
    if (props === null) return
    const local = this.#listEl
    if (local !== null) {
      const el = scrollerOf(local)
      const row = pagingAnchor(local, el)
      if (row !== null && row.dataset.chatAnchorKey !== undefined) {
        this.#anchor = { key: row.dataset.chatAnchorKey, top: flowTop(row, el) }
      }
    }
    props.loadOlder()
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const {
      useSession, useSessions, useStore, renderSlot, sessionId, inspectCall, chatScroll: _chatScroll, forkAt,
      fileMentions, t,
    } = props

    const order = useSession(s => s.chat.order)
    const timeline = useSession(s => s.chat.timeline)
    const inbox = useSession(s => s.queue)
    const cwd = useSessions(s => s.byId[sessionId]?.cwd)
    const running = useSession(s => s.running)
    const openState = useSession(s => s.openState)
    const openError = useSession(s => s.openError)
    const hasMore = useSession(s => s.hasMore)
    const loadingOlder = useSession(s => s.loadingOlder)
    const selectedCallId = useStore(s => s.selection?.callId)
    const pendingSteering = inbox.filter(item => item.placement === 'steering')
    const renderMessageImages: RenderMessageImages = owner => renderSlot('conversation.message.images', { ...owner, loadImage: props.loadImage })
    const runningTurnStart = runningTurnStartTime(timeline)

    const vdom = (
      <div class={css.root ?? ''}>
        <div
          ref={(el: Element | null) => { this.#listEl = el as HTMLDivElement | null }}
          class={css.scroll ?? ''}
        >
          <div
            ref={(el: Element | null) => { this.#columnEl = el as HTMLDivElement | null }}
            class={css.column ?? ''}
            data-chat-flow=""
          >
            {openState === 'loading' && <div class={css.hint ?? ''}>{t('chat.loadingHistory')}</div>}
            {openState === 'error' && openError !== null && (
              <div class={css.openError ?? ''}>
                {t('chat.loadError', { message: openError.message, code: openError.code })}
              </div>
            )}
            {hasMore && (
              <div class={css.older ?? ''}>
                <button type="button" disabled={loadingOlder} onclick={() => { this.#loadOlderAnchored() }}>
                  {loadingOlder ? t('loading') : t('chat.loadOlder')}
                </button>
              </div>
            )}
            {order.map(nodeKey => (
              <ChatNodeSeat
                key={nodeKey}
                nodeKey={nodeKey}
                useSession={useSession}
                selectedCallId={selectedCallId}
                cwd={cwd}
                openFile={(path: string) => { this.#requestOpenFile(path) }}
                inspectCall={inspectCall}
                forkAt={forkAt}
                renderMessageImages={renderMessageImages}
                fileMentions={fileMentions}
                renderSlot={renderSlot}
                t={t}
              />
            ))}
            {/* No pending placeholders: questions (ui-user-questions) and approvals
                (ApprovalPanel) both take over the composer, so a flow card would
                double-render the same wait. */}
            {/* Turn-level loading signal: rides the whole running turn (first-token
                wait, tool execution, streaming) so it never flickers per step. */}
            {running && (TurnStatus({ startTime: runningTurnStart, t }) as unknown as VNode)}
            {pendingSteering.map(item => (
              <PendingSteeringBubble
                key={item.id}
                content={item.content}
                renderMessageImages={renderMessageImages}
                t={t}
              />
            ))}
          </div>
          {!this.#atBottom && (
            <div class={css.toBottomSlot ?? ''}>
              <button
                type="button"
                class={css.toBottom ?? ''}
                aria-label={t('chat.toBottom')}
                onclick={() => {
                  const local = this.#listEl
                  if (local !== null) { this.#toBottom(scrollerOf(local)); this.#render() }
                }}
              >
                <IconChevronDownOutline14 />
              </button>
            </div>
          )}
        </div>
        {this.#fileOpenError !== null && (FileOpenErrorDialog({
          path: this.#fileOpenError.path,
          message: this.#fileOpenError.message,
          busy: this.#fileOpenBusy,
          onClose: () => { this.#closeFileOpenError() },
          onRetry: () => {
            const error = this.#fileOpenError
            if (error !== null) this.#requestOpenFile(error.path)
          },
          t,
        }) as unknown as VNode)}
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-chat-view') === undefined) {
  customElements.define('dsh-chat-view', DshChatView)
}

/**
 * The chat view slot entry: pure component over the composed props; each
 * ordered business Node crosses the keyed renderer seat.
 */
export function ChatView(props: ChatViewSlotProps): JSX.Element {
  const el = document.createElement('dsh-chat-view') as DshChatView
  el.setProps(props)
  return el as unknown as JSX.Element
}
