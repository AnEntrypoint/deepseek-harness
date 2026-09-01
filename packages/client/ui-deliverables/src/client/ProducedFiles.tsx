// ProducedFiles: the produced-file row a finished turn ends with. The paths
// come pre-matched by the turn-tail chain from the mutation tools'
// follow-along locations, never from the closing prose. Clicking one goes
// through the same openFile the tool rows use — the Host's own opener, on the
// Host machine.
//
// Converted from a React hooks component (useState/useRef/useLayoutEffect) to
// a webjsx custom element: state becomes private fields, the layout
// measurement effect becomes connectedCallback + a ResizeObserver kept as an
// instance field, and re-render is an explicit #render() -> applyDiff call.

import { applyDiff } from 'webjsx'
import type { HostDescriptionSource } from '@deepseek-ai/dsh-client-connection/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { basename } from './turn-deliverables.ts'
import type { NS } from './locales.ts'
import css from './ProducedFiles.css.ts'

/** At most six chips compete for the one-line summary; every other path stays counted. */
const SHOWN_LIMIT = 6

/**
 * Select the largest prefix whose measured chips and exact remainder fit.
 * @param available - usable width of the one-line file lane.
 * @param gap - computed flex gap between adjacent visible items.
 * @param chipWidths - measured widths for the candidate file chips.
 * @param moreWidthsByShown - exact localized remainder width for each shown count.
 * @returns Number of leading chips to render.
 */
export function fitProducedFiles(
  available: number,
  gap: number,
  chipWidths: readonly number[],
  moreWidthsByShown: readonly (number | undefined)[],
): number {
  if (available <= 0) return chipWidths.length
  const prefix = [0]
  let prefixWidth = 0
  for (const width of chipWidths) {
    prefixWidth += width
    prefix.push(prefixWidth)
  }
  let largestFit = 0
  for (const [shown, width] of prefix.entries()) {
    const more = moreWidthsByShown[shown]
    const items = shown + (more === undefined ? 0 : 1)
    const needed = width + (more ?? 0) + Math.max(0, items - 1) * gap
    if (needed <= available) largestFit = shown
  }
  return largestFit
}

/** Registration-side Host capability facts. */
export interface ProducedFilesInjected {
  /** Whether the browser itself is connected over loopback. */
  isLoopback: boolean
  hooks: {
    /** Current generation's Host description, bound by the slot renderer. */
    hostDescription: HostDescriptionSource
  }
}

/** Matched paths plus the opener, locale, and injected Host capability. */
export type ProducedFilesProps = Pick<TurnTailOwnerProps, 'openFile'> & {
  matched: readonly string[]
} & PropsLocale<typeof NS> & InjectFace<ProducedFilesInjected>

function moreLabel(t: ProducedFilesProps['t'], count: number): string {
  return count === 1 ? t('produced.moreOne') : t('produced.more', { count: String(count) })
}

/**
 * Produced-files turn-tail row custom element: renders openable chips for a
 * turn's produced paths, measuring how many fit one line via a ResizeObserver
 * bound to hidden probe chips.
 */
export class DshProducedFiles extends HTMLElement {
  #props: ProducedFilesProps | null = null
  #shownCount = SHOWN_LIMIT
  #observer: ResizeObserver | null = null
  #rowEl: HTMLDivElement | null = null
  #moreProbeEl: HTMLSpanElement | null = null
  #chipProbeEls: Array<HTMLButtonElement | null> = []

  /** Set/replace props and re-render; call after creating or updating the element. */
  setProps(props: ProducedFilesProps): void {
    this.#props = props
    this.#shownCount = Math.min(props.matched.length, SHOWN_LIMIT)
    this.#render()
    this.#remeasure()
  }

  connectedCallback(): void {
    this.#render()
    this.#remeasure()
  }

  disconnectedCallback(): void {
    this.#observer?.disconnect()
    this.#observer = null
  }

  #measure(): void {
    const props = this.#props
    const row = this.#rowEl
    const remainderProbe = this.#moreProbeEl
    if (props === null || row === null || remainderProbe === null) return
    const { matched: paths, t } = props
    const limit = Math.min(paths.length, SHOWN_LIMIT)
    const styles = getComputedStyle(row)
    const gap = Number.parseFloat(styles.columnGap || styles.gap) || 0
    const activeChipProbes = this.#chipProbeEls.slice(0, limit) as HTMLButtonElement[]
    const chips = activeChipProbes.map(probe => probe.getBoundingClientRect().width)
    const more = Array.from({ length: limit + 1 }, (_, candidate) => {
      if (paths.length === candidate) return undefined
      remainderProbe.textContent = moreLabel(t, paths.length - candidate)
      return remainderProbe.getBoundingClientRect().width
    })
    const next = fitProducedFiles(row.clientWidth, gap, chips, more)
    if (next !== this.#shownCount) {
      this.#shownCount = next
      this.#render()
    }
  }

  #remeasure(): void {
    this.#observer?.disconnect()
    this.#observer = null
    // Probe elements exist only after #render() has mounted the DOM.
    queueMicrotask(() => {
      const row = this.#rowEl
      if (row === null) return
      this.#measure()
      if (typeof ResizeObserver === 'undefined') return
      const observer = new ResizeObserver(() => { this.#measure() })
      observer.observe(row)
      for (const probe of [...this.#chipProbeEls, this.#moreProbeEl]) {
        if (probe !== null) observer.observe(probe)
      }
      this.#observer = observer
    })
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const { matched: paths, openFile, isLoopback, useHostDescription, t } = props
    const hostCanOpenPath = useHostDescription(description => description?.canOpenPath === true)
    const canOpenPath = isLoopback && hostCanOpenPath
    const limit = Math.min(paths.length, SHOWN_LIMIT)
    const visibleCount = Math.min(this.#shownCount, limit)
    const shown = paths.slice(0, visibleCount)
    const hidden = paths.length - shown.length

    this.#chipProbeEls = []
    const vdom = (
      <div class={css.root ?? ''}>
        <span class={css.label ?? ''}>{t('produced.label')}</span>
        <div
          ref={(node) => { this.#rowEl = node as HTMLDivElement | null }}
          class={css.row ?? ''}
          data-produced-files-row
        >
          {shown.map(path => (
            <button
              key={path}
              type="button"
              class={css.file ?? ''}
              // The full path is the disambiguator when two turns produce files
              // that share a basename; the chip itself stays short.
              title={path}
              aria-label={t('produced.open', { name: path })}
              onclick={() => { openFile(path) }}
            >
              {basename(path)}
            </button>
          ))}
          {hidden > 0 && <span class={css.more ?? ''}>{moreLabel(t, hidden)}</span>}
        </div>
        {hidden > 0 && canOpenPath && (
          <button type="button" class={css.showFolder ?? ''} onclick={() => { openFile('.') }}>
            {t('produced.showInFolder')}
          </button>
        )}
        <div class={css.measure ?? ''} aria-hidden="true">
          {paths.slice(0, limit).map((path, index) => (
            <button
              key={path}
              ref={(node) => { this.#chipProbeEls[index] = node as HTMLButtonElement | null }}
              type="button"
              tabIndex={-1}
              class={`${css.file ?? ''} ${css.probe ?? ''}`}
            >
              {basename(path)}
            </button>
          ))}
          <span
            ref={(node) => { this.#moreProbeEl = node as HTMLSpanElement | null }}
            class={`${css.more ?? ''} ${css.probe ?? ''}`}
          />
        </div>
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-produced-files') === undefined) {
  customElements.define('dsh-produced-files', DshProducedFiles)
}
