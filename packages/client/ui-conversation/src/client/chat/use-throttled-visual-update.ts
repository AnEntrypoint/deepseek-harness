/** Frame-throttled scheduling for non-essential visual alignment.
 *
 * Plain closure: create with `createThrottledVisualUpdate(update, intervalFrames)`,
 * call the returned function to schedule the latest alignment, and call
 * `.stop()` in `disconnectedCallback` to cancel any pending frame.
 */

const DEFAULT_INTERVAL_FRAMES = 3

/** Scheduler returned by {@link createThrottledVisualUpdate}. */
export interface ThrottledVisualUpdate {
  /** Schedule the latest alignment; coalesces repeated calls within the interval. */
  (): void
  /** Cancel any pending frame. Idempotent. Call in `disconnectedCallback`. */
  stop: () => void
}

/**
 * Create a stable scheduler that coalesces visual updates over a frame interval.
 * @param update - DOM alignment to run after the throttle interval; read fresh
 *   on each call so the owner can update its closed-over state without
 *   recreating the scheduler.
 * @param intervalFrames - frames to wait before applying the latest alignment.
 * @returns a scheduler function exposing `.stop()`.
 */
export function createThrottledVisualUpdate(
  update: () => void,
  intervalFrames = DEFAULT_INTERVAL_FRAMES,
): ThrottledVisualUpdate {
  let pendingFrame: number | null = null

  const schedule = (): void => {
    if (pendingFrame !== null) return
    let remainingFrames = intervalFrames
    const advance = (): void => {
      remainingFrames -= 1
      if (remainingFrames > 0) {
        pendingFrame = requestAnimationFrame(advance)
        return
      }
      pendingFrame = null
      update()
    }
    pendingFrame = requestAnimationFrame(advance)
  }

  schedule.stop = (): void => {
    if (pendingFrame === null) return
    cancelAnimationFrame(pendingFrame)
    pendingFrame = null
  }

  return schedule
}
