/**
 * Plugins settings section: localized tabs around feature-owned pages.
 *
 * Converted from a React hooks component (useState/useEffect/useRef/useId) to
 * a webjsx custom element: activeId/visitedIds become instance fields, the
 * visited-set effect becomes an inline update inside #render, tab button refs
 * become a direct querySelector lookup by index, and re-render is an explicit
 * applyDiff(this, vdom) call (Toast.tsx's pattern). useId's stable id becomes
 * a per-instance counter assigned in the constructor.
 */

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import type {
  HostObservable, InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginsSettingsLocaleKey } from './locales.ts'
import css from './PluginsSettingsSection.css.ts'

/** Cast a renderSlot() RenderOutput result into a webjsx-embeddable child. */
function asChild(node: unknown): VNode {
  return node as unknown as VNode
}

/** One tab projected from a `settings.plugins.tab` contribution. */
export interface PluginsSettingsTabEntry {
  id: string
  order: number
  label: string
}

/** Registration-side business face for the section. */
export interface PluginsSettingsSectionInjected {
  hooks: {
    /** Ordered, locale-aware projection of the Plugins tab ledger. */
    tabs: HostObservable<readonly PluginsSettingsTabEntry[]>
  }
}

/** Props the renderer binds for the section. */
export type PluginsSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.plugins'>
  & PropsRenderSlots<'settings.plugins.tab'>
  & InjectFace<PluginsSettingsSectionInjected>

let idCounter = 0

/** Plugins section custom element: tabs whose contents arrive from feature-owned tabs. */
export class DshPluginsSettingsSection extends HTMLElement {
  #props: PluginsSettingsSectionProps | null = null
  #tabsId = `dsh-plugins-tabs-${String(idCounter++)}`
  #activeId: string | undefined
  #visitedIds = new Set<string>()

  /** Set/replace props and re-render; call after creating or updating the element. */
  setProps(props: PluginsSettingsSectionProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  #focusTab(index: number): void {
    const button = this.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]
    button?.focus()
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const { t, renderSlot, useTabs } = props
    const rows = useTabs(value => value)
    const active = rows.find(row => row.id === this.#activeId)?.id ?? rows[0]?.id
    if (active !== undefined && !this.#visitedIds.has(active)) {
      this.#visitedIds = new Set([...this.#visitedIds, active])
    }
    const tabsId = this.#tabsId

    const vdom = (
      <div class={css.section ?? ''}>
        <h2 class={css.heading ?? ''}>{t('title')}</h2>
        <p class={css.intro ?? ''}>{t('intro')}</p>
        {rows.length === 0
          ? <p class={css.empty ?? ''}>{t('empty')}</p>
          : [
            <div class={css.tabs ?? ''} role="tablist" aria-label={t('tabs')}>
              {rows.map((row, index) => {
                const selected = row.id === active
                return (
                  <button
                    key={row.id}
                    id={`${tabsId}-tab-${row.id}`}
                    type="button"
                    role="tab"
                    class={css.tab ?? ''}
                    aria-selected={selected}
                    aria-controls={`${tabsId}-panel-${row.id}`}
                    data-active={selected ? 'true' : undefined}
                    tabindex={selected ? '0' : '-1'}
                    onclick={() => { this.#activeId = row.id; this.#render() }}
                    onkeydown={(event: KeyboardEvent) => {
                      let nextIndex: number
                      switch (event.key) {
                        case 'ArrowRight': nextIndex = (index + 1) % rows.length; break
                        case 'ArrowLeft': nextIndex = (index - 1 + rows.length) % rows.length; break
                        case 'Home': nextIndex = 0; break
                        case 'End': nextIndex = rows.length - 1; break
                        default: return
                      }
                      event.preventDefault()
                      const nextRow = rows[nextIndex] as PluginsSettingsTabEntry
                      this.#activeId = nextRow.id
                      this.#render()
                      this.#focusTab(nextIndex)
                    }}
                  >
                    {row.label}
                  </button>
                )
              })}
            </div>,
            ...rows
              .filter(row => row.id === active || this.#visitedIds.has(row.id))
              .map((row) => {
                const selected = row.id === active
                return (
                  <div
                    key={row.id}
                    id={`${tabsId}-panel-${row.id}`}
                    class={css.panel ?? ''}
                    role="tabpanel"
                    aria-labelledby={`${tabsId}-tab-${row.id}`}
                    hidden={!selected}
                  >
                    {asChild(renderSlot('settings.plugins.tab', {}, { only: row.id }))}
                  </div>
                )
              }),
          ]}
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-plugins-settings-section') === undefined) {
  customElements.define('dsh-plugins-settings-section', DshPluginsSettingsSection)
}

/** Render one Plugins page whose contents arrive from feature-owned tabs. */
export function PluginsSettingsSection(props: PluginsSettingsSectionProps): JSX.Element {
  const el = document.createElement('dsh-plugins-settings-section') as DshPluginsSettingsSection
  el.setProps(props)
  return el as unknown as JSX.Element
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Plugins section, configurable-tab, and card copy. */
    'settings.plugins': PluginsSettingsLocaleKey
  }
}
