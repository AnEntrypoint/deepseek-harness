/**
 * The session header's agent-preset label.
 *
 * Read-only by construction: a session's composition is fixed once its
 * conversation starts, and a header is only worth reading after that. Offering
 * a control here would promise a switch the host refuses; naming what the
 * session runs is the honest affordance, and the choice itself lives on the
 * new-session screen ({@link AgentPresetSeat}).
 */

import { applyDiff } from 'webjsx'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconAgentPresetOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the header actions).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { AgentPresetSettingsState } from './settings-store.ts'
import { presetDisplayText } from './locales.ts'
import css from './AgentPresetLabel.module.css'

/** Registration-side business face for the header label. */
export interface AgentPresetLabelInjected {
  hooks: {
    /** Roster snapshot bound by the renderer as useAgentPresets. */
    agentPresets: SnapshotStore<AgentPresetSettingsState>
  }
  /** Read the roster, so the label can show a name rather than an id. */
  load: () => Promise<void>
}

/** Full component props. */
export type AgentPresetLabelProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<AgentPresetLabelInjected>

/** Session-header agent-preset label custom element. */
export class DshAgentPresetLabel extends HTMLElement {
  #props: AgentPresetLabelProps | null = null
  #loadedFor: string | undefined

  /** Set/replace props and re-render; the owning renderer calls this on every update. */
  setProps(props: AgentPresetLabelProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  #maybeLoad(preset: string | undefined): void {
    const props = this.#props
    if (props === null) return
    // Deployments that compose no presets never label anything, so the roster
    // is only worth a request once a session reports one.
    if (preset !== undefined && preset !== this.#loadedFor) {
      this.#loadedFor = preset
      void props.load()
    }
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const { sessionId, useSessions, useAgentPresets, t } = props
    const preset = useSessions(state => state.byId[sessionId]?.agentPreset)
    const options = useAgentPresets(state => state.options)

    this.#maybeLoad(preset)

    if (preset === undefined) {
      applyDiff(this, <span style="display:none" />)
      return
    }

    const option = options.find(entry => entry.id === preset)
    const text = option === undefined ? undefined : presetDisplayText(option, t)
    const vdom = (
      <span class={css.label ?? ''} title={text?.description ?? t('headerHint')}>
        <IconAgentPresetOutline16 size={14} className={css.icon} />
        {text?.name ?? preset}
      </span>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-agent-preset-label') === undefined) {
  customElements.define('dsh-agent-preset-label', DshAgentPresetLabel)
}

/**
 * Render this session's agent-preset name beside its title.
 * @param props - composed slot props.
 * @returns the label element; renders nothing visible when the session
 * records no preset.
 */
export function AgentPresetLabel(props: AgentPresetLabelProps): JSX.Element {
  const el = document.createElement('dsh-agent-preset-label') as DshAgentPresetLabel
  el.setProps(props)
  return el as unknown as JSX.Element
}
