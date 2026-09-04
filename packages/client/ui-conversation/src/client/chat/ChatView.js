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

import { applyDiff, createElement as h } from 'webjsx'
import { Button, IconChevronDownOutline14, renderModal } from '@freddie/freddie-client-ui-primitives'
import { PendingSteeringBubble } from './MessageItem.js'
import { ChatNodeSeat } from './ChatNodeSeat.js'
import { formatRunDuration } from './message-chrome.js'
import css from './ChatView.css.js'

const FOLLOW_THRESHOLD = 24

/** Active column host when present; otherwise the view-local scroller. */
function scrollerOf(from) {
  return (from.closest('[data-conversation-scroll]')) ?? from
}

/** Find an already-rendered settled row without interpolating a selector. */
function anchorElement(list, key) {
  for (const row of list.querySelectorAll('[data-chat-anchor-key]')) {
    if (row.dataset.chatAnchorKey === key) return row
  }
  return null
}

/** Row position in scrollport coordinates (viewport-independent). */
function flowTop(row, scrollport) {
  return row.getBoundingClientRect().top - scrollport.getBoundingClientRect().top
}

/** Select a visible stable node/call identity, falling back only when layout
 * has not exposed a visible box yet. */
function pagingAnchor(list, scrollport) {
  const viewport = scrollport.getBoundingClientRect()
  const composer = scrollport.querySelector('[data-composer-seat]')
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
          ? element.closest('[data-chat-anchor-key]')
          : null
        if (row !== null && list.contains(row)) return row
      }
    }
  }
  const rows = [...list.querySelectorAll('[data-chat-anchor-key]')]
  const visibleRows = rows.filter((row) => {
    const rect = row.getBoundingClientRect()
    return rect.bottom > viewport.top && rect.top < visibleBottom
  })
  return visibleRows[0] ?? rows[0] ?? null
}

/** Capture a reflow-resistant reader position from the current rendered window. */
function scrollPosition(list, scrollport) {
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
function openFailureMessage(error, fallback) {
  const message = error instanceof Error ? error.message : String(error)
  return message === '' ? fallback : message
}

/** ProducedFiles opens the session workspace as `.`. */
function isFolderOpenPath(path) {
  return path === '.'
}

function runningTurnStartTime(timeline) {
  let latest = null
  for (const turn of timeline.turns.values()) {
    if (turn.status === 'open' && turn.start !== undefined) latest = turn.start.time
  }
  return latest
}

/** Turn-level model activity label custom element: retains elapsed time across
 * first-token, tool, and streaming phases via an internal ticking clock. */
class DshTurnStatus extends HTMLElement {
  #startTime = null
  #t = (key) => key
  #mountedAt = Date.now()
  #elapsedMs = 0
  #tickId = null

  setProps(startTime, t) {
    this.#startTime = startTime
    this.#t = t
    this.#tick()
  }

  connectedCallback() {
    this.#mountedAt = Date.now()
    this.#tick()
    this.#tickId = setInterval(() => { this.#tick() }, 1000)
  }

  disconnectedCallback() {
    if (this.#tickId !== null) { clearInterval(this.#tickId); this.#tickId = null }
  }

  #tick() {
    const anchor = this.#startTime ?? this.#mountedAt
    this.#elapsedMs = Math.max(0, Date.now() - anchor)
    this.#render()
  }

  #render() {
    const showClock = this.#elapsedMs >= 15_000
    const vdom = h(
      'div',
      { class: css.turnStatus ?? '', role: 'status', 'aria-live': 'polite' },
      'Deep diving...',
      showClock && (
        h('span', { class: css.turnStatusClock ?? '', 'aria-hidden': true },
          formatRunDuration(this.#elapsedMs, this.#t))
      ),
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-turn-status') === undefined) {
  customElements.define('dsh-turn-status', DshTurnStatus)
}

/** In-page Host open-path refusal: the wire reason plus a retry of the same path. */
function fileOpenErrorModalProps({
  path, message, busy, onClose, onRetry, t,
}) {
  return {
    open: true,
    onClose,
    closeLabel: t('close'),
    title: t(isFolderOpenPath(path) ? 'fileOpen.folderTitle' : 'fileOpen.title'),
    description: message,
    footer: [
      h(Button, { variant: 'outline', class: css.modalAction ?? '', onclick: onClose }, t('cancel')),
      h(Button, { variant: 'primary', class: css.modalAction ?? '', disabled: busy, onclick: onRetry }, t('retry')),
    ],
  }
}

/**
 * The chat view slot entry custom element: pure component over the composed
 * props; each ordered business Node crosses the keyed renderer seat.
 */
export class DshChatView extends HTMLElement {
  #props = null

  #fileOpenError = null
  #fileOpenBusy = false
  #fileOpenRequest = 0
  #atBottom = true
  #atBottomRef = true
  #observedTop = 0
  #anchor = null
  #firstSeq = null
  #opened = false
  #lastKey = null
  #lastSteeringId = null
  #followSig = null

  #listEl = null
  #columnEl = null
  #scrollHandler = null
  #resizeObserver = null
  #boundScrollport = null
  #turnStatus = null
  #fileOpenModal = null

  setProps(props) {
    this.#props = props
    this.#render()
    // Post-render layout pass (React's useLayoutEffect equivalent): runs
    // synchronously after the DOM has the new rows so anchor/prepend
    // measurement sees the final layout.
    this.#afterRender()
  }

  connectedCallback() {
    this.#render()
    this.#afterRender()
  }

  disconnectedCallback() {
    this.#unbindScroll()
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
    this.#fileOpenModal?.remove()
    this.#fileOpenModal = null
  }

  #toBottom(el) {
    this.#anchor = null
    el.scrollTop = el.scrollHeight
    this.#observedTop = el.scrollTop
    this.#atBottomRef = true
    this.#atBottom = true
    this.#props?.chatScroll.save(null)
  }

  #afterRender() {
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

  #bindScroll(el) {
    if (this.#boundScrollport === el) return
    this.#unbindScroll()
    const onScroll = () => { this.#onScroll() }
    el.addEventListener('scroll', onScroll, { passive: true })
    this.#scrollHandler = onScroll
    this.#boundScrollport = el
  }

  #unbindScroll() {
    if (this.#scrollHandler !== null && this.#boundScrollport !== null) {
      this.#boundScrollport.removeEventListener('scroll', this.#scrollHandler)
    }
    this.#scrollHandler = null
    this.#boundScrollport = null
  }

  #bindResize() {
    if (this.#resizeObserver !== null) return
    const column = this.#columnEl
    const local = this.#listEl
    if (column === null || local === null || typeof ResizeObserver === 'undefined') return
    const scrollport = scrollerOf(local)
    const composer = scrollport.querySelector('[data-composer-seat]')
    const observer = new ResizeObserver(() => { this.#follow() })
    observer.observe(column)
    if (composer !== null) observer.observe(composer)
    this.#resizeObserver = observer
  }

  #follow() {
    const local = this.#listEl
    if (local !== null && this.#atBottomRef) {
      const el = scrollerOf(local)
      el.scrollTop = el.scrollHeight
      this.#observedTop = el.scrollTop
      this.#props?.chatScroll.save(null)
    }
  }

  #onScroll() {
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

  #requestOpenFile(path) {
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
      (error) => {
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

  #closeFileOpenError() {
    this.#fileOpenRequest += 1
    this.#fileOpenError = null
    this.#fileOpenBusy = false
    this.#render()
  }

  #loadOlderAnchored() {
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

  #render() {
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
    const renderMessageImages = owner => renderSlot('conversation.message.images', { ...owner, loadImage: props.loadImage })
    const runningTurnStart = runningTurnStartTime(timeline)

    const vdom = h(
      'div',
      { class: css.root ?? '' },
      h(
        'div',
        {
          ref: (el) => { this.#listEl = el },
          class: css.scroll ?? '',
        },
        h(
          'div',
          {
            ref: (el) => { this.#columnEl = el },
            class: css.column ?? '',
            'data-chat-flow': '',
          },
          openState === 'loading' && h('div', { class: css.hint ?? '' }, t('chat.loadingHistory')),
          openState === 'error' && openError !== null && (
            h('div', { class: css.openError ?? '' },
              t('chat.loadError', { message: openError.message, code: openError.code }))
          ),
          hasMore && (
            h(
              'div',
              { class: css.older ?? '' },
              h(
                'button',
                { type: 'button', disabled: loadingOlder, onclick: () => { this.#loadOlderAnchored() } },
                loadingOlder ? t('loading') : t('chat.loadOlder'),
              ),
            )
          ),
          order.map(nodeKey => h(ChatNodeSeat, {
            key: nodeKey,
            nodeKey,
            useSession,
            selectedCallId,
            cwd,
            openFile: (path) => { this.#requestOpenFile(path) },
            inspectCall,
            forkAt,
            renderMessageImages,
            fileMentions,
            renderSlot,
            t,
          })),
          // No pending placeholders: questions (ui-user-questions) and approvals
          // (ApprovalPanel) both take over the composer, so a flow card would
          // double-render the same wait.
          // Turn-level loading signal: rides the whole running turn (first-token
          // wait, tool execution, streaming) so it never flickers per step.
          running && (() => {
            const el = this.#turnStatus ??= document.createElement('dsh-turn-status')
            el.setProps(runningTurnStart, t)
            return el
          })(),
          pendingSteering.map(item => h(PendingSteeringBubble, {
            key: item.id,
            content: item.content,
            renderMessageImages,
            t,
          })),
        ),
        !this.#atBottom && (
          h(
            'div',
            { class: css.toBottomSlot ?? '' },
            h(
              'button',
              {
                type: 'button',
                class: css.toBottom ?? '',
                'aria-label': t('chat.toBottom'),
                onclick: () => {
                  const local = this.#listEl
                  if (local !== null) { this.#toBottom(scrollerOf(local)); this.#render() }
                },
              },
              h(IconChevronDownOutline14, null),
            ),
          )
        ),
      ),
    )
    applyDiff(this, vdom)
    const fileOpenError = this.#fileOpenError
    if (fileOpenError !== null) {
      this.#fileOpenModal = renderModal(this.#fileOpenModal, fileOpenErrorModalProps({
        path: fileOpenError.path,
        message: fileOpenError.message,
        busy: this.#fileOpenBusy,
        onClose: () => { this.#closeFileOpenError() },
        onRetry: () => {
          const error = this.#fileOpenError
          if (error !== null) this.#requestOpenFile(error.path)
        },
        t,
      }))
    } else if (this.#fileOpenModal !== null) {
      this.#fileOpenModal.remove()
      this.#fileOpenModal = null
    }
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-chat-view') === undefined) {
  customElements.define('dsh-chat-view', DshChatView)
}

/**
 * The chat view slot entry: pure component over the composed props; each
 * ordered business Node crosses the keyed renderer seat.
 */
export function ChatView(props) {
  const el = document.createElement('dsh-chat-view')
  el.setProps(props)
  return el
}
