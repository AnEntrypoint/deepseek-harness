// ComposerAttachments: draft-image rail, document drop target, and
// original-image preview slot entry. Converted from a React hooks component
// to a webjsx custom element: state (preview/dragActive/dragDepth) becomes
// instance fields, the document-level drag/drop listeners' useEffect becomes
// connectedCallback/disconnectedCallback, and re-render is an explicit
// applyDiff(this, vdom) call (Toast.tsx's pattern).

import { applyDiff } from 'webjsx'
import type {
  ComposerAttachment, ComposerAttachmentsProps,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { renderAttachmentRail } from '../AttachmentRail.tsx'
import type { AttachmentRailItem, DshAttachmentRail } from '../AttachmentRail.tsx'
import { renderDropOverlay } from '../DropOverlay.tsx'
import type { DshDropOverlay } from '../DropOverlay.tsx'
import { renderImageLightbox } from '../ImageLightbox.tsx'
import type { DshImageLightbox } from '../ImageLightbox.tsx'
import { attachmentRailLabels, dropOverlayLabels, lightboxLabels } from './labels.ts'
import css from './ComposerAttachments.css.ts'

/** Rail item retaining its browser-owned attachment for callbacks. */
interface ComposerRailItem extends AttachmentRailItem {
  attachment: ComposerAttachment
}

/** Draft-image rail, document drop target, and original-image preview slot entry. */
export class DshComposerAttachments extends HTMLElement {
  #props: ComposerAttachmentsProps | null = null
  #preview: ComposerAttachment | null = null
  #dragActive = false
  #dragDepth = 0
  #railWrap: HTMLDivElement | null = null
  #railEl: DshAttachmentRail | null = null
  #overlayEl: DshDropOverlay | null = null
  #lightboxEl: DshImageLightbox | null = null

  setProps(props: ComposerAttachmentsProps): void {
    this.#props = props
    if (this.#preview !== null && !props.attachments.some(a => a.id === this.#preview?.id)) this.#preview = null
    this.#render()
  }

  connectedCallback(): void {
    document.addEventListener('dragenter', this.#onDragEnter)
    document.addEventListener('dragover', this.#onDragOver)
    document.addEventListener('dragleave', this.#onDragLeave)
    document.addEventListener('drop', this.#onDrop)
    window.addEventListener('dragend', this.#reset)
    this.#render()
  }

  disconnectedCallback(): void {
    document.removeEventListener('dragenter', this.#onDragEnter)
    document.removeEventListener('dragover', this.#onDragOver)
    document.removeEventListener('dragleave', this.#onDragLeave)
    document.removeEventListener('drop', this.#onDrop)
    window.removeEventListener('dragend', this.#reset)
    this.#overlayEl?.remove()
    this.#overlayEl = null
    this.#lightboxEl?.remove()
    this.#lightboxEl = null
  }

  #fileTransfer(event: DragEvent): DataTransfer | null {
    const dataTransfer = event.dataTransfer
    if (dataTransfer === null || !dataTransfer.types.includes('Files')) return null
    return dataTransfer
  }

  #reset = (): void => {
    this.#dragDepth = 0
    this.#dragActive = false
    this.#render()
  }

  #onDragEnter = (event: DragEvent): void => {
    if (this.#fileTransfer(event) === null) return
    event.preventDefault()
    this.#dragDepth += 1
    this.#dragActive = true
    this.#render()
  }

  #onDragOver = (event: DragEvent): void => {
    const dataTransfer = this.#fileTransfer(event)
    if (dataTransfer === null) return
    event.preventDefault()
    dataTransfer.dropEffect = this.#props?.canAcceptDrop === true ? 'copy' : 'none'
  }

  #onDragLeave = (event: DragEvent): void => {
    if (this.#fileTransfer(event) === null) return
    this.#dragDepth = Math.max(0, this.#dragDepth - 1)
    if (this.#dragDepth === 0) { this.#dragActive = false; this.#render() }
    const leftViewport = event.clientX <= 0 || event.clientY <= 0
      || event.clientX >= window.innerWidth || event.clientY >= window.innerHeight
    if ((event.target === document.documentElement || event.target === document.body) && leftViewport) this.#reset()
  }

  #onDrop = (event: DragEvent): void => {
    const dataTransfer = this.#fileTransfer(event)
    if (dataTransfer === null) return
    event.preventDefault()
    this.#reset()
    if (this.#props?.canAcceptDrop === true) this.#props.onAddImages([...dataTransfer.files])
  }

  #closePreview = (): void => {
    this.#preview = null
    this.#render()
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const { attachments, canAcceptDrop, onRemoveImage, dropLimits, t } = props

    if (this.#dragActive) {
      this.#overlayEl = renderDropOverlay(this.#overlayEl, {
        disabled: !canAcceptDrop,
        labels: dropOverlayLabels(t, canAcceptDrop, dropLimits),
      })
    } else if (this.#overlayEl !== null) {
      this.#overlayEl.remove()
      this.#overlayEl = null
    }

    const railItems: ComposerRailItem[] = attachments.map(attachment => ({
      id: attachment.id,
      previewUrl: attachment.previewUrl,
      alt: attachment.file.name || t('image.pending'),
      removeLabel: t('image.remove', { name: attachment.file.name }),
      attachment,
    }))
    const byId = new Map(railItems.map(item => [item.id, item]))

    if (this.#preview !== null && this.#preview.previewUrl !== '') {
      this.#lightboxEl = renderImageLightbox(this.#lightboxEl, {
        src: this.#preview.previewUrl,
        alt: this.#preview.file.name || t('image.original'),
        labels: lightboxLabels(t),
        onClose: this.#closePreview,
      })
    } else if (this.#lightboxEl !== null) {
      this.#lightboxEl.remove()
      this.#lightboxEl = null
    }

    const vdom = railItems.length > 0
      ? <div data-composer-rail-wrap="" class={css.rail ?? ''} />
      : <span style="display:none" />
    applyDiff(this, vdom)

    if (railItems.length > 0) {
      this.#railWrap = this.querySelector<HTMLDivElement>('[data-composer-rail-wrap]')
      if (this.#railWrap !== null) {
        this.#railEl = renderAttachmentRail(this.#railEl, {
          items: railItems,
          labels: attachmentRailLabels(t),
          onOpen: (item) => { const ri = byId.get(item.id); if (ri !== undefined) { this.#preview = ri.attachment; this.#render() } },
          onRemove: (item) => { const ri = byId.get(item.id); if (ri !== undefined) onRemoveImage(ri.attachment.id) },
        })
        if (this.#railEl.parentElement !== this.#railWrap) this.#railWrap.appendChild(this.#railEl)
      }
    } else {
      this.#railEl?.remove()
      this.#railEl = null
    }
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-composer-attachments') === undefined) {
  customElements.define('dsh-composer-attachments', DshComposerAttachments)
}

/** Create (if needed) and update a ComposerAttachments element in place.
 * @param el - an existing `dsh-composer-attachments` element to update, or null to create one.
 * @param props - the slot-composed props contract.
 * @returns the `dsh-composer-attachments` element; keep it and pass it back in to update. */
export function renderComposerAttachments(
  el: DshComposerAttachments | null, props: ComposerAttachmentsProps,
): DshComposerAttachments {
  const target = el ?? document.createElement('dsh-composer-attachments') as DshComposerAttachments
  target.setProps(props)
  return target
}

/**
 * Slot component entry point: a plain function honoring the slot registry's
 * `SlotComponent<P> = (props: P) => ReactNode` contract (that contract lives
 * in `@deepseek-ai/dsh-client-ui-slots`, a package not yet converted off
 * React — see the conversion report). Each call creates a fresh element,
 * since the slot renderer calls this on every re-render with fresh props
 * rather than holding a persistent handle; the element's own `setProps`
 * still diffs its subtree in place via webjsx.
 */
export function ComposerAttachments(props: ComposerAttachmentsProps): unknown {
  return renderComposerAttachments(null, props)
}
