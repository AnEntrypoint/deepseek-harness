// Hover/focus label bubble (figma tooltip pill: dark plate, white text).
// TODO: interaction is a placeholder (horizontal overflow clamps and a
// vertical collision flips the bubble to the other side, but there is no
// arrow) — visuals and behavior get a proper pass later.
// The bubble is position:fixed and coordinates come from the anchor's rect at
// show time, so it escapes ancestor overflow clipping (the sidebar rail clips
// its column) without a portal.
//
// Converted from a React hooks component to a webjsx custom element. React's
// cloneElement (injecting hover/focus handlers into an arbitrary child
// element without a wrapper node) has no webjsx equivalent, since webjsx has
// no notion of an opaque "element with props" outside a vnode tree it owns —
// so this version wraps the anchor in a lightweight inline-content span
// instead of cloning it. The wrapper carries no layout box of its own
// (`display: contents`, in Tooltip.module.css) so it does not change the
// anchor's layout context, matching the original's "never changes layout"
// guarantee without needing cloneElement. pos/placement state become
// instance fields; re-render is an explicit applyDiff(this, vdom) call.

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import css from './Tooltip.module.css'

/** Bubble placement relative to the anchor. */
export type TooltipSide = 'right' | 'bottom' | 'top'

type TooltipLabel = string | (() => string)

export interface TooltipProps {
  label: TooltipLabel
  side?: TooltipSide
  delayMs?: number
  disabled?: boolean
  maxWidth?: number
  children: VNode | string
}

const DEFAULT_PROPS: TooltipProps = { label: '', children: '' }

const EDGE_MARGIN = 12

/** Hover/focus tooltip attached to an anchor element, as a custom element. */
export class DshTooltip extends HTMLElement {
  #props: TooltipProps = DEFAULT_PROPS
  #pos: { x: number; top: number; bottom: number } | null = null
  #placement: TooltipSide = 'right'
  #showTimer: ReturnType<typeof setTimeout> | null = null
  #triggers = { hover: false, focus: false }
  #resizeHandler: (() => void) | null = null
  #bubble: HTMLSpanElement | null = null

  setProps(props: TooltipProps): void {
    const wasDisabled = this.#props.disabled === true
    this.#props = props
    this.#placement = props.side ?? 'right'
    if (props.disabled === true && !wasDisabled) {
      this.#cancelShow()
      this.#triggers = { hover: false, focus: false }
      this.#pos = null
      this.#unbindFit()
    }
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  disconnectedCallback(): void {
    this.#cancelShow()
    this.#unbindFit()
  }

  #cancelShow(): void {
    if (this.#showTimer === null) return
    clearTimeout(this.#showTimer)
    this.#showTimer = null
  }

  #anchorEl(): HTMLElement | null {
    return this.querySelector<HTMLElement>('[data-tooltip-anchor]')
  }

  #show(): void {
    if (this.#props.disabled === true) return
    const el = this.#anchorEl()
    if (el === null) return
    const r = el.getBoundingClientRect()
    this.#placement = this.#props.side ?? 'right'
    this.#pos = { x: this.#placement === 'right' ? r.right + 10 : r.left + r.width / 2, top: r.top, bottom: r.bottom }
    this.#bindFit()
    this.#render()
  }

  #showAfterHoverDelay(): void {
    this.#cancelShow()
    const delayMs = this.#props.delayMs ?? 0
    if (delayMs <= 0) { this.#show(); return }
    this.#showTimer = setTimeout(() => {
      this.#showTimer = null
      this.#show()
    }, delayMs)
  }

  #hide(): void {
    this.#cancelShow()
    if (!this.#triggers.hover && !this.#triggers.focus) {
      this.#pos = null
      this.#unbindFit()
      this.#render()
    }
  }

  #bindFit(): void {
    this.#unbindFit()
    const fit = (): void => {
      if (this.#pos === null) return
      const el = this.#bubble
      if (el === null) return
      el.style.left = `${this.#pos.x}px`
      const r = el.getBoundingClientRect()
      let dx = 0
      if (r.right > window.innerWidth - EDGE_MARGIN) dx = window.innerWidth - EDGE_MARGIN - r.right
      if (r.left + dx < EDGE_MARGIN) dx = EDGE_MARGIN - r.left
      el.style.left = `${this.#pos.x + dx}px`
      const side = this.#props.side ?? 'right'
      if (side === 'right') return
      const fitsBelow = this.#pos.bottom + 8 + r.height <= window.innerHeight - EDGE_MARGIN
      const fitsAbove = this.#pos.top - 8 - r.height >= EDGE_MARGIN
      let changed = false
      if (this.#placement === 'bottom' && !fitsBelow && fitsAbove) { this.#placement = 'top'; changed = true }
      if (this.#placement === 'top' && !fitsAbove && fitsBelow) { this.#placement = 'bottom'; changed = true }
      if (changed) this.#render()
    }
    this.#resizeHandler = fit
    // Runs after the bubble is in the DOM (queued via microtask by #render's
    // applyDiff having already run before this call site executes fit()).
    fit()
    window.addEventListener('resize', fit)
  }

  #unbindFit(): void {
    if (this.#resizeHandler === null) return
    window.removeEventListener('resize', this.#resizeHandler)
    this.#resizeHandler = null
  }

  #render(): void {
    const { label, maxWidth, children } = this.#props
    const resolvedLabel = this.#pos === null ? null : typeof label === 'function' ? label() : label
    const y = this.#pos === null
      ? 0
      : this.#placement === 'right'
        ? this.#pos.top + (this.#pos.bottom - this.#pos.top) / 2
        : this.#placement === 'top' ? this.#pos.top - 8 : this.#pos.bottom + 8

    const vdom = (
      <>
        <span
          data-tooltip-anchor
          style="display:contents"
          onmouseenter={() => { this.#triggers.hover = true; this.#showAfterHoverDelay() }}
          onmouseleave={() => { this.#triggers.hover = false; this.#cancelShow(); this.#pos = null; this.#unbindFit(); this.#render() }}
          onfocus={() => { this.#triggers.focus = true; this.#cancelShow(); this.#show() }}
          onblur={() => { this.#triggers.focus = false; this.#hide() }}
        >
          {children}
        </span>
        {this.#pos !== null && (
          <span
            key="bubble"
            class={css.bubble ?? ''}
            data-side={this.#placement}
            style={`left: ${this.#pos.x}px; top: ${y}px;${maxWidth === undefined ? '' : ` max-width: ${maxWidth}px;`}`}
            role="tooltip"
          >
            {resolvedLabel}
          </span>
        )}
      </>
    )
    applyDiff(this, vdom)
    this.#bubble = this.querySelector<HTMLSpanElement>(`.${css.bubble}`)
    if (this.#pos !== null && this.#resizeHandler !== null) this.#resizeHandler()
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-tooltip') === undefined) {
  customElements.define('dsh-tooltip', DshTooltip)
}

/**
 * Create (if needed) or update a Tooltip element in place.
 * @param el - an existing `dsh-tooltip` element to update, or null to create one.
 * @param props - see {@link TooltipProps}.
 * @returns the `dsh-tooltip` element; keep it and pass it back in to update.
 */
export function renderTooltip(el: DshTooltip | null, props: TooltipProps): DshTooltip {
  const target = el ?? document.createElement('dsh-tooltip') as DshTooltip
  target.setProps(props)
  return target
}

/** One-shot creation helper preserving the original function-component call shape. */
export function Tooltip(props: TooltipProps): JSX.Element {
  return renderTooltip(null, props) as unknown as JSX.Element
}
