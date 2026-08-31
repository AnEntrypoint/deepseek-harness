// HoverCard: delayed hover-preview card portaled to document.body.
// Same portal mechanics as Menu: the wrapper span supplies the anchor rect,
// the card is fixed-positioned at its right edge and repositions on
// scroll/resize while open. The card is reachable: it takes pointer events,
// and leaving the anchor only arms a grace-delayed close, so the pointer can
// cross the 8px gap and settle on the card to read a clipped path or title.
//
// Converted from a React hooks component to a webjsx custom element: open/
// pos/copied state become instance fields, the placement/grace/copy effects
// become connectedCallback/disconnectedCallback plus explicit timers, and
// re-render is an explicit applyDiff(this, vdom) call (Toast.tsx's pattern).
// The card is appended to document.body directly (createPortal's webjsx
// equivalent) rather than being a DOM child of the wrapper, so its pointer
// events are wired independently instead of riding React's enter/leave
// tree traversal.

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import { writeClipboard } from './clipboard.ts'
import css from './HoverCard.module.css'

export interface HoverCardProps {
  anchor: VNode | string
  content: VNode | string
  openDelayMs?: number
  disabled?: boolean
  copyText?: string | undefined
  copyLabel?: string | undefined
  copiedLabel?: string | undefined
}

const DEFAULT_PROPS: HoverCardProps = { anchor: '', content: '' }

/** Anchor-with-hover-triggered-preview-card custom element. */
export class DshHoverCard extends HTMLElement {
  #props: HoverCardProps = DEFAULT_PROPS
  #open = false
  #pos: { left: number; top: number } | null = null
  #copied = false
  #openTimer: ReturnType<typeof setTimeout> | null = null
  #closeTimer: ReturnType<typeof setTimeout> | null = null
  #copyTimer: ReturnType<typeof setTimeout> | null = null
  #copyHeight: number | null = null
  #copyEpoch = 0
  #copying = false
  #placeHandler: (() => void) | null = null
  #card: HTMLDivElement | null = null

  setProps(props: HoverCardProps): void {
    const wasDisabled = this.#props.disabled === true
    this.#props = props
    if (props.disabled === true && !wasDisabled) this.#close()
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  disconnectedCallback(): void {
    this.#copyEpoch += 1
    this.#clearOpenTimer()
    this.#clearCloseTimer()
    this.#clearCopyTimer()
    this.#unbindPlacement()
    this.#card?.remove()
    this.#card = null
  }

  #clearOpenTimer(): void {
    if (this.#openTimer !== null) { clearTimeout(this.#openTimer); this.#openTimer = null }
  }

  #clearCloseTimer(): void {
    if (this.#closeTimer !== null) { clearTimeout(this.#closeTimer); this.#closeTimer = null }
  }

  #clearCopyTimer(): void {
    if (this.#copyTimer !== null) { clearTimeout(this.#copyTimer); this.#copyTimer = null }
  }

  #clearCopied(): void {
    this.#clearCopyTimer()
    this.#copyHeight = null
    this.#copied = false
  }

  #close(): void {
    this.#copyEpoch += 1
    this.#clearCopied()
    this.#open = false
    this.#unbindPlacement()
    this.#render()
  }

  #armClose(): void {
    this.#clearCloseTimer()
    this.#closeTimer = setTimeout(() => {
      this.#closeTimer = null
      this.#close()
    }, 200)
  }

  #cancelClose(): void {
    this.#clearCloseTimer()
  }

  #bindPlacement(): void {
    this.#unbindPlacement()
    const place = (): void => {
      const wrapper = this.querySelector<HTMLElement>('[data-hovercard-root]')
      if (wrapper === null) return
      const r = wrapper.getBoundingClientRect()
      const h = this.#card?.offsetHeight ?? 0
      const top = r.top + h > window.innerHeight - 8 ? window.innerHeight - h - 8 : r.top
      this.#pos = { left: r.right + 8, top }
      this.#render()
    }
    this.#placeHandler = place
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
  }

  #unbindPlacement(): void {
    if (this.#placeHandler === null) { this.#pos = null; return }
    window.removeEventListener('scroll', this.#placeHandler, true)
    window.removeEventListener('resize', this.#placeHandler)
    this.#placeHandler = null
    this.#pos = null
  }

  async #copy(text: string): Promise<void> {
    if (this.#copied || this.#copying) return
    this.#copying = true
    const epoch = this.#copyEpoch
    const accepted = await writeClipboard(text)
    this.#copying = false
    if (!accepted || epoch !== this.#copyEpoch || this.#card === null) return
    const height = this.#card.offsetHeight
    this.#copyHeight = height > 0 ? height : null
    this.#copied = true
    this.#render()
    this.#copyTimer = setTimeout(() => {
      this.#copyTimer = null
      this.#clearCopied()
      this.#render()
    }, 1000)
  }

  #render(): void {
    const { anchor, content, openDelayMs = 500, disabled = false, copyText, copyLabel = '复制', copiedLabel = '复制成功' } = this.#props
    const copyable = copyText !== undefined
    const showCard = this.#open && this.#pos !== null

    if (!showCard) {
      this.#card?.remove()
      this.#card = null
    }

    const pos = this.#pos
    const cardVNode: VNode | null = showCard && pos !== null
      ? (
        <div
          class={`${css.card}${copyable ? ` ${css.copyable}` : ''}${this.#copied ? ` ${css.feedback}` : ''}`}
          style={`left: ${pos.left}px; top: ${pos.top}px;${this.#copied && this.#copyHeight !== null ? ` min-height: ${this.#copyHeight}px;` : ''}`}
          role={copyable ? 'button' : null}
          tabindex={copyable ? 0 : undefined}
          aria-label={copyable ? `${copyLabel}: ${copyText}` : undefined}
          onclick={copyable
            ? (e: MouseEvent) => {
              const selection = window.getSelection()
              if (selection !== null && !selection.isCollapsed) {
                for (let i = 0; i < selection.rangeCount; i += 1) {
                  if (selection.getRangeAt(i).intersectsNode(e.currentTarget as Node)) return
                }
              }
              void this.#copy(copyText)
            }
            : null}
          onkeydown={copyable
            ? (e: KeyboardEvent) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              void this.#copy(copyText)
            }
            : null}
        >
          {this.#copied ? <span class={css.copied ?? ''} aria-hidden="true">{copiedLabel}</span> : content}
        </div>
      )
      : null

    if (cardVNode !== null) {
      if (this.#card === null) {
        this.#card = document.createElement('div')
        document.body.appendChild(this.#card)
      }
      applyDiff(this.#card, cardVNode)
    }

    const vdom = (
      <span
        data-hovercard-root
        class={css.root ?? ''}
        onpointerenter={() => {
          if (disabled) return
          this.#cancelClose()
          if (this.#open) return
          this.#clearOpenTimer()
          this.#openTimer = setTimeout(() => {
            this.#openTimer = null
            this.#open = true
            this.#bindPlacement()
            this.#render()
          }, openDelayMs)
        }}
        onpointerleave={() => {
          this.#clearOpenTimer()
          if (this.#open) this.#armClose()
        }}
        onpointerdowncapture={(e: PointerEvent) => {
          if (this.#card?.contains(e.target as Node) === true) return
          this.#clearOpenTimer()
          this.#cancelClose()
          this.#close()
        }}
      >
        {anchor}
        {this.#open && copyable && <span class={css.status ?? ''} role="status">{this.#copied ? copiedLabel : ''}</span>}
      </span>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-hover-card') === undefined) {
  customElements.define('dsh-hover-card', DshHoverCard)
}

/**
 * Create (if needed) or update a HoverCard element in place.
 * @param el - an existing `dsh-hover-card` element to update, or null to create one.
 * @param props - see {@link HoverCardProps}.
 * @returns the `dsh-hover-card` element; keep it and pass it back in to update.
 */
export function renderHoverCard(el: DshHoverCard | null, props: HoverCardProps): DshHoverCard {
  const target = el ?? document.createElement('dsh-hover-card') as DshHoverCard
  target.setProps(props)
  return target
}

/** One-shot creation helper preserving the original function-component call shape. */
export function HoverCard(props: HoverCardProps): JSX.Element {
  return renderHoverCard(null, props) as unknown as JSX.Element
}
