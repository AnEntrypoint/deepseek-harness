import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import {
  indexSubagentDescendants, type SessionId, type SessionListState, type SessionProjectionMap,
  type SessionSummary, type SubagentAddress, type SubagentCatalogSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconChevronDownOutline14, IconChevronRightOutline14, IconRefreshOutline14, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-subagent/client'
import type {} from '@deepseek-ai/dsh-token-meter/client'
import css from './SubagentHeaderLineage.css.ts'

type CatalogEntry = SubagentCatalogSnapshot['entries'][number]
type Catalogs = SessionListState['subagentsByParent']

/** Business actions supplied by the slot registration. */
export interface SubagentCatalogInjected {
  openChild: (address: SubagentAddress) => void
  refresh: (parentSessionId: SessionId) => void
  setCatalogOpen: (parentSessionId: SessionId, open: boolean) => void
}

/** Full props for the session-header lineage renderer. */
export type SubagentHeaderLineageProps =
  PropsRuntime<'conversation.session.header.lineage'> & SubagentCatalogInjected & PropsLocale<typeof NS>

interface CatalogRowsProps {
  parentSessionId: SessionId
  currentSessionId: SessionId | undefined
  catalog: SubagentCatalogSnapshot
  catalogs: Catalogs
  summaries: Readonly<Record<SessionId, SessionSummary>>
  expanded: ReadonlySet<SessionId>
  level: number
  now: number
  openChild: (address: SubagentAddress) => void
  refresh: (parentSessionId: SessionId) => void
  toggleBranch: (childSessionId: SessionId) => void
  closeCatalog: () => void
}

function diagnosticReason(
  entry: Extract<CatalogEntry, { kind: 'diagnostic' }>,
  t: TranslateNS<typeof NS>,
): string {
  switch (entry.reason) {
    case 'corrupt': return t('diagnostic.corrupt')
    case 'unsupported': return t('diagnostic.unsupported')
    case 'unavailable': return t('diagnostic.unavailable')
  }
}

function treeItems(root: HTMLDivElement | null): HTMLElement[] {
  return root === null
    ? []
    : Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]:not([aria-disabled="true"])'))
}

/** Compact token count shared in shape with the conversation stats strip. */
function formatTokens(value: number): string {
  const scaled = (next: number): string => next >= 100
    ? String(Math.round(next))
    : String(Math.round(next * 10) / 10)
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${scaled(value / 1_000)}K`
  return `${scaled(value / 1_000_000)}M`
}

/** Sum the four disjoint durable provider-usage buckets. */
function tokenTotal(
  usage: SessionProjectionMap['tokenUsage'] | undefined,
): number | undefined {
  return usage === undefined
    ? undefined
    : usage.uncachedInputTokens + usage.outputTokens
      + usage.cacheReadTokens + usage.cacheWriteTokens
}

/** Exact whole-second active-turn duration for one catalog row. */
function activityDuration(
  summary: SessionSummary | undefined,
  activity: 'running' | 'inactive',
  now: number,
): number | undefined {
  if (summary === undefined) return undefined
  const timing: SessionProjectionMap['subagentTiming'] | undefined
    = summary.projectionValues?.subagentTiming
  if (timing === undefined) return undefined
  if (timing.active === undefined) return timing.settledMs
  const end = activity === 'running'
    ? now
    : timing.active.through
  return timing.settledMs + Math.max(0, end - timing.active.since)
}

interface DurationParts {
  seconds: number
  minutes: number
  hours: number
  days: number
  totalMinutes: number
  totalHours: number
}

function splitDuration(ms: number): DurationParts {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1_000)
  const totalMinutes = Math.floor(totalSeconds / 60)
  const totalHours = Math.floor(totalMinutes / 60)
  return {
    seconds: totalSeconds % 60,
    minutes: totalMinutes % 60,
    hours: totalHours % 24,
    days: Math.floor(totalHours / 24),
    totalMinutes,
    totalHours,
  }
}

/** Format a duration with decreasing visual precision at larger scales. */
function formatDuration(ms: number, t: TranslateNS<typeof NS>): string {
  const { seconds, minutes, hours, days, totalMinutes, totalHours } = splitDuration(ms)
  if (days >= 365) {
    const years = Math.floor(days / 365)
    const months = Math.floor((days % 365) / 30)
    return months === 0
      ? t('duration.years', { years })
      : t('duration.yearsMonths', { years, months })
  }
  if (days >= 30) {
    const months = Math.floor(days / 30)
    const remainingDays = days % 30
    return remainingDays === 0
      ? t('duration.months', { months })
      : t('duration.monthsDays', { months, days: remainingDays })
  }
  if (days > 0) {
    return hours === 0
      ? t('duration.days', { days })
      : t('duration.daysHours', { days, hours })
  }
  if (totalHours > 0) {
    return t('duration.hours', {
      hours: totalHours,
      minutes: String(minutes).padStart(2, '0'),
      seconds: String(seconds).padStart(2, '0'),
    })
  }
  if (totalMinutes > 0) {
    return t('duration.minutes', {
      minutes: totalMinutes,
      seconds: String(seconds).padStart(2, '0'),
    })
  }
  return t('duration.seconds', { seconds })
}

/** Preserve exact whole seconds for hover and accessible naming. */
function formatExactDuration(ms: number, t: TranslateNS<typeof NS>): string {
  const { seconds, minutes, hours, days } = splitDuration(ms)
  return days === 0
    ? formatDuration(ms, t)
    : t('duration.exactDays', {
      days,
      hours: String(hours).padStart(2, '0'),
      minutes: String(minutes).padStart(2, '0'),
      seconds: String(seconds).padStart(2, '0'),
    })
}

const NO_DESCENDANTS = { count: 0, runningCount: 0 } as const

function SubagentSwitcherIcon(): VNode {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M5.99951 12.7L8.95546 14.9478C9.40011 15.2859 9.62244 15.455 9.87526 15.488C9.95774 15.4988 10.0413 15.4988 10.1238 15.488C10.3766 15.455 10.5989 15.2859 11.0436 14.9478L13.9995 12.7"
        stroke="currentColor"
        strokeWidth="1.5"
      />
      <path
        d="M13.9995 7.7417L11.0436 5.49387C10.5989 5.15574 10.3766 4.98668 10.1238 4.95362C10.0413 4.94283 9.95775 4.94283 9.87527 4.95362C9.62245 4.98668 9.40012 5.15574 8.95547 5.49387L5.99952 7.7417"
        stroke="currentColor"
        strokeWidth="1.5"
      />
    </svg>
  )
}

/** Render the known direct-child shape while its authoritative catalog hydrates. */
function CatalogLoadingRows({
  parentSessionId,
  summaries,
  level,
  t,
}: {
  parentSessionId: SessionId
  summaries: Readonly<Record<SessionId, SessionSummary>>
  level: number
  t: TranslateNS<typeof NS>
}): VNode | VNode[] {
  const children = Object.values(summaries).filter(summary => (
    summary.origin === 'subagent' && summary.parentId === parentSessionId
  ))
  if (children.length === 0) return <div class={css.notice ?? ''}>{t('loading.label')}</div>
  return children.map(summary => (
    <div key={summary.id} class={css.node ?? ''}>
      <div
        role="treeitem"
        aria-disabled="true"
        aria-level={String(level)}
        aria-label={t('loading.aria')}
        class={`${css.row ?? ''} ${css.disabled ?? ''} ${css.loadingRow ?? ''}`}
      >
        <span class={css.disclosureSpace ?? ''} />
        <StateDot state={summary.running ? 'ongoing' : 'done'} />
        <span class={css.content ?? ''}>
          <span class={css.label ?? ''}>{t('loading.label')}</span>
        </span>
      </div>
    </div>
  ))
}

/** Render one catalog level and recurse only through explicitly expanded rows. */
function CatalogRows({
  parentSessionId, currentSessionId, catalog, catalogs, summaries, expanded, level, now,
  openChild, refresh, toggleBranch, closeCatalog, t,
}: CatalogRowsProps & { t: TranslateNS<typeof NS> }): VNode | VNode[] {
  const emptyLoading = catalog.state === 'loading' && catalog.entries.length === 0
  const reserveDisclosure = catalog.entries.some(
    entry => entry.kind === 'child' && entry.hasChildren,
  )
  const rows: VNode[] = []
  if (emptyLoading) {
    const loadingRows = CatalogLoadingRows({ parentSessionId, summaries, level, t })
    rows.push(...(Array.isArray(loadingRows) ? loadingRows : [loadingRows]))
  }
  if (catalog.state === 'error') {
    rows.push(
      <div class={css.error ?? ''}>
        <span>{catalog.error?.message ?? t('load.error')}</span>
        <button
          type="button"
          class={css.refresh ?? ''}
          onclick={() => { refresh(parentSessionId) }}
        >
          <IconRefreshOutline14 />
          {t('retry')}
        </button>
      </div>,
    )
  }
  for (const entry of catalog.entries) {
    if (entry.kind === 'diagnostic') {
      const reason = diagnosticReason(entry, t)
      rows.push(
        <div key={entry.id} class={css.node ?? ''}>
          <div
            role="treeitem"
            aria-disabled="true"
            aria-level={String(level)}
            aria-label={`${entry.id} ${reason}`}
            class={`${css.row ?? ''} ${css.disabled ?? ''}`}
            title={reason}
          >
            {reserveDisclosure && <span class={css.disclosureSpace ?? ''} />}
            <StateDot state="error" />
            <span class={css.content ?? ''}>
              <span class={css.label ?? ''}>{entry.id}</span>
              <span class={css.summary ?? ''}>{reason}</span>
            </span>
          </div>
        </div>,
      )
      continue
    }

    const childCatalog = catalogs[entry.id]
    const isCurrent = entry.id === currentSessionId
    const isExpanded = expanded.has(entry.id)
    const knownLeaf = !entry.hasChildren
    const childLoading = childCatalog === undefined
      || (childCatalog.state === 'loading' && childCatalog.entries.length === 0)
    const summary = summaries[entry.id]
    const label = entry.label ?? entry.id
    const mode = entry.mode === 'one-shot' ? t('mode.oneShot') : t('mode.continuable')
    const activity = entry.activity === 'running' ? t('activity.running') : t('activity.inactive')
    const secondary = [summary?.title, mode, activity]
      .filter(value => value !== undefined)
      .join(' · ')
    const totalTokens = tokenTotal(summary?.projectionValues?.tokenUsage)
    const durationMs = activityDuration(
      summary,
      entry.activity,
      now,
    )
    const tokenMetric = totalTokens === undefined
      ? undefined
      : `${formatTokens(totalTokens)} tok`
    const durationMetric = durationMs === undefined
      ? undefined
      : {
        compact: formatDuration(durationMs, t),
        exact: formatExactDuration(durationMs, t),
      }
    const metrics = [tokenMetric, durationMetric?.exact]
      .filter(value => value !== undefined)
      .join(' · ')

    const open = (): void => {
      openChild({ parentSessionId, childSessionId: entry.id, mode: entry.mode })
      closeCatalog()
    }
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        event.stopPropagation()
        open()
      } else if (
        (event.key === 'ArrowRight' && !knownLeaf && !isExpanded)
        || (event.key === 'ArrowLeft' && isExpanded)
      ) {
        event.preventDefault()
        event.stopPropagation()
        toggleBranch(entry.id)
      }
    }
    const toggle = (event: MouseEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      toggleBranch(entry.id)
    }

    rows.push(
      <div key={entry.id} class={css.node ?? ''}>
        <div
          role="treeitem"
          tabindex={0}
          aria-level={String(level)}
          aria-current={isCurrent ? 'true' : null}
          aria-label={[label, secondary, metrics].filter(value => value !== '').join(' ')}
          aria-expanded={knownLeaf ? null : isExpanded}
          class={css.row ?? ''}
          onclick={open}
          onkeydown={handleKey}
        >
          {knownLeaf
            ? (reserveDisclosure ? <span class={css.disclosureSpace ?? ''} /> : null)
            : (
              <button
                type="button"
                tabindex={-1}
                class={`${css.disclosure ?? ''} ${isExpanded ? css.disclosureOpen ?? '' : ''}`}
                aria-label={t(isExpanded ? 'branch.collapse' : 'branch.expand', { label })}
                onclick={toggle}
              >
                <IconChevronRightOutline14 />
              </button>
            )}
          <div class={css.clickarea ?? ''}>
            <StateDot state={entry.activity === 'running' ? 'ongoing' : 'done'} />
            <span class={css.content ?? ''}>
              <span class={`${css.label ?? ''} ${isCurrent ? css.currentLabel ?? '' : ''}`}>{label}</span>
              <span class={css.summary ?? ''}>{secondary}</span>
            </span>
            {metrics !== '' && (
              <span class={css.metrics ?? ''}>
                {tokenMetric !== undefined && <span class={css.metricToken ?? ''}>{tokenMetric}</span>}
                {durationMetric !== undefined && (
                  <span
                    class={css.metricDuration ?? ''}
                    title={t('duration.exactTitle', { duration: durationMetric.exact })}
                  >
                    {durationMetric.compact}
                  </span>
                )}
              </span>
            )}
          </div>
        </div>
        {isExpanded && !knownLeaf && (
          <div
            role="group"
            class={css.children ?? ''}
            aria-busy={childLoading ? 'true' : null}
          >
            {childCatalog === undefined
              ? CatalogLoadingRows({
                parentSessionId: entry.id,
                summaries,
                level: level + 1,
                t,
              })
              : CatalogRows({
                parentSessionId: entry.id,
                currentSessionId,
                catalog: childCatalog,
                catalogs,
                summaries,
                expanded,
                level: level + 1,
                now,
                openChild,
                refresh,
                toggleBranch,
                closeCatalog,
                t,
              })}
          </div>
        )}
      </div>,
    )
  }
  return rows
}

interface CatalogDropdownSharedProps extends SubagentCatalogInjected {
  /** Session whose direct catalog roots the tree. */
  rootSessionId: SessionId
  /** Whether an ordinary title needs a breadcrumb separator before its count. */
  separator?: boolean
  useSessions: SubagentHeaderLineageProps['useSessions']
  t: TranslateNS<typeof NS>
}

type CatalogDropdownProps = CatalogDropdownSharedProps & (
  | {
    /** Descendant-count control. */
    variant: 'count'
    currentSessionId?: never
    displayTitle?: never
    openTitle?: never
  }
  | {
    /** Current-title sibling switcher. */
    variant: 'switcher'
    /** Selected descendant highlighted in the catalog. */
    currentSessionId: SessionId
    /** Visible title included in the switcher's hover target. */
    displayTitle: string
    /** Optional ancestor navigation when the combined title is clicked. */
    openTitle?: () => void
  }
)

const MENU_VIEWPORT_MARGIN = 16

/** Place a portaled catalog below its trigger without crossing the viewport edge. */
function catalogMenuPosition(trigger: HTMLButtonElement): { top: number; left: number } {
  const rect = trigger.getBoundingClientRect()
  const width = Math.min(336, window.innerWidth - MENU_VIEWPORT_MARGIN * 2)
  return {
    top: rect.bottom + 5,
    left: Math.min(
      Math.max(MENU_VIEWPORT_MARGIN, rect.left),
      window.innerWidth - width - MENU_VIEWPORT_MARGIN,
    ),
  }
}

/**
 * One trigger-plus-tree dropdown over the catalog rooted at `rootSessionId`,
 * as a webjsx custom element.
 *
 * Converted from a React hooks component to a webjsx custom element: every
 * useState becomes an instance field, effects become connectedCallback/
 * disconnectedCallback plus explicit listener bind/unbind helpers, and
 * `createPortal(..., document.body)` becomes a directly-appended
 * `document.body` child div kept in sync via `applyDiff`, matching Menu.tsx's
 * portal-mode pattern.
 */
export class DshCatalogDropdown extends HTMLElement {
  #props: CatalogDropdownProps | null = null
  #open = false
  #menuPosition: { top: number; left: number } | undefined = undefined
  #now = Date.now()
  #expanded: ReadonlySet<SessionId> = new Set()
  #hoverOpenTimer: ReturnType<typeof setTimeout> | undefined = undefined
  #hoverCloseTimer: ReturnType<typeof setTimeout> | undefined = undefined
  #observedCatalogs = new Set<SessionId>()
  #requestedInitialCatalog: SessionId | undefined = undefined
  #runningTimer: ReturnType<typeof setInterval> | null = null
  #outsideHandler: ((e: PointerEvent) => void) | null = null
  #placeHandler: (() => void) | null = null
  #scrollHandler: (() => void) | null = null
  #portalEl: HTMLDivElement | null = null
  #triggerEl: HTMLButtonElement | null = null
  #menuEl: HTMLDivElement | null = null

  setProps(props: CatalogDropdownProps): void {
    this.#props = props
    if (
      props.variant === 'switcher'
      && props.useSessions(state => state.subagentsByParent)[props.rootSessionId] === undefined
      && this.#requestedInitialCatalog !== props.rootSessionId
    ) {
      this.#requestedInitialCatalog = props.rootSessionId
      props.refresh(props.rootSessionId)
    }
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  disconnectedCallback(): void {
    this.#cancelHoverOpen()
    this.#cancelHoverClose()
    for (const parentSessionId of this.#observedCatalogs) {
      this.#props?.setCatalogOpen(parentSessionId, false)
    }
    this.#observedCatalogs.clear()
    this.#unbindOutsideClose()
    this.#unbindPlacement()
    this.#unbindRunningTimer()
    this.#portalEl?.remove()
    this.#portalEl = null
  }

  #observeCatalog(parentSessionId: SessionId, next: boolean): void {
    if (next) this.#observedCatalogs.add(parentSessionId)
    else this.#observedCatalogs.delete(parentSessionId)
    this.#props?.setCatalogOpen(parentSessionId, next)
  }

  #closeAllCatalogs(): void {
    for (const parentSessionId of this.#observedCatalogs) {
      this.#props?.setCatalogOpen(parentSessionId, false)
    }
    this.#observedCatalogs.clear()
    this.#expanded = new Set()
  }

  #cancelHoverClose(): void {
    if (this.#hoverCloseTimer === undefined) return
    clearTimeout(this.#hoverCloseTimer)
    this.#hoverCloseTimer = undefined
  }

  #cancelHoverOpen(): void {
    if (this.#hoverOpenTimer === undefined) return
    clearTimeout(this.#hoverOpenTimer)
    this.#hoverOpenTimer = undefined
  }

  #changeOpen(next: boolean, restoreFocus = false): void {
    this.#cancelHoverOpen()
    this.#cancelHoverClose()
    const props = this.#props
    if (props === null) return
    if (next) {
      const trigger = this.#triggerEl
      /* v8 ignore next -- a queued callback can outlive the trigger */
      if (trigger === null) return
      this.#open = true
      this.#menuPosition = catalogMenuPosition(trigger)
      this.#now = Date.now()
      this.#observeCatalog(props.rootSessionId, true)
      this.#bindOutsideClose()
    } else {
      this.#open = false
      this.#menuPosition = undefined
      this.#closeAllCatalogs()
      this.#unbindOutsideClose()
      this.#unbindPlacement()
      this.#unbindRunningTimer()
    }
    this.#render()
    if (next) { this.#bindPlacement(); this.#syncRunningTimer() }
    if (restoreFocus) queueMicrotask(() => { this.#triggerEl?.focus() })
  }

  #scheduleHoverOpen(): void {
    this.#cancelHoverOpen()
    this.#cancelHoverClose()
    if (this.#open) return
    this.#hoverOpenTimer = setTimeout(() => {
      this.#hoverOpenTimer = undefined
      this.#changeOpen(true)
    }, 150)
  }

  #scheduleHoverClose(): void {
    this.#cancelHoverOpen()
    this.#cancelHoverClose()
    this.#hoverCloseTimer = setTimeout(() => {
      this.#hoverCloseTimer = undefined
      this.#changeOpen(false)
    }, 120)
  }

  #closeBranch(root: SessionId): void {
    const props = this.#props
    if (props === null) return
    const catalogs = props.useSessions(state => state.subagentsByParent)
    const closing = new Set<SessionId>()
    const visit = (parentSessionId: SessionId): void => {
      if (closing.has(parentSessionId) || !this.#expanded.has(parentSessionId)) return
      closing.add(parentSessionId)
      const branch = catalogs[parentSessionId]
      for (const entry of branch?.entries ?? []) {
        if (entry.kind === 'child') visit(entry.id)
      }
    }
    visit(root)
    for (const parentSessionId of closing) this.#observeCatalog(parentSessionId, false)
    this.#expanded = new Set([...this.#expanded].filter(id => !closing.has(id)))
  }

  #toggleBranch(childSessionId: SessionId): void {
    if (this.#expanded.has(childSessionId)) {
      this.#closeBranch(childSessionId)
    } else {
      this.#expanded = new Set(this.#expanded).add(childSessionId)
      this.#observeCatalog(childSessionId, true)
    }
    this.#render()
  }

  #bindOutsideClose(): void {
    this.#unbindOutsideClose()
    const closeOutside = (event: PointerEvent): void => {
      if (
        event.target instanceof Node
        && !this.contains(event.target)
        && !this.#menuEl?.contains(event.target)
      ) {
        this.#changeOpen(false)
      }
    }
    this.#outsideHandler = closeOutside
    document.addEventListener('pointerdown', closeOutside)
  }

  #unbindOutsideClose(): void {
    if (this.#outsideHandler === null) return
    document.removeEventListener('pointerdown', this.#outsideHandler)
    this.#outsideHandler = null
  }

  #bindPlacement(): void {
    this.#unbindPlacement()
    const placeMenu = (): void => {
      const trigger = this.#triggerEl
      /* v8 ignore next -- native resize or scroll can outlive the trigger */
      if (trigger === null) return
      this.#menuPosition = catalogMenuPosition(trigger)
      this.#render()
    }
    this.#placeHandler = placeMenu
    this.#scrollHandler = placeMenu
    window.addEventListener('resize', placeMenu)
    document.addEventListener('scroll', placeMenu, true)
  }

  #unbindPlacement(): void {
    if (this.#placeHandler !== null) {
      window.removeEventListener('resize', this.#placeHandler)
      this.#placeHandler = null
    }
    if (this.#scrollHandler !== null) {
      document.removeEventListener('scroll', this.#scrollHandler, true)
      this.#scrollHandler = null
    }
  }

  #syncRunningTimer(): void {
    this.#unbindRunningTimer()
    const props = this.#props
    if (props === null || !this.#open) return
    const summaries = props.useSessions(state => state.byId)
    const descendants = indexSubagentDescendants(summaries).get(props.rootSessionId) ?? NO_DESCENDANTS
    if (descendants.runningCount === 0) return
    this.#runningTimer = setInterval(() => { this.#now = Date.now(); this.#render() }, 1_000)
  }

  #unbindRunningTimer(): void {
    if (this.#runningTimer === null) return
    clearInterval(this.#runningTimer)
    this.#runningTimer = null
  }

  #focusAt(index: number): void {
    const items = treeItems(this.#menuEl)
    if (items.length === 0) return
    items[(index + items.length) % items.length]?.focus()
  }

  #navigate(event: KeyboardEvent): void {
    const items = treeItems(this.#menuEl)
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      this.#changeOpen(false, true)
    } else if (event.key === 'Home') {
      event.preventDefault()
      this.#focusAt(0)
    } else if (event.key === 'End') {
      event.preventDefault()
      this.#focusAt(items.length - 1)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      this.#focusAt(index + 1)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      this.#focusAt(index < 0 ? items.length - 1 : index - 1)
    }
  }

  #render(): void {
    const props = this.#props
    if (props === null) { applyDiff(this, []); return }
    const {
      rootSessionId, currentSessionId, displayTitle, openTitle, variant, separator = false,
      useSessions, openChild, refresh, t,
    } = props
    const ancestorSwitcher = variant === 'switcher' && openTitle !== undefined
    const catalogs = useSessions(state => state.subagentsByParent)
    const summaries = useSessions(state => state.byId)
    const catalog = catalogs[rootSessionId]
    const currentEntry = currentSessionId === undefined
      ? undefined
      : catalog?.entries.find(entry => entry.kind === 'child' && entry.id === currentSessionId)
    const switcherDisplayTitle = currentEntry?.kind === 'child'
      ? currentEntry.label ?? currentEntry.id
      : displayTitle
    const healthy = catalog?.entries.filter(entry => entry.kind === 'child') ?? []
    const descendants = indexSubagentDescendants(summaries).get(rootSessionId) ?? NO_DESCENDANTS
    // The catalog can arrive before the session-list baseline; never undercount
    // the already-visible direct rows during that short bootstrap window.
    const descendantCount = Math.max(healthy.length, descendants.count)
    const totalCountKey = descendantCount === 1 ? 'count.total.one' : 'count.total.other'
    const runningCountKey = descendants.runningCount === 1 ? 'count.running.one' : 'count.running.other'
    // Session summaries can announce membership before the descriptor-backed catalog catches up.
    // Keep that entry point visible through disabled loading rows; only catalog rows are navigable.
    const summaryBackedLoading = (descendants.count > 0 || variant === 'switcher')
      && (catalog === undefined || (catalog.state === 'ready' && catalog.entries.length === 0))
    const presentedCatalog: SubagentCatalogSnapshot | undefined = summaryBackedLoading
      ? {
        entries: [],
        parentAvailable: catalog?.parentAvailable ?? false,
        state: 'loading',
        error: null,
      }
      : catalog

    // Visibility needs evidence of children (entries, summary-known descendants,
    // or a failed load worth retrying). A bare loading catalog is not evidence:
    // selecting any session schedules a refresh whose loading snapshot would
    // otherwise flash the action in and out on childless sessions.
    const visible = presentedCatalog !== undefined
      && (variant === 'switcher'
        || presentedCatalog.state === 'error'
        || presentedCatalog.entries.length > 0
        || descendantCount > 0)

    if (!visible) {
      if (this.#open) {
        this.#cancelHoverOpen()
        this.#cancelHoverClose()
        this.#open = false
        this.#closeAllCatalogs()
        this.#unbindOutsideClose()
        this.#unbindPlacement()
        this.#unbindRunningTimer()
      }
      this.#portalEl?.remove()
      this.#portalEl = null
      applyDiff(this, [])
      return
    }

    const menuVNode: VNode | null = this.#open
      ? (
        <div
          ref={(el) => { this.#menuEl = el as HTMLDivElement | null }}
          class={css.menu ?? ''}
          style={this.#menuPosition === undefined
            ? ''
            : `left: ${this.#menuPosition.left}px; top: ${this.#menuPosition.top}px`}
          role="tree"
          aria-label={t('tree.aria')}
          onmouseenter={() => { this.#cancelHoverClose() }}
          onmouseleave={() => { this.#scheduleHoverClose() }}
        >
          {CatalogRows({
            parentSessionId: rootSessionId,
            currentSessionId,
            catalog: presentedCatalog,
            catalogs,
            summaries,
            expanded: this.#expanded,
            level: 1,
            now: this.#now,
            openChild,
            refresh,
            toggleBranch: (id) => { this.#toggleBranch(id) },
            closeCatalog: () => { this.#changeOpen(false) },
            t,
          })}
        </div>
      )
      : null

    if (menuVNode !== null) {
      if (this.#portalEl === null) {
        this.#portalEl = document.createElement('div')
        document.body.appendChild(this.#portalEl)
      }
      applyDiff(this.#portalEl, menuVNode)
    } else {
      this.#portalEl?.remove()
      this.#portalEl = null
    }

    const vdom = (
      <div
        class={`${css.root ?? ''} ${variant === 'switcher' ? css.switcherRoot ?? '' : ''}`}
        onkeydown={(event: KeyboardEvent) => { this.#navigate(event) }}
        onmouseenter={() => { this.#scheduleHoverOpen() }}
        onmouseleave={() => { this.#scheduleHoverClose() }}
      >
        {separator && <span class={css.separator ?? ''}>/</span>}
        <button
          ref={(el) => { this.#triggerEl = el as HTMLButtonElement | null }}
          type="button"
          class={variant === 'switcher'
            ? `${css.switcherTrigger ?? ''} ${ancestorSwitcher ? css.ancestorSwitcherTrigger ?? '' : ''}`
            : css.trigger ?? ''}
          aria-haspopup="tree"
          aria-expanded={this.#open}
          aria-label={variant === 'switcher'
            ? t('switcher.aria', { title: switcherDisplayTitle })
            : t(
              descendants.runningCount > 0 ? runningCountKey : totalCountKey,
              { count: descendants.runningCount > 0 ? descendants.runningCount : descendantCount },
            )}
          onclick={openTitle === undefined
            ? null
            : () => {
              this.#cancelHoverOpen()
              if (this.#open) this.#changeOpen(false)
              openTitle()
            }}
          onkeydown={(event: KeyboardEvent) => {
            if (event.key !== 'ArrowDown') return
            event.preventDefault()
            if (!this.#open) this.#changeOpen(true)
            queueMicrotask(() => { this.#focusAt(0) })
          }}
        >
          {variant === 'switcher'
            ? <span class={css.switcherTitle ?? ''}>{switcherDisplayTitle}</span>
            : (
              <>
                {descendants.runningCount > 0 && (
                  <span class={css.activitySlot ?? ''}>
                    <StateDot state="ongoing" />
                  </span>
                )}
                <span class={css.count ?? ''}>{t(totalCountKey, { count: descendantCount })}</span>
              </>
            )}
          {variant === 'switcher'
            ? <SubagentSwitcherIcon />
            : <IconChevronDownOutline14 className={this.#open ? css.triggerOpen : undefined} />}
        </button>
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-catalog-dropdown') === undefined) {
  customElements.define('dsh-catalog-dropdown', DshCatalogDropdown)
}

/**
 * Create (if needed) or update a CatalogDropdown element in place.
 * @param el - an existing `dsh-catalog-dropdown` element to update, or null to create one.
 * @param props - see {@link CatalogDropdownProps}.
 * @returns the `dsh-catalog-dropdown` element; keep it and pass it back in to update.
 */
function renderCatalogDropdown(el: DshCatalogDropdown | null, props: CatalogDropdownProps): DshCatalogDropdown {
  const target = el ?? document.createElement('dsh-catalog-dropdown') as DshCatalogDropdown
  target.setProps(props)
  return target
}

/**
 * Render one breadcrumb title together with its subagent navigation, as a
 * webjsx custom element hosting one or two `dsh-catalog-dropdown` children.
 *
 * Converted from a React hooks component to a webjsx custom element: the
 * derived `parentId` (a `useSessions` selector, not local state) is read
 * directly in `#render()`, and the two CatalogDropdown-shaped instances are
 * plain child `dsh-catalog-dropdown` elements kept in sync via `setProps`
 * rather than JSX-mounted React children.
 */
export class DshSubagentHeaderLineage extends HTMLElement {
  #props: SubagentHeaderLineageProps | null = null
  // Imperatively managed children: webjsx's JSX.IntrinsicElements only covers
  // built-in HTMLElementTagNameMap/SVGElementTagNameMap tags, so an
  // unregistered custom-element tag like `dsh-catalog-dropdown` cannot be
  // authored as a JSX element (no global TagNameMap augmentation exists for
  // it) — these two slots are created/updated/removed directly instead,
  // mirroring DshGoalDock's host-a-child-custom-element pattern.
  #ancestorOrCount: DshCatalogDropdown | null = null
  #ownCount: DshCatalogDropdown | null = null

  setProps(props: SubagentHeaderLineageProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  disconnectedCallback(): void {
    // Child dsh-catalog-dropdown elements release their own listeners via
    // their own disconnectedCallback when removed from the DOM below.
  }

  #render(): void {
    const props = this.#props
    if (props === null) {
      this.#ancestorOrCount?.remove()
      this.#ancestorOrCount = null
      this.#ownCount?.remove()
      this.#ownCount = null
      return
    }
    const { lineageSessionId, displayTitle, openTitle, useSessions, openChild, refresh, setCatalogOpen, t } = props
    const parentId = useSessions((state) => {
      const summary = state.byId[lineageSessionId]
      return summary?.origin === 'subagent' ? summary.parentId : undefined
    })
    const shared = { useSessions, openChild, refresh, setCatalogOpen, t }

    if (parentId === undefined) {
      this.#ownCount?.remove()
      this.#ownCount = null
      if (this.#ancestorOrCount === null) {
        this.#ancestorOrCount = document.createElement('dsh-catalog-dropdown') as DshCatalogDropdown
        this.appendChild(this.#ancestorOrCount)
      }
      renderCatalogDropdown(this.#ancestorOrCount, {
        rootSessionId: lineageSessionId,
        variant: 'count',
        separator: true,
        ...shared,
      })
      return
    }

    if (this.#ancestorOrCount === null) {
      this.#ancestorOrCount = document.createElement('dsh-catalog-dropdown') as DshCatalogDropdown
      this.appendChild(this.#ancestorOrCount)
    }
    renderCatalogDropdown(this.#ancestorOrCount, {
      rootSessionId: parentId,
      currentSessionId: lineageSessionId,
      variant: 'switcher',
      displayTitle,
      ...openTitle === undefined ? {} : { openTitle },
      ...shared,
    })

    if (openTitle === undefined) {
      if (this.#ownCount === null) {
        this.#ownCount = document.createElement('dsh-catalog-dropdown') as DshCatalogDropdown
        this.appendChild(this.#ownCount)
      }
      renderCatalogDropdown(this.#ownCount, {
        rootSessionId: lineageSessionId,
        variant: 'count',
        ...shared,
      })
    } else {
      this.#ownCount?.remove()
      this.#ownCount = null
    }
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-subagent-header-lineage') === undefined) {
  customElements.define('dsh-subagent-header-lineage', DshSubagentHeaderLineage)
}

/**
 * Create (if needed) or update a SubagentHeaderLineage element in place.
 * @param el - an existing `dsh-subagent-header-lineage` element to update, or null to create one.
 * @param props - see {@link SubagentHeaderLineageProps}.
 * @returns the `dsh-subagent-header-lineage` element; keep it and pass it back in to update.
 */
export function renderSubagentHeaderLineage(
  el: DshSubagentHeaderLineage | null,
  props: SubagentHeaderLineageProps,
): DshSubagentHeaderLineage {
  const target = el ?? document.createElement('dsh-subagent-header-lineage') as DshSubagentHeaderLineage
  target.setProps(props)
  return target
}

/** One-shot creation helper preserving the original function-component call shape. */
export function SubagentHeaderLineage(props: SubagentHeaderLineageProps): DshSubagentHeaderLineage {
  return renderSubagentHeaderLineage(null, props)
}
