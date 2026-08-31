// Component-local calendar-day tick: memoized message rows keep stable props
// across midnight, so the IconActions clock needs a local day seat that
// re-fires at the next local midnight without reaching for framework hooks.
//
// Converted from a React hook (useState/useEffect) to a plain closure:
// create with `createCalendarDay(onChange)`, read `.day` for the current
// midnight epoch, and call `.stop()` in `disconnectedCallback` to clear the
// pending timer.

import { msUntilNextLocalMidnight, startOfLocalDay } from './message-chrome.ts'

/** Controller returned by {@link createCalendarDay}. */
export interface CalendarDayController {
  /** Midnight ms for the current local day; updates after the boundary. */
  readonly day: number
  /** Clear the pending midnight timer. Idempotent. Call in `disconnectedCallback`. */
  stop: () => void
}

/**
 * Create a local calendar-day epoch that advances at each local midnight.
 * @param onChange - called with the new `day` value whenever it changes.
 * @returns a controller exposing `day` and `stop`.
 */
export function createCalendarDay(onChange: (day: number) => void): CalendarDayController {
  let day = startOfLocalDay(Date.now())
  let timer: ReturnType<typeof setTimeout> | null = null

  const arm = (): void => {
    const now = Date.now()
    day = startOfLocalDay(now)
    onChange(day)
    timer = setTimeout(arm, msUntilNextLocalMidnight(now))
  }
  timer = setTimeout(arm, msUntilNextLocalMidnight(Date.now()))

  return {
    get day() { return day },
    stop(): void {
      if (timer === null) return
      clearTimeout(timer)
      timer = null
    },
  }
}
