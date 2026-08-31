/**
 * Language preference row registered into the General section item slot
 * (figma 501:30011 'Setting-Cell'): title + selector pill opening the locale
 * menu. Registered by this package — the locale feature owns its own
 * settings surface.
 */
import { applyDiff } from 'webjsx'
import { IconChevronDownOutline14, renderMenu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DshMenu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createLanguageRowStore } from './settings-store.ts'
import css from './LanguageRow.module.css'

/** Injected business face: the preference write (t rides the standard locale seat). */
export interface LanguageRowInjected {
  /** Switch the active locale (a registered locale id). */
  setLocale: (id: string) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type LanguageRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createLanguageRowStore>>
  & PropsLocale<'settings.locale'> & LanguageRowInjected

/** Language preference row, as a custom element (owns the menu open state). */
export class DshLanguageRow extends HTMLElement {
  #props: LanguageRowComponentProps | null = null
  #open = false
  #menu: DshMenu | null = null

  /** Set/replace props and re-render; the owning renderer calls this on every update. */
  setProps(props: LanguageRowComponentProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const { t, setLocale, useStore } = props
    const active = useStore(s => s.active)
    const options = useStore(s => s.options)
    const activeLabel = options.find(o => o.id === active)?.label ?? active

    const vdom = (
      <div class={css.row ?? ''}>
        <div class={css.rowText ?? ''}>
          <div class={css.title ?? ''}>{t('language.title')}</div>
        </div>
        <span data-language-menu-slot="" />
      </div>
    )
    applyDiff(this, vdom)

    this.#menu = renderMenu(this.#menu, {
      open: this.#open,
      onClose: () => { this.#open = false; this.#render() },
      items: options.map(o => ({ id: o.id, label: o.label })),
      selectedId: active,
      onSelect: (id) => {
        setLocale(id)
        this.#open = false
        this.#render()
      },
      align: 'end',
      portal: true,
      anchor: (
        <button
          type="button"
          class={css.selector ?? ''}
          aria-haspopup="menu"
          aria-expanded={String(this.#open)}
          onclick={() => { this.#open = !this.#open; this.#render() }}
        >
          {activeLabel}
          <IconChevronDownOutline14 className={css.chevron} />
        </button>
      ),
    })
    const slot = this.querySelector<HTMLElement>('[data-language-menu-slot]')
    slot?.replaceWith(this.#menu)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-language-row') === undefined) {
  customElements.define('dsh-language-row', DshLanguageRow)
}

/**
 * Render the Language row.
 * @param props - composed slot props.
 * @returns the row element.
 */
export function LanguageRow(props: LanguageRowComponentProps): JSX.Element {
  const el = document.createElement('dsh-language-row') as DshLanguageRow
  el.setProps(props)
  return el as unknown as JSX.Element
}
