// Modal: controlled full-viewport dialog (create-workspace and similar).
// The overlay portals to this document's body so ancestor stacking contexts
// cannot leave sticky page controls above the mask. This is still an in-page
// WebUI dialog; it never creates or targets another browser/native window.
//
// Converted from a React hooks component to a webjsx custom element: the
// Escape-key listener that was useEffect becomes connectedCallback/
// disconnectedCallback, and re-render is an explicit applyDiff(this, vdom)
// call (Toast.tsx's pattern) instead of implicit re-render on state change.

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import clsx from 'clsx'
import { IconCloseOutline16 } from './icons/index.tsx'
import css from './Modal.module.css'

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  closeLabel?: string
  description?: string
  children?: VNode | VNode[] | string | null
  footer?: VNode | VNode[] | string | null
  className?: string
  contentClassName?: string
  headless?: boolean
}

/**
 * Centered modal over a blurred page mask, as a custom element. Attaches
 * itself to `document.body` on connect (mirrors Toast's mount pattern) so an
 * owner inside a transformed or filtered ancestor cannot trap the fixed
 * overlay in that ancestor's box.
 */
export class DshModal extends HTMLElement {
  #props: ModalProps = { open: false, onClose: () => {}, title: '' }

  /** Set/replace props and re-render; call after creating or updating the element. */
  setProps(props: ModalProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    document.addEventListener('keydown', this.#onKeyDown)
    this.#render()
  }

  disconnectedCallback(): void {
    document.removeEventListener('keydown', this.#onKeyDown)
  }

  #onKeyDown = (e: KeyboardEvent): void => {
    if (!this.#props.open) return
    if (e.key === 'Escape') this.#props.onClose()
  }

  #render(): void {
    const {
      open, onClose, title, closeLabel = 'Close', description, children, footer,
      className, contentClassName, headless = false,
    } = this.#props

    if (!open) {
      applyDiff(this, <span style="display:none" />)
      return
    }

    const vdom = (
      <div class={css.root ?? ''} role="presentation">
        <div class={css.mask ?? ''} aria-hidden="true" onclick={onClose} />
        <div
          class={clsx(css.dialog, className)}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          {headless
            ? children
            : (
              <>
                <div class={clsx(css.content, contentClassName)}>
                  <div class={css.header ?? ''}>
                    <h2 class={css.title ?? ''}>{title}</h2>
                    <button type="button" class={css.close ?? ''} aria-label={closeLabel} onclick={onClose}>
                      <IconCloseOutline16 size={14} />
                    </button>
                  </div>
                  {description !== undefined && description !== '' && (
                    <p class={css.description ?? ''}>{description}</p>
                  )}
                  {children !== undefined && children !== null && <div class={css.body ?? ''}>{children}</div>}
                </div>
                {footer !== undefined && footer !== null && <div class={css.footer ?? ''}>{footer}</div>}
              </>
            )}
        </div>
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-modal') === undefined) {
  customElements.define('dsh-modal', DshModal)
}

/**
 * Create (if needed) and update a Modal mounted on `document.body`.
 * @param el - an existing mounted modal (from a prior call), or null to create one.
 * @param props - see {@link ModalProps}.
 * @returns the mounted `dsh-modal` element; keep it and pass it back in to update, `.remove()` when done with it.
 */
export function renderModal(el: DshModal | null, props: ModalProps): DshModal {
  const target = el ?? (() => {
    const created = document.createElement('dsh-modal') as DshModal
    document.body.appendChild(created)
    return created
  })()
  target.setProps(props)
  return target
}

/**
 * Convenience wrapper preserving the original function-component call shape
 * for simple one-shot usage: creates the element, sets props, and returns it.
 * Callers that need to update props across renders should hold the returned
 * element and call `.setProps()` directly.
 *
 * The `DshModal` return is cast to `JSX.Element` so `<Modal ... />` typechecks
 * as a JSX component call: the element self-mounts to `document.body` (see
 * the class doc above), so it is never diffed as a child of the caller's own
 * vdom — the JSX call site only needs the side effect and the typecheck, not
 * a structurally valid `VElement`.
 */
export function Modal(props: ModalProps): JSX.Element {
  return renderModal(null, props) as unknown as JSX.Element
}
