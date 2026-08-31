/** Assistant reasoning disclosure, independent of Tool-call presentation.
 *
 * Converted from a React hooks component to a webjsx custom element: the
 * `expanded` useState becomes a private field, the summary scroll-follow
 * useEffect becomes connectedCallback binding plus an explicit call after
 * each render, and re-render is an explicit applyDiff(this, vdom) call.
 */
import { applyDiff } from 'webjsx'
import { DisclosureRow, IconThinkOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { createThrottledVisualUpdate } from './use-throttled-visual-update.ts'
import a11yCss from './accessibility.module.css'
import css from './ReasoningRow.module.css'

function firstLine(text: string): string {
  const newline = text.indexOf('\n')
  return newline === -1 ? text : text.slice(0, newline)
}

function latestLine(text: string): string {
  const visible = text.trimEnd()
  const newline = visible.lastIndexOf('\n')
  return newline === -1 ? visible : visible.slice(newline + 1)
}

export interface ReasoningRowProps {
  /** Complete or streaming reasoning text. */
  text: string
  /** Whether this block is the streaming tail. */
  running: boolean
  /** Conversation locale seat for the running status. */
  t: ChatViewSlotProps['t']
}

const DEFAULT_PROPS: ReasoningRowProps = { text: '', running: false, t: (key: string) => key }

/** Assistant reasoning disclosure custom element. */
export class DshReasoningRow extends HTMLElement {
  #props: ReasoningRowProps = DEFAULT_PROPS
  #expanded = false
  #scheduleSummaryScroll = createThrottledVisualUpdate(() => { this.#scrollSummary() })

  setProps(props: ReasoningRowProps): void {
    this.#props = props
    this.#render()
    this.#scheduleSummaryScroll()
  }

  connectedCallback(): void {
    this.#render()
    this.#scheduleSummaryScroll()
  }

  disconnectedCallback(): void {
    this.#scheduleSummaryScroll.stop()
  }

  #scrollSummary(): void {
    const element = this.querySelector<HTMLSpanElement>(`.${css.summary}`)
    if (element === null) return
    element.scrollLeft = this.#props.running ? element.scrollWidth - element.clientWidth : 0
  }

  #toggle = (): void => {
    this.#expanded = !this.#expanded
    this.#render()
  }

  #render(): void {
    const { text, running, t } = this.#props
    const summary = running ? latestLine(text) : firstLine(text)
    const vdom = (
      <div class={css.root ?? ''} data-variant="think" data-state={running ? 'running' : 'ok'}>
        {running && <span class={a11yCss.visuallyHidden ?? ''}>{t('row.running')}</span>}
        <DisclosureRow
          rowClassName={css.row}
          leadingClassName={css.leading}
          titleClassName={css.title}
          chevronClassName={css.chevron}
          icon={<IconThinkOutline14 size={14} />}
          title="Think"
          open={this.#expanded}
          expandable
          expandOnRowClick
          onToggle={this.#toggle}
          collapsedContent={(
            <>
              <span class={css.separator ?? ''} aria-hidden />
              <span class={css.summary ?? ''} data-follow-end={running || undefined}>{summary}</span>
            </>
          )}
        >
          <div class={css.thinkBody ?? ''}>{text}</div>
        </DisclosureRow>
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-reasoning-row') === undefined) {
  customElements.define('dsh-reasoning-row', DshReasoningRow)
}

/**
 * Create (if needed) or update a ReasoningRow element in place.
 * @param el - an existing `dsh-reasoning-row` element to update, or null to create one.
 * @param props - see {@link ReasoningRowProps}.
 * @returns the `dsh-reasoning-row` element; keep it and pass it back in to update.
 */
export function renderReasoningRow(el: DshReasoningRow | null, props: ReasoningRowProps): DshReasoningRow {
  const target = el ?? document.createElement('dsh-reasoning-row') as DshReasoningRow
  target.setProps(props)
  return target
}

/** One-shot creation helper preserving the original function-component call shape. */
export function ReasoningRow(props: ReasoningRowProps): JSX.Element {
  return renderReasoningRow(null, props) as unknown as JSX.Element
}
