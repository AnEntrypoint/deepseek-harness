/**
 * Permission preference row: the default preset for subsequently created
 * sessions. Current-session switches remain on the composer `/permission`
 * control.
 *
 * Converted from a React hooks component to a webjsx custom element:
 * open/confirmingFullAccess/acknowledged state become instance fields, the
 * settings-status-driven effect becomes logic inside `#derive`/`#render`, and
 * re-render is an explicit applyDiff(this, vdom) call (Toast.tsx's pattern).
 */
import { applyDiff } from 'webjsx'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconChevronDownOutline14, renderMenu, renderRiskConfirmation,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DshMenu, DshModal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PermissionSettingsState } from './settings-store.ts'
import type { PermissionSettingsKey } from './locales.ts'
import { FULL_ACCESS_PRESET } from './presentation.ts'
import css from './PermissionRow.module.css'

/** Registration-side business face for the host-backed preference. */
export interface PermissionRowInjected {
  hooks: {
    /** Permission settings snapshot bound by the renderer as usePermission. */
    permission: SnapshotStore<PermissionSettingsState>
  }
  /** Load the descriptor when the row first renders. */
  load: () => Promise<void>
  /** Persist one advertised preset. */
  select: (preset: string) => Promise<void>
}

/** Full component props. */
export type PermissionRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.permission'>
  & InjectFace<PermissionRowInjected>

/**
 * Render the new-session Permission default selector.
 */
export class DshPermissionRow extends HTMLElement {
  #props: PermissionRowProps | null = null
  #open = false
  #confirmingFullAccess = false
  #acknowledged = false
  #lastWritable: boolean | null = null
  #lastStatus: PermissionSettingsState['status'] | null = null
  #loaded = false
  // Held across renders (renderMenu(this.#menu, ...) / renderRiskConfirmation
  // (this.#confirmModal, ...)) instead of the bare Menu(...)/RiskConfirmation
  // (...) one-shot calls: those always create a brand-new dsh-menu/dsh-modal,
  // so calling them fresh on every #render() replaced the live element (and
  // its bound listeners) — or, for the modal, orphaned a fresh dsh-modal
  // onto document.body — on every state change.
  #menu: DshMenu | null = null
  #confirmModal: DshModal | null = null

  /** Set/replace props and re-render; call after creating or updating the element. */
  setProps(props: PermissionRowProps): void {
    this.#props = props
    if (!this.#loaded) {
      this.#loaded = true
      void props.load()
    }
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  disconnectedCallback(): void {}

  #render(): void {
    const props = this.#props
    if (props === null) { applyDiff(this, []); return }
    const { select, t, usePermission } = props
    // NOTE: usePermission is the framework standard-kit's React-hook binding
    // (InjectFace synthesizes it from the registered SnapshotStore); this
    // custom element calls it outside a React render as a best-effort bridge
    // — the raw observable itself is not threaded onto composed props. See
    // batch report: cross-package blocker in ui-slots/ui-renderer, out of
    // this package's scope.
    const state = usePermission(snapshot => snapshot)

    if (state.writable && state.status !== 'unavailable') {
      // no-op: keep current open/confirm state
    } else if (this.#lastWritable !== state.writable || this.#lastStatus !== state.status) {
      this.#open = false
      this.#acknowledged = false
      this.#confirmingFullAccess = false
    }
    this.#lastWritable = state.writable
    this.#lastStatus = state.status

    if (state.status === 'unavailable') { applyDiff(this, []); return }
    const selected = state.options.find(option => option.id === state.currentValue)
    const busy = state.status === 'loading' || state.status === 'saving' || this.#confirmingFullAccess
    const label = selected?.label
      ?? (busy ? t('loading') : t('unavailable'))
    const description: string = state.error ?? t('description')

    const vdom = [
      <div class={css.row ?? ''}>
        <div class={css.rowText ?? ''}>
          <div class={css.title ?? ''}>{t('title')}</div>
          <div class={css.desc ?? ''} role={state.error === null ? null : 'alert'}>{description}</div>
        </div>
        {(() => {
          this.#menu = renderMenu(this.#menu, {
            open: this.#open,
            onClose: () => { this.#open = false; this.#render() },
            items: state.options.map(option => ({ id: option.id, label: option.label })),
            selectedId: state.currentValue,
            onSelect: (id) => {
              this.#open = false
              if (id === state.currentValue) { this.#render(); return }
              if (id === FULL_ACCESS_PRESET) {
                this.#acknowledged = false
                this.#confirmingFullAccess = true
                this.#render()
                return
              }
              this.#render()
              void select(id)
            },
            align: 'end',
            portal: true,
            anchor: (
              <button
                type="button"
                class={css.selector ?? ''}
                aria-haspopup="menu"
                aria-expanded={this.#open}
                disabled={busy || !state.writable || state.options.length === 0}
                onclick={() => { this.#open = !this.#open; this.#render() }}
              >
                {label}
                <IconChevronDownOutline14 className={css.chevron} />
              </button>
            ),
          })
          return this.#menu as unknown as JSX.Element
        })()}
      </div>,
    ]
    this.#confirmModal = renderRiskConfirmation(this.#confirmModal, {
      open: this.#confirmingFullAccess,
      title: t('confirm.title'),
      description: t('confirm.description'),
      acknowledgeLabel: t('confirm.acknowledge'),
      cancelLabel: t('confirm.cancel'),
      confirmLabel: t('confirm.enable'),
      acknowledged: this.#acknowledged,
      disabled: !state.writable || state.status === 'saving',
      onAcknowledgedChange: (acknowledged: boolean) => { this.#acknowledged = acknowledged; this.#render() },
      onCancel: () => {
        this.#acknowledged = false
        this.#confirmingFullAccess = false
        this.#render()
      },
      onConfirm: () => {
        this.#acknowledged = false
        this.#confirmingFullAccess = false
        this.#render()
        void select(FULL_ACCESS_PRESET)
      },
    })
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-permission-row') === undefined) {
  customElements.define('dsh-permission-row', DshPermissionRow)
}

/** One-shot creation helper preserving the original function-component call shape. */
export function PermissionRow(props: PermissionRowProps): DshPermissionRow {
  const el = document.createElement('dsh-permission-row') as DshPermissionRow
  el.setProps(props)
  return el
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Permission row copy. */
    'settings.permission': PermissionSettingsKey
  }
}
