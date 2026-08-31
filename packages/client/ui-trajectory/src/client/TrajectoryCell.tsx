// Legacy standalone trajectory cell retained for direct consumers and specs.

import {
  formatElapsedSeconds,
  type TrajectoryCellKind,
  type TrajectoryCellProps,
} from './trajectory-record.ts'
import css from './TrajectoryCell.module.css'

export { formatElapsedSeconds }
export type {
  AssistantMetricDetail,
  TrajectoryCellKind,
  TrajectoryCellProps,
} from './trajectory-record.ts'

/** Display label per kind (matches the design tags). */
const KIND_LABEL: Record<TrajectoryCellKind, string> = {
  system: 'System',
  user: 'User',
  context: 'Context',
  compacted: 'Compacted',
  message: 'Message',
  tool: 'Tool',
  subtool: 'Sub',
}

const TAG_CLASS: Record<TrajectoryCellKind, string | undefined> = {
  system: css.tagSystem,
  user: css.tagUser,
  context: css.tagContext,
  compacted: css.tagSystem,
  message: css.tagMessage,
  tool: css.tagTool,
  subtool: css.tagSubtool,
}

/**
 * Render one trajectory step cell.
 * @param props - index, kind, text, time, and optional Message metrics.
 * @returns the cell element.
 */
export function TrajectoryCell({
  index,
  kind,
  text,
  inputDetail: _inputDetail,
  promptDetail: _promptDetail,
  previousPromptDetail: _previousPromptDetail,
  outputDetail: _outputDetail,
  thinkingDetail: _thinkingDetail,
  sourceBlocks: _sourceBlocks,
  outputBlocks: _outputBlocks,
  schemaDetail: _schemaDetail,
  assistantMetrics: _assistantMetrics,
  result: _result,
  callId: _callId,
  isError: _isError,
  timeSeconds,
  startedAt: _startedAt,
  input,
  output,
  think,
  selected = false,
  className,
  ...rest
}: TrajectoryCellProps): JSX.Element {
  const rootClass = [
    css.root,
    selected ? css.selected : undefined,
    className,
  ].filter((c): c is string => c !== undefined).join(' ')
  const showMetrics = kind === 'message'
  return (
    <div class={rootClass} data-kind={kind} data-selected={selected || undefined} {...rest}>
      <span class={css.index ?? ''}>#{index}</span>
      <span class={css.tagSlot ?? ''}>
        <span class={[css.tag, TAG_CLASS[kind]].filter((c): c is string => c !== undefined).join(' ')}>{KIND_LABEL[kind]}</span>
      </span>
      <span class={css.text ?? ''}>{text}</span>
      <span class={css.trailing ?? ''}>
        {showMetrics ? [
          <span class={css.metric ?? ''}>{input ?? ''}</span>,
          <span class={css.metric ?? ''}>{output ?? ''}</span>,
          <span class={css.metric ?? ''}>{think ?? ''}</span>,
        ] : null}
        <span class={css.time ?? ''}>{formatElapsedSeconds(timeSeconds)}</span>
      </span>
    </div>
  )
}
