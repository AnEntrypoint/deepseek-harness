/** Localized cards for `cordis_stop` and `cordis_undefine`. */

import {
  IconInspectOutline12, IconStopFill16, IconTrashOutline16, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { cordisActionCard } from './card-model.ts'
import css from './CordisRunRow.css.ts'

/** Full action-card props composed by the keyed Tool slot. */
export type CordisActionRowProps = ToolCallViewProps & PropsLocale<'cordis'>

/** Render one Stop or Remove call with Cordis-owned localized copy. */
export function CordisActionRow({ callId, toolName, block, inspect, t }: CordisActionRowProps): JSX.Element {
  const card = cordisActionCard(block)
  const remove = toolName === 'cordis_undefine'
  const summary = card.errorSummary ?? card.pluginId ?? callId

  return (
    <div class={css.card ?? ''} data-tool={toolName} data-state={card.state}>
      <div class={css.row ?? ''}>
        <span class={css.icon ?? ''}>
          {card.state === 'error'
            ? <StateDot state="error" />
            : card.state === 'stopped'
              ? <StateDot state="warning" />
              : remove ? <IconTrashOutline16 size={14} /> : <IconStopFill16 size={14} />}
        </span>
        <span class={css.title ?? ''}>{t(remove ? 'row.removeTitle' : 'row.stopTitle')}</span>
        <span class={css.separator ?? ''} aria-hidden />
        <span class={card.errorSummary === null ? (css.summary ?? '') : (css.error ?? '')}>{summary}</span>
        {inspect !== undefined && (
          <button type="button" class={css.inspect ?? ''} aria-label="Inspect" onclick={inspect}>
            <IconInspectOutline12 />
          </button>
        )}
      </div>
      {card.output !== null && <pre class={css.output ?? ''}>{card.output}</pre>}
    </div>
  )
}
