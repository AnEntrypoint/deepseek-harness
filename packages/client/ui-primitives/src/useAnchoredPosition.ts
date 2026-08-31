/**
 * Keep a fixed-position floating element anchored to a trigger.
 *
 * A portaled panel is positioned from its anchor's viewport rect, which stops
 * being true the moment anything scrolls or the window resizes. This owns that
 * one concern: measure the anchor, offset the panel below it, clamp the result
 * inside the viewport, and re-run on scroll (capture phase, so scrollers nested
 * inside the page are caught too), on resize, and on the panel's own size
 * changes while the element is open.
 *
 * Converted from a React hook (useLayoutEffect/useState) to a plain closure:
 * call `start()` when the panel opens (or in `connectedCallback` if it starts
 * open), `stop()` when it closes/unmounts, and read `.value` for the current
 * `{ left, top }` (or `null` before the first measurement / while closed).
 * Pass `onChange` so the owner can trigger its own `#render()`.
 * @module @deepseek-ai/dsh-client-ui-primitives/useAnchoredPosition
 */

/** A panel's fixed-position coordinates. */
export interface AnchoredPosition {
  left: number
  top: number
}

/** Inputs for {@link createAnchoredPosition}. */
export interface AnchoredPositionOptions {
  /** The element the panel is placed from. */
  anchor: HTMLElement | null
  /** The floating element, measured so the clamp uses real dimensions. */
  panel: HTMLElement | null
  /** Distance kept between the anchor's bottom edge and the panel's top. */
  gap: number
  /** Distance kept between the panel and each viewport edge. */
  margin: number
  /** Called with the new position (or `null`) whenever it changes. */
  onChange: (position: AnchoredPosition | null) => void
}

/** Controller returned by {@link createAnchoredPosition}. */
export interface AnchoredPositionController {
  /** Current `left`/`top` for the panel, or `null` before the first measurement / while stopped. */
  readonly value: AnchoredPosition | null
  /** Measure now and attach scroll/resize/ResizeObserver listeners. Call whenever the panel opens. */
  start: () => void
  /** Detach listeners and reset `value` to `null`. Idempotent. Call whenever the panel closes/unmounts. */
  stop: () => void
}

/**
 * Create a controller that tracks an anchor and reports the panel's fixed
 * coordinates.
 * @param options - the anchor/panel elements, gap/margin distances, and the change callback.
 * @returns a controller exposing the current value plus start/stop.
 */
export function createAnchoredPosition(options: AnchoredPositionOptions): AnchoredPositionController {
  let position: AnchoredPosition | null = null
  let observer: ResizeObserver | null = null
  let started = false

  const setPosition = (next: AnchoredPosition | null): void => {
    position = next
    options.onChange(position)
  }

  const place = (): void => {
    /* v8 ignore start -- geometry read from real layout: jsdom reports zero
       offset sizes, so the positive-size clamp arms are exercised by browser
       scenarios rather than unit tests. */
    const rect = options.anchor?.getBoundingClientRect()
    if (rect === undefined) return
    const panel = options.panel
    const width = panel?.offsetWidth ?? 0
    const height = panel?.offsetHeight ?? 0
    let left = rect.left
    let top = rect.bottom + options.gap
    if (width > 0) left = Math.min(Math.max(left, options.margin), window.innerWidth - width - options.margin)
    if (height > 0) top = Math.min(Math.max(top, options.margin), window.innerHeight - height - options.margin)
    /* v8 ignore stop */
    setPosition({ left, top })
  }

  return {
    get value() { return position },
    start(): void {
      if (started) this.stop()
      started = true
      // The first run measures the panel in the same tick that opened it, so
      // the clamp uses real dimensions before anything paints.
      place()
      window.addEventListener('scroll', place, true)
      window.addEventListener('resize', place)
      // The panel's own height changes without either event — a status line
      // appearing inside it, or a `resize: vertical` textarea dragged taller —
      // and a stale clamp would let a panel near the bottom edge cross the
      // margin it is supposed to respect. The guard keeps this usable where
      // `ResizeObserver` is absent, which is how jsdom runs.
      const panel = options.panel
      if (typeof ResizeObserver !== 'undefined' && panel !== null) {
        observer = new ResizeObserver(place)
        observer.observe(panel)
      }
    },
    stop(): void {
      if (!started) return
      started = false
      observer?.disconnect()
      observer = null
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
      setPosition(null)
    },
  }
}
