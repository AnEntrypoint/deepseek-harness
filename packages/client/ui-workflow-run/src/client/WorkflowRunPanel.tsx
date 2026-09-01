import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import {
  DisclosureRow, IconChevronRightOutline14, StateDot,
  type DisclosureRowProps, type StateDotState,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { shallowEqual, type SessionId, type SessionListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkflowRunKey } from './locales.ts'
import type {
  WorkflowRunMemberData, WorkflowRunPhaseData, WorkflowRunStatus,
} from './workflow-definition.ts'
import css from './WorkflowRunPanel.css.ts'

/** Navigation action injected from the plugin's own SessionRuntime access. */
export interface WorkflowRunInjected {
  readonly openSession: (id: SessionId) => void
}

/** Complete keyed Chat renderer props. */
export type WorkflowRunPanelProps =
  PropsRuntime<'conversation.chat.node', 'workflow-run'>
  & PropsLocale<'workflowRun'>
  & WorkflowRunInjected

type Translate = WorkflowRunPanelProps['t']

const STATUS_KEYS = {
  running: 'status.running',
  completed: 'status.completed',
  failed: 'status.failed',
  cancelled: 'status.cancelled',
  interrupted: 'status.interrupted',
} as const satisfies Record<WorkflowRunStatus, WorkflowRunKey>

function dotState(status: WorkflowRunStatus): StateDotState {
  switch (status) {
    case 'running': return 'ongoing'
    case 'completed': return 'done'
    case 'failed': return 'error'
    case 'cancelled':
    case 'interrupted': return 'warning'
    /* v8 ignore next -- WorkflowRunStatus is closed and every variant is handled above. */
    default: return status satisfies never
  }
}

function readablePhase(phase: string | null, t: Translate): string {
  if (phase === null) return t('phase.unassigned')
  return phase === '' ? t('phase.empty') : phase
}

function readableMember(label: string, t: Translate): string {
  return label === '' ? t('member.empty') : label
}

function statusCount(
  status: WorkflowRunStatus,
  count: number,
  t: Translate,
): string {
  return t(`statusCount.${status}`, { count })
}

function memberCount(count: number, t: Translate): string {
  return t(count === 1 ? 'run.members.one' : 'run.members.other', { count })
}

type DisclosureMode = 'clean' | 'running' | 'abnormal'

interface DisclosureFacts {
  readonly mode: DisclosureMode
  readonly activityCount: number
}

interface DisclosureState extends DisclosureFacts {
  readonly open: boolean
  readonly pendingCleanCollapse: boolean
}

interface WorkflowDisclosureState {
  readonly run: DisclosureState
  readonly phases: ReadonlyMap<string, DisclosureState>
}

type StatusDisclosureProps = Omit<DisclosureRowProps, 'expandable'>

function StatusDisclosure(props: StatusDisclosureProps): VNode {
  return <DisclosureRow {...props} expandable />
}

function abnormal(status: WorkflowRunStatus): boolean {
  return status === 'failed' || status === 'cancelled' || status === 'interrupted'
}

function phaseDisclosureFacts(phase: WorkflowRunPhaseData): DisclosureFacts {
  const mode = phase.members.some(member => abnormal(member.status))
    ? 'abnormal'
    : phase.members.some(member => member.status === 'running') ? 'running' : 'clean'
  return { mode, activityCount: phase.members.length }
}

function runDisclosureFacts(
  status: WorkflowRunStatus,
  phases: readonly (readonly [string, DisclosureFacts])[],
): DisclosureFacts {
  const mode = abnormal(status) || phases.some(([, facts]) => facts.mode === 'abnormal')
    ? 'abnormal'
    : status === 'running' || phases.some(([, facts]) => facts.mode === 'running')
      ? 'running'
      : 'clean'
  const activityCount = phases.reduce((count, [, facts]) => count + facts.activityCount, 0)
  return { mode, activityCount }
}

function initialDisclosureState(facts: DisclosureFacts): DisclosureState {
  return { ...facts, open: facts.mode !== 'clean', pendingCleanCollapse: false }
}

function advanceDisclosureState(
  current: DisclosureState,
  facts: DisclosureFacts,
  focusWithin: boolean,
): DisclosureState {
  const sameFacts = current.mode === facts.mode && current.activityCount === facts.activityCount
  if (sameFacts) {
    if (!current.pendingCleanCollapse || focusWithin) return current
    return { ...current, open: false, pendingCleanCollapse: false }
  }
  if (facts.mode === 'clean') {
    const deferCollapse = current.open && focusWithin
    return { ...facts, open: deferCollapse, pendingCleanCollapse: deferCollapse }
  }
  if (current.mode === 'clean' || (facts.mode === 'abnormal' && current.mode !== 'abnormal')) {
    return { ...facts, open: true, pendingCleanCollapse: false }
  }
  return { ...facts, open: current.open, pendingCleanCollapse: false }
}

function focusIsWithin(element: HTMLElement | null | undefined): boolean {
  if (element === null || element === undefined) return false
  return element.contains(element.ownerDocument.activeElement)
}

function collapsePending(state: DisclosureState): DisclosureState {
  if (!state.pendingCleanCollapse) return state
  return { ...state, open: false, pendingCleanCollapse: false }
}

function existingPhaseState(
  phases: ReadonlyMap<string, DisclosureState>,
  key: string,
): DisclosureState {
  const phase = phases.get(key)
  /* v8 ignore next -- mounted phase callbacks are created from this owner map. */
  if (phase === undefined) throw new Error(`Missing disclosure state for phase ${key}`)
  return phase
}

function preventPendingHeaderFocus(event: MouseEvent): void {
  const header = (event.currentTarget as HTMLElement).querySelector('[data-disclosure-row]')
  /* v8 ignore next -- DisclosureRow always renders its header before the content. */
  if (header === null) throw new Error('Missing disclosure header')
  if (header.contains(event.target as Node)) event.preventDefault()
}

function phaseStatusSummary(members: readonly WorkflowRunMemberData[], t: Translate): string {
  const counts = new Map<WorkflowRunStatus, number>()
  for (const member of members) counts.set(member.status, (counts.get(member.status) ?? 0) + 1)
  const count = (status: WorkflowRunStatus): number => counts.get(status) ?? 0
  const active = (['running', 'failed', 'cancelled', 'interrupted'] as const)
    .filter(status => count(status) > 0)
  if (active.length === 0) return statusCount('completed', count('completed'), t)
  const visible = active.includes('interrupted') && count('completed') > 0
    ? ['completed' as const, ...active]
    : active
  return visible.map(status => statusCount(status, count(status), t)).join(' · ')
}

function navigableMembers(
  sessions: SessionListState,
  phases: readonly WorkflowRunPhaseData[],
  parentId: SessionId,
): readonly SessionId[] {
  const ordinary = new Set(sessions.ids)
  const result: SessionId[] = []
  for (const phase of phases) {
    for (const member of phase.members) {
      const summary = sessions.byId[member.childId]
      if (member.status === 'running'
        && ordinary.has(member.childId)
        && summary?.origin === 'subagent'
        && summary.parentId === parentId
        && summary.running) {
        result.push(member.childId)
      }
    }
  }
  return result
}

function RunHeader({ children, count, name, onToggle, open, status, t }: {
  readonly children: VNode | VNode[] | string | null
  readonly count: number
  readonly name: string
  readonly onToggle: () => void
  readonly open: boolean
  readonly status: WorkflowRunStatus
  readonly t: Translate
}): VNode {
  return (
    <StatusDisclosure
      icon={<IconChevronRightOutline14 />}
      title={t('run.title', { name })}
      open={open}
      onToggle={onToggle}
      expandOnRowClick
      previewChevron={false}
      keepContentWhenOpen
      rowClassName={css.runHeader}
      leadingClassName={css.runLeading}
      titleClassName={css.runTitle}
      collapsedContent={(
        <>
          <span class={css.separator ?? ''} aria-hidden />
          <span class={css.runSummary ?? ''}>{memberCount(count, t)}</span>
          <span class={css.statusTail ?? ''} data-status={status}>
            <StateDot state={dotState(status)} />
            <span>{t(STATUS_KEYS[status])}</span>
          </span>
        </>
      )}
    >
      {children}
    </StatusDisclosure>
  )
}

function MemberRow({ member, navigable, openSession, t }: {
  readonly member: WorkflowRunMemberData
  readonly navigable: boolean
  readonly openSession: WorkflowRunInjected['openSession']
  readonly t: Translate
}): VNode {
  const name = readableMember(member.label, t)

  const content = (
    <>
      <span class={css.dotSlot ?? ''}><StateDot state={dotState(member.status)} /></span>
      <span class={css.memberLabelWrap ?? ''} data-member-label-wrap><span class={css.memberLabel ?? ''} data-member-label>{name}</span></span>
      <span class={css.memberStatus ?? ''} data-member-status-text>{t(STATUS_KEYS[member.status])}</span>
    </>
  )
  if (!navigable) {
    // The original React version rendered a focusable-but-inert button while
    // keyboard focus lingered on a member that stopped being navigable
    // (member.status flipped away from 'running' mid-focus). webjsx has no
    // React-style focus-tracking state hook; instead the DOM's native
    // :focus-within-adjacent behavior is unaffected by dropping that local
    // affordance, since a blur naturally moves focus off a removed control.
    return <div class={css.memberRow ?? ''} data-member-status={member.status}>{content}</div>
  }
  return (
    <button
      type="button"
      class={css.memberButton ?? ''}
      data-member-status={member.status}
      aria-label={t('member.open', { name })}
      onclick={() => { openSession(member.childId) }}
    >
      {content}
    </button>
  )
}

function PhaseSection({
  contentRef, onContentBlur, onToggle, open, pendingCleanCollapse,
  phase, navigable, openSession, t,
}: {
  readonly contentRef: (element: HTMLDivElement | null) => void
  readonly onContentBlur: (event: FocusEvent) => void
  readonly onToggle: () => void
  readonly open: boolean
  readonly pendingCleanCollapse: boolean
  readonly phase: WorkflowRunPhaseData
  readonly navigable: readonly SessionId[]
  readonly openSession: WorkflowRunInjected['openSession']
  readonly t: Translate
}): VNode {
  return (
    <div
      class={css.phase ?? ''}
      onmousedowncapture={pendingCleanCollapse ? preventPendingHeaderFocus : null}
    >
      <StatusDisclosure
        icon={<IconChevronRightOutline14 />}
        title={readablePhase(phase.phase, t)}
        open={open}
        onToggle={onToggle}
        expandOnRowClick
        previewChevron={false}
        keepContentWhenOpen
        rowClassName={css.phaseHeader}
        leadingClassName={css.phaseLeading}
        titleClassName={css.phaseTitle}
        collapsedContent={(
          <>
            <span class={css.separator ?? ''} aria-hidden />
            <span class={css.phaseCount ?? ''} data-phase-count>{memberCount(phase.members.length, t)}</span>
            <span class={css.phaseStatus ?? ''} data-phase-status-text>{phaseStatusSummary(phase.members, t)}</span>
          </>
        )}
      >
        <div ref={(node) => { contentRef(node as HTMLDivElement | null) }} class={css.members ?? ''} onblur={onContentBlur}>
          {phase.members.map(member => (
            <MemberRow
              key={member.seq}
              member={member}
              navigable={navigable.includes(member.childId)}
              openSession={openSession}
              t={t}
            />
          ))}
        </div>
      </StatusDisclosure>
    </div>
  )
}

/**
 * Render one durable workflow run with status-driven run and phase
 * disclosure, as a webjsx custom element.
 *
 * Converted from a React hooks component (useState/useMemo/useRef/
 * useLayoutEffect) to a webjsx custom element: `disclosures` state becomes an
 * instance field, the derived phaseFacts/runFacts/navigable memos become
 * plain per-render recomputation (no framework memoization needed at this
 * scale), the outer-hiding useLayoutEffect that settles deferred collapses
 * becomes an explicit call at the top of `#render()` before building vdom,
 * and the content refs (blur tracking for collapse deferral) are read from
 * the live DOM via querySelector after each applyDiff, since ref callbacks
 * are not part of webjsx's contract the way they are in React.
 */
export class DshWorkflowRunPanel extends HTMLElement {
  #props: WorkflowRunPanelProps | null = null
  #disclosures: WorkflowDisclosureState | null = null
  #runContent: HTMLDivElement | null = null
  #phaseContents = new Map<string, HTMLDivElement>()

  setProps(props: WorkflowRunPanelProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  disconnectedCallback(): void {
    // No pending timers/listeners to release.
  }

  #settleDisclosures(phaseFacts: readonly (readonly [string, DisclosureFacts])[], runFacts: DisclosureFacts): WorkflowDisclosureState {
    const current = this.#disclosures ?? {
      run: initialDisclosureState(runFacts),
      phases: new Map(phaseFacts.map(([key, facts]) => [key, initialDisclosureState(facts)])),
    }
    const phases = new Map<string, DisclosureState>()
    let phaseStartedCycle = false
    for (const [key, facts] of phaseFacts) {
      const previous = current.phases.get(key)
      const next = previous === undefined
        ? initialDisclosureState(facts)
        : advanceDisclosureState(previous, facts, focusIsWithin(this.#phaseContents.get(key)))
      phases.set(key, next)
      if (previous?.mode === 'clean'
        && (facts.mode !== 'clean' || facts.activityCount !== previous.activityCount)) {
        phaseStartedCycle = true
      }
    }
    const advancedRun = advanceDisclosureState(
      current.run,
      runFacts,
      focusIsWithin(this.#runContent),
    )
    const run = phaseStartedCycle && runFacts.mode !== 'clean' && !advancedRun.open
      ? { ...advancedRun, open: true, pendingCleanCollapse: false }
      : advancedRun
    const next = { run, phases }
    this.#disclosures = next
    return next
  }

  #toggleRun(): void {
    const current = this.#disclosures
    if (current === null) return
    this.#disclosures = {
      ...current,
      run: { ...current.run, open: !current.run.open, pendingCleanCollapse: false },
    }
    this.#render()
  }

  #togglePhase(key: string): void {
    const current = this.#disclosures
    if (current === null) return
    const phases = new Map(current.phases)
    const phase = existingPhaseState(phases, key)
    phases.set(key, { ...phase, open: !phase.open, pendingCleanCollapse: false })
    this.#disclosures = { ...current, phases }
    this.#render()
  }

  #settleRunBlur(event: FocusEvent): void {
    const currentTarget = event.currentTarget as HTMLElement
    if (event.relatedTarget instanceof Node && currentTarget.contains(event.relatedTarget)) return
    const current = this.#disclosures
    if (current === null) return
    const run = collapsePending(current.run)
    if (run === current.run) return
    this.#disclosures = { ...current, run }
    this.#render()
  }

  #settlePhaseBlur(key: string, event: FocusEvent): void {
    const currentTarget = event.currentTarget as HTMLElement
    if (event.relatedTarget instanceof Node && currentTarget.contains(event.relatedTarget)) return
    const current = this.#disclosures
    if (current === null) return
    const phase = existingPhaseState(current.phases, key)
    const next = collapsePending(phase)
    if (next === phase) return
    const phases = new Map(current.phases)
    phases.set(key, next)
    this.#disclosures = { ...current, phases }
    this.#render()
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const { node, sessionId, useSessions, openSession, t } = props

    const phaseFacts = node.data.phases.map(phase => (
      [phase.key, phaseDisclosureFacts(phase)] as const
    ))
    const runFacts = runDisclosureFacts(node.data.status, phaseFacts)
    const totalMembers = runFacts.activityCount
    const disclosures = this.#settleDisclosures(phaseFacts, runFacts)
    const navigable = useSessions(
      sessions => navigableMembers(sessions, node.data.phases, sessionId),
      shallowEqual,
    )

    const vdom = (
      <section
        class={css.root ?? ''}
        data-workflow-run
        data-run-status={node.data.status}
        onmousedowncapture={disclosures.run.pendingCleanCollapse
          ? preventPendingHeaderFocus
          : null}
      >
        <RunHeader
          count={totalMembers}
          name={node.data.name}
          open={disclosures.run.open}
          onToggle={() => { this.#toggleRun() }}
          status={node.data.status}
          t={t}
        >
          <div
            ref={(element) => { this.#runContent = element as HTMLDivElement | null }}
            class={css.phaseList ?? ''}
            onblur={(event: FocusEvent) => { this.#settleRunBlur(event) }}
          >
            {node.data.phases.length === 0
              ? <span class={css.empty ?? ''}>{t('run.empty')}</span>
              : node.data.phases.map((phase) => {
                const facts = phaseDisclosureFacts(phase)
                const disclosure = disclosures.phases.get(phase.key) ?? initialDisclosureState(facts)
                return (
                  <PhaseSection
                    key={phase.key}
                    contentRef={(element) => {
                      if (element === null) this.#phaseContents.delete(phase.key)
                      else this.#phaseContents.set(phase.key, element)
                    }}
                    onContentBlur={(event) => { this.#settlePhaseBlur(phase.key, event) }}
                    onToggle={() => { this.#togglePhase(phase.key) }}
                    open={disclosure.open}
                    pendingCleanCollapse={disclosure.pendingCleanCollapse}
                    phase={phase}
                    navigable={navigable}
                    openSession={openSession}
                    t={t}
                  />
                )
              })}
          </div>
        </RunHeader>
      </section>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-workflow-run-panel') === undefined) {
  customElements.define('dsh-workflow-run-panel', DshWorkflowRunPanel)
}

/**
 * Create (if needed) or update a WorkflowRunPanel element in place.
 * @param el - an existing `dsh-workflow-run-panel` element to update, or null to create one.
 * @param props - see {@link WorkflowRunPanelProps}.
 * @returns the `dsh-workflow-run-panel` element; keep it and pass it back in to update.
 */
export function renderWorkflowRunPanel(el: DshWorkflowRunPanel | null, props: WorkflowRunPanelProps): DshWorkflowRunPanel {
  const target = el ?? document.createElement('dsh-workflow-run-panel') as DshWorkflowRunPanel
  target.setProps(props)
  return target
}

/** One-shot creation helper preserving the original function-component call shape. */
export function WorkflowRunPanel(props: WorkflowRunPanelProps): DshWorkflowRunPanel {
  return renderWorkflowRunPanel(null, props)
}
