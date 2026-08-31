/** Chrome-Network-style overview timeline for focusing the trajectory ledger. */

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TrajectoryTurnModel } from './layout.ts'
import type { AssistantMetricDetail, TrajectoryCellKind, TrajectoryCellProps } from './trajectory-record.ts'
import {
  deriveTrajectoryTimeline,
  formatTimelineOffset,
  type TrajectoryTimelineMode,
  type TrajectoryTimeRange,
} from './timeline.ts'
import css from './TrajectoryTimeline.module.css'

const MINIMUM_DRAG_PX = 3
const MINIMUM_ZOOM_OPERATIONS = 4
const EDGE_PAN_ZONE_FRACTION = 0.08
const EDGE_PAN_STEP_FRACTION = 0.025
const MAXIMUM_EDGE_PAN_PX = 32
const TIMELINE_TOOLTIP_DELAY_MS = 500

interface TimelineRecordDetail {
  decodingMs?: number
  durationMs?: number
  startedAt?: number
  ttftMs?: number
}

interface FractionRange {
  start: number
  end: number
}

interface HoverPoint {
  fraction: number
  recordIndex: number | null
}

interface PanGesture {
  anchorClientX: number
  anchorStart: number
  moved: boolean
  pannable: boolean
  pointerId: number
}

function assistantTimingDetail(
  metrics: AssistantMetricDetail | undefined,
): Pick<TimelineRecordDetail, 'ttftMs' | 'decodingMs'> {
  const start = metrics?.stepStartTime
  const first = metrics?.firstTokenTime
  const completed = metrics?.completedTime
  if (
    metrics?.timingRecorded !== true
    || typeof start !== 'number'
    || typeof first !== 'number'
    || typeof completed !== 'number'
    || !Number.isFinite(start)
    || !Number.isFinite(first)
    || !Number.isFinite(completed)
    || first < start
    || completed < first
  ) return {}
  return { ttftMs: first - start, decodingMs: completed - first }
}

function timelineRecordDetail(cell: TrajectoryCellProps): TimelineRecordDetail {
  const durationMs = cell.timeSeconds === null || !Number.isFinite(cell.timeSeconds)
    ? undefined
    : Math.max(0, cell.timeSeconds * 1_000)
  const startedAt = cell.startedAt === null || !Number.isFinite(cell.startedAt)
    ? undefined
    : cell.startedAt
  return {
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(startedAt === undefined ? {} : { startedAt }),
    ...assistantTimingDetail(cell.assistantMetrics),
  }
}

function timelineKindLabel(kind: TrajectoryCellKind): string {
  switch (kind) {
    case 'system': return 'SYSTEM'
    case 'user': return 'USER'
    case 'context': return 'CONTEXT'
    case 'compacted': return 'COMPACTED'
    case 'message': return 'ASSISTANT'
    case 'tool': return 'TOOL'
    case 'subtool': return 'SUBTOOL'
  }
}

function formatRecordedTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  })
}

function timelineTooltipLabel(
  kind: TrajectoryCellKind,
  detail: TimelineRecordDetail | undefined,
): string {
  const heading = timelineKindLabel(kind)
  if (detail === undefined) return heading
  const duration = detail.durationMs === undefined
    ? null
    : `Total ${formatTimelineOffset(detail.durationMs)}`
  const range = detail.startedAt === undefined
    ? null
    : detail.durationMs === undefined
      ? `Started ${formatRecordedTime(detail.startedAt)}`
      : `${formatRecordedTime(detail.startedAt)} → ${formatRecordedTime(
        detail.startedAt + detail.durationMs,
      )}`
  const segments = detail.ttftMs === undefined || detail.decodingMs === undefined
    ? null
    : `TTFT ${formatTimelineOffset(detail.ttftMs)} · Decoding ${formatTimelineOffset(
      detail.decodingMs,
    )}`
  const timing = [duration, segments].filter(value => value !== null).join(' · ')
  return [heading, range, timing].filter(value => value !== null && value !== '').join('\n')
}

/** Props for the fixed full-domain overview above the trajectory ledger. */
export interface TrajectoryTimelineProps {
  turns: readonly TrajectoryTurnModel[]
  mode: TrajectoryTimelineMode
  range: TrajectoryTimeRange | null
  /** Whether the loaded timeline omits an earlier history prefix. */
  hasEarlierRecords?: boolean
  /** Load one earlier history page from the truncation control. */
  onLoadEarlier?: () => Promise<boolean>
  selectedIndex?: number | null
  /** Record indexes matching the active ledger search, or null without a query. */
  searchMatchIndexes?: ReadonlySet<number> | null
  onRangeChange: (range: TrajectoryTimeRange | null) => void
  /** Select a directly clicked timeline block. */
  onRecordSelect?: (index: number) => void
  /** Bring the nearest record into view after clicking timeline whitespace. */
  onRecordFocus?: (index: number) => void
}

function orderedRange(left: number, right: number): FractionRange {
  return left <= right ? { start: left, end: right } : { start: right, end: left }
}

function clampFraction(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function centeredRange(
  center: number,
  width: number,
  minimum: number,
  maximum: number,
): FractionRange {
  const clampedWidth = Math.min(maximum - minimum, Math.max(0, width))
  const start = Math.min(
    Math.max(center - clampedWidth / 2, minimum),
    maximum - clampedWidth,
  )
  return { start, end: start + clampedWidth }
}

function rangeFraction(
  range: TrajectoryTimeRange,
  start: number,
  duration: number,
  minimum: number,
  maximum: number,
): FractionRange {
  const bounded = orderedRange(
    Math.min(maximum, Math.max(minimum, range.start)),
    Math.min(maximum, Math.max(minimum, range.end)),
  )
  return {
    start: (bounded.start - start) / duration,
    end: (bounded.end - start) / duration,
  }
}

function LaneLabels(): JSX.Element {
  return (
    <div class={css.labels ?? ''} aria-hidden="true">
      <span>Input</span>
      <span>Model</span>
      <span>Tools</span>
    </div>
  )
}

function EarlierHistoryBoundary({
  loading,
  onHover,
  onLoad,
}: {
  loading: boolean
  onHover: () => void
  onLoad: (() => void) | undefined
}): JSX.Element {
  return (
    <Tooltip
      label={loading ? 'Loading earlier history…' : 'Click to load earlier history'}
      side="right"
      delayMs={TIMELINE_TOOLTIP_DELAY_MS}
    >
      <button
        type="button"
        class={css.earlierHistory ?? ''}
        data-earlier-history
        data-loading={loading || undefined}
        aria-label={loading ? 'Loading earlier history' : 'Load earlier history'}
        aria-disabled={loading || onLoad === undefined}
        onclick={onLoad ?? null}
        onpointerenter={(event: PointerEvent) => {
          event.stopPropagation()
          onHover()
        }}
        onpointermove={(event: PointerEvent) => { event.stopPropagation() }}
        onpointerdown={(event: PointerEvent) => { event.stopPropagation() }}
      >
        …
      </button>
    </Tooltip> as unknown as JSX.Element
  )
}

interface DragState {
  pointerId: number
  anchorTime: number
  anchorClientX: number
  recordIndex: number | null
}

function cssVarStyle(vars: Record<string, string | number | undefined>): string {
  return Object.entries(vars)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${String(value)}`)
    .join('; ')
}

/** Overview renderer with drag ranges, click-sized focus, and Escape reset — a custom element. */
export class DshTrajectoryTimeline extends HTMLElement {
  #props: TrajectoryTimelineProps = {
    turns: [], mode: 'sequence', range: null, onRangeChange: () => {},
  }

  #drag: DragState | null = null
  #pan: PanGesture | null = null
  #trackEl: HTMLDivElement | null = null
  #wheelHandler: ((event: globalThis.WheelEvent) => void) | null = null

  #draft: TrajectoryTimeRange | null = null
  #hover: HoverPoint | null = null
  #loadingEarlier = false
  #panning = false
  #viewport: TrajectoryTimeRange | null = null
  #animateViewport = false

  setProps(props: TrajectoryTimelineProps): void {
    this.#props = props
    this.#syncEffects()
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  disconnectedCallback(): void {
    this.#unbindWheel()
  }

  #syncEffects(): void {
    const { turns, mode, range, onRangeChange, selectedIndex = null } = this.#props
    const model = deriveTrajectoryTimeline(turns, mode)
    if (
      model !== null
      && range !== null
      && (range.end < model.start || range.start > model.end)
    ) {
      onRangeChange(null)
      return
    }
    if (model === null) {
      this.#animateViewport = false
      if (
        this.#viewport !== null
        && (this.#viewport.end < 0 || this.#viewport.start > 0)
      ) this.#viewport = null
      return
    }
    if (
      this.#viewport !== null
      && (this.#viewport.end < model.start || this.#viewport.start > model.end)
    ) this.#viewport = null
    if (selectedIndex !== null) {
      const selectedSpan = model.spans.find(span => span.index === selectedIndex)
      if (selectedSpan !== undefined) {
        this.#animateViewport = true
        const current = this.#viewport
        if (current !== null) {
          const overlaps = selectedSpan.end > current.start && selectedSpan.start < current.end
          if (!overlaps) {
            const duration = Math.max(1, current.end - current.start)
            const desiredStart = selectedSpan.end <= current.start
              ? selectedSpan.start
              : selectedSpan.end - duration
            const nextStart = Math.min(
              Math.max(desiredStart, model.start),
              Math.max(model.start, model.end - duration),
            )
            if (nextStart !== current.start) {
              this.#viewport = { start: nextStart, end: nextStart + duration }
            }
          }
        }
      }
    }
  }

  #bindWheel(): void {
    this.#unbindWheel()
    const onWheel = (event: globalThis.WheelEvent): void => {
      event.preventDefault()
      const { turns, mode } = this.#props
      const model = deriveTrajectoryTimeline(turns, mode)
      const track = this.#trackEl
      if (track === null || model === null) return
      const fullDuration = Math.max(1, model.end - model.start)
      const domainDuration = this.#viewport === null
        ? fullDuration
        : Math.min(fullDuration, Math.max(1, this.#viewport.end - this.#viewport.start))
      const domainStart = this.#viewport === null
        ? model.start
        : Math.min(Math.max(this.#viewport.start, model.start), model.end - domainDuration)
      this.#animateViewport = false
      const rect = track.getBoundingClientRect()
      const anchorFraction = clampFraction((event.clientX - rect.left) / Math.max(1, rect.width))
      const nextDuration = Math.min(
        fullDuration,
        Math.max(
          Math.min(mode === 'sequence' ? MINIMUM_ZOOM_OPERATIONS : 20, fullDuration),
          domainDuration * Math.exp(event.deltaY * 0.0015),
        ),
      )
      if (nextDuration >= fullDuration * 0.999) {
        this.#viewport = null
        this.#render()
        return
      }
      const anchorTime = domainStart + anchorFraction * domainDuration
      const nextStart = Math.min(
        Math.max(anchorTime - anchorFraction * nextDuration, model.start),
        model.end - nextDuration,
      )
      this.#viewport = { start: nextStart, end: nextStart + nextDuration }
      this.#render()
    }
    this.#wheelHandler = onWheel
    this.addEventListener('wheel', onWheel, { passive: false })
  }

  #unbindWheel(): void {
    if (this.#wheelHandler === null) return
    this.removeEventListener('wheel', this.#wheelHandler)
    this.#wheelHandler = null
  }

  #fractionAt(event: PointerEvent): number {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
    return clampFraction((event.clientX - rect.left) / Math.max(1, rect.width))
  }

  #recordIndexAt(event: PointerEvent): number | null {
    const target = event.target instanceof HTMLElement ? event.target : null
    const value = target?.closest<HTMLElement>('[data-timeline-record-index]')
      ?.dataset.timelineRecordIndex
    if (value === undefined) return null
    const index = Number(value)
    return Number.isFinite(index) ? index : null
  }

  #render(): void {
    const {
      turns, mode, range, hasEarlierRecords = false, onLoadEarlier,
      selectedIndex = null, searchMatchIndexes = null, onRangeChange,
      onRecordSelect, onRecordFocus,
    } = this.#props
    const model = deriveTrajectoryTimeline(turns, mode)
    const detailByIndex = new Map(turns.flatMap(turn =>
      turn.groups.flatMap(group =>
        group.cells.map(cell => [cell.index, timelineRecordDetail(cell)] as const),
      ),
    ))

    if (model === null) {
      const loadEarlier = onLoadEarlier === undefined || this.#loadingEarlier
        ? undefined
        : () => {
          this.#loadingEarlier = true
          this.#render()
          void onLoadEarlier().finally(() => { this.#loadingEarlier = false; this.#render() })
        }
      const vdom = (
        <section class={css.root ?? ''} aria-label="Trajectory timeline">
          <div class={css.plot ?? ''}>
            <LaneLabels />
            <div class={css.track ?? ''}>
              <span class={css.empty ?? ''}>No timing data</span>
              {hasEarlierRecords
                ? <EarlierHistoryBoundary
                  loading={this.#loadingEarlier}
                  onHover={() => { this.#hover = null; this.#render() }}
                  onLoad={loadEarlier}
                />
                : null}
            </div>
          </div>
        </section>
      )
      applyDiff(this, vdom)
      this.#trackEl = null
      this.#unbindWheel()
      return
    }

    const fullDuration = Math.max(1, model.end - model.start)
    const viewportDuration = Math.min(
      fullDuration,
      Math.max(1, (this.#viewport?.end ?? 0) - (this.#viewport?.start ?? 0)),
    )
    const viewportStart = this.#viewport === null
      ? model.start
      : Math.min(
        Math.max(this.#viewport.start, model.start),
        model.end - viewportDuration,
      )
    const domainDuration = this.#viewport === null ? fullDuration : viewportDuration
    const domainStart = this.#viewport === null ? model.start : viewportStart
    const showsEarlierBoundary = hasEarlierRecords && domainStart === model.start
    const loadEarlier = onLoadEarlier === undefined || this.#loadingEarlier
      ? undefined
      : () => {
        this.#loadingEarlier = true
        this.#render()
        void onLoadEarlier().finally(() => { this.#loadingEarlier = false; this.#render() })
      }
    const projectedDomainStyle = cssVarStyle({
      '--trajectory-domain-left': `${-(domainStart - model.start) / domainDuration * 100}%`,
      '--trajectory-domain-width': `${fullDuration / domainDuration * 100}%`,
    })
    const committed = range === null
      ? null
      : rangeFraction(range, domainStart, domainDuration, model.start, model.end)
    const draftFraction = this.#draft === null
      ? null
      : rangeFraction(this.#draft, domainStart, domainDuration, model.start, model.end)
    const visibleRange = draftFraction ?? committed
    const activeRange = this.#draft ?? range
    const draft = this.#draft
    const hover = this.#hover
    const panning = this.#panning
    const animateViewport = this.#animateViewport

    const minimumSelectionDuration = Math.min(
      domainDuration,
      fullDuration / model.spans.length,
    )

    const commit = (nextRange: TrajectoryTimeRange): void => {
      onRangeChange(nextRange)
    }

    const onPointerDown = (event: PointerEvent): void => {
      if (event.button === 2) {
        this.#pan = {
          anchorClientX: event.clientX,
          anchorStart: domainStart,
          moved: false,
          pannable: this.#viewport !== null,
          pointerId: event.pointerId,
        }
        if (this.#viewport !== null) this.#animateViewport = false
        this.#panning = true
        const target = event.currentTarget as HTMLElement
        if (typeof target.setPointerCapture === 'function') {
          target.setPointerCapture(event.pointerId)
        }
        this.#render()
        return
      }
      if (event.button !== 0) return
      const anchor = this.#fractionAt(event)
      const anchorTime = domainStart + anchor * domainDuration
      const recordIndex = this.#recordIndexAt(event)
      this.#hover = { fraction: anchor, recordIndex }
      this.#drag = {
        pointerId: event.pointerId,
        anchorTime,
        anchorClientX: event.clientX,
        recordIndex,
      }
      const target = event.currentTarget as HTMLElement
      if (typeof target.setPointerCapture === 'function') {
        target.setPointerCapture(event.pointerId)
      }
      this.#draft = { start: anchorTime, end: anchorTime }
      this.#render()
    }

    const onPointerMove = (event: PointerEvent): void => {
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
      const fraction = this.#fractionAt(event)
      this.#hover = { fraction, recordIndex: this.#recordIndexAt(event) }
      const pan = this.#pan
      if (pan !== null && pan.pointerId === event.pointerId) {
        if (Math.abs(event.clientX - pan.anchorClientX) >= MINIMUM_DRAG_PX) {
          pan.moved = true
        }
        if (!pan.pannable) { this.#render(); return }
        const delta = (event.clientX - pan.anchorClientX) / Math.max(1, rect.width)
        const nextStart = Math.min(
          Math.max(pan.anchorStart - delta * domainDuration, model.start),
          model.end - domainDuration,
        )
        this.#viewport = { start: nextStart, end: nextStart + domainDuration }
        this.#render()
        return
      }
      const drag = this.#drag
      if (drag === null || drag.pointerId !== event.pointerId) { this.#render(); return }
      let nextDomainStart = domainStart
      if (this.#viewport !== null) {
        const localX = event.clientX - rect.left
        const edgeWidth = Math.min(
          MAXIMUM_EDGE_PAN_PX,
          Math.max(1, rect.width * EDGE_PAN_ZONE_FRACTION),
        )
        const direction = localX < edgeWidth
          ? -1
          : localX > rect.width - edgeWidth ? 1 : 0
        if (direction !== 0) {
          const edgeDistance = direction < 0
            ? edgeWidth - localX
            : localX - (rect.width - edgeWidth)
          const strength = clampFraction(edgeDistance / edgeWidth)
          const desiredStart = domainStart
            + direction * domainDuration * EDGE_PAN_STEP_FRACTION
            * Math.max(0.2, strength)
          nextDomainStart = Math.min(
            Math.max(desiredStart, model.start),
            model.end - domainDuration,
          )
          if (nextDomainStart !== domainStart) {
            this.#animateViewport = false
            this.#viewport = {
              start: nextDomainStart,
              end: nextDomainStart + domainDuration,
            }
          }
        }
      }
      const pointTime = nextDomainStart + fraction * domainDuration
      this.#draft = orderedRange(drag.anchorTime, pointTime)
      this.#render()
    }

    const onPointerEnd = (event: PointerEvent): void => {
      const pan = this.#pan
      if (pan !== null && pan.pointerId === event.pointerId) {
        const moved = pan.moved
          || Math.abs(event.clientX - pan.anchorClientX) >= MINIMUM_DRAG_PX
        this.#pan = null
        this.#panning = false
        if (!moved) { onRangeChange(null); return }
        this.#render()
        return
      }
      const drag = this.#drag
      if (drag === null || drag.pointerId !== event.pointerId) return
      const pointFraction = this.#fractionAt(event)
      const pointTime = domainStart + pointFraction * domainDuration
      const selected = orderedRange(drag.anchorTime, pointTime)
      this.#hover = { fraction: pointFraction, recordIndex: this.#recordIndexAt(event) }
      this.#drag = null
      this.#draft = null
      const click = Math.abs(event.clientX - drag.anchorClientX) < MINIMUM_DRAG_PX
      const clickedSpan = click && drag.recordIndex !== null
        ? model.spans.find(span => span.index === drag.recordIndex)
        : undefined
      if (clickedSpan !== undefined) {
        onRangeChange(null)
        onRecordSelect?.(clickedSpan.index)
        this.#render()
        return
      }
      const committedRange = selected.end - selected.start < minimumSelectionDuration
        ? centeredRange(
          click ? selected.start : (selected.start + selected.end) / 2,
          minimumSelectionDuration,
          model.start,
          model.end,
        )
        : selected
      commit(committedRange)
      if (click) {
        const timelinePoint = selected.start
        const nearest = model.spans.reduce((candidate, span) => {
          const candidateDistance = timelinePoint < candidate.start
            ? candidate.start - timelinePoint
            : timelinePoint > candidate.end ? timelinePoint - candidate.end : 0
          const spanDistance = timelinePoint < span.start
            ? span.start - timelinePoint
            : timelinePoint > span.end ? timelinePoint - span.end : 0
          return spanDistance < candidateDistance ? span : candidate
        })
        onRecordFocus?.(nearest.index)
      }
      this.#render()
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || range === null) return
      event.preventDefault()
      onRangeChange(null)
    }

    const onPointerCancel = (): void => {
      this.#drag = null
      this.#pan = null
      this.#draft = null
      this.#hover = null
      this.#panning = false
      this.#render()
    }

    const vdom: VNode = (
      <section class={css.root ?? ''} aria-label="Trajectory timeline">
        <div class={css.plot ?? ''}>
          <LaneLabels />
          <div
            class={css.track ?? ''}
            data-panning={panning || undefined}
            aria-label="Timeline overview; drag horizontally to focus events"
            tabIndex={0}
            onkeydown={onKeyDown}
            onpointerdown={onPointerDown}
            onpointermove={onPointerMove}
            onpointerup={onPointerEnd}
            onpointercancel={onPointerCancel}
            onpointerleave={() => {
              if (this.#drag === null && this.#pan === null) { this.#hover = null; this.#render() }
            }}
            ondblclick={(event: MouseEvent) => {
              event.preventDefault()
              onRangeChange(null)
            }}
            oncontextmenu={(event: MouseEvent) => {
              event.preventDefault()
            }}
          >
            {showsEarlierBoundary
              ? <EarlierHistoryBoundary
                loading={this.#loadingEarlier}
                onHover={() => { this.#hover = null; this.#render() }}
                onLoad={loadEarlier}
              />
              : null}
            {hover !== null && hover.recordIndex === null && draft === null
              ? <div
                class={css.hoverLine ?? ''}
                data-timeline-hover-line
                aria-hidden="true"
                style={cssVarStyle({ '--trajectory-hover-left': `${hover.fraction * 100}%` })}
              />
              : null}
            {visibleRange !== null
              ? [
                <div
                  class={css.selection ?? ''}
                  data-dragging={draft === null ? undefined : 'true'}
                  aria-hidden="true"
                  style={cssVarStyle({
                    '--trajectory-selection-left': `${visibleRange.start * 100}%`,
                    '--trajectory-selection-width': `${(visibleRange.end - visibleRange.start) * 100}%`,
                  })}
                />,
                <div
                  class={css.selectionEdges ?? ''}
                  data-dragging={draft === null ? undefined : 'true'}
                  aria-hidden="true"
                  style={cssVarStyle({
                    '--trajectory-selection-left': `${visibleRange.start * 100}%`,
                    '--trajectory-selection-width': `${(visibleRange.end - visibleRange.start) * 100}%`,
                  })}
                />,
              ]
              : null}
            <div
              class={css.turnBoundaries ?? ''}
              data-animate-viewport={animateViewport || undefined}
              aria-hidden="true"
              style={projectedDomainStyle}
            >
              {model.turnBoundaries
                .filter(boundary =>
                  boundary.time > model.start
                  && boundary.time >= domainStart
                  && boundary.time <= domainStart + domainDuration)
                .map(boundary => (
                  <span
                    class={css.turnBoundary ?? ''}
                    data-turn={boundary.turn}
                    key={boundary.turn}
                    style={cssVarStyle({
                      '--trajectory-turn-left': `${(boundary.time - model.start) / fullDuration * 100}%`,
                    })}
                  />
                ))}
            </div>
            <div
              class={css.lanes ?? ''}
              data-animate-viewport={animateViewport || undefined}
              data-timeline-domain
              style={projectedDomainStyle}
            >
              {model.spans
                .filter(span =>
                  span.index === selectedIndex
                  || (span.end >= domainStart && span.start <= domainStart + domainDuration))
                .map((span) => {
                  const left = (span.start - model.start) / fullDuration
                  const width = (span.end - span.start) / fullDuration
                  const widthPercent = width * 100
                  const detail = detailByIndex.get(span.index)
                  const ttftMs = detail?.ttftMs
                  const decodingMs = detail?.decodingMs
                  const ttftFraction = ttftMs === undefined
                    || decodingMs === undefined
                    || ttftMs + decodingMs <= 0
                    ? null
                    : ttftMs / (ttftMs + decodingMs)
                  return (
                    <Tooltip
                      key={span.index}
                      label={() => timelineTooltipLabel(span.kind, detail)}
                      side="bottom"
                      delayMs={TIMELINE_TOOLTIP_DELAY_MS}
                    >
                      <span
                        aria-hidden="true"
                        class={css.span ?? ''}
                        data-timeline-span={span.kind}
                        data-timeline-record-index={span.index}
                        data-assistant-timing={ttftFraction === null ? undefined : 'true'}
                        data-error={span.isError || undefined}
                        data-equal-duration={mode === 'time' || undefined}
                        data-current={span.index === selectedIndex || undefined}
                        data-hovered={hover?.recordIndex === span.index || undefined}
                        data-search-match={searchMatchIndexes === null
                          ? undefined
                          : searchMatchIndexes.has(span.index) ? 'true' : 'false'}
                        data-selected={activeRange === null
                          ? undefined
                          : span.start <= activeRange.end && span.end >= activeRange.start
                            ? 'true'
                            : 'false'}
                        style={cssVarStyle({
                          '--trajectory-span-left': `${left * 100}%`,
                          '--trajectory-span-width': `${widthPercent}%`,
                          '--trajectory-span-gap': `min(${widthPercent * 0.08}%, 1px)`,
                          '--trajectory-span-lane': span.lane,
                          ...(ttftFraction === null
                            ? {}
                            : { '--trajectory-assistant-ttft': `${ttftFraction * 100}%` }),
                        })}
                      />
                    </Tooltip> as unknown as VNode
                  )
                })}
            </div>
          </div>
        </div>
      </section>
    )
    applyDiff(this, vdom)
    this.#trackEl = this.querySelector<HTMLDivElement>(`.${css.track}`)
    this.#bindWheel()
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-trajectory-timeline') === undefined) {
  customElements.define('dsh-trajectory-timeline', DshTrajectoryTimeline)
}

/** Create and mount a TrajectoryTimeline element in place of the old function-component call. */
export function TrajectoryTimeline(props: TrajectoryTimelineProps): JSX.Element {
  const el = document.createElement('dsh-trajectory-timeline') as DshTrajectoryTimeline
  el.setProps(props)
  return el as unknown as JSX.Element
}
