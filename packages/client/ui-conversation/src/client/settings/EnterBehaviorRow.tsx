/** General Settings row for the Composer's busy-state Enter preference.
 *
 * Converted from a React hooks component to a webjsx custom element: `open`
 * becomes an instance field and re-render is an explicit applyDiff(this,
 * vdom) call (Toast.tsx's pattern). */
import { applyDiff } from 'webjsx'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { BusyEnterBehavior } from '../contract/composer-submission.ts'
import type { ConversationKey } from '../locales.ts'
import css from './EnterBehaviorRow.css.ts'

/** Registration-side preference face. */
export interface EnterBehaviorRowInjected {
  hooks: {
    /** Persisted busy-state preference bound as useBusyEnter. */
    busyEnter: SnapshotStore<BusyEnterBehavior>
  }
  /** Change the busy-state plain-Enter behavior. */
  setBusyEnter: (behavior: BusyEnterBehavior) => void
}

/** Full Settings-row props. */
export type EnterBehaviorRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'conversation'>
  & InjectFace<EnterBehaviorRowInjected>

const OPTIONS: readonly {
  id: BusyEnterBehavior
  label: ConversationKey
}[] = [
  { id: 'queue', label: 'settings.enter.queue' },
  { id: 'steer', label: 'settings.enter.steer' },
]

/**
 * Busy-state Enter behavior selector custom element.
 */
export class DshEnterBehaviorRow extends HTMLElement {
  #props: EnterBehaviorRowProps | null = null
  #open = false

  setProps(props: EnterBehaviorRowProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  #render(): void {
    if (this.#props === null) return
    const { useBusyEnter, setBusyEnter, t } = this.#props
    const behavior = useBusyEnter(value => value)
    const open = this.#open
    const selectedLabel = behavior === 'queue' ? 'settings.enter.queue' : 'settings.enter.steer'

    const vdom = (
      <div class={css.row ?? ''}>
        <div class={css.rowText ?? ''}>
          <div class={css.title ?? ''}>{t('settings.enter.title')}</div>
          <div class={css.desc ?? ''}>{t('settings.enter.description')}</div>
        </div>
        {Menu({
          open,
          onClose: () => { this.#open = false; this.#render() },
          items: OPTIONS.map(option => ({ id: option.id, label: t(option.label) })),
          selectedId: behavior,
          onSelect: (id) => {
            this.#open = false
            setBusyEnter(id as BusyEnterBehavior)
            this.#render()
          },
          align: 'end',
          portal: true,
          anchor: (
            <button
              type="button"
              class={css.selector ?? ''}
              aria-haspopup="menu"
              aria-expanded={open}
              onclick={() => { this.#open = !this.#open; this.#render() }}
            >
              {t(selectedLabel)}
              <IconChevronDownOutline14 className={css.chevron} />
            </button>
          ) as unknown as JSX.Element,
        }) as unknown as JSX.Element}
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-enter-behavior-row') === undefined) {
  customElements.define('dsh-enter-behavior-row', DshEnterBehaviorRow)
}

/** One-shot creation/update helper preserving the original function-component call shape. */
export function EnterBehaviorRow(props: EnterBehaviorRowProps): JSX.Element {
  const el = document.createElement('dsh-enter-behavior-row') as DshEnterBehaviorRow
  el.setProps(props)
  return el as unknown as JSX.Element
}
