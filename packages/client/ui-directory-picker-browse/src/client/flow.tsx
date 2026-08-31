/**
 * The browse picking occupant (package-internal; the `./client` surface
 * exposes only the Loader exports). Same-package tests exercise it directly
 * through this module.
 *
 * Converted from a stateless React function component to a webjsx custom
 * element: setProps receives the merged owner (DirectoryFlowOwnerProps) +
 * injected (BrowseFlowInjected) props exactly as the WebjsxBridge composes
 * them (ui-renderer's scoped-slots.tsx renderEntry), and #render adapts them
 * onto a nested dsh-directory-browser element (this package's own
 * DshDirectoryBrowser), created once and updated via its own setProps —
 * mirrors ui-primitives' Toast/Modal single-child-element pattern.
 */
import { applyDiff } from 'webjsx'
import type { DirectoryListing } from '@deepseek-ai/dsh-client-runtime/client'
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
// Type-only: the owner contract of the directory-flow holes.
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { DirectoryBrowserProps } from './DirectoryBrowser.tsx'
import './DirectoryBrowser.tsx'

/** Injected face: the browse wire calls and copy the dialog drives (bound in apply's closure). */
export interface BrowseFlowInjected {
  /** List one directory level (absent path = the Host home directory); the signal aborts a superseded scan. */
  listDirectory: (path?: string, signal?: AbortSignal) => Promise<DirectoryListing>
  /** Create one child directory under an existing parent. */
  createDirectory: (path: string, name: string) => Promise<string>
  /** Localized dialog copy (this package's namespace). */
  t: Translate
}

/** Full props of the flow occupant: owner conversation plus the injected browse face. */
export type BrowseDirectoryFlowProps = DirectoryFlowOwnerProps & BrowseFlowInjected

/**
 * Flow occupant custom element: adapts the hole's owner conversation onto the
 * browser dialog — a confirmed directory is the picked path, dismissal is the
 * cancellation. Browse failures (unreadable targets, create conflicts) stay
 * inside the dialog's own alert surfaces, so the owner's `onError` arm is
 * never driven by this occupant.
 */
export class DshBrowseDirectoryFlow extends HTMLElement {
  #props: BrowseDirectoryFlowProps | null = null
  #inner: (HTMLElement & { setProps: (props: DirectoryBrowserProps) => void }) | null = null

  /** Set/replace props and re-render; call after creating or updating the element. */
  setProps(props: BrowseDirectoryFlowProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  #render(): void {
    const props = this.#props
    if (props === null) { applyDiff(this, <span style="display:none" />); return }
    if (this.#inner === null) {
      const created = document.createElement('dsh-directory-browser') as HTMLElement & {
        setProps: (p: DirectoryBrowserProps) => void
      }
      this.#inner = created
      applyDiff(this, <span style="display:contents" />)
      this.appendChild(created)
    }
    this.#inner.setProps({
      open: props.open,
      busy: props.busy,
      listDirectory: props.listDirectory,
      createDirectory: props.createDirectory,
      t: props.t,
      onOpen: props.onPicked,
      onClose: props.onCancel,
    })
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-browse-directory-flow') === undefined) {
  customElements.define('dsh-browse-directory-flow', DshBrowseDirectoryFlow)
}
