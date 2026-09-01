/** Optional settings-header action for opening a file-backed Host document. */

import { applyDiff } from 'webjsx'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsDocumentStore } from './settings-document-store.ts'
import css from './SettingsDocumentAction.css.ts'

/** Registrant-owned dependencies of {@link SettingsDocumentAction}. */
export interface SettingsDocumentActionInjected {
  /** Provider metadata and action state owner. */
  controller: SettingsDocumentStore
  hooks: {
    /** Controller snapshot bound by the UI renderer as useSnapshot. */
    snapshot: SettingsDocumentStore['store']
  }
}

/** Header-action owner share, localized copy, and the registrant's state face. */
export type SettingsDocumentActionProps =
  PropsRuntime<'settings.action'> & PropsLocale<'settings'> & InjectFace<SettingsDocumentActionInjected>

/** Header-action custom element: renders only after Host metadata confirms document availability. */
export class DshSettingsDocumentAction extends HTMLElement {
  #props: SettingsDocumentActionProps | null = null
  #loaded = false

  /** Set/replace props and re-render; the owning renderer calls this on every update. */
  setProps(props: SettingsDocumentActionProps): void {
    this.#props = props
    if (!this.#loaded) {
      this.#loaded = true
      void props.controller.load()
    }
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const { controller, useSnapshot, t } = props
    const state = useSnapshot(snapshot => snapshot)

    if (state.status !== 'ready') {
      applyDiff(this, <span style="display:none" />)
      return
    }

    const vdom = (
      <div class={css.action ?? ''}>
        {state.error === null ? null : <span class={css.error ?? ''} role="alert">{t('openDocument.error')}</span>}
        <Button
          variant="outline"
          size="sm"
          disabled={state.opening}
          onclick={() => { void controller.open() }}
        >
          {t('openDocument')}
        </Button>
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-settings-document-action') === undefined) {
  customElements.define('dsh-settings-document-action', DshSettingsDocumentAction)
}

/**
 * Render the open-document action only after Host metadata confirms document availability.
 * @param props - header owner props, localized copy, and injected document state.
 * @returns the action element.
 */
export function SettingsDocumentAction(props: SettingsDocumentActionProps): JSX.Element {
  const el = document.createElement('dsh-settings-document-action') as DshSettingsDocumentAction
  el.setProps(props)
  return el as unknown as JSX.Element
}
