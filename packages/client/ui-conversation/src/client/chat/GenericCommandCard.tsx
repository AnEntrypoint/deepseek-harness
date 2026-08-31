// GenericCommandCard: the default command row — a stripped-down
// GenericToolCard rendering the command name and its settlement text.
// Supplied by the chat view as the keyed commandview slot's render-site
// fallback (an unregistered command name lands here); registrants may compose
// it as a base, feeding the same owner payload through.
//
// Converted from a React hooks component to a webjsx custom element: the
// `expanded` useState becomes a private field, re-render is an explicit
// applyDiff(this, vdom) call.

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import { DisclosureRow, IconApiOutline14, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps, CommandRowOwnerProps } from '../contract/slots.ts'
import a11yCss from './accessibility.module.css'
import css from './GenericCommandCard.module.css'

type CommandRowState = 'running' | 'ok' | 'error'

/** Node state → row state semantic (running while unsettled; outcome kind after). */
function stateOf(outcome: CommandRowOwnerProps['node']['outcome']): CommandRowState {
  if (outcome === null) return 'running'
  return outcome.kind === 'error' ? 'error' : 'ok'
}

function leadingFor(state: CommandRowState): VNode {
  return state === 'error' ? <StateDot state="error" /> : <IconApiOutline14 size={14} />
}

/** Card props: the owner payload plus the render site's locale seat (plain prop). */
export interface GenericCommandCardProps extends CommandRowOwnerProps {
  t: ChatViewSlotProps['t']
  /** Command-specific running copy; absent uses the generic command label. */
  runningSummary?: string | undefined
}

const DEFAULT_PROPS: GenericCommandCardProps = {
  node: { name: null, outcome: null } as unknown as CommandRowOwnerProps['node'],
  t: (key: string) => key,
}

/** Generic command row custom element. */
export class DshGenericCommandCard extends HTMLElement {
  #props: GenericCommandCardProps = DEFAULT_PROPS
  #expanded = false

  setProps(props: GenericCommandCardProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  #toggle = (): void => {
    this.#expanded = !this.#expanded
    this.#render()
  }

  #render(): void {
    const { node, t, runningSummary } = this.#props
    const text = node.outcome?.text
    const summary = node.outcome === null
      ? runningSummary ?? t('command.running')
      : text ?? (node.outcome.kind === 'error' ? t('command.failed') : t('command.done'))
    // Title is the bare command name: the row already reads `name · outcome`,
    // and the dispatched line's own `/` and arguments only restate what the
    // settlement text says (`permission · preset workspace-write`). A
    // cross-window node whose run page fell out of the window has no name.
    const title = node.name ?? t('command.title')
    const state = stateOf(node.outcome)
    const body = text !== undefined && text.includes('\n') ? text : null
    const open = this.#expanded && body !== null
    const vdom = (
      <div class={css.root ?? ''} data-variant="others" data-state={state}>
        {state === 'running' && <span class={a11yCss.visuallyHidden ?? ''}>{t('row.running')}</span>}
        {state === 'error' && <span class={a11yCss.visuallyHidden ?? ''}>{t('row.failed')}</span>}
        <DisclosureRow
          rowClassName={css.row}
          leadingClassName={css.leading}
          titleClassName={css.title}
          chevronClassName={css.chevron}
          icon={leadingFor(state)}
          title={title}
          open={open}
          expandable={body !== null}
          expandOnRowClick
          keepContentWhenOpen
          onToggle={this.#toggle}
          collapsedContent={(
            <>
              <span class={css.separator ?? ''} aria-hidden />
              <span class={css.summary ?? ''} data-error={state === 'error' || undefined}>{summary}</span>
            </>
          )}
        >
          <pre class={css.body ?? ''} data-error={state === 'error' || undefined}>{body}</pre>
        </DisclosureRow>
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-generic-command-card') === undefined) {
  customElements.define('dsh-generic-command-card', DshGenericCommandCard)
}

/**
 * Create (if needed) or update a GenericCommandCard element in place.
 * @param el - an existing `dsh-generic-command-card` element to update, or null to create one.
 * @param props - see {@link GenericCommandCardProps}.
 * @returns the `dsh-generic-command-card` element; keep it and pass it back in to update.
 */
export function renderGenericCommandCard(
  el: DshGenericCommandCard | null,
  props: GenericCommandCardProps,
): DshGenericCommandCard {
  const target = el ?? document.createElement('dsh-generic-command-card') as DshGenericCommandCard
  target.setProps(props)
  return target
}

/** One-shot creation helper preserving the original function-component call shape. */
export function GenericCommandCard(props: GenericCommandCardProps): JSX.Element {
  return renderGenericCommandCard(null, props) as unknown as JSX.Element
}
