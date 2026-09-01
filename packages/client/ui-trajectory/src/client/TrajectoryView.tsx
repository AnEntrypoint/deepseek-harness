/** Trajectory view: compact summary over a turn-aware event ledger. */

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  AssistantBlock, ConversationNode, ConversationSnapshot,
  SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { TrajectorySnapshot } from './trajectory-contract.ts'
import {
  TrajectoryTable,
  type TrajectoryRequestNumber,
  type TrajectoryUsage,
} from './TrajectoryTable.tsx'
import { TrajectoryToolbar } from './TrajectoryToolbar.tsx'
import { TrajectoryTimeline } from './TrajectoryTimeline.tsx'
import {
  appendTrajectoryPartialLayout, deriveTrajectoryLayout,
  type TrajectoryTurnModel,
} from './layout.ts'
import {
  trajectoryTimelineFocusIndexes,
  type TrajectoryTimelineMode,
  type TrajectoryTimeRange,
} from './timeline.ts'
import { trajectoryRecordId } from './trajectory-record.ts'
import { TrajectorySearchIndex } from './trajectory-search-index.ts'
import { EMPTY_TRAJECTORY_SNAPSHOT } from './trajectory-snapshot-builder.ts'
import css from './views.css.ts'

const EMPTY_TURN_IDS: ReadonlySet<number> = new Set()
const EMPTY_RECORD_IDS: ReadonlySet<string> = new Set()
const SEARCH_INDEX_THROTTLE_MS = 3_000

function lastCellIndex(turns: readonly TrajectoryTurnModel[]): number {
  let last = 0
  for (const turn of turns) {
    for (const group of turn.groups) {
      for (const cell of group.cells) last = Math.max(last, cell.index)
    }
  }
  return last
}

function timelineBlock(block: AssistantBlock): AssistantBlock {
  switch (block.kind) {
    case 'text': return { kind: 'text', text: '' }
    case 'reasoning': return { kind: 'reasoning', text: '' }
    case 'image': return block
    case 'tool-call': return {
      kind: 'tool-call',
      callId: block.callId,
      name: block.name,
      argsRaw: '',
    }
    case 'other': return { kind: 'other', block: null }
  }
}

/** Session-bound controls not already supplied by the conversation view slot. */
export interface TrajectoryViewInjected {
  hooks: {
    duration: SnapshotStore<boolean>
  }
  loadOlder: () => Promise<boolean>
  setActualDuration: (actualDuration: boolean) => void
}

interface UsageLike {
  inputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  outputTokens?: number
  reasoningTokens?: number
}

function requestUsage(value: unknown): TrajectoryUsage | undefined {
  const usage = value as UsageLike | undefined
  if (usage === undefined) return undefined
  return {
    ...(usage.inputTokens === undefined ? {} : { input: usage.inputTokens }),
    ...(usage.cacheReadTokens === undefined ? {} : { cacheRead: usage.cacheReadTokens }),
    ...(usage.cacheWriteTokens === undefined ? {} : { cacheWrite: usage.cacheWriteTokens }),
    ...(usage.outputTokens === undefined ? {} : { output: usage.outputTokens }),
    ...(usage.reasoningTokens === undefined ? {} : { reasoning: usage.reasoningTokens }),
  }
}

function addUsage(
  total: TrajectoryUsage | undefined,
  usage: TrajectoryUsage | undefined,
): TrajectoryUsage | undefined {
  if (usage === undefined) return total
  return {
    ...(total?.input === undefined && usage.input === undefined
      ? {}
      : { input: (total?.input ?? 0) + (usage.input ?? 0) }),
    ...(total?.cacheRead === undefined && usage.cacheRead === undefined
      ? {}
      : { cacheRead: (total?.cacheRead ?? 0) + (usage.cacheRead ?? 0) }),
    ...(total?.cacheWrite === undefined && usage.cacheWrite === undefined
      ? {}
      : { cacheWrite: (total?.cacheWrite ?? 0) + (usage.cacheWrite ?? 0) }),
    ...(total?.output === undefined && usage.output === undefined
      ? {}
      : { output: (total?.output ?? 0) + (usage.output ?? 0) }),
    ...(total?.reasoning === undefined && usage.reasoning === undefined
      ? {}
      : { reasoning: (total?.reasoning ?? 0) + (usage.reasoning ?? 0) }),
  }
}

function requestNumbersFrom(
  nodes: readonly ConversationNode[],
  requests: TrajectorySnapshot['requests'],
): readonly TrajectoryRequestNumber[] {
  const assistantsByStep = new Map<string, Extract<ConversationNode, { kind: 'assistant' }>>()
  for (const node of nodes) {
    if (node.kind !== 'assistant' || node.step <= 0) continue
    assistantsByStep.set(`${node.turn}\u0000${node.step}`, node)
  }
  const requestsByStep = new Map(
    requests
      .filter(request => request.purpose === 'assistant')
      .map(request => [
        `${request.turn}\u0000${request.step}`,
        request,
      ]),
  )
  const orderedRequests = [
    ...requests.map(request => ({
      seq: request.startSeq,
      request,
      node: request.purpose === 'assistant'
        ? assistantsByStep.get(`${request.turn}\u0000${request.step}`)
        : undefined,
    })),
    ...[...assistantsByStep.entries()].flatMap(([key, node]) =>
      requestsByStep.has(key)
        ? []
        : [{
          seq: node.seq,
          request: undefined,
          node,
        }],
    ),
  ].sort((left, right) => left.seq - right.seq)
  const numbered: TrajectoryRequestNumber[] = []
  let cumulativeUsage: TrajectoryUsage | undefined
  for (const [index, entry] of orderedRequests.entries()) {
    const usage = requestUsage(entry.request?.usage ?? entry.node?.usage)
    cumulativeUsage = addUsage(cumulativeUsage, usage)
    if (entry.request?.purpose !== 'compaction') {
      const request = entry.request
      const node = entry.node
      const turn = request?.turn ?? node?.turn
      const step = request?.step ?? node?.step
      if (turn === undefined || step === undefined) continue
      const provider = request?.provenance?.provider ?? node?.provenance?.provider
      const model = request?.provenance?.model ?? node?.provenance?.model
      const requestConfig = request?.requestConfig ?? node?.requestConfig
      numbered.push({
        seq: entry.seq,
        turn,
        step,
        group: `Step ${step}`,
        number: index + 1,
        ...(request?.status === undefined ? {} : { status: request.status }),
        ...(request?.startedAt === undefined ? {} : { startedAt: request.startedAt }),
        ...(request?.completedAt === undefined ? {} : { completedAt: request.completedAt }),
        ...(request?.error === undefined ? {} : { error: request.error }),
        ...(request?.resultSeq === undefined ? {} : { resultSeq: request.resultSeq }),
        ...(request?.retry === undefined ? {} : { retry: request.retry }),
        ...(request?.maxRetries === undefined ? {} : { maxRetries: request.maxRetries }),
        ...(request?.retryDelayMs === undefined ? {} : { retryDelayMs: request.retryDelayMs }),
        ...(provider === undefined ? {} : { provider }),
        ...(model === undefined ? {} : { model }),
        ...(requestConfig === undefined ? {} : { requestConfig }),
        ...(usage === undefined ? {} : { usage }),
        ...(cumulativeUsage === undefined ? {} : { cumulativeUsage }),
      })
      continue
    }
    const request = entry.request
    numbered.push({
      seq: request.startSeq,
      turn: request.turn,
      step: 0,
      group: `Compaction ${request.startSeq}`,
      number: index + 1,
      purpose: 'compaction',
      status: request.status,
      startedAt: request.startedAt,
      completedAt: request.completedAt,
      ...(request.error === undefined ? {} : { error: request.error }),
      resultSeq: request.startSeq,
      ...(request.provenance?.provider === undefined ? {} : { provider: request.provenance.provider }),
      ...(request.provenance?.model === undefined ? {} : { model: request.provenance.model }),
      ...(request.requestConfig === undefined ? {} : { requestConfig: request.requestConfig }),
      ...(usage === undefined ? {} : { usage }),
      ...(cumulativeUsage === undefined ? {} : { cumulativeUsage }),
    })
  }
  return numbered
}

type TrajectoryViewProps = ConvViewProps & InjectFace<TrajectoryViewInjected> & PropsLocale<'trajectory'>

/**
 * Trajectory view custom element: derives layout/search/timeline state from
 * session snapshots on every `setProps`, then re-renders through
 * `applyDiff`. Session-derived state (collapsed turns/assistants, timeline
 * selection, search query, search index) lives as private fields in place of
 * the React version's useState; one-shot cross-view record focus/select
 * requests are plain fields instead of refs guarding a useEffect.
 */
export class DshTrajectoryView extends HTMLElement {
  #props: TrajectoryViewProps | null = null

  #collapsedTurns: ReadonlySet<number> = EMPTY_TURN_IDS
  #collapsedAssistants: ReadonlySet<string> = EMPTY_RECORD_IDS
  #timelineSelection: TrajectoryTimeRange | null = null
  #actualTime = false
  #searchQuery = ''
  #searchIndex = new TrajectorySearchIndex()
  #searchIndexRevision = 0
  #searchIndexTimer: ReturnType<typeof setTimeout> | null = null
  #searchIndexInitialized = false
  #selectedTimelineIndex: number | null = null
  #timelineRecordSelection: { readonly index: number } | null = null
  #timelineRecordFocus: { readonly index: number } | null = null

  setProps(props: TrajectoryViewProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  disconnectedCallback(): void {
    if (this.#searchIndexTimer !== null) {
      clearTimeout(this.#searchIndexTimer)
      this.#searchIndexTimer = null
    }
  }

  #toggleTurn(turn: number): void {
    const collapsed = new Set(this.#collapsedTurns)
    if (collapsed.has(turn)) collapsed.delete(turn)
    else collapsed.add(turn)
    this.#collapsedTurns = collapsed
    this.#render()
  }

  #toggleAssistant(id: string): void {
    const collapsed = new Set(this.#collapsedAssistants)
    if (collapsed.has(id)) collapsed.delete(id)
    else collapsed.add(id)
    this.#collapsedAssistants = collapsed
    this.#render()
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const {
      useSession, useDuration, loadOlder, setActualDuration,
      inspect, onInspectDone, t,
    } = props
    const actualDuration = useDuration(value => value)
    const inspection = useSession(snapshot =>
      snapshot.views.get('trajectory') ?? EMPTY_TRAJECTORY_SNAPSHOT)
    const historyLoading = useSession(snapshot => snapshot.openState === 'loading')
    const olderHistoryLoading = useSession(snapshot => snapshot.loadingOlder)
    const hasOlderHistory = useSession(snapshot => snapshot.hasMore)
    const nodes = inspection.eventNodes
    const eventLocations = inspection.eventLocations
    const historyBaseSeq = nodes[0]?.seq ?? 0
    const partial = inspection.partial
    const runningCalls = inspection.runningCalls
    const requests = inspection.requests
    const callSchemas = inspection.callSchemas

    const requestNumbers = requestNumbersFrom(nodes, requests)

    const partialTurn = partial?.turn ?? null
    const partialStep = partial?.step ?? null
    const finalizedTurns = deriveTrajectoryLayout({
      nodes,
      eventLocations,
      partial: partialTurn === null || partialStep === null
        ? null
        : { turn: partialTurn, step: partialStep, blocks: [] },
      runningCalls,
      requests,
      callSchemas,
    })
    const finalizedLastIndex = lastCellIndex(finalizedTurns)

    const timelinePartial: ConversationSnapshot['partial'] = partial === null
      ? null
      : {
        turn: partial.turn,
        step: partial.step,
        blocks: partial.blocks.map(block => timelineBlock(block)),
      }
    const timelineTurns = appendTrajectoryPartialLayout(finalizedTurns, timelinePartial, finalizedLastIndex)
    const timelineMode: TrajectoryTimelineMode = actualDuration
      ? this.#actualTime ? 'actual' : 'duration'
      : this.#actualTime ? 'time' : 'sequence'
    const partialSearchTurns = appendTrajectoryPartialLayout([], partial, finalizedLastIndex)
    const searchLayouts = [finalizedTurns, partialSearchTurns] as const

    // Debounced/throttled search-index refresh: first pass is synchronous,
    // later passes throttle behind a timer keyed to the latest layouts.
    if (!this.#searchIndexInitialized) {
      this.#searchIndexInitialized = true
      if (this.#searchIndex.update(searchLayouts)) this.#searchIndexRevision += 1
    } else if (this.#searchIndexTimer === null) {
      this.#searchIndexTimer = setTimeout(() => {
        this.#searchIndexTimer = null
        if (this.#searchIndex.update([finalizedTurns, partialSearchTurns])) {
          this.#searchIndexRevision += 1
        }
        this.#render()
      }, SEARCH_INDEX_THROTTLE_MS)
    }

    const streamingCells = partialSearchTurns.flatMap(turn =>
      turn.groups.flatMap(group => group.cells))
    const searchMatchRecordIds = this.#searchIndex.search(this.#searchQuery)
    const searchMatchIndexes = searchMatchRecordIds === null
      ? null
      : (() => {
        const indexes = new Set<number>()
        for (const turns of searchLayouts) {
          for (const turn of turns) {
            for (const group of turn.groups) {
              for (const cell of group.cells) {
                if (searchMatchRecordIds.has(trajectoryRecordId(cell))) indexes.add(cell.index)
              }
            }
          }
        }
        return indexes
      })()
    const timelineRange = this.#timelineSelection
    const timelineFocusIndexes = timelineRange === null
      ? null
      : trajectoryTimelineFocusIndexes(timelineTurns, timelineRange, timelineMode)

    const handleRecordSelect = (index: number): void => {
      if (timelineFocusIndexes !== null && !timelineFocusIndexes.has(index)) {
        this.#timelineSelection = null
        this.#render()
      }
    }
    const handleTimelineRangeChange = (range: TrajectoryTimeRange | null): void => {
      this.#timelineSelection = range
      this.#render()
    }
    const handleTimelineRecordSelect = (index: number): void => {
      this.#timelineSelection = null
      this.#timelineRecordSelection = { index }
      this.#selectedTimelineIndex = index
      this.#render()
    }
    const handleTimelineRecordFocus = (index: number): void => {
      this.#timelineRecordFocus = { index }
      this.#render()
    }

    const collapsibleTurnIds = timelineTurns
      .filter(turn =>
        turn.turn !== null
        && turn.groups.reduce(
          (count, group) =>
            count + group.cells.filter(cell =>
              cell.requestOnly !== true && cell.kind !== 'system').length,
          0,
        ) > 1)
      .flatMap(turn => turn.turn === null ? [] : [turn.turn])
    const allTurnsCollapsed = collapsibleTurnIds.length > 0
      && collapsibleTurnIds.every(turn => this.#collapsedTurns.has(turn))
    const collapsibleAssistantIds: string[] = []
    for (const turn of timelineTurns) {
      const cells = turn.groups.flatMap(group => group.cells)
      for (let i = 0; i < cells.length; i++) {
        const cell = cells[i]
        if (cell?.kind !== 'message') continue
        const next = cells[i + 1]
        if (next?.kind === 'tool' || next?.kind === 'subtool') {
          collapsibleAssistantIds.push(trajectoryRecordId(cell))
        }
      }
    }
    const allAssistantsCollapsed = collapsibleAssistantIds.length > 0
      && collapsibleAssistantIds.every(index => this.#collapsedAssistants.has(index))

    const toggleAllTurns = (): void => {
      const collapsed = new Set(this.#collapsedTurns)
      if (allTurnsCollapsed) {
        for (const turn of collapsibleTurnIds) collapsed.delete(turn)
      } else {
        for (const turn of collapsibleTurnIds) collapsed.add(turn)
      }
      this.#collapsedTurns = collapsed
      this.#render()
    }

    const toggleAllAssistants = (): void => {
      const collapsed = new Set(this.#collapsedAssistants)
      if (allAssistantsCollapsed) {
        for (const id of collapsibleAssistantIds) collapsed.delete(id)
      } else {
        for (const id of collapsibleAssistantIds) collapsed.add(id)
      }
      this.#collapsedAssistants = collapsed
      this.#render()
    }

    const loadEarlierHistory = (): Promise<boolean> => loadOlder()

    const vdom: VNode = (
      <div class={css.root ?? ''} data-conversation-composer-overlay="">
        <TrajectoryToolbar
          actualDuration={actualDuration}
          onActualDurationChange={(nextActualDuration) => {
            setActualDuration(nextActualDuration)
            this.#timelineSelection = null
            this.#render()
          }}
          actualTime={this.#actualTime}
          onActualTimeChange={(nextActualTime) => {
            this.#actualTime = nextActualTime
            this.#timelineSelection = null
            this.#render()
          }}
          allTurnsCollapsed={allTurnsCollapsed}
          onToggleAllTurns={toggleAllTurns}
          allAssistantsCollapsed={allAssistantsCollapsed}
          onToggleAllAssistants={toggleAllAssistants}
          searchQuery={this.#searchQuery}
          onSearchQueryChange={(query) => { this.#searchQuery = query; this.#render() }}
          t={t}
        />
        <TrajectoryTimeline
          turns={timelineTurns}
          mode={timelineMode}
          range={timelineRange}
          hasEarlierRecords={hasOlderHistory}
          onLoadEarlier={loadEarlierHistory}
          selectedIndex={this.#selectedTimelineIndex}
          searchMatchIndexes={searchMatchIndexes}
          onRangeChange={handleTimelineRangeChange}
          onRecordSelect={handleTimelineRecordSelect}
          onRecordFocus={handleTimelineRecordFocus}
        />
        <div class={css.ledger ?? ''}>
          <TrajectoryTable
            requestNumbers={requestNumbers}
            turns={timelineTurns}
            streamingCells={streamingCells}
            timelineFocusIndexes={timelineFocusIndexes}
            searchMatchIndexes={searchMatchIndexes}
            onSelectedIndexChange={(index) => { this.#selectedTimelineIndex = index }}
            onRecordSelect={handleRecordSelect}
            recordSelection={this.#timelineRecordSelection}
            recordFocus={this.#timelineRecordFocus}
            historyLoading={historyLoading}
            olderHistoryLoading={olderHistoryLoading}
            historyStartSeq={historyBaseSeq}
            hasOlderRecords={hasOlderHistory}
            onLoadOlder={loadEarlierHistory}
            onClearSelection={() => { this.#timelineSelection = null; this.#render() }}
            collapsedTurns={this.#collapsedTurns}
            onToggleTurn={(turn) => { this.#toggleTurn(turn) }}
            collapsedAssistants={this.#collapsedAssistants}
            onToggleAssistant={(id) => { this.#toggleAssistant(id) }}
            inspectCallId={inspect?.callId ?? null}
            onInspectApplied={onInspectDone}
          />
        </div>
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-trajectory-view') === undefined) {
  customElements.define('dsh-trajectory-view', DshTrajectoryView)
}

/** Create and mount a TrajectoryView element in place of the old function-component call. */
export function TrajectoryView(props: TrajectoryViewProps): JSX.Element {
  const el = document.createElement('dsh-trajectory-view') as DshTrajectoryView
  el.setProps(props)
  return el as unknown as JSX.Element
}
