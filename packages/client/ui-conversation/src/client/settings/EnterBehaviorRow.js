/** General Settings row for the Composer's busy-state Enter preference.
 *
 * Converted from a React hooks component to a webjsx custom element: `open`
 * becomes an instance field and re-render is an explicit applyDiff(this,
 * vdom) call (Toast.tsx's pattern). */
import { applyDiff, createElement as h } from 'webjsx'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './EnterBehaviorRow.css.js'

const OPTIONS = [
  { id: 'queue', label: 'settings.enter.queue' },
  { id: 'steer', label: 'settings.enter.steer' },
]

/**
 * Busy-state Enter behavior selector custom element.
 */
export class DshEnterBehaviorRow extends HTMLElement {
  #props = null
  #open = false

  setProps(props) {
    this.#props = props
    this.#render()
  }

  connectedCallback() {
    this.#render()
  }

  #render() {
    if (this.#props === null) return
    const { useBusyEnter, setBusyEnter, t } = this.#props
    const behavior = useBusyEnter(value => value)
    const open = this.#open
    const selectedLabel = behavior === 'queue' ? 'settings.enter.queue' : 'settings.enter.steer'

    const vdom = h('div', { class: css.row ?? '' },
      h('div', { class: css.rowText ?? '' },
        h('div', { class: css.title ?? '' }, t('settings.enter.title')),
        h('div', { class: css.desc ?? '' }, t('settings.enter.description')),
      ),
      Menu({
        open,
        onClose: () => { this.#open = false; this.#render() },
        items: OPTIONS.map(option => ({ id: option.id, label: t(option.label) })),
        selectedId: behavior,
        onSelect: (id) => {
          this.#open = false
          setBusyEnter(id)
          this.#render()
        },
        align: 'end',
        portal: true,
        anchor: h(
          'button',
          {
            type: 'button',
            class: css.selector ?? '',
            'aria-haspopup': 'menu',
            'aria-expanded': open,
            onclick: () => { this.#open = !this.#open; this.#render() },
          },
          t(selectedLabel),
          h(IconChevronDownOutline14, { className: css.chevron }),
        ),
      }),
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-enter-behavior-row') === undefined) {
  customElements.define('dsh-enter-behavior-row', DshEnterBehaviorRow)
}

/** One-shot creation/update helper preserving the original function-component call shape. */
export function EnterBehaviorRow(props) {
  const el = document.createElement('dsh-enter-behavior-row')
  el.setProps(props)
  return el
}
