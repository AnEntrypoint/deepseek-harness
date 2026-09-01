/**
 * Per-message feedback controls: a Like/Dislike pair plus an optional note.
 * The buttons render inside the assistant message's IconActions row, so they
 * reuse that row's chrome and sit between copy and branch. The note editor is
 * a popover (portaled to `document.body`) anchored to the note trigger, not an
 * inline expansion: a 260px textarea plus buttons cannot fit the row at any
 * viewport, and an inline element pushed the branch action and clock out of the
 * conversation column. Portaling out of the column also escapes its `overflow`
 * clip, so the panel cannot be cropped or detached from the message it annotates.
 *
 * Converted from a React hooks component to a webjsx custom element: every
 * useState/useRef becomes a private instance field, the `feedback` hook
 * subscription becomes a direct store subscription bound in
 * connectedCallback, useAnchoredPosition becomes createAnchoredPosition
 * (ui-primitives' factory-function conversion of the same hook), the note
 * popover's document.body mount replaces createPortal, and re-render is an
 * explicit applyDiff(this, vdom) call (Toast.tsx's pattern).
 * @module @deepseek-ai/dsh-client-ui-message-feedback/client/MessageFeedbackActions
 */

import { applyDiff } from 'webjsx'
import {
  createAnchoredPosition, IconDislikeOutline16, IconLikeOutline16, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { AnchoredPosition } from '@deepseek-ai/dsh-client-ui-primitives'
import type { MessageFeedbackRating } from '@deepseek-ai/dsh-message-feedback/types'
import type { MessageFeedbackActionProps } from './slots.ts'
import css from './MessageFeedbackActions.css.ts'

/** Safe distance kept between the panel and the viewport edges (the Menu portal margin). */
const PANEL_MARGIN = 12

/** Distance between the trigger's bottom edge and the panel's top. */
const PANEL_GAP = 4

/**
 * One message's feedback controls, as a custom element.
 */
export class DshMessageFeedbackActions extends HTMLElement {
  #props: MessageFeedbackActionProps | null = null
  #noteOpen = false
  #draft = ''
  #pending = false
  /** A rating or load failure surfaces beside the rating buttons, always legible
   * whether or not the note popover is open. */
  #rowFailure: string | null = null
  /** A note save failure surfaces inside the note popover, where the human is
   * looking; it stays open so the draft survives to be corrected. */
  #noteFailure: string | null = null
  #triggerEl: HTMLButtonElement | null = null
  #panelEl: HTMLDivElement | null = null
  #inputEl: HTMLTextAreaElement | null = null
  /** The controls mount for every settled message in the transcript, so the
   * Session's feedback is read once on first hover/focus rather than on mount. */
  #seeded = false
  #alive = true
  /** Bumped whenever an editing session ends, so a late save can tell it is stale. */
  #noteGeneration = 0
  #wasOpen = false
  #pos: ReturnType<typeof createAnchoredPosition> | null = null
  #posValue: AnchoredPosition | null = null
  #portalEl: HTMLDivElement | null = null
  #pointerHandler: ((e: PointerEvent) => void) | null = null
  #keyHandler: ((e: KeyboardEvent) => void) | null = null

  /** Set/replace props and re-render; call after creating or updating the element. */
  setProps(props: MessageFeedbackActionProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#alive = true
    this.#render()
  }

  disconnectedCallback(): void {
    this.#alive = false
    this.#pos?.stop()
    this.#unbindNoteListeners()
    this.#portalEl?.remove()
    this.#portalEl = null
  }

  #seed(): void {
    if (this.#seeded) return
    this.#seeded = true
    void this.#props?.ensure()
  }

  #errorCopy(result: { ok: boolean; error?: { code: string } }): string {
    const t = this.#props?.t
    if (t === undefined) return ''
    return result.error?.code === 'version-conflict' ? t('error.conflict') : t('error.generic')
  }

  #settleRating(result: { ok: boolean; error?: { code: string } }): void {
    if (!this.#alive) return
    this.#pending = false
    this.#rowFailure = result.ok ? null : this.#errorCopy(result)
    this.#render()
  }

  #closeNote(): void {
    // Ends the editing session, so any save still in flight becomes stale.
    this.#noteGeneration += 1
    this.#noteOpen = false
    this.#syncNotePosition()
    this.#render()
  }

  #onRate(next: MessageFeedbackRating): void {
    const props = this.#props
    if (props === null) return
    const messageId = props.messageId
    this.#pending = true
    this.#rowFailure = null
    // The controller decides retract-vs-replace from the committed item, so a
    // click that lands before the first list read still toggles the stored
    // value instead of this render's empty view.
    this.#closeNote()
    void props.toggle(messageId, next).then((result) => { this.#settleRating(result) })
  }

  // The rating is a parameter because only the note editor's render site can
  // prove one is recorded; that removes an unreachable undefined guard here.
  #onSaveNote(item: { note?: string } | undefined, current: MessageFeedbackRating): void {
    const props = this.#props
    if (props === null) return
    const messageId = props.messageId
    const trimmed = this.#draft.trim()
    this.#pending = true
    this.#noteFailure = null
    this.#render()
    // A save belongs to the editing session that started it. Closing and
    // reopening the panel begins a new one, and a late reply from the old
    // session must not act on it: a stale success would shut the panel the
    // human just opened, and a stale failure would describe a draft this
    // session never sent.
    const generation = this.#noteGeneration
    // What a session reopened before this save commits would be seeded with.
    const staleSeed = item?.note ?? ''
    // An emptied editor removes the note explicitly; `rate` alone preserves a
    // stored note, so it cannot express deletion.
    const settled = trimmed.length === 0
      ? props.clearNote(messageId)
      : props.rate(messageId, current, trimmed)
    void settled.then((result) => {
      if (!this.#alive) return
      // `pending` tracks the request in flight, not the editing session, so it
      // is released either way.
      this.#pending = false
      if (result.ok) {
        // Only the session that is still open may act on a success.
        if (generation === this.#noteGeneration) {
          this.#noteFailure = null
          this.#noteOpen = false
          this.#syncNotePosition()
          this.#render()
          return
        }
        // A newer session is open, seeded from the note as it read before this
        // save committed. Resync it so the editor shows what is stored and the
        // next save cannot overwrite the text that just landed. An edited draft
        // is the human's, so it is left alone.
        if (this.#draft === staleSeed) this.#draft = trimmed
        this.#render()
        return
      }
      // A failure from the session still on screen belongs in its panel. One
      // from an abandoned session is reported only when no new session has
      // taken over.
      if (generation === this.#noteGeneration || !this.#noteOpen) {
        this.#noteFailure = this.#errorCopy(result)
      }
      this.#render()
    })
  }

  // The trigger toggles: while closed it opens the popover (seeding the draft
  // with the recorded note), while open it closes it.
  #toggleNote(item: { note?: string } | undefined): void {
    if (this.#noteOpen) {
      this.#closeNote()
      return
    }
    this.#draft = item?.note ?? ''
    this.#noteFailure = null
    this.#noteOpen = true
    this.#syncNotePosition()
    this.#bindNoteListeners()
    this.#render()
    queueMicrotask(() => { this.#inputEl?.focus() })
  }

  #syncNotePosition(): void {
    if (this.#pos === null) {
      this.#pos = createAnchoredPosition({
        anchor: this.#triggerEl,
        panel: this.#panelEl,
        gap: PANEL_GAP,
        margin: PANEL_MARGIN,
        onChange: (value) => { this.#posValue = value; this.#render() },
      })
    }
    if (this.#noteOpen) this.#pos.start()
    else this.#pos.stop()
  }

  #bindNoteListeners(): void {
    this.#unbindNoteListeners()
    const onPointerDown = (e: PointerEvent): void => {
      if (!(e.target instanceof Node)) return
      if (this.#triggerEl?.contains(e.target) === true) return
      if (this.#panelEl?.contains(e.target) === true) return
      this.#closeNote()
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') this.#closeNote()
    }
    this.#pointerHandler = onPointerDown
    this.#keyHandler = onKeyDown
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
  }

  #unbindNoteListeners(): void {
    if (this.#pointerHandler !== null) {
      document.removeEventListener('pointerdown', this.#pointerHandler)
      this.#pointerHandler = null
    }
    if (this.#keyHandler !== null) {
      document.removeEventListener('keydown', this.#keyHandler)
      this.#keyHandler = null
    }
  }

  #render(): void {
    const props = this.#props
    if (props === null) { applyDiff(this, []); return }
    const { messageId, useFeedback, t } = props
    // NOTE: useFeedback is the framework standard-kit's React-hook binding
    // (InjectFace synthesizes it from the registered HostObservable); this
    // custom element calls it outside a React render as a best-effort bridge
    // — the raw observable itself is not threaded onto composed props. See
    // batch report: cross-package blocker in ui-slots/ui-renderer, out of
    // this package's scope.
    const view = useFeedback(v => v)
    const item = view.items.get(messageId)
    const loadFailed = view.status === 'error'
    const rating = item?.rating

    if (!this.#noteOpen) this.#unbindNoteListeners()

    const likeLabel = rating === 'positive' ? t('action.likeActive') : t('action.like')
    const dislikeLabel = rating === 'negative' ? t('action.dislikeActive') : t('action.dislike')

    // Return focus to the trigger only when the panel actually closes, not on
    // the initial mount.
    if (this.#noteOpen) {
      this.#wasOpen = true
    } else if (this.#wasOpen) {
      this.#wasOpen = false
      this.#triggerEl?.focus()
    }

    const panelStyle = this.#posValue === null
      ? 'visibility: hidden; left: 0; top: 0'
      : `left: ${this.#posValue.left}px; top: ${this.#posValue.top}px`

    const panelVNode = rating !== undefined && this.#noteOpen
      ? (
        <div
          class={css.notePanel ?? ''}
          role="dialog"
          aria-label={t('note.dialog')}
          style={panelStyle}
          ref={(node: Node | null) => { this.#panelEl = node as HTMLDivElement | null }}
        >
          <textarea
            class={css.noteInput ?? ''}
            aria-label={t('note.aria')}
            placeholder={t('note.placeholder')}
            value={this.#draft}
            rows="3"
            ref={(node: Node | null) => { this.#inputEl = node as HTMLTextAreaElement | null }}
            oninput={(event: Event) => { this.#draft = (event.currentTarget as HTMLTextAreaElement).value; this.#render() }}
          />
          <div class={css.noteActions ?? ''}>
            <button
              type="button"
              class={css.noteSave ?? ''}
              disabled={this.#pending}
              onclick={() => { if (rating !== undefined) this.#onSaveNote(item, rating) }}
            >
              {t('note.save')}
            </button>
            <button type="button" class={css.noteCancel ?? ''} onclick={() => { this.#closeNote() }}>
              {t('note.cancel')}
            </button>
          </div>
          {this.#noteFailure !== null && <span class={css.failure ?? ''} role="status">{this.#noteFailure}</span>}
        </div>
      )
      : null

    if (panelVNode !== null) {
      if (this.#portalEl === null) {
        this.#portalEl = document.createElement('div')
        document.body.appendChild(this.#portalEl)
      }
      applyDiff(this.#portalEl, panelVNode)
    } else {
      this.#portalEl?.remove()
      this.#portalEl = null
    }

    const vdom = (
      <>
        <Tooltip label={likeLabel} side="bottom">
          <button
            type="button"
            class={css.action ?? ''}
            aria-label={likeLabel}
            aria-pressed={rating === 'positive'}
            data-active={rating === 'positive' || undefined}
            disabled={this.#pending}
            onfocus={() => { this.#seed() }}
            onpointerenter={() => { this.#seed() }}
            onclick={() => { this.#onRate('positive') }}
          >
            <IconLikeOutline16 />
          </button>
        </Tooltip>
        <Tooltip label={dislikeLabel} side="bottom">
          <button
            type="button"
            class={css.action ?? ''}
            aria-label={dislikeLabel}
            aria-pressed={rating === 'negative'}
            data-active={rating === 'negative' || undefined}
            disabled={this.#pending}
            onfocus={() => { this.#seed() }}
            onpointerenter={() => { this.#seed() }}
            onclick={() => { this.#onRate('negative') }}
          >
            <IconDislikeOutline16 />
          </button>
        </Tooltip>
        {rating !== undefined && (
          <button
            type="button"
            class={css.noteOpen ?? ''}
            aria-haspopup="dialog"
            aria-expanded={this.#noteOpen}
            ref={(node: Node | null) => { this.#triggerEl = node as HTMLButtonElement | null }}
            onclick={() => { this.#toggleNote(item) }}
          >
            {item?.note === undefined ? t('note.open') : item.note}
          </button>
        )}
        {this.#rowFailure === null && loadFailed && (
          <span class={css.failure ?? ''} role="status">{t('error.load')}</span>
        )}
        {this.#rowFailure !== null && <span class={css.failure ?? ''} role="status">{this.#rowFailure}</span>}
        {/* A note-save failure normally lives inside the panel. Whenever the
            panel is not on screen it falls back to the row instead. */}
        {!(rating !== undefined && this.#noteOpen) && this.#noteFailure !== null && (
          <span class={css.failure ?? ''} role="status">{this.#noteFailure}</span>
        )}
      </>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-message-feedback-actions') === undefined) {
  customElements.define('dsh-message-feedback-actions', DshMessageFeedbackActions)
}

/** One-shot creation helper preserving the original function-component call shape. */
export function MessageFeedbackActions(props: MessageFeedbackActionProps): DshMessageFeedbackActions {
  const el = document.createElement('dsh-message-feedback-actions') as DshMessageFeedbackActions
  el.setProps(props)
  return el
}
