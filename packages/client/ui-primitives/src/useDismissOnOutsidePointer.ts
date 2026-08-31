/**
 * Outside-pointer dismissal for trigger-owned popovers (jobs list, Cordis
 * panel): while the surface is open, a pointerdown outside the root closes it.
 *
 * Converted from a React hook (useEffect) to a plain closure: call `start()`
 * when the surface opens, `stop()` when it closes/unmounts. Idempotent on
 * both ends, so callers may call `start()`/`stop()` freely as `open` toggles.
 */

/** Inputs for {@link createDismissOnOutsidePointer}. */
export interface DismissOnOutsidePointerOptions {
  /** Element containing both the trigger and the open surface. */
  root: HTMLElement | null
  /** Called with `false` on an outside pointerdown. */
  onDismiss: (open: false) => void
}

/** Controller returned by {@link createDismissOnOutsidePointer}. */
export interface DismissOnOutsidePointerController {
  /** Attach the outside-pointerdown listener. Call when the surface opens. */
  start: () => void
  /** Detach the listener. Idempotent. Call when the surface closes/unmounts. */
  stop: () => void
}

/**
 * Create a controller that closes an open popover when a pointerdown lands
 * outside its root element.
 * @param options - the root element and the dismiss callback.
 * @returns a controller exposing start/stop.
 */
export function createDismissOnOutsidePointer(
  options: DismissOnOutsidePointerOptions,
): DismissOnOutsidePointerController {
  let started = false
  const closeOutside = (event: PointerEvent): void => {
    if (event.target instanceof Node && !options.root?.contains(event.target)) {
      options.onDismiss(false)
    }
  }
  return {
    start(): void {
      if (started) return
      started = true
      document.addEventListener('pointerdown', closeOutside)
    },
    stop(): void {
      if (!started) return
      started = false
      document.removeEventListener('pointerdown', closeOutside)
    },
  }
}
