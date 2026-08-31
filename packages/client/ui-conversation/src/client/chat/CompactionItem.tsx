// CompactionItem: the one row a landed compaction contributes to the flow.
// The conversation it shadowed on the model surface stays above it, so this
// marker reports where the model stopped seeing that history — it never
// replaces it. The framed checkpoint payload is written for the model and is
// not rendered; the disclosure shows the summary from the checkpoint's own
// cited `compaction/summary` event, and a window cut that left that event outside makes the row
// non-expandable rather than empty.
//
// Converted from a React hooks component to a webjsx custom element: the
// `expanded` useState becomes a private field, re-render is an explicit
// applyDiff(this, vdom) call.

import { applyDiff } from 'webjsx'
import type { CompactionSummaryNode } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconApiOutline14,
  IconChevronDownOutline14,
  IconChevronRightOutline14,
  MarkdownText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import css from './MessageItem.module.css'

export interface CompactionItemProps {
  node: CompactionSummaryNode
  /** Optional command title for a manual compaction folded into this marker. */
  title?: string
  /** Command settlement text used when structured compaction counts are unavailable. */
  fallbackSummary?: string | null
  /** The owning view's locale seat. */
  t: ChatViewSlotProps['t']
}

const DEFAULT_PROPS: CompactionItemProps = {
  node: { summary: null, shadowedItemCount: null, shadowedTokenCount: null } as unknown as CompactionSummaryNode,
  t: (key: string) => key,
}

/** The collapsed-by-default compaction marker custom element. */
export class DshCompactionItem extends HTMLElement {
  #props: CompactionItemProps = DEFAULT_PROPS
  #expanded = false

  setProps(props: CompactionItemProps): void {
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
    const { node, title, fallbackSummary, t } = this.#props
    const expandable = node.summary !== null
    const open = expandable && this.#expanded
    const summary = node.shadowedItemCount !== null && node.shadowedTokenCount !== null
      ? t('message.compaction.completed', {
        items: node.shadowedItemCount,
        tokens: node.shadowedTokenCount,
      })
      : fallbackSummary
        ?? (expandable ? t('message.compaction.expand') : t('message.compaction.unavailable'))
    const vdom = (
      <div class={css.compactionRow ?? ''}>
        <button
          type="button"
          class={css.compactionButton ?? ''}
          disabled={!expandable}
          aria-expanded={expandable ? open : undefined}
          onclick={this.#toggle}
        >
          <span class={css.compactionLeading ?? ''} aria-hidden>
            <span class={css.compactionContextIcon ?? ''} data-compaction-icon="context">
              <IconApiOutline14 />
            </span>
            <span
              class={css.compactionDisclosureIcon ?? ''}
              data-compaction-disclosure={open ? 'expanded' : 'collapsed'}
            >
              {open ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
            </span>
          </span>
          <span class={css.compactionTitle ?? ''}>{title ?? t('message.compaction')}</span>
          <span class={css.compactionSep ?? ''} aria-hidden />
          <span class={css.compactionSummary ?? ''}>{summary}</span>
        </button>
        {open && node.summary !== null
          && <div class={css.compactionBody ?? ''}><MarkdownText text={node.summary} /></div>}
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-compaction-item') === undefined) {
  customElements.define('dsh-compaction-item', DshCompactionItem)
}

/**
 * Create (if needed) or update a CompactionItem element in place.
 * @param el - an existing `dsh-compaction-item` element to update, or null to create one.
 * @param props - see {@link CompactionItemProps}.
 * @returns the `dsh-compaction-item` element; keep it and pass it back in to update.
 */
export function renderCompactionItem(
  el: DshCompactionItem | null,
  props: CompactionItemProps,
): DshCompactionItem {
  const target = el ?? document.createElement('dsh-compaction-item') as DshCompactionItem
  target.setProps(props)
  return target
}

/** One-shot creation helper preserving the original function-component call shape. */
export function CompactionItem(props: CompactionItemProps): JSX.Element {
  return renderCompactionItem(null, props) as unknown as JSX.Element
}
