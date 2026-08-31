/**
 * Trigger candidate menu: renders the InputTriggerService menu store into the
 * conversation.input.overlay anchor. Closed state renders null (the overlay
 * slot stays mounted); groups render in roster order under localized title
 * rows, pending groups as a loading row; pointer picks route back through
 * the service (combobox pattern — focus never leaves the textarea, so rows
 * are mousedown-handled and the highlight is exposed via
 * aria-activedescendant on the listbox).
 *
 * Converted from a React hooks component to a webjsx custom element: the
 * menu-store subscription that was useSyncExternalStore becomes a
 * connectedCallback/disconnectedCallback-managed subscribe, the
 * scrollIntoView and pointer-dismiss effects become explicit re-arm-on-render
 * bookkeeping, and re-render is an explicit applyDiff(this, vdom) call
 * (Toast.tsx's pattern) instead of implicit re-render on state change.
 */
import { applyDiff } from 'webjsx'
import clsx from 'clsx'
import { createAnchoredMaxHeight, type AnchoredMaxHeightController } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './MenuView.module.css'
import type { MenuViewInjected } from './slots.ts'
import type { MenuKey } from './locales.ts'
import type { MenuState } from '../core/contract.ts'

/** Full menu props: injected face + the locale seat. */
export type MenuViewProps = MenuViewInjected & PropsLocale<'slash.menu'>

/** Design cap on the list height (figma SLASH 39:26572 MenuDropdown). */
const MAX_HEIGHT = 320

/** DOM id of one option row (the aria-activedescendant target). */
function optionId(source: string, index: number): string {
  return `dsh-slash-option-${source}-${index}`
}

/** Render the candidate menu overlay entry custom element (see module doc). */
export class DshMenuView extends HTMLElement {
  #props: MenuViewProps | null = null
  #state: MenuState | null = null
  #unsubscribeMenu: (() => void) | null = null
  #anchored: AnchoredMaxHeightController | null = null
  #maxHeight = MAX_HEIGHT
  #lastHighlight: { source: string; index: number } | null = null
  #outsidePointer: ((ev: PointerEvent) => void) | null = null

  /** Set/replace props and re-render; call after creating or updating the element. */
  setProps(props: MenuViewProps): void {
    const menuChanged = this.#props?.menu !== props.menu
    this.#props = props
    if (menuChanged) this.#bindMenu()
    this.#render()
  }

  connectedCallback(): void {
    this.#bindMenu()
    this.#render()
  }

  disconnectedCallback(): void {
    this.#unbindMenu()
    this.#unbindOutsidePointer()
    this.#anchored?.stop()
    this.#anchored = null
  }

  #bindMenu(): void {
    this.#unbindMenu()
    const menu = this.#props?.menu
    if (menu === undefined) return
    this.#state = menu.getSnapshot()
    this.#unsubscribeMenu = menu.subscribe(() => {
      this.#state = menu.getSnapshot()
      this.#render()
    })
  }

  #unbindMenu(): void {
    this.#unsubscribeMenu?.()
    this.#unsubscribeMenu = null
  }

  #unbindOutsidePointer(): void {
    if (this.#outsidePointer !== null) {
      document.removeEventListener('pointerdown', this.#outsidePointer, true)
      this.#outsidePointer = null
    }
  }

  #render(): void {
    const props = this.#props
    const state = this.#state
    if (props === null || state === null || !state.open) {
      applyDiff(this, <span style="display:none" />)
      this.#unbindOutsidePointer()
      this.#anchored?.stop()
      return
    }
    const { onPick, onDismiss, t } = props
    const highlight = state.highlight

    // Dismiss on pointer outside the menu AND outside the composer card
    // (clicking the textarea or bottom bar must not close the menu).
    this.#unbindOutsidePointer()
    const onPointerDown = (ev: PointerEvent): void => {
      if (!(ev.target instanceof Node)) return
      if (this.contains(ev.target)) return
      const composerCard = this.closest('[data-composer-card]')
      if (composerCard?.contains(ev.target) === true) return
      onDismiss()
    }
    this.#outsidePointer = onPointerDown
    document.addEventListener('pointerdown', onPointerDown, true)

    const vdom = (
      <div
        class={css.menu ?? ''}
        style={`max-height: ${this.#maxHeight}px`}
        role="listbox"
        aria-label={t('suggestions.aria')}
        aria-activedescendant={highlight !== null ? optionId(highlight.source, highlight.index) : null}
      >
        <div class={css.viewport ?? ''}>
          {state.groups.map(group => (group.status === 'ready' && group.items.length === 0)
            ? null
            : (
              // Source names key the dictionary open-endedly: the lookup
              // chain returns an unknown key verbatim, so an unregistered
              // source shows its raw name — hence the cast past the typed
              // key union.
              [
                group.showGroupTitle === false || group.items.some(item => item.section !== undefined)
                  ? null
                  : <div class={css.groupTitle ?? ''} role="presentation" data-source={group.source}>{t(group.source as MenuKey)}</div>,
                group.status === 'pending'
                  ? <div class={css.loading ?? ''} data-source={group.source}>{t('loading')}</div>
                  : group.items.map((item, index) => {
                    const active = highlight !== null && highlight.source === group.source && highlight.index === index
                    return [
                      item.section !== undefined && item.section !== group.items[index - 1]?.section
                        ? <div class={css.sectionTitle ?? ''} role="presentation">{item.section}</div>
                        : null,
                      <button
                        id={optionId(group.source, index)}
                        type="button"
                        role="option"
                        aria-selected={String(active)}
                        class={clsx(css.item, active && css.active)}
                        // mousedown, not click: the textarea keeps focus
                        // (combobox pattern) — preventing default stops the
                        // focus steal, and the pick runs before any
                        // blur-driven teardown.
                        onmousedown={(ev: MouseEvent) => {
                          ev.preventDefault()
                          onPick(group.source, index)
                        }}
                      >
                        {item.icon !== undefined && <span class={css.itemIcon ?? ''} aria-hidden>{item.icon}</span>}
                        <span class={css.itemName ?? ''}>{item.name}</span>
                        {item.description !== undefined && <span class={css.itemDescription ?? ''}>{item.description}</span>}
                      </button>,
                    ]
                  }),
              ]
            ))}
        </div>
      </div>
    )
    applyDiff(this, vdom)

    // Anchor re-fit: the list is bottom-anchored above the composer; clamp
    // the design cap to the space above it, re-measured whenever the store
    // updates (the anchor moves when the composer grows).
    this.#anchored?.stop()
    this.#anchored = createAnchoredMaxHeight({
      el: this,
      cap: MAX_HEIGHT,
      onChange: (maxHeight) => {
        this.#maxHeight = maxHeight
        this.#render()
      },
    })
    this.#maxHeight = this.#anchored.value
    this.#anchored.start()
    this.#maxHeight = this.#anchored.value

    // Focus stays in the textarea (combobox pattern), so the browser never
    // scrolls the active option into view on keyboard moves — do it here.
    const highlightChanged = highlight !== null
      && (this.#lastHighlight === null || this.#lastHighlight.source !== highlight.source || this.#lastHighlight.index !== highlight.index)
    this.#lastHighlight = highlight
    if (highlightChanged) {
      document.getElementById(optionId(highlight.source, highlight.index))
        ?.scrollIntoView({ block: 'nearest' })
    }
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-menu-view') === undefined) {
  customElements.define('dsh-menu-view', DshMenuView)
}
