/**
 * Official popupSelect shell: renders one session's PopupSelectController
 * store into the conversation.input.overlay anchor. Unlike the slash menu
 * (combobox — textarea keeps focus), this shell HOLDS focus while open: the
 * inner search input takes focus, plain typing filters the loaded options
 * locally, Enter/↑↓ drive the filtered highlight (scrolled into view), Escape
 * dismisses back to the composer, and ←→ keep the search input's native
 * caret. Any pointer interaction outside the box dismisses (the click's own
 * target takes focus). Closed state renders nothing; the overlay slot stays
 * mounted. The card height clamps to the space above the composer.
 *
 * Converted from a React hooks component (useSyncExternalStore/useRef/
 * useEffect) to a webjsx custom element: the store subscription becomes a
 * connectedCallback subscribe + disconnectedCallback unsubscribe pair, and
 * every derived effect (highlight scroll, outside-pointer dismiss, search
 * focus, anchored max-height) becomes plain instance bookkeeping recomputed
 * inside #render().
 */
import { applyDiff } from 'webjsx'
import clsx from 'clsx'
import {
  createAnchoredMaxHeight, IconCheckOutline16, renderRiskConfirmation,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { AnchoredMaxHeightController, DshModal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { filterOptions } from './popup.ts'
import type { PopupSelectController } from './popup.ts'
import type { PopupState } from './popup.ts'
import css from './PopupSelectView.css.ts'

/** Design cap on the card height (same MenuDropdown family as the slash menu). */
const MAX_HEIGHT = 320

/** Injected business face of the popupSelect overlay entry. */
export interface PopupSelectInjected {
  /** The session's shell controller (state store + verbs; the view never touches the open-context type). */
  popup: PopupSelectController
}

/** Full shell props: injected face + the locale seat. */
export type PopupSelectViewProps = PopupSelectInjected & PropsLocale<'command'>

/**
 * Render the popupSelect shell overlay entry as a custom element.
 */
export class DshPopupSelectView extends HTMLElement {
  #props: PopupSelectViewProps | null = null
  #unsubscribeStore: (() => void) | null = null
  #cardEl: HTMLDivElement | null = null
  #searchEl: HTMLInputElement | null = null
  #anchored: AnchoredMaxHeightController | null = null
  #maxHeight = MAX_HEIGHT
  #prevActive: number | null = null
  #focusedSearchForOpen = false
  #onPointerDown: ((ev: PointerEvent) => void) | null = null
  // Held across renders (renderRiskConfirmation(this.#confirmModal, ...))
  // instead of the bare <RiskConfirmation ... /> one-shot call, which always
  // created a brand-new dsh-modal appended to document.body on every
  // #render() — orphaning the previous one instead of updating it in place.
  #confirmModal: DshModal | null = null

  /** Set/replace props and re-render; call after creating or updating the element. */
  setProps(props: PopupSelectViewProps): void {
    const popupChanged = this.#props?.popup !== props.popup
    this.#props = props
    if (popupChanged) this.#bindStore()
    this.#render()
  }

  connectedCallback(): void {
    this.#bindStore()
    this.#render()
  }

  disconnectedCallback(): void {
    this.#unsubscribeStore?.()
    this.#unsubscribeStore = null
    this.#anchored?.stop()
    this.#anchored = null
    this.#unbindOutsidePointer()
  }

  #bindStore(): void {
    this.#unsubscribeStore?.()
    const popup = this.#props?.popup
    if (popup === undefined) { this.#unsubscribeStore = null; return }
    this.#unsubscribeStore = popup.state.subscribe(() => { this.#render() })
  }

  #unbindOutsidePointer(): void {
    if (this.#onPointerDown !== null) {
      document.removeEventListener('pointerdown', this.#onPointerDown, true)
      this.#onPointerDown = null
    }
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const { popup, t } = props
    const state: PopupState = popup.state.getSnapshot()

    // Anchored max-height: (re)start the controller whenever the card
    // element identity or state changes, mirroring the React version's
    // effect dependency on [cardRef, MAX_HEIGHT, state].
    this.#anchored?.stop()
    this.#anchored = createAnchoredMaxHeight({
      el: this.#cardEl,
      cap: MAX_HEIGHT,
      onChange: (value) => { this.#maxHeight = value; this.#render() },
    })
    this.#anchored.start()
    this.#maxHeight = this.#anchored.value

    const active = state.open ? state.active : null

    // Outside-pointer dismiss: bind while open and not confirming.
    this.#unbindOutsidePointer()
    if (state.open && state.confirming === null) {
      const onPointerDown = (ev: PointerEvent): void => {
        if (this.#cardEl !== null && ev.target instanceof Node && this.#cardEl.contains(ev.target)) return
        popup.dismiss()
      }
      this.#onPointerDown = onPointerDown
      document.addEventListener('pointerdown', onPointerDown, true)
    }

    if (!state.open) {
      applyDiff(this, [])
      this.#prevActive = null
      this.#focusedSearchForOpen = false
      return
    }

    const rows = filterOptions(state.options, state.search)
    const confirmation = state.confirming?.confirmation

    const onKeyDown = (ev: KeyboardEvent): void => {
      // ArrowLeft/ArrowRight fall through on purpose: the search input keeps
      // its native caret movement.
      switch (ev.key) {
        case 'ArrowDown':
          ev.preventDefault()
          popup.move(1)
          return
        case 'ArrowUp':
          ev.preventDefault()
          popup.move(-1)
          return
        case 'Enter':
          ev.preventDefault()
          void popup.select(state.active)
          return
        case 'Escape':
          ev.preventDefault()
          popup.dismiss({ focusComposer: true })
          return
        default:
      }
    }

    const vdom = [
      state.confirming === null ? (
        <div
          ref={(node) => { this.#cardEl = node as HTMLDivElement | null }}
          class={css.card ?? ''}
          style={`max-height: ${this.#maxHeight}px`}
          aria-label={t('overlay.aria', { command: String(state.command) })}
          onkeydown={onKeyDown}
        >
          <input
            ref={(node) => { this.#searchEl = node as HTMLInputElement | null }}
            class={css.search ?? ''}
            type="text"
            placeholder={t('search.placeholder')}
            aria-label={t('search.aria')}
            value={state.search}
            readonly={state.submitting}
            oninput={(ev: Event) => { popup.setSearch((ev.currentTarget as HTMLInputElement).value) }}
          />
          {state.error !== null && (
            <div class={css.error ?? ''} role="alert">
              <span class={css.errorText ?? ''}>{state.error}</span>
              {state.status === 'failed' && (
                <button type="button" class={css.retry ?? ''} onclick={() => { popup.retry() }}>{t('retry')}</button>
              )}
            </div>
          )}
          {state.status === 'pending' && <div class={css.status ?? ''}>{t('status.loading')}</div>}
          {state.submitting && <div class={css.status ?? ''}>{t('status.applying')}</div>}
          {state.status === 'ready' && rows.length === 0 && <div class={css.status ?? ''}>{t('status.empty')}</div>}
          {state.status === 'ready' && (
            <div role="listbox" aria-label={t('listbox.aria', { command: String(state.command) })} class={css.viewport ?? ''}>
              {rows.map((option, index) => (
                <div
                  key={option.id}
                  role="option"
                  aria-selected={index === state.active}
                  class={clsx(css.row, index === state.active && css.rowActive)}
                  // mousedown would race the document capture listener; the shell
                  // owns focus anyway, so a plain click (inside the card → no
                  // dismiss) works.
                  onclick={() => { void popup.select(index) }}
                  onmouseenter={() => { popup.highlight(index) }}
                >
                  <span class={css.label ?? ''}>{option.label}</span>
                  {option.detail !== undefined && <span class={css.detail ?? ''}>{option.detail}</span>}
                  {option.active === true && <span class={css.check ?? ''}><IconCheckOutline16 /></span>}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null,
    ].filter((node): node is Exclude<typeof node, null> => node !== null)
    applyDiff(this, vdom)

    this.#confirmModal = renderRiskConfirmation(this.#confirmModal, {
      open: confirmation !== undefined,
      title: confirmation?.title ?? '',
      description: confirmation?.description ?? '',
      acknowledgeLabel: confirmation?.acknowledgeLabel ?? '',
      cancelLabel: confirmation?.cancelLabel ?? '',
      confirmLabel: confirmation?.confirmLabel ?? '',
      acknowledged: state.acknowledged,
      onAcknowledgedChange: (value: boolean) => { popup.acknowledge(value) },
      onCancel: () => { popup.cancelConfirmation() },
      onConfirm: () => { void popup.confirm() },
    })

    // The search input keeps focus while arrows move a virtual highlight, so
    // the browser never scrolls the active row into view — do it here.
    if (active !== null && active !== this.#prevActive) {
      this.#cardEl?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
    }
    this.#prevActive = active

    // Focus the search input once per open (mirrors the React version's
    // effect keyed on [state.open, state.confirming]).
    if (state.confirming === null && !this.#focusedSearchForOpen) {
      this.#searchEl?.focus()
      this.#focusedSearchForOpen = true
    }
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-popup-select-view') === undefined) {
  customElements.define('dsh-popup-select-view', DshPopupSelectView)
}
