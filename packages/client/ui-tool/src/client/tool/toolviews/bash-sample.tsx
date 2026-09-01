// Bash toolview registrant: third-party posture over the keyed toolview hole
// (ctx.slots.register + ToolRowProps only — never imports the chat domain).
// Product chrome matches ToolRow / Think (figma: Bash · {description}).
//
// A bash call normally declares the terminal render intent, so this row renders
// the command's own output through TerminalBlock. Execution failures that
// settle without terminal material use the bounded generic IN/OUT fallback —
// both are expand-gated exactly like
// ToolRow's unified interaction: collapsed by default, the whole summary row
// is the toggle (click / Enter / Space, icon→chevron hover preview; the
// summary stays inline while open),
// and the expanded card max-height-scrolls inside its own surface with the
// full output (maxLines Infinity — no middle collapse). An error row's
// collapsed summary is the failure's first line in the error color.

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import type { Context } from '@deepseek-ai/cordis'
import clsx from 'clsx'
import {
  IconApiOutline14, IconChevronDownOutline14, IconInspectOutline12, StateDot, TerminalBlock,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '../../contract/slots.ts'
import { terminalBlockLabels, terminalCardModel, terminalFailed } from '../models/terminal-card-model.ts'
import { toolRowModel, type ToolRowState } from '../models/tool-call-model.ts'
import { CONVERSATION_NS as NS } from '../../locale.ts'
import css from './bash-sample.css.ts'

/** Bash row props: the toolview runtime share plus the standard locale seat. */
type BashRowProps = ToolCallViewProps & PropsLocale<'conversation'>

function leadingFor(state: ToolRowState): VNode {
  switch (state) {
    case 'error': return <StateDot state="error" />
    case 'stopped': return <StateDot state="warning" />
    // Running keeps the icon — the row sweep carries the in-flight signal.
    default: return <IconApiOutline14 size={14} />
  }
}

/** Visually hidden status — StateDot is aria-hidden; AT needs a text label. */
function stateStatus(state: ToolRowState, t: BashRowProps['t']): string | null {
  switch (state) {
    case 'running': return t('bash.running')
    case 'error': return t('bash.failed')
    case 'stopped': return t('bash.stopped')
    default: return null
  }
}

/**
 * Bash row: icon + Bash · {description} in the shared ToolRow chrome, the
 * whole row toggling the command's terminal or generic error card (ToolRow's unified
 * expand interaction, replicated locally per the registrant posture).
 *
 * Converted from a React hooks component (`expanded` was `useState`) to a
 * webjsx custom element: `expanded` is an instance field, re-render is an
 * explicit `#render()` calling `applyDiff(this, vdom)`.
 */
export class DshBashRow extends HTMLElement {
  #props: BashRowProps | null = null
  #expanded = false

  setProps(props: BashRowProps): void {
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
    const { toolName, block, sessionId, useSessions, inspect, t } = props
    const model = toolRowModel(toolName, block)
    // Session workspace root: the terminal view's cwd resolves against it (an
    // omitted workdir IS the workspace), which the pure presenter cannot do.
    const cwd = useSessions(list => list.byId[sessionId]?.cwd)
    const terminal = terminalCardModel(block, cwd)
    // A failing exit status is the terminal card's own error signal (the call
    // itself settles isError:false), surfaced as the row's red state dot.
    const state = model.state === 'ok' && terminal !== null && terminalFailed(terminal)
      ? 'error'
      : model.state
    const status = stateStatus(state, t)
    // Execution failures (for example cancellation before the process reports a
    // terminal result) use the generic presenter. Keep their recorded args and
    // full error reachable instead of collapsing the row to the first line.
    const genericError = terminal === null
      && model.state === 'error'
      && (model.body !== null || model.output !== null)
    const expandable = terminal !== null || genericError
    const open = this.#expanded && expandable
    const failureLine = model.state === 'error' ? model.errorSummary : null
    const toggleFromKeyboard = (event: KeyboardEvent): void => {
      if (!expandable || (event.key !== 'Enter' && event.key !== ' ')) return
      event.preventDefault()
      this.#toggleExpand()
    }
    const leading = open
      ? <IconChevronDownOutline14 className={css.chevron} />
      : expandable
        ? (
          [
            <span class={css.iconIdle ?? ''}>{leadingFor(state)}</span>,
            <IconChevronDownOutline14 className={clsx(css.chevron, css.chevronHover)} />,
          ]
        )
        : leadingFor(state)
    const vdom = (
      <div class={css.card ?? ''}>
        <div
          class={css.root ?? ''}
          data-sample="bash"
          data-variant="bash"
          data-state={state}
          data-expandable={expandable || undefined}
          role={expandable ? 'button' : undefined}
          tabindex={expandable ? 0 : undefined}
          aria-expanded={expandable ? open : undefined}
          onclick={expandable ? this.#toggleExpand : null}
          onkeydown={expandable ? toggleFromKeyboard : null}
        >
          <span class={css.leading ?? ''}>{leading}</span>
          {status !== null && <span class={css.visuallyHidden ?? ''}>{status}</span>}
          <span class={css.title ?? ''}>{model.title}</span>
          <span class={css.sep ?? ''} aria-hidden />
          {/* The terminal presenter's description is the contractual
              above-card summary; a failure's first line outranks both. */}
          <span class={clsx(css.summary, failureLine !== null && css.errorSummary)}>
            {failureLine ?? terminal?.description ?? model.summary}
          </span>
        </div>
        {open && (
          /* Same hover-Inspect posture as ToolRow's expanded body, replicated
             locally per the registrant posture. */
          <div class={css.bodyWrap ?? ''}>
            {terminal !== null
              ? (
                <TerminalBlock
                  {...terminal.card}
                  maxLines={Infinity}
                  labels={terminalBlockLabels(t)}
                  className={css.terminal}
                /> as unknown as JSX.Element
              )
              : (
                <div class={css.ioCard ?? ''}>
                  {model.body !== null && (
                    <div class={css.ioSection ?? ''}>
                      <span class={css.ioLabel ?? ''}>IN</span>
                      <span class={css.ioText ?? ''}>{model.body}</span>
                    </div>
                  )}
                  {model.body !== null && model.output !== null && (
                    <span class={css.ioDivider ?? ''} aria-hidden />
                  )}
                  {model.output !== null && (
                    <div class={css.ioSection ?? ''}>
                      <span class={css.ioLabel ?? ''}>OUT</span>
                      <span class={css.ioText ?? ''} data-error>
                        {model.output}
                      </span>
                    </div>
                  )}
                </div>
              )}
            {inspect !== undefined && (
              <button type="button" class={css.inspectButton ?? ''} onclick={inspect}>
                <IconInspectOutline12 />
                Inspect
              </button>
            )}
          </div>
        )}
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-bash-row') === undefined) {
  customElements.define('dsh-bash-row', DshBashRow)
}

/** One-shot creation helper preserving the original function-component call shape. */
export function BashRow(props: BashRowProps): DshBashRow {
  const el = document.createElement('dsh-bash-row') as DshBashRow
  el.setProps(props)
  return el
}

/**
 * The sample as a plain registrant plugin. Slot injection follows the chat
 * toolview declaration across independent activation and reload lifetimes.
 */
export const bashToolviewSample = {
  name: 'bash-toolview-sample',
  inject: ['slots'],
  /**
   * Register the bash row into the Tool-owned keyed view slot.
   * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
   */
  apply(ctx: Context): void {
    ctx.slots.inject('tool.call.toolview', () =>
      ctx.slots.register({ name: 'tool.call.toolview', key: 'bash', locale: NS }, BashRow))
  },
}
