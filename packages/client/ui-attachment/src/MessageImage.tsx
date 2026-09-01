// MessageImage: compact history renderer with retryable async loading and
// click-to-open preview, converted from a React hooks component to a webjsx
// custom element. State (src/error/open/attempt) becomes instance fields,
// the async load effect becomes an explicit #load() call guarded by a
// liveness epoch (mirrors the original useEffect's cleanup flag), and
// re-render is an explicit applyDiff(this, vdom) call (Toast.tsx's pattern).

import { applyDiff } from 'webjsx'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import { renderImageLightbox } from './ImageLightbox.tsx'
import type { DshImageLightbox, ImageLightboxLabels } from './ImageLightbox.tsx'
import css from './MessageImage.css.ts'

/** Loads a session-authorized durable image URL. */
export type ImageLoader = (attachment: ImageAttachmentRef) => Promise<string>

/** Message-image strings the owner resolves from its own locale namespace. */
export interface MessageImageLabels {
  /** Fallback display name for an unnamed image. */
  image: string
  /** Thumbnail tooltip inviting the original-image preview. */
  open: string
  /** Accessible thumbnail label; receives the image's display name. */
  openNamed: (label: string) => string
  /** Loading placeholder shown until bytes resolve. */
  loading: string
  /** Retry-control label shown when the load fails. */
  loadFailed: string
  /** Lightbox strings forwarded to the opened preview. */
  lightbox: ImageLightboxLabels
}

export interface MessageImageProps {
  attachment: ImageAttachmentRef
  load: ImageLoader
  variant: 'single' | 'tile'
  labels: MessageImageLabels
}

/** Display box for a lone image (DeepSeek Chat rule): long edge 240px with
 * the rendered aspect ratio clamped to [0.25, 4] — the overflow is cropped by
 * `object-fit: cover` — and never upscaled past the image's natural size. The
 * crop anchor keeps the top of very tall images and the left of very wide
 * ones, where the informative content usually starts. */
function singleFit(attachment: ImageAttachmentRef): { width: number; height: number; objectPosition: string } {
  const natural = attachment.width / attachment.height
  const ratio = Math.min(4, Math.max(0.25, natural))
  const box = ratio >= 1 ? { width: 240, height: 240 / ratio } : { width: 240 * ratio, height: 240 }
  const scale = Math.min(1, attachment.width / box.width, attachment.height / box.height)
  return {
    width: Math.max(1, Math.round(box.width * scale)),
    height: Math.max(1, Math.round(box.height * scale)),
    objectPosition: natural < 0.25 ? 'center top' : natural > 4 ? 'left center' : 'center',
  }
}

/**
 * Compact history renderer with retryable loading and click-to-open original
 * preview. A lone image renders at its `singleFit` size; an image among
 * several renders as a fixed 64px square tile.
 */
export class DshMessageImage extends HTMLElement {
  #props: MessageImageProps | null = null
  #src: string | null = null
  #error = false
  #open = false
  #epoch = 0
  #lightboxEl: DshImageLightbox | null = null

  setProps(props: MessageImageProps): void {
    const prev = this.#props
    const attachmentChanged = prev === null || prev.attachment !== props.attachment || prev.load !== props.load
    this.#props = props
    if (attachmentChanged) this.#request()
    this.#render()
  }

  connectedCallback(): void {
    if (this.#props !== null && this.#src === null && !this.#error) this.#request()
    this.#render()
  }

  disconnectedCallback(): void {
    this.#epoch += 1
    this.#lightboxEl?.remove()
    this.#lightboxEl = null
  }

  #request(): void {
    const props = this.#props
    if (props === null) return
    this.#epoch += 1
    const epoch = this.#epoch
    this.#error = false
    this.#src = null
    void props.load(props.attachment)
      .then((url) => { if (epoch === this.#epoch) { this.#src = url; this.#render() } })
      .catch(() => { if (epoch === this.#epoch) { this.#error = true; this.#render() } })
  }

  #close = (): void => {
    this.#open = false
    this.#lightboxEl?.remove()
    this.#lightboxEl = null
    this.#render()
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const { attachment, variant, labels } = props
    const fit = variant === 'single' ? singleFit(attachment) : undefined
    const label = attachment.name ?? labels.image

    if (this.#open && this.#src !== null) {
      this.#lightboxEl = renderImageLightbox(this.#lightboxEl, {
        src: this.#src, alt: label, labels: labels.lightbox, onClose: this.#close,
      })
    } else if (this.#lightboxEl !== null) {
      this.#lightboxEl.remove()
      this.#lightboxEl = null
    }

    if (this.#error) {
      applyDiff(this, (
        <button type="button" class={css.error ?? ''} data-variant={variant} onclick={() => { this.#request() }}>
          {labels.loadFailed}
        </button>
      ))
      return
    }

    const vdom = (
      <button
        type="button"
        class={css.frame ?? ''}
        data-variant={variant}
        style={fit === undefined ? '' : `width: ${fit.width}px; height: ${fit.height}px`}
        title={labels.open}
        aria-label={labels.openNamed(label)}
        onclick={() => { if (this.#src !== null) { this.#open = true; this.#render() } }}
      >
        {this.#src === null
          ? <span class={css.loading ?? ''}>{labels.loading}</span>
          : <img src={this.#src} alt={label} style={fit === undefined ? '' : `object-position: ${fit.objectPosition}`} />}
      </button>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-message-image') === undefined) {
  customElements.define('dsh-message-image', DshMessageImage)
}

/** Create (if needed) and update a MessageImage element in place.
 * @param el - an existing `dsh-message-image` element to update, or null to create one.
 * @param props - see {@link MessageImageProps}.
 * @returns the `dsh-message-image` element; keep it and pass it back in to update. */
export function renderMessageImage(el: DshMessageImage | null, props: MessageImageProps): DshMessageImage {
  const target = el ?? document.createElement('dsh-message-image') as DshMessageImage
  target.setProps(props)
  return target
}

/** One-shot creation helper preserving the original function-component call shape. */
export function MessageImage(props: MessageImageProps): JSX.Element {
  return renderMessageImage(null, props) as unknown as JSX.Element
}

/** Wrapping image group shared by user and assistant history: a lone image
 * renders large, several render as 64px square tiles (DeepSeek Chat rule). */
export function ImageGallery({ images, load, align, labels }: {
  images: readonly { attachment: ImageAttachmentRef }[]
  load: ImageLoader
  align: 'start' | 'end'
  labels: MessageImageLabels
}): JSX.Element | null {
  if (images.length === 0) return null
  const variant = images.length === 1 ? 'single' : 'tile'
  return (
    <div class={css.gallery ?? ''} data-align={align}>
      {images.map(image => MessageImage({ attachment: image.attachment, load, variant, labels }))}
    </div>
  )
}
