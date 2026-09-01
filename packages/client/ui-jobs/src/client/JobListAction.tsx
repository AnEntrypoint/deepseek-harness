import { applyDiff } from 'webjsx'
import type { JobView } from '@deepseek-ai/dsh-client-runtime/client'
import { IconChevronDownOutline14, StateDot, createDismissOnOutsidePointer, type StateDotState } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { NS } from './locales.ts'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './JobListAction.css.ts'

/** Full props for the session-header background-job action. */
export type JobListActionProps =
  PropsRuntime<'conversation.session.header.actions'> & PropsLocale<typeof NS>

/** Stable empty list so a session with no jobs keeps one array identity. */
const NO_TASKS: readonly JobView[] = []

/** A job the registry still holds open, and whose duration therefore ticks. */
function isLive(job: JobView): boolean {
  return job.status === 'running' || job.status === 'stopping'
}

/** Closed-union exhaustiveness fence for the wire status set. */
/* v8 ignore next 3 -- closed-union backstop; only reached if a status is forged */
function assertNever(value: never): never {
  throw new Error(`unhandled job status: ${JSON.stringify(value)}`)
}

/**
 * Status marker semantics. `stopping` and `killed` share the attention color:
 * both mean the work ended (or is ending) on request rather than on its own.
 */
function dotState(status: JobView['status']): StateDotState {
  switch (status) {
    case 'running': return 'ongoing'
    case 'stopping': return 'warning'
    case 'completed': return 'done'
    case 'killed': return 'warning'
    case 'failed': return 'error'
    /* v8 ignore next -- closed wire status union */
    default: return assertNever(status)
  }
}

/** Human status word for the row and its accessible name. */
function statusLabel(status: JobView['status'], t: TranslateNS<typeof NS>): string {
  switch (status) {
    case 'running': return t('status.running')
    case 'stopping': return t('status.stopping')
    case 'completed': return t('status.completed')
    case 'killed': return t('status.killed')
    case 'failed': return t('status.failed')
    /* v8 ignore next -- closed wire status union */
    default: return assertNever(status)
  }
}

/**
 * Elapsed time in at most two adjacent units. A background job that outlives
 * an hour is already exceptional, so hours is the widest unit — beyond that the
 * figure stays in hours rather than growing a day/month vocabulary no producer
 * currently reaches.
 */
function formatDuration(elapsedMs: number, t: TranslateNS<typeof NS>): string {
  const total = Math.max(0, Math.floor(elapsedMs / 1_000))
  const seconds = total % 60
  const minutes = Math.floor(total / 60) % 60
  const hours = Math.floor(total / 3_600)
  if (hours > 0) return t('duration.hours', { hours, minutes })
  if (minutes > 0) return t('duration.minutes', { minutes, seconds })
  return t('duration.seconds', { seconds })
}

/**
 * Live rows first in start order, then settled rows newest-first. Two jobs
 * that settled in the same millisecond fall back to start order, so the sort
 * never depends on the host's map iteration.
 */
function ordered(jobs: readonly JobView[]): JobView[] {
  return [...jobs].sort((left, right) => {
    const liveLeft = isLive(left)
    if (liveLeft !== isLive(right)) return liveLeft ? -1 : 1
    if (liveLeft) return left.startedAt - right.startedAt
    const finished = (right.finishedAt ?? right.startedAt) - (left.finishedAt ?? left.startedAt)
    return finished !== 0 ? finished : left.startedAt - right.startedAt
  })
}

/**
 * Session-header entry point for this session's background jobs custom
 * element (see module doc). Renders nothing at all until the session has at
 * least one job, so an ordinary conversation never grows a control for a
 * capability it is not using.
 *
 * Converted from a React hooks component to a webjsx custom element: `open`/
 * `now` become private fields, the dismiss-on-outside-pointer effect and the
 * live-duration ticker become connectedCallback/disconnectedCallback-managed
 * controllers/timers, and re-render is an explicit applyDiff(this, vdom) call
 * (Toast.tsx's pattern) instead of implicit re-render on setState.
 */
export class DshJobListAction extends HTMLElement {
  #props: JobListActionProps | null = null
  #open = false
  #now = Date.now()
  #tickTimer: ReturnType<typeof setInterval> | null = null
  #dismiss = createDismissOnOutsidePointer({ root: this, onDismiss: () => { this.#setOpen(false) } })

  /** Set/replace props and re-render; call after creating or updating the element. */
  setProps(props: JobListActionProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  disconnectedCallback(): void {
    this.#dismiss.stop()
    this.#stopTick()
  }

  #setOpen(open: boolean): void {
    if (this.#open === open) return
    this.#open = open
    if (open) {
      this.#now = Date.now()
      this.#dismiss.start()
    } else {
      this.#dismiss.stop()
    }
    this.#syncTick()
    this.#render()
  }

  #syncTick(): void {
    const props = this.#props
    const jobs = props === null ? NO_TASKS : (props.useSessions(state => state.jobsBySession[props.sessionId]) ?? NO_TASKS)
    const liveCount = jobs.filter(isLive).length
    if (this.#open && liveCount > 0) {
      if (this.#tickTimer === null) {
        this.#tickTimer = setInterval(() => {
          this.#now = Date.now()
          this.#render()
        }, 1_000)
      }
    } else {
      this.#stopTick()
    }
  }

  #stopTick(): void {
    if (this.#tickTimer !== null) { clearInterval(this.#tickTimer); this.#tickTimer = null }
  }

  #render(): void {
    const props = this.#props
    if (props === null) { applyDiff(this, <span style="display:none" />); return }
    const { sessionId, useSessions, t } = props
    const jobs = useSessions(state => state.jobsBySession[sessionId]) ?? NO_TASKS

    // The last job disappearing removes this control; close first so focus
    // does not vanish from an unmounting node.
    if (jobs.length === 0 && this.#open) {
      this.#open = false
      this.#dismiss.stop()
      this.#stopTick()
    }

    if (jobs.length === 0) { applyDiff(this, <span style="display:none" />); return }

    const rows = ordered(jobs)
    const liveCount = jobs.filter(isLive).length
    const countKey = liveCount > 0
      ? (liveCount === 1 ? 'count.live.one' : 'count.live.other')
      : (jobs.length === 1 ? 'count.idle.one' : 'count.idle.other')
    const countLabel = t(countKey, { count: liveCount > 0 ? liveCount : jobs.length })
    const open = this.#open
    const now = this.#now

    const vdom = (
      <div
        class={css.root ?? ''}
        onkeydown={(event: KeyboardEvent) => {
          if (event.key !== 'Escape' || !open) return
          event.preventDefault()
          this.#setOpen(false)
          this.querySelector<HTMLButtonElement>(`.${css.trigger ?? ''}`)?.focus()
        }}
      >
        <button
          type="button"
          class={css.trigger ?? ''}
          aria-expanded={String(open)}
          aria-label={countLabel}
          onclick={() => {
            // Sample the clock in the same commit that opens the list: the
            // mount-time value predates every job, so the first painted frame
            // would otherwise clamp a long-running row to zero until the
            // open effect corrects it a frame later.
            this.#now = Date.now()
            this.#setOpen(!open)
          }}
        >
          {liveCount > 0 ? <StateDot state="ongoing" className={css.triggerDot} /> : null}
          <span class={css.count ?? ''}>{countLabel}</span>
          <IconChevronDownOutline14 className={open ? css.triggerOpen : undefined} />
        </button>
        {open
          ? (
            <ul class={css.menu ?? ''} aria-label={t('list.aria')}>
              {rows.map((job) => {
                const live = isLive(job)
                const elapsed = live ? now - job.startedAt : (job.finishedAt ?? job.startedAt) - job.startedAt
                const duration = formatDuration(elapsed, t)
                const status = statusLabel(job.status, t)
                return (
                  <li class={live ? (css.row ?? '') : `${css.row ?? ''} ${css.rowSettled ?? ''}`}>
                    <StateDot state={dotState(job.status)} className={css.rowDot} />
                    <span class={css.kind ?? ''}>{job.kind}</span>
                    <span class={css.label ?? ''} title={job.label}>{job.label}</span>
                    <span class={css.status ?? ''} title={job.detail ?? status}>{job.detail ?? status}</span>
                    <span
                      class={css.duration ?? ''}
                      title={t(live ? 'duration.title.live' : 'duration.title.done', { duration })}
                    >
                      {duration}
                    </span>
                  </li>
                )
              })}
            </ul>
          )
          : null}
      </div>
    )
    applyDiff(this, vdom)
    this.#syncTick()
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-job-list-action') === undefined) {
  customElements.define('dsh-job-list-action', DshJobListAction)
}
