// Shared close timing for pointer-dismissed popups (HoverCard, hover-closing
// Menu). Both float free of their anchor, so the pointer has to cross ground
// that belongs to neither on its way in; closing on the first pointerleave
// makes the popup unreachable. The grace turns that transit into a cancelable
// pending close.
//
// Converted from a React hook (useCallback/useEffect/useRef) to a plain
// closure, mirroring use-copy-feedback.ts's createCopyFeedback: create with
// `createPointerGrace(close)`, call `.arm()`/`.cancel()` from pointer
// handlers, and call `.cancel()` in `disconnectedCallback` to clear any
// pending timeout (the former unmount-time useEffect cleanup).

/**
 * Grace before a pointer-dismissed popup closes. Covers the anchor->popup gap
 * (8px for HoverCard, 4px for Menu) at a hand's travel speed without leaving a
 * popup lingering once the pointer has genuinely moved on.
 */
export const POINTER_GRACE_MS = 200

/** Cancelable delayed close for a pointer-dismissed popup. */
export interface PointerGrace {
  /** Schedule the close {@link POINTER_GRACE_MS} from now, replacing any pending one. */
  arm: () => void
  /** Abort a pending close (the pointer came back). Also call this on unmount to clear a pending timer. */
  cancel: () => void
}

/**
 * Create a delayed-close controller for a pointer-dismissed popup, so the
 * pointer can cross the gap between anchor and popup.
 * @param close - runs when the grace elapses with no re-entry; read at fire
 * time, so callers may pass a fresh closure on each call to `arm`.
 * @returns the {@link PointerGrace} handle.
 */
export function createPointerGrace(close: () => void): PointerGrace {
  let timer: ReturnType<typeof setTimeout> | null = null

  const cancel = (): void => {
    if (timer === null) return
    clearTimeout(timer)
    timer = null
  }

  const arm = (): void => {
    cancel()
    timer = setTimeout(() => {
      timer = null
      close()
    }, POINTER_GRACE_MS)
  }

  return { arm, cancel }
}
