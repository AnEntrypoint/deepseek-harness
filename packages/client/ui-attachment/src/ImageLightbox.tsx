// ImageLightbox: document-level original-image preview, converted from a
// React component using createPortal to a webjsx custom element that
// self-mounts to document.body (Modal.tsx's pattern): the Escape-key
// listener and focus-restore effect become connectedCallback/
// disconnectedCallback.

import { applyDiff } from 'webjsx'
import { IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './ImageLightbox.module.css'

/** Lightbox strings the owner resolves from its own locale namespace. */
export interface ImageLightboxLabels {
  /** Accessible name of the preview dialog. */
  dialog: string
  /** Accessible label of the close control. */
  close: string
}

export interface ImageLightboxProps {
  src: string
  alt: string
  labels: ImageLightboxLabels
  onClose: () => void
}

/**
 * Document-level original-image preview opened by clicking a thumbnail.
 * Closes on Escape, backdrop press, or the close control, and restores focus
 * to the opener on disconnect. Mounted directly on `document.body`: an
 * opener inside a transformed or filtered ancestor would otherwise trap the
 * fixed backdrop in that ancestor's box instead of covering the viewport.
 */
export class DshImageLightbox extends HTMLElement {
  #props: ImageLightboxProps = { src: '', alt: '', labels: { dialog: '', close: '' }, onClose: () => {} }
  #restore: HTMLElement | null = null

  setProps(props: ImageLightboxProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#restore = document.activeElement instanceof HTMLElement ? document.activeElement : null
    this.#render()
    this.querySelector<HTMLButtonElement>('[data-lightbox-close]')?.focus()
    document.addEventListener('keydown', this.#onKeyDown)
  }

  disconnectedCallback(): void {
    document.removeEventListener('keydown', this.#onKeyDown)
    this.#restore?.focus()
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') this.#props.onClose()
  }

  #render(): void {
    const { src, alt, labels, onClose } = this.#props
    const vdom = (
      <div
        class={css.backdrop ?? ''}
        role="dialog"
        aria-modal="true"
        aria-label={labels.dialog}
      >
        <div class={css.mask ?? ''} aria-hidden="true" onmousedown={onClose} />
        <img class={css.image ?? ''} src={src} alt={alt} />
        <button data-lightbox-close type="button" class={css.close ?? ''} aria-label={labels.close} onclick={onClose}>
          <IconCloseOutline16 size={16} />
        </button>
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-image-lightbox') === undefined) {
  customElements.define('dsh-image-lightbox', DshImageLightbox)
}

/** Create (if needed) and update an ImageLightbox mounted on `document.body`.
 * @param el - an existing mounted lightbox (from a prior call), or null to create one.
 * @param props - see {@link ImageLightboxProps}.
 * @returns the mounted `dsh-image-lightbox` element; keep it and pass it back in to update, `.remove()` when done with it. */
export function renderImageLightbox(el: DshImageLightbox | null, props: ImageLightboxProps): DshImageLightbox {
  const target = el ?? (() => {
    const created = document.createElement('dsh-image-lightbox') as DshImageLightbox
    document.body.appendChild(created)
    return created
  })()
  target.setProps(props)
  return target
}

/** Convenience one-shot wrapper preserving the original function-component call shape. */
export function ImageLightbox(props: ImageLightboxProps): JSX.Element {
  return renderImageLightbox(null, props) as unknown as JSX.Element
}
