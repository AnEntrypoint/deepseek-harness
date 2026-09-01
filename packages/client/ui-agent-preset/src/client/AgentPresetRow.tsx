/**
 * Agent-preset preference row: the preset new sessions are composed from.
 * A running session keeps the composition it began with, so this row never
 * disturbs work in progress.
 */

import { applyDiff } from 'webjsx'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AgentPresetSettingsState } from './settings-store.ts'
import { presetDisplayText, type AgentPresetSettingsKey } from './locales.ts'
import { renderPresetMenu } from './PresetMenu.tsx'
import type { DshMenu } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './AgentPresetRow.css.ts'

/** Registration-side business face for the host-backed preference. */
export interface AgentPresetRowInjected {
  hooks: {
    /** Agent-preset settings snapshot bound by the renderer as useAgentPreset. */
    agentPreset: SnapshotStore<AgentPresetSettingsState>
  }
  /** Load the roster when the row first renders. */
  load: () => Promise<void>
  /** Persist one preset as the default for later sessions. */
  select: (id: string) => Promise<void>
}

/** Full component props. */
export type AgentPresetRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<AgentPresetRowInjected>

/** New-session agent-preset selector row, as a custom element. */
export class DshAgentPresetRow extends HTMLElement {
  #props: AgentPresetRowProps | null = null
  #open = false
  #loaded = false
  #lastStatus: string | undefined
  #lastWritable: boolean | undefined
  #menu: DshMenu | null = null

  /** Set/replace props and re-render; the owning renderer calls this on every update. */
  setProps(props: AgentPresetRowProps): void {
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

  #render(): void {
    const props = this.#props
    if (props === null) return
    const { select, useAgentPreset, t } = props
    const state = useAgentPreset(snapshot => snapshot)

    if (state.status !== this.#lastStatus || state.writable !== this.#lastWritable) {
      this.#lastStatus = state.status
      this.#lastWritable = state.writable
      if (!(state.writable && state.status !== 'unavailable')) this.#open = false
    }

    // A deployment that composes no presets has nothing to choose between, and
    // every session shares the host composition — the row simply does not exist.
    if (state.status === 'unavailable') {
      applyDiff(this, <span style="display:none" />)
      return
    }
    const busy = state.status === 'loading' || state.status === 'saving'
    // Every preset surface applies the same display-copy rule. The id remains
    // addressing rather than a label, except where no display name exists.
    const chosen = state.options.find(option => option.id === state.currentValue)
    const chosenText = chosen === undefined ? undefined : presetDisplayText(chosen, t)
    const label = state.currentValue === '' ? t('loading') : (chosenText?.name ?? state.currentValue)
    const description: string = state.error ?? t('description')

    const vdom = (
      <div class={css.row ?? ''}>
        <div class={css.rowText ?? ''}>
          <div class={css.title ?? ''}>{t('title')}</div>
          <div class={css.desc ?? ''} role={state.error === null ? null : 'alert'}>{description}</div>
        </div>
        <span data-preset-menu-slot="" />
      </div>
    )
    applyDiff(this, vdom)

    this.#menu = renderPresetMenu(this.#menu, {
      options: state.options,
      selectedId: state.currentValue,
      label,
      t,
      buttonClassName: css.selector,
      chevronClassName: css.chevron,
      disabled: busy || !state.writable || state.options.length === 0,
      open: this.#open,
      onOpenChange: (value) => { this.#open = value; this.#render() },
      onSelect: (id) => { void select(id) },
    })
    const slot = this.querySelector<HTMLElement>('[data-preset-menu-slot]')
    slot?.replaceWith(this.#menu)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-agent-preset-row') === undefined) {
  customElements.define('dsh-agent-preset-row', DshAgentPresetRow)
}

/**
 * Render the new-session agent-preset selector.
 * @param props - composed slot props.
 * @returns the row element.
 */
export function AgentPresetRow(props: AgentPresetRowProps): JSX.Element {
  const el = document.createElement('dsh-agent-preset-row') as DshAgentPresetRow
  el.setProps(props)
  return el as unknown as JSX.Element
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Agent-preset row copy. */
    'settings.agentPreset': AgentPresetSettingsKey
  }
}
