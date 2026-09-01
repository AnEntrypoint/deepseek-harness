// TrajectoryTurnHeader: sticky per-turn bar with Input/Output/Think/Time labels.

import css from './TrajectoryTurnHeader.css.ts'

const COLUMN_LABELS = ['Input', 'Output', 'Think', 'Time'] as const

export interface TrajectoryTurnHeaderProps {
  /** 1-based turn index shown as `Turn N`. */
  turn: number
}

/**
 * Render the sticky turn header row.
 * @param props.turn - turn index.
 * @returns the sticky header element.
 */
export function TrajectoryTurnHeader({ turn }: TrajectoryTurnHeaderProps): JSX.Element {
  return (
    <div class={css.root ?? ''}>
      <div class={css.inner ?? ''}>
        <span class={css.title ?? ''}>Turn {turn}</span>
        <div class={css.columns ?? ''} aria-hidden="true">
          {COLUMN_LABELS.map(label => (
            <span key={label} class={css.column ?? ''}>{label}</span>
          ))}
        </div>
      </div>
    </div>
  )
}
