/**
 * Viewport-fit controller for bottom-anchored overlays (slash menu,
 * popupSelect): the element's bottom edge is laid out independent of its
 * height, so it grows upward and only the top edge can collide with the
 * viewport — clamp the design cap to the space between that edge and the
 * viewport top.
 *
 * Converted from a React hook (useLayoutEffect/useState) to a plain closure:
 * call `start()` in `connectedCallback`/whenever the signal changes, `stop()`
 * in `disconnectedCallback`, and read `.value` (re-measured synchronously on
 * `start()`) for the current max-height. Pass an `onChange` callback so the
 * owner can trigger its own `#render()` when a resize/scroll re-fit changes
 * the value.
 */

/** Safe distance kept between the overlay and the viewport top edge (mirrors the Menu portal margin). */
const MARGIN = 12

/** Inputs for {@link createAnchoredMaxHeight}. */
export interface AnchoredMaxHeightOptions {
  /** The overlay element; a null element (overlay closed) skips measuring. */
  el: HTMLElement | null
  /** Design max-height in px (the clamp never exceeds it). */
  cap: number
  /** Called with the new max-height whenever a re-fit changes it. */
  onChange: (maxHeight: number) => void
}

/** Controller returned by {@link createAnchoredMaxHeight}. */
export interface AnchoredMaxHeightController {
  /** Current max-height to apply inline, in px. */
  readonly value: number
  /** Measure now and attach resize/scroll listeners. Call again (after `stop()`) whenever `el`/`cap`/the react-signal changes. */
  start: () => void
  /** Detach listeners. Idempotent. */
  stop: () => void
}

/**
 * Create a controller that clamps a bottom-anchored overlay's max-height to
 * the viewport.
 * @param options - the element, the design cap, and the change callback.
 * @returns a controller exposing the current value plus start/stop.
 */
export function createAnchoredMaxHeight(options: AnchoredMaxHeightOptions): AnchoredMaxHeightController {
  let { el, cap } = options
  const { onChange } = options
  let maxHeight = cap
  let started = false

  const fit = (): void => {
    if (el === null) return
    const next = Math.min(cap, Math.max(0, el.getBoundingClientRect().bottom - MARGIN))
    if (next !== maxHeight) {
      maxHeight = next
      onChange(maxHeight)
    }
  }

  return {
    get value() { return maxHeight },
    start(): void {
      if (started) this.stop()
      el = options.el
      cap = options.cap
      if (el === null) return
      started = true
      fit()
      window.addEventListener('resize', fit)
      window.addEventListener('scroll', fit, true)
    },
    stop(): void {
      if (!started) return
      started = false
      window.removeEventListener('resize', fit)
      window.removeEventListener('scroll', fit, true)
    },
  }
}
