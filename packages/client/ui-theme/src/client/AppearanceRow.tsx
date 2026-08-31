// Appearance preference row registered into the General section item slot
// (figma 501:30012 'Frame 2117131228'): title + three preference cubes.
// Registered by this package — the theme feature owns its own settings
// surface. Selection follows the persisted preference, never the resolved
// active theme.
//
// Converted from a React function component to a webjsx custom element: the
// component reads a declared store (`props.useStore`), which is a framework
// hook bound per-instance by the slot renderer — a hook cannot be invoked
// outside a React render. `setProps` therefore calls it once, synchronously,
// to capture the current selected value for `#render()`; the bridge
// (ui-renderer's WebjsxBridge) re-invokes `setProps` whenever its own props
// object changes identity.
import { applyDiff } from 'webjsx'
import {
  IconDarkOutline16, IconFollowsystemOutline16, IconLightOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ThemePreference } from '../theme-settings.ts'
import type { ThemeKey } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type { createAppearanceRowStore } from './settings-store.ts'
import css from './AppearanceRow.module.css'

/** Injected business face: the preference write (t rides the standard locale seat). */
export interface AppearanceRowInjected {
  /** Switch the theme preference. */
  setTheme: (id: ThemePreference) => void
}

/** Full component props: runtime share + store share + locale seat + injected face. */
export type AppearanceRowComponentProps =
  PropsRuntime<'settings.general.item'> & PropsStore<ReturnType<typeof createAppearanceRowStore>>
  & PropsLocale<'settings.theme'> & AppearanceRowInjected

/** Cube order and icons (figma 501:30015-30017: Light, Dark, System). */
const CUBES: readonly { id: ThemePreference; labelKey: ThemeKey; Icon: typeof IconLightOutline16 }[] = [
  { id: 'light', labelKey: 'appearance.light', Icon: IconLightOutline16 },
  { id: 'dark', labelKey: 'appearance.dark', Icon: IconDarkOutline16 },
  { id: 'system', labelKey: 'appearance.system', Icon: IconFollowsystemOutline16 },
]

/**
 * Appearance row custom element: title + three preference cubes. Registered
 * as `dsh-theme-appearance-row` via `webjsxSlot` at the slot's register call
 * site (see index.ts), so the slot renderer hosts this element instead of
 * calling a React component directly.
 */
export class DshAppearanceRow extends HTMLElement {
  #props: AppearanceRowComponentProps | null = null
  #preference: ThemePreference = 'system'

  /** Set/replace props and re-render; called by the slot renderer's webjsx bridge. */
  setProps(props: AppearanceRowComponentProps): void {
    this.#props = props
    this.#preference = props.useStore(s => s.preference)
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const { t, setTheme } = props
    const preference = this.#preference
    const vdom = (
      <div class={css.group ?? ''}>
        <div class={css.title ?? ''}>{t('appearance.title')}</div>
        <div class={css.cubeRow ?? ''}>
          {CUBES.map(({ id, labelKey, Icon }) => (
            <button
              type="button"
              class={preference === id ? `${css.themeCube ?? ''} ${css.selected ?? ''}` : css.themeCube ?? ''}
              aria-pressed={String(preference === id)}
              onclick={() => { setTheme(id) }}
            >
              <Icon />
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-theme-appearance-row') === undefined) {
  customElements.define('dsh-theme-appearance-row', DshAppearanceRow)
}
