// Converted from a React hooks component to a webjsx custom element: the
// `open` useState becomes a private field, re-render is an explicit
// applyDiff(this, vdom) call.

import { applyDiff } from 'webjsx'
import type { ContextMessageNode } from '@deepseek-ai/dsh-client-runtime/client'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { DisclosureRow, IconBrowseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { ReferenceIcon } from '../reference/ReferenceIcon.tsx'
import { contextBody } from './ContextBody.tsx'
import css from './ContextInjectionRow.module.css'

/** Props for the logged non-user message presentation. */
export interface ContextInjectionRowProps {
  content: ContextMessageNode['content']
  source: ContextMessageNode['source']
  /** Role and producer name projected from the durable source. */
  provenance: ContextMessageNode['provenance']
  /** Producer-declared information form; null renders the opaque body. */
  form: ContextMessageNode['form']
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

const DEFAULT_PROPS: ContextInjectionRowProps = {
  content: [],
  source: null,
  provenance: { role: 'context', label: null },
  form: null,
  t: (key: string) => key,
}

/**
 * Render logged context with the Tool calls disclosure chrome from Figma.
 *
 * The header names the role the context plays and, beside it, the producer the
 * durable source identifies, so a reader can tell an injected skill catalog
 * from a workspace instruction file or a recalled session without expanding.
 * The expanded body follows the producer-declared form; an absent or unknown
 * form renders the opaque body.
 */
export class DshContextInjectionRow extends HTMLElement {
  #props: ContextInjectionRowProps = DEFAULT_PROPS
  #open = false

  setProps(props: ContextInjectionRowProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  #toggle = (): void => {
    this.#open = !this.#open
    this.#render()
  }

  #render(): void {
    const { content, source, provenance, form, t } = this.#props
    // Resolved rather than declared: a form whose fields are unreadable renders
    // the opaque body, and the marker must say what the row actually shows.
    const { rendered, summary, body } = contextBody(form, { content, source, t })

    const vdom = (
      <DisclosureRow
        className={css.root ?? ''}
        icon={provenance.role === 'recall'
          ? <span data-context-recall-icon><ReferenceIcon kind="session" /></span>
          : <IconBrowseOutline16 size={14} />}
        chevronClassName={css.chevron ?? ''}
        title={t(provenance.role === 'recall' ? 'message.contextRecall' : 'message.contextInjection')}
        {...(provenance.label === null ? {} : {
          // ToolRow's separator shape: an aria-hidden dot, so the accessible name
          // stays the two readable parts and the two disclosure rows expose one
          // name shape. A source that names no producer drops the dot with it.
          collapsedContent: [
            <span class={css.sep ?? ''} aria-hidden />,
            <span class={css.source ?? ''} data-context-source>{provenance.label}</span>,
            ...(summary !== null ? [
              <span class={css.sep ?? ''} aria-hidden />,
              <span class={css.summary ?? ''} data-context-summary>{summary}</span>,
            ] : []),
          ],
        })}
        keepContentWhenOpen
        open={this.#open}
        expandable
        expandOnRowClick
        onToggle={this.#toggle}
      >
        <div class={css.body ?? ''} data-context-injection-body data-context-form={rendered ?? undefined}>
          {body}
        </div>
      </DisclosureRow>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-context-injection-row') === undefined) {
  customElements.define('dsh-context-injection-row', DshContextInjectionRow)
}

/**
 * Create (if needed) or update a ContextInjectionRow element in place.
 * @param el - an existing `dsh-context-injection-row` element to update, or null to create one.
 * @param props - see {@link ContextInjectionRowProps}.
 * @returns the `dsh-context-injection-row` element; keep it and pass it back in to update.
 */
export function renderContextInjectionRow(
  el: DshContextInjectionRow | null,
  props: ContextInjectionRowProps,
): DshContextInjectionRow {
  const target = el ?? document.createElement('dsh-context-injection-row') as DshContextInjectionRow
  target.setProps(props)
  return target
}

/** One-shot creation helper preserving the original function-component call shape. */
export function ContextInjectionRow(props: ContextInjectionRowProps): JSX.Element {
  return renderContextInjectionRow(null, props) as unknown as JSX.Element
}
