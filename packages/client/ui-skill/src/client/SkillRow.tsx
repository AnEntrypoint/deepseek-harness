// Skill toolview registrant: a domain-owned row over the keyed toolview hole.
// The compact accent row keeps loaded instructions scannable in the transcript;
// the exact durable tool output remains available in a bounded disclosure card.
//
// Converted from a React function component (useState) to a webjsx custom
// element: `#expanded` replaces useState, `#render()` calls applyDiff.

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import {
  IconChevronDownOutline14, IconInspectOutline12, IconSkillOutline16, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import css from './SkillRow.module.css'

/** Skill row lifecycle derived solely from the durable call slice. */
type SkillRowState = 'running' | 'ok' | 'error' | 'stopped'

/** Full row props: the toolview runtime share plus this package's locale seat. */
export type SkillRowProps = ToolCallViewProps & PropsLocale<'skill'>

/** Compact, replay-stable view model for the dedicated row. */
interface SkillRowModel {
  readonly name: string
  readonly output: string | null
  readonly errorSummary: string | null
  readonly state: SkillRowState
}

/** First physical line for the collapsed error summary and malformed-args fallback. */
function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

/** Skill names are the only call argument the compact row presents. */
function skillName(argsRaw: string, callId: string): string {
  try {
    const parsed = JSON.parse(argsRaw) as unknown
    if (typeof parsed === 'object' && parsed !== null) {
      const name = (parsed as Record<string, unknown>).name
      if (typeof name === 'string' && name !== '') return firstLine(name)
    }
  } catch {
    // Streaming can expose a truncated JSON prefix; its first line is still
    // more useful than replacing the call with an unrelated catalog lookup.
  }
  return argsRaw === '' ? callId : firstLine(argsRaw)
}

/** Flatten durable result blocks under the generic Tool-row text contract.
 *  Keep aligned with ui-tool's models/tool-call-model.ts `resultText`. */
function resultText(block: ToolCallViewProps['block']): string | null {
  if (!('kind' in block)) return null
  const parts: string[] = []
  for (const item of block.content) {
    parts.push(item.type === 'text' ? item.text : JSON.stringify(item, null, 2))
  }
  if (parts.length === 0 && block.error !== undefined) {
    parts.push(`${block.error.name}: ${block.error.code}`)
  }
  return parts.join('\n') || null
}

/** Derive display state without consulting the live skill catalog. */
function skillRowModel(block: ToolCallViewProps['block']): SkillRowModel {
  const settled = 'kind' in block
  const argsRaw = (settled ? block.call?.argsRaw : block.argsRaw) ?? ''
  const state: SkillRowState = !settled
    ? 'running'
    : block.error?.code === 'interrupted'
      ? 'stopped'
      : block.isError ? 'error' : 'ok'
  const output = resultText(block)
  return {
    name: skillName(argsRaw, block.callId),
    output,
    errorSummary: state === 'error' && output !== null ? firstLine(output) : null,
    state,
  }
}

/** State substitution for the collapsed leading slot. */
function leadingFor(state: SkillRowState): VNode {
  switch (state) {
    case 'error': return <StateDot state="error" />
    case 'stopped': return <StateDot state="warning" />
    default: return <IconSkillOutline16 size={14} />
  }
}

/** Leading disclosure slot: state icon at rest, chevron on hover or while open. */
function disclosureLeading(state: SkillRowState, open: boolean, expandable: boolean): VNode | VNode[] {
  if (open) return <IconChevronDownOutline14 className={css.chevron} />
  const icon = leadingFor(state)
  if (!expandable) return icon
  return [
    <span class={css.iconIdle ?? ''}>{icon}</span>,
    <IconChevronDownOutline14 className={`${css.chevron ?? ''} ${css.chevronHover ?? ''}`} />,
  ]
}

/** Visually hidden state copy for the colour-only lifecycle cues. */
function stateStatus(state: SkillRowState, t: SkillRowProps['t']): string | null {
  switch (state) {
    case 'running': return t('row.running')
    case 'error': return t('row.failed')
    case 'stopped': return t('row.stopped')
    default: return null
  }
}

/**
 * Skill row custom element: renders one `skill` tool call as an accent
 * summary and instructions disclosure. Registered as `dsh-skill-row` via
 * `webjsxSlot` at the slot's register call site (see index.ts).
 */
export class DshSkillRow extends HTMLElement {
  #props: SkillRowProps | null = null
  #expanded = false

  /** Set/replace props and re-render; called by the slot renderer's webjsx bridge. */
  setProps(props: SkillRowProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  #toggleExpand = (): void => {
    this.#expanded = !this.#expanded
    this.#render()
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const { block, inspect, t } = props
    const model = skillRowModel(block)
    const expandable = model.output !== null
    const open = this.#expanded && expandable
    const status = stateStatus(model.state, t)
    const summary = model.errorSummary ?? model.name
    const toggleFromKeyboard = (event: KeyboardEvent): void => {
      if (!expandable || (event.key !== 'Enter' && event.key !== ' ')) return
      event.preventDefault()
      this.#toggleExpand()
    }
    const leading = disclosureLeading(model.state, open, expandable)
    const vdom = (
      <div class={css.card ?? ''} data-tool="skill" data-state={model.state}>
        <div
          class={css.row ?? ''}
          data-expandable={expandable ? 'true' : null}
          role={expandable ? 'button' : null}
          tabindex={expandable ? '0' : null}
          aria-expanded={expandable ? String(open) : null}
          onclick={expandable ? this.#toggleExpand : null}
          onkeydown={expandable ? toggleFromKeyboard : null}
        >
          <span class={css.leading ?? ''}>{leading}</span>
          {status !== null ? <span class={css.visuallyHidden ?? ''}>{status}</span> : null}
          <span class={css.title ?? ''}>Skill</span>
          <span class={css.separator ?? ''} aria-hidden="true" />
          <span class={model.errorSummary === null ? css.summary ?? '' : `${css.summary ?? ''} ${css.errorSummary ?? ''}`}>
            {summary}
          </span>
        </div>
        {open ? (
          <div class={css.bodyWrap ?? ''}>
            <section class={css.instructionsCard ?? ''} aria-label={t('row.instructions')}>
              <div class={css.instructionsHeader ?? ''}>{t('row.instructions')}</div>
              <pre class={css.instructions ?? ''} data-error={model.state === 'error' ? 'true' : null}>{model.output}</pre>
            </section>
            {inspect !== undefined ? (
              <button type="button" class={css.inspectButton ?? ''} onclick={inspect}>
                <IconInspectOutline12 />
                Inspect
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-skill-row') === undefined) {
  customElements.define('dsh-skill-row', DshSkillRow)
}
