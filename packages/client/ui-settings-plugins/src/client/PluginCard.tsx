/**
 * One plugin's card: a header naming the plugin and what its settings govern,
 * disclosing that plugin's controls in place, with the save that writes them.
 *
 * The header is its own button rather than a shared disclosure row because a
 * card stacks its name over its description, while that row lays the two side
 * by side — the layout, not the behavior, is what differs. Disclosure is
 * card-local state: which card a user has open is a reading gesture, not
 * something the Host or the section has any stake in. Staged edits outlive
 * collapsing, so the header marks a card holding unsaved edits.
 *
 * A card renders nothing while its namespace is unavailable: a deployment that
 * does not compose the owning plugin should show no trace of it, rather than a
 * disabled card the user cannot act on.
 *
 * Converted from a React hooks component (useState) to a webjsx custom
 * element: `open` becomes an instance field, and re-render is an explicit
 * applyDiff(this, vdom) call (Toast.tsx's pattern).
 */

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import clsx from 'clsx'
import { IconChevronDownOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { CardShell } from './card-form.ts'
import type { PluginsSettingsLocaleKey } from './locales.ts'
import css from './PluginCard.css.ts'

/** Card chrome shared by every plugin section. */
export interface PluginCardProps {
  /** Locale reader for this section's copy. */
  t: (key: PluginsSettingsLocaleKey) => string
  /** Locale key of the plugin's name. */
  titleKey: PluginsSettingsLocaleKey
  /** Locale key of the line describing what this plugin's settings govern. */
  descriptionKey: PluginsSettingsLocaleKey
  /** The card's form state: availability, writability, and what a save would do. */
  state: CardShell
  /** Write every staged edit. */
  onSave: () => void
  /** Drop every staged edit. */
  onDiscard: () => void
  /** The plugin's controls. */
  children: VNode | VNode[] | string | null
}

/** One plugin card custom element. See {@link PluginCardProps} for the field-by-field docs. */
export class DshPluginCard extends HTMLElement {
  #props: PluginCardProps | null = null
  #open = false

  /** Set/replace props and re-render; call after creating or updating the element. */
  setProps(props: PluginCardProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const { state } = props
    if (!state.available) {
      applyDiff(this, [])
      return
    }
    const open = this.#open
    const title = props.t(props.titleKey)
    const blocked = !state.dirty || state.invalid || state.saving
    const vdom = (
      <li class={clsx(css.card, open && css.cardOpen)}>
        <button
          type="button"
          class={css.header ?? ''}
          aria-expanded={open}
          aria-label={`${props.t(open ? 'collapse' : 'expand')}: ${title}`}
          onclick={() => { this.#open = !this.#open; this.#render() }}
        >
          <span class={css.headText ?? ''}>
            <span class={css.name ?? ''}>{title}</span>
            <span class={css.description ?? ''}>{props.t(props.descriptionKey)}</span>
          </span>
          {state.dirty ? <span class={css.pending ?? ''}>{props.t('unsaved')}</span> : null}
          <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
        </button>
        {open
          ? (
            <div class={css.body ?? ''}>
              {!state.writable ? <p class={css.readOnly ?? ''} role="status">{props.t('readOnly')}</p> : null}
              {props.children}
              <div class={css.footer ?? ''}>
                {state.failed ? <p class={css.failed ?? ''} role="status">{props.t('saveFailed')}</p> : null}
                <button
                  type="button"
                  class={css.discard ?? ''}
                  disabled={!state.dirty || state.saving}
                  onclick={props.onDiscard}
                >
                  {props.t('discard')}
                </button>
                <button
                  type="button"
                  class={css.save ?? ''}
                  disabled={blocked}
                  onclick={props.onSave}
                >
                  {props.t(state.saving ? 'saving' : 'save')}
                </button>
              </div>
            </div>
          )
          : null}
      </li>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-plugin-card') === undefined) {
  customElements.define('dsh-plugin-card', DshPluginCard)
}

/**
 * Render one plugin card.
 * @param props - the plugin's copy keys, its form state, and its controls.
 * @returns the card; renders nothing when the namespace is unavailable.
 */
export function PluginCard(props: PluginCardProps): JSX.Element {
  const el = document.createElement('dsh-plugin-card') as DshPluginCard
  el.setProps(props)
  return el as unknown as JSX.Element
}
