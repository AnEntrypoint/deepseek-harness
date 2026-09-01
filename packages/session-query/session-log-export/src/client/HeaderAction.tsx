import { applyDiff } from 'webjsx'
import { IconDownloadOutline16, renderModal, type DshModal } from '@deepseek-ai/dsh-client-ui-primitives'
import { dialogProps, type SessionLogDownloadDialogProps } from './Dialog.tsx'
import css from './HeaderAction.css.ts'

/**
 * Session Header export capsule custom element, plus its shared result
 * modal: converted to a class so the modal can be held across renders
 * (renderModal(el, props)) instead of recreated via a bare <Modal> call on
 * every re-render, which would orphan a fresh dsh-modal each time and leave
 * a stale, unclosable instance behind (the one-shot-leak pattern already
 * fixed elsewhere in the webjsx conversion).
 */
export class DshSessionLogDownloadHeaderAction extends HTMLElement {
  #props: SessionLogDownloadDialogProps | null = null
  #modal: DshModal | null = null

  setProps(props: SessionLogDownloadDialogProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  disconnectedCallback(): void {
    this.#modal?.remove()
    this.#modal = null
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const { sessionId, useSessionLogDownload, request } = props
    const entry = useSessionLogDownload(state => state.bySession[String(sessionId)])
    const busy = entry?.status === 'downloading'

    this.#modal = renderModal(this.#modal, dialogProps(props))

    applyDiff(this, (
      <button
        type="button"
        class={css.sessionLogButton ?? ''}
        disabled={busy}
        aria-busy={busy}
        onclick={() => { void request(sessionId) }}
      >
        <span>Session log</span>
        <IconDownloadOutline16 size={12} />
      </button>
    ))
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-session-log-download-header-action') === undefined) {
  customElements.define('dsh-session-log-download-header-action', DshSessionLogDownloadHeaderAction)
}

/** One-shot creation/update helper preserving the original function-component call shape. */
export function SessionLogDownloadHeaderAction(props: SessionLogDownloadDialogProps): JSX.Element {
  const el = document.createElement('dsh-session-log-download-header-action') as DshSessionLogDownloadHeaderAction
  el.setProps(props)
  return el as unknown as JSX.Element
}
