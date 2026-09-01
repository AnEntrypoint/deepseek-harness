// TrajectoryTurn: sticky Turn header plus the padded Message/Step body.

import type { VNode } from 'webjsx'
import { TrajectoryTurnHeader } from './TrajectoryTurnHeader.tsx'
import css from './TrajectoryTurn.css.ts'

export interface TrajectoryTurnProps {
  /** 1-based turn index for the sticky header. */
  turn: number
  /** Message / Step headers and TrajectoryCell rows. */
  children?: VNode | VNode[] | string | null
}

/**
 * Render one turn section (sticky header + body).
 * @param props - turn index and body children.
 * @returns the turn section element.
 */
export function TrajectoryTurn({ turn, children }: TrajectoryTurnProps): JSX.Element {
  return (
    <section class={css.root ?? ''} data-turn={turn}>
      <TrajectoryTurnHeader turn={turn} />
      <div class={css.body ?? ''}>{children}</div>
    </section>
  )
}
