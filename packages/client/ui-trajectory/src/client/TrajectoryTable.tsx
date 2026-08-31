/** Turn-aware trajectory event ledger with a local record inspector. */

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import { Virtualizer } from '@tanstack/virtual-core'
import type { VirtualizerOptions } from '@tanstack/virtual-core'
import {
  IconChevronRightOutline14,
  IconSettingsOutline16,
  IconSparkle16,
  IconUserOutline16,
  JsonTree,
  MarkdownText,
  Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { structuredPatch } from 'diff'
import type {
  AssistantRequestConfig, ConversationPromptSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import type {
  AssistantMetricDetail, TrajectoryCellKind, TrajectoryCellProps, TrajectorySourceBlock,
} from './trajectory-record.ts'
import { formatElapsedSeconds, trajectoryRecordId } from './trajectory-record.ts'
import {
  groupTrajectoryVirtualRows, trajectoryVirtualRecordKey,
} from './trajectory-virtual-rows.ts'
import type { TrajectoryVirtualRow } from './trajectory-virtual-rows.ts'
import type { TrajectoryTurnModel } from './layout.ts'
import { trajectoryPreviewText } from './trajectory-preview.ts'
import css from './TrajectoryTable.module.css'

const BOTTOM_FOLLOW_THRESHOLD_PX = 2
const OLDER_LOAD_THRESHOLD_PX = 48
const HISTORY_LOAD_ROW_HEIGHT_PX = 30
const VIRTUALIZATION_THRESHOLD = 100
const VIRTUAL_OVERSCAN_ROWS = 12
const VIRTUAL_INITIAL_VIEWPORT_HEIGHT_PX = 600

const KIND_LABEL: Record<TrajectoryCellKind, string> = {
  system: 'SYSTEM',
  user: 'USER',
  context: 'CONTEXT',
  compacted: 'COMPACTED',
  message: 'ASSISTANT',
  tool: 'TOOL',
  subtool: 'SUBTOOL',
}

function ToolWrenchIcon(): JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      data-role-icon="wrench"
      aria-hidden="true"
    >
      <path d="M14 3.3a3.8 3.8 0 0 1-4.8 4.8l-5.1 5.1a1.6 1.6 0 1 1-2.3-2.3l5.1-5.1A3.8 3.8 0 0 1 11.7 1l-2.3 2.3 2.3 2.3L14 3.3Z" />
    </svg>
  )
}

function InformationIcon(): JSX.Element {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.4"
      stroke-linecap="round"
      data-role-icon="information"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.7" />
      <circle cx="8" cy="5.5" r=".85" fill="currentColor" stroke="none" />
      <path d="M8 7.75v3.4" stroke-width="1.8" />
    </svg>
  )
}

function CompactedIcon(): JSX.Element {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      data-role-icon="compacted"
      aria-hidden="true"
    >
      <path d="m2.5 2.5 3.75 3.75M3 6.25h3.25V3" />
      <path d="m13.5 2.5-3.75 3.75M13 6.25H9.75V3" />
      <path d="m2.5 13.5 3.75-3.75M3 9.75h3.25V13" />
      <path d="m13.5 13.5-3.75-3.75M13 9.75H9.75V13" />
    </svg>
  )
}

function kindIcon(kind: TrajectoryCellKind): JSX.Element {
  switch (kind) {
    case 'system': return <IconSettingsOutline16 size={13} />
    case 'user': return <IconUserOutline16 size={13} />
    case 'context': return <InformationIcon />
    case 'compacted': return <CompactedIcon />
    case 'message': return <IconSparkle16 size={13} />
    case 'tool': return <ToolWrenchIcon />
    case 'subtool': return <ToolWrenchIcon />
  }
}

interface TableRecord {
  turn: number | null
  section: number
  group: string
  groupStart: boolean
  turnStart: boolean
  cell: TrajectoryCellProps
  turnEnd: boolean
  collapsedSummary?: string
  collapsedSummaryKind?: 'turn' | 'assistant'
}

interface VirtualRowStructure {
  height: number
  key: string
}

function stableVirtualRowStructure(
  rows: readonly TrajectoryVirtualRow<TableRecord>[],
  cache: { rows: readonly TrajectoryVirtualRow<TableRecord>[]; structure: readonly VirtualRowStructure[] },
): readonly VirtualRowStructure[] {
  if (cache.rows === rows) return cache.structure
  const structure = cache.structure.length === rows.length
    && rows.every((row, index) => {
      const previous = cache.structure[index]
      return previous?.key === row.key && previous.height === row.height
    })
    ? cache.structure
    : rows.map(row => ({ key: row.key, height: row.height }))
  cache.rows = rows
  cache.structure = structure
  return structure
}

type DetailTab =
  | 'system-prompt'
  | 'tools'
  | 'overview'
  | 'rendered'
  | 'raw'
  | 'source'
  | 'input'
  | 'output'
  | 'schema'
  | 'options'
  | 'usage'
  | 'timing'
  | 'diff'
type RecordState = 'complete' | 'running' | 'error'

interface DetailTabItem {
  id: DetailTab
  label: string
}

interface ParentRecords {
  message?: TableRecord
  tool?: TableRecord
}

interface ToolCallTextParts {
  name: string
  args?: string
}

interface SelectedRequest {
  turn: number | null
  group: string
  seq?: number
}

interface DetailsResizeDrag {
  pointerId: number
  startX: number
  startWidth: number
  splitWidth: number
  startToolRequestOffset: number
}

const DETAILS_MIN_WIDTH = 320
const DETAILS_MAX_WIDTH = 720
const TABLE_MIN_WIDTH = 280
const DETAILS_RESIZE_STEP = 16
const TOOL_REQUEST_SHARE = 0.58
const TOOL_REQUEST_MIN_WIDTH = 180
const TOOL_REQUEST_MAX_WIDTH = 480
const DEFAULT_TOOL_REQUEST_SHARE = 0.36
const DEFAULT_TOOL_REQUEST_OFFSET = 56
const SYSTEM_PROMPT_TABS: readonly DetailTabItem[] = [
  { id: 'system-prompt', label: 'System Prompt' },
  { id: 'tools', label: 'Tools' },
]
const SYSTEM_UPDATE_TABS: readonly DetailTabItem[] = [
  { id: 'diff', label: 'Diff' },
  ...SYSTEM_PROMPT_TABS,
]
const REQUEST_TABS: readonly DetailTabItem[] = [
  { id: 'overview', label: 'Summary' },
  { id: 'options', label: 'Options' },
  { id: 'usage', label: 'Usage' },
  { id: 'timing', label: 'Timing' },
]

interface OlderLoadAnchor {
  readonly historyStartSeq: number | undefined
  readonly scrollHeight: number
  readonly scrollTop: number
}

function clampDetailsWidth(width: number, splitWidth: number): number {
  const maxWidth = Math.max(
    DETAILS_MIN_WIDTH,
    Math.min(DETAILS_MAX_WIDTH, splitWidth - TABLE_MIN_WIDTH),
  )
  return Math.round(Math.min(Math.max(width, DETAILS_MIN_WIDTH), maxWidth))
}

function defaultToolRequestWidth(splitWidth: number): number {
  return Math.min(
    Math.max(
      splitWidth * DEFAULT_TOOL_REQUEST_SHARE - DEFAULT_TOOL_REQUEST_OFFSET,
      TOOL_REQUEST_MIN_WIDTH,
    ),
    TOOL_REQUEST_MAX_WIDTH,
  )
}

function formatDurationMs(milliseconds: number): string {
  if (milliseconds < 1_000) return `${Math.round(milliseconds)} ms`
  return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 2 : 1)} s`
}

function formatStartedAt(timestamp: number | null): string {
  if (timestamp === null || !Number.isFinite(timestamp)) return 'Not available'
  const date = new Date(timestamp)
  const two = (value: number) => String(value).padStart(2, '0')
  const three = (value: number) => String(value).padStart(3, '0')
  const time = `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}.${three(date.getMilliseconds())}`
  const day = `${date.getFullYear()}-${two(date.getMonth() + 1)}-${two(date.getDate())}`
  return `${day} ${time}`
}

/** Whether a click lands on an active text selection and should keep it. */
function clickSelectsText(target: Node): boolean {
  const selection = window.getSelection()
  return selection !== null
    && !selection.isCollapsed
    && selection.rangeCount > 0
    && selection.getRangeAt(0).intersectsNode(target)
}

function StartedAtValue({
  timestamp,
  showUnix,
  onToggle,
}: {
  timestamp: number | null
  showUnix: boolean
  onToggle: () => void
}): JSX.Element {
  if (timestamp === null || !Number.isFinite(timestamp)) return <dd>Not available</dd>
  return (
    <dd>
      <button
        type="button"
        class={css.timestampToggle ?? ''}
        title={showUnix ? 'Show local time' : 'Show Unix timestamp'}
        onclick={(event: MouseEvent) => {
          if (clickSelectsText(event.currentTarget as Node)) return
          onToggle()
        }}
      >
        {showUnix ? (timestamp / 1_000).toFixed(3) : formatStartedAt(timestamp)}
      </button>
    </dd>
  )
}

function totalTime(metrics: AssistantMetricDetail): string {
  if (!metrics.timingRecorded) return 'Not recorded'
  if (metrics.stepStartTime === null) return 'Step start unavailable'
  if (metrics.completedTime === null) return 'Pending'
  return formatDurationMs(Math.max(0, metrics.completedTime - metrics.stepStartTime))
}

function ttft(metrics: AssistantMetricDetail): string {
  if (!metrics.timingRecorded) return 'Not recorded'
  if (metrics.stepStartTime === null) return 'Step start unavailable'
  if (metrics.firstTokenTime === null) return 'First token unavailable'
  return formatDurationMs(Math.max(0, metrics.firstTokenTime - metrics.stepStartTime))
}

function generationTime(metrics: AssistantMetricDetail): string {
  if (!metrics.timingRecorded || metrics.firstTokenTime === null) return 'First token unavailable'
  if (metrics.completedTime === null) return 'Pending'
  return formatDurationMs(Math.max(0, metrics.completedTime - metrics.firstTokenTime))
}

function throughput(metrics: AssistantMetricDetail): string {
  if (!metrics.usageProvided) return 'Usage unavailable'
  if (metrics.outputTokens === null) return 'Output tokens unavailable'
  if (!metrics.timingRecorded || metrics.firstTokenTime === null) return 'First token unavailable'
  if (metrics.completedTime === null) return 'Pending'
  const generationSeconds = (metrics.completedTime - metrics.firstTokenTime) / 1_000
  if (generationSeconds <= 0) return 'Duration too short'
  return `${(metrics.outputTokens / generationSeconds).toFixed(1)} tok/s`
}

function AssistantTimingPanel({
  metrics,
  showUnix,
  onToggleUnix,
}: {
  metrics: AssistantMetricDetail
  showUnix: boolean
  onToggleUnix: () => void
}): JSX.Element {
  return (
    <dl class={css.overview ?? ''}>
      <div><dt>Started</dt><StartedAtValue timestamp={metrics.stepStartTime} showUnix={showUnix} onToggle={onToggleUnix} /></div>
      <div><dt>Total duration</dt><dd>{totalTime(metrics)}</dd></div>
      <div><dt>TTFT</dt><dd>{ttft(metrics)}</dd></div>
      <div><dt>Generation</dt><dd>{generationTime(metrics)}</dd></div>
      <div><dt>Throughput</dt><dd>{throughput(metrics)}</dd></div>
    </dl>
  )
}

/** Props for the trajectory ledger. */
export interface TrajectoryTableProps {
  /** Session-global request numbers for the request groups visible in this context. */
  requestNumbers?: readonly TrajectoryRequestNumber[]
  /** Grouped records in display order. */
  turns: readonly TrajectoryTurnModel[]
  /** In-flight cells whose content replaces the matching structural record index. */
  streamingCells?: readonly TrajectoryCellProps[]
  /** Record indexes emphasized by the active timeline focus. */
  timelineFocusIndexes?: ReadonlySet<number> | null
  /** Record indexes retained by the active live search, or null without a query. */
  searchMatchIndexes?: ReadonlySet<number> | null
  /** Report the record currently selected in the local inspector. */
  onSelectedIndexChange?: (index: number | null) => void
  /** Report a direct user selection from a ledger row. */
  onRecordSelect?: (index: number) => void
  /** One externally requested record selection; a new object repeats the request. */
  recordSelection?: { readonly index: number } | null
  /** One externally requested record focus without changing inspector selection. */
  recordFocus?: { readonly index: number } | null
  /** Whether the initial history tail is still loading. */
  historyLoading?: boolean
  /** Whether one older history page request is pending anywhere. */
  olderHistoryLoading?: boolean
  /** First loaded raw event, used to preserve scroll position after prepending a page. */
  historyStartSeq?: number | undefined
  /** Whether one older history page can be requested. */
  hasOlderRecords?: boolean
  /** Load one older history page. */
  onLoadOlder?: () => Promise<boolean>
  /** Clear selection state owned by the ledger host. */
  onClearSelection?: () => void
  /** Turn ids whose rows after the first are folded into a summary. */
  collapsedTurns: ReadonlySet<number>
  /** Toggle one turn between folded and expanded. */
  onToggleTurn: (turn: number) => void
  /** Stable Assistant record ids whose tool calls are folded. */
  collapsedAssistants: ReadonlySet<string>
  /** Toggle tool calls under one assistant record. */
  onToggleAssistant: (id: string) => void
  /** One-shot cross-view inspect: open and scroll to this call's record. */
  inspectCallId?: string | null
  /** Acknowledge a consumed (or unresolvable) inspect request. */
  onInspectApplied?: (() => void) | undefined
}

/** Request-inspector fields shared by ordinary generation and compaction. */
interface TrajectoryRequestNumberBase {
  /** Request anchor event sequence; absent for the currently streaming ordinary request. */
  seq?: number
  group: string
  number: number
  status?: 'complete' | 'running' | 'error'
  startedAt?: number
  completedAt?: number | null
  error?: string
  retry?: number
  maxRetries?: number
  retryDelayMs?: number
  resultSeq?: number
  provider?: string
  model?: string
  requestConfig?: AssistantRequestConfig
  usage?: TrajectoryUsage
  cumulativeUsage?: TrajectoryUsage
}

/** One purpose-discriminated request identity paired with its session-global number. */
export type TrajectoryRequestNumber = TrajectoryRequestNumberBase & (
  | {
    purpose?: 'assistant'
    turn: number
    step: number
  }
  | {
    purpose: 'compaction'
    turn: number | null
    step: 0
  }
)

/** Disjoint provider token buckets for one request or a session prefix. */
export interface TrajectoryUsage {
  input?: number
  cacheRead?: number
  cacheWrite?: number
  output?: number
  reasoning?: number
}

function flattenRecords(turns: readonly TrajectoryTurnModel[]): TableRecord[] {
  return turns.flatMap((turn, section) => {
    let firstInSection = true
    const records = turn.groups.flatMap((group) => {
      return group.cells.map((cell, index) => {
        const turnStart = firstInSection
          && cell.requestOnly !== true
          && cell.kind !== 'system'
          && (cell.kind !== 'compacted' || turn.turn === null)
        if (turnStart) firstInSection = false
        return {
          turn: turn.turn,
          section,
          group: group.title,
          groupStart: index === 0,
          turnStart,
          cell,
          turnEnd: false,
        }
      })
    })
    const last = records.at(-1)
    if (last !== undefined) last.turnEnd = true
    return records
  })
}

function filterRecords(
  records: readonly TableRecord[],
  matches: ReadonlySet<number>,
): TableRecord[] {
  const filtered = records
    .filter(record =>
      record.cell.requestOnly !== true && matches.has(record.cell.index),
    )
    .map(record => ({ ...record, groupStart: false, turnStart: false, turnEnd: false }))
  const startedSections = new Set<number>()
  for (const [index, record] of filtered.entries()) {
    const previous = filtered[index - 1]
    const next = filtered[index + 1]
    record.groupStart = previous === undefined
      || previous.section !== record.section
      || previous.group !== record.group
    record.turnStart = !startedSections.has(record.section)
      && record.cell.kind !== 'system'
      && (record.cell.kind !== 'compacted' || record.turn === null)
    if (record.turnStart) startedSections.add(record.section)
    record.turnEnd = next === undefined || next.section !== record.section
  }
  return filtered
}

function requestStep(group: string): number | undefined {
  if (!group.startsWith('Step ')) return undefined
  const value = Number(group.slice('Step '.length))
  return Number.isInteger(value) && value > 0 ? value : undefined
}

function requestKey(turn: number | null, group: string): string {
  return `${turn}\u0000${group}`
}

function indexRequestBoundaries(records: readonly TableRecord[]): ReadonlyMap<string, number> {
  const boundaries = new Map<string, number>()
  for (const record of records) {
    const key = requestKey(record.turn, record.group)
    if (boundaries.has(key)) continue
    if (requestStep(record.group) === undefined) {
      if (record.groupStart) boundaries.set(key, record.cell.index)
      continue
    }
    if (record.cell.kind === 'user' || record.cell.kind === 'context') continue
    boundaries.set(key, record.cell.index)
  }
  return boundaries
}

function sectionLabel(turn: number | null): string {
  return turn === null ? 'Between turns' : `Turn ${turn}`
}

function indexRequestNumbers(
  records: readonly TableRecord[],
  sessionNumbers: readonly TrajectoryRequestNumber[] | undefined,
  boundaries: ReadonlyMap<string, number>,
): ReadonlyMap<string, number> {
  const numbers = new Map<string, number>()
  for (const request of sessionNumbers ?? []) {
    numbers.set(requestKey(request.turn, request.group), request.number)
  }
  let next = Math.max(0, ...numbers.values()) + 1
  const boundaryRecords = records
    .filter(record => boundaries.get(requestKey(record.turn, record.group)) === record.cell.index
      && requestStep(record.group) !== undefined)
    .sort((left, right) => left.cell.index - right.cell.index)
  for (const record of boundaryRecords) {
    const key = requestKey(record.turn, record.group)
    if (!numbers.has(key)) numbers.set(key, next++)
  }
  return numbers
}

function indexRequestBoundaryRuns(records: readonly TableRecord[]): ReadonlyMap<number, number> {
  const indexes = new Map<number, number>()
  let runLength = 0
  for (const record of records) {
    if (record.cell.requestOnly === true) {
      indexes.set(record.cell.index, runLength++)
      continue
    }
    if (runLength > 0 && record.groupStart && requestStep(record.group) !== undefined) {
      indexes.set(record.cell.index, runLength)
    }
    runLength = 0
  }
  return indexes
}

function summarizeTurn(records: readonly TableRecord[]): string {
  const steps = new Set(
    records
      .map(record => record.group)
      .filter(group => group.startsWith('Step ')),
  ).size
  const toolCalls = records.filter(record =>
    record.cell.kind === 'tool' || record.cell.kind === 'subtool',
  ).length
  return [
    `${steps} ${steps === 1 ? 'step' : 'steps'}`,
    `${toolCalls} tool ${toolCalls === 1 ? 'call' : 'calls'}`,
  ].join(' · ')
}

function collapseTurnRecords(
  records: readonly TableRecord[],
  collapsedTurns: ReadonlySet<number>,
): TableRecord[] {
  const recordsByTurn = new Map<number, TableRecord[]>()
  for (const record of records) {
    if (record.turn === null) continue
    const turnRecords = recordsByTurn.get(record.turn) ?? []
    turnRecords.push(record)
    recordsByTurn.set(record.turn, turnRecords)
  }
  return records.flatMap((record) => {
    if (record.turn === null || !collapsedTurns.has(record.turn)) return [record]
    const turnRecords = recordsByTurn.get(record.turn) ?? [record]
    if (record.cell.requestOnly === true || record.cell.kind === 'system') return [record]
    const contentRecords = turnRecords.filter(candidate =>
      candidate.cell.requestOnly !== true && candidate.cell.kind !== 'system')
    if (contentRecords.length <= 1) return [record]
    if (record.cell.index !== contentRecords[0]?.cell.index) return []
    return [
      { ...record, turnEnd: false },
      {
        ...record,
        groupStart: false,
        turnStart: false,
        turnEnd: true,
        collapsedSummary: summarizeTurn(contentRecords.slice(1)),
        collapsedSummaryKind: 'turn' as const,
      },
    ]
  })
}

function assistantToolCalls(
  records: readonly TableRecord[],
  assistantIndex: number,
): readonly TableRecord[] {
  const at = records.findIndex(record => record.cell.index === assistantIndex)
  if (at === -1 || records[at]?.cell.kind !== 'message') return []
  const calls: TableRecord[] = []
  for (let i = at + 1; i < records.length; i++) {
    const record = records[i]
    if (record === undefined) break
    if (record.cell.kind !== 'tool' && record.cell.kind !== 'subtool') break
    calls.push(record)
  }
  return calls
}

function summarizeAssistantTools(records: readonly TableRecord[]): string {
  const names = [...new Set(records.map((record) => {
    const separator = record.cell.text.indexOf(' · ')
    return separator === -1 ? record.cell.text : record.cell.text.slice(0, separator)
  }).filter(name => name !== ''))]
  const count = records.length
  const summary = `${count} tool ${count === 1 ? 'call' : 'calls'}`
  return names.length > 0 ? `${summary} · ${names.join(', ')}` : summary
}

function collapseAssistantRecords(
  records: readonly TableRecord[],
  collapsedAssistants: ReadonlySet<string>,
): TableRecord[] {
  const out: TableRecord[] = []
  for (let i = 0; i < records.length; i++) {
    const record = records[i]
    if (record === undefined) continue
    out.push(record)
    if (
      record.cell.kind !== 'message'
      || !collapsedAssistants.has(trajectoryRecordId(record.cell))
    ) continue
    const calls: TableRecord[] = []
    for (let j = i + 1; j < records.length; j++) {
      const candidate = records[j]
      if (
        candidate === undefined
        || candidate.collapsedSummary !== undefined
        || (candidate.cell.kind !== 'tool' && candidate.cell.kind !== 'subtool')
      ) break
      calls.push(candidate)
    }
    if (calls.length === 0) continue
    const last = calls.at(-1)
    out[out.length - 1] = { ...record, turnEnd: false }
    out.push({
      ...record,
      groupStart: false,
      turnStart: false,
      turnEnd: last?.turnEnd ?? false,
      collapsedSummary: summarizeAssistantTools(calls),
      collapsedSummaryKind: 'assistant' as const,
    })
    i += calls.length
  }
  return out
}

function stateOf(record: TableRecord): RecordState {
  if (record.cell.isError) return 'error'
  if (record.cell.kind === 'compacted' && record.cell.timeSeconds === null) return 'running'
  if (
    (record.cell.kind === 'tool' || record.cell.kind === 'subtool')
    && record.cell.outputDetail === undefined
  ) return 'running'
  return 'complete'
}

function statusLabel(state: RecordState): string {
  if (state === 'error') return 'Failed'
  if (state === 'running') return 'Pending'
  return 'Completed'
}

function TokenRows({ cell }: { cell: TrajectoryCellProps }): (JSX.Element | null)[] {
  const content = cell.output !== undefined && cell.think !== undefined
    ? Math.max(0, cell.output - cell.think)
    : undefined
  return [
    <div>
      <dt>Tokens</dt>
      <dd>{cell.output === undefined ? '—' : `${cell.output} tok`}</dd>
    </div>,
    cell.think !== undefined
      ? (
        <div class={css.requestTokenDetail ?? ''}>
          <dt>Reasoning</dt>
          <dd>{cell.think} tok</dd>
        </div>
      )
      : null,
    content !== undefined
      ? (
        <div class={css.requestTokenDetail ?? ''}>
          <dt>Content</dt>
          <dd>{content} tok</dd>
        </div>
      )
      : null,
  ]
}

function inputTotal(usage: TrajectoryUsage): number | undefined {
  if (
    usage.input === undefined
    && usage.cacheRead === undefined
    && usage.cacheWrite === undefined
  ) return undefined
  return (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0)
}

function UsageRows({ usage }: { usage: TrajectoryUsage | undefined }): JSX.Element {
  if (usage === undefined) return <p class={css.noPayload ?? ''}>Usage not reported</p>
  const totalInput = inputTotal(usage)
  const otherOutput = usage.output !== undefined && usage.reasoning !== undefined
    ? usage.output - usage.reasoning
    : undefined
  return (
    <dl class={css.overview ?? ''}>
      {totalInput !== undefined && (
        <div><dt>Input</dt><dd>{totalInput} tok</dd></div>
      )}
      {usage.cacheRead !== undefined && (
        <div class={css.requestTokenDetail ?? ''}>
          <dt>Cached</dt>
          <dd>{usage.cacheRead} tok</dd>
        </div>
      )}
      {usage.cacheWrite !== undefined && (
        <div class={css.requestTokenDetail ?? ''}>
          <dt>Cache created</dt>
          <dd>{usage.cacheWrite} tok</dd>
        </div>
      )}
      {usage.input !== undefined && (
        <div class={css.requestTokenDetail ?? ''}>
          <dt>Other</dt>
          <dd>{usage.input} tok</dd>
        </div>
      )}
      {usage.output !== undefined && (
        <div><dt>Output</dt><dd>{usage.output} tok</dd></div>
      )}
      {usage.reasoning !== undefined && (
        <div class={css.requestTokenDetail ?? ''}>
          <dt>Reasoning</dt>
          <dd>{usage.reasoning} tok</dd>
        </div>
      )}
      {otherOutput !== undefined && (
        <div class={css.requestTokenDetail ?? ''}>
          <dt>Content</dt>
          <dd>{otherOutput} tok</dd>
        </div>
      )}
    </dl>
  )
}

function RequestUsagePanel({
  usage,
  cumulative,
}: {
  usage: TrajectoryUsage | undefined
  cumulative: TrajectoryUsage | undefined
}): JSX.Element {
  return (
    <div class={css.usagePanel ?? ''}>
      <section class={css.usageGroup ?? ''}>
        <h4 class={css.usageHeading ?? ''}>This request</h4>
        <UsageRows usage={usage} />
      </section>
      <section class={css.usageGroup ?? ''}>
        <h4 class={css.usageHeading ?? ''}>Session cumulative</h4>
        <UsageRows usage={cumulative} />
      </section>
    </div>
  )
}

function RequestOptions({
  options,
  preview = false,
}: {
  options: AssistantRequestConfig | undefined
  preview?: boolean
}): JSX.Element {
  if (options === undefined) {
    return <p class={css.noPayload ?? ''}>Options not recorded</p>
  }
  return (
    <JsonTree
      data={options}
      label="Request options JSON"
      className={preview ? css.jsonPreview : css.jsonPayload}
    /> as unknown as JSX.Element
  )
}

function messageSourceLabel(source: unknown): string {
  if (typeof source !== 'object' || source === null || Array.isArray(source)) {
    return 'Unknown'
  }
  const properties = source as Record<string, unknown>
  const kind = properties.kind
  if (kind === 'user') return 'User'
  if (kind === 'plugin') {
    const plugin = properties.plugin
    return typeof plugin === 'string' && plugin !== ''
      ? `Plugin · ${plugin}`
      : 'Plugin'
  }
  if (kind === 'goal') {
    const round = properties.round
    return typeof round === 'number' && round > 0
      ? `Goal · Round ${round}`
      : 'Goal'
  }
  if (typeof kind !== 'string' || kind === '') return 'Unknown'
  return `${kind[0]?.toUpperCase() ?? ''}${kind.slice(1)}`
}

function MessageSource({ record }: { record: TableRecord }): JSX.Element {
  const source = record.cell.messageSource
  if (source === undefined) return <p class={css.noPayload ?? ''}>Source not recorded</p>
  const data = typeof source === 'object' && source !== null
    ? source
    : { value: source }
  return (
    <JsonTree
      data={data}
      label="Message source JSON"
      className={css.jsonPayload}
    /> as unknown as JSX.Element
  )
}

function isMarkdownRecord(record: TableRecord): boolean {
  return record.cell.kind === 'user'
    || record.cell.kind === 'context'
    || record.cell.kind === 'message'
}

function parentRecords(
  records: readonly TableRecord[],
  record: TableRecord,
): ParentRecords {
  if (record.cell.kind !== 'tool' && record.cell.kind !== 'subtool') return {}
  const at = records.findIndex(candidate => candidate.cell.index === record.cell.index)
  if (at === -1) return {}
  let tool: TableRecord | undefined
  if (record.cell.kind === 'subtool') {
    for (let i = at - 1; i >= 0; i--) {
      const candidate = records[i]
      if (
        candidate === undefined
        || candidate.turn !== record.turn
        || candidate.group !== record.group
      ) break
      if (candidate.cell.kind === 'tool') {
        tool = candidate
        break
      }
    }
  }
  const parentCallId = tool?.cell.callId ?? record.cell.callId
  let message: TableRecord | undefined
  if (parentCallId !== undefined) {
    message = records.find(candidate =>
      candidate.turn === record.turn
      && candidate.cell.kind === 'message'
      && candidate.cell.sourceBlocks?.some(block => block.callId === parentCallId) === true,
    )
  }
  return { ...(message === undefined ? {} : { message }), ...(tool === undefined ? {} : { tool }) }
}

function markdownSource(record: TableRecord): string | undefined {
  if (record.cell.kind === 'user' || record.cell.kind === 'context') {
    return record.cell.inputDetail
  }
  if (record.cell.kind === 'message' || record.cell.kind === 'compacted') {
    return record.cell.outputDetail
  }
  return undefined
}

function detailTabs(record: TableRecord): readonly DetailTabItem[] {
  if (record.cell.kind === 'system') {
    return record.cell.previousPromptDetail === undefined
      ? SYSTEM_PROMPT_TABS
      : SYSTEM_UPDATE_TABS
  }
  if (record.cell.kind === 'compacted') {
    return [
      { id: 'overview', label: 'Summary' },
      { id: 'raw', label: 'Raw Output' },
    ]
  }
  if (isMarkdownRecord(record)) {
    return [
      { id: 'overview', label: 'Summary' },
      { id: 'rendered', label: 'Preview' },
      { id: 'raw', label: 'Raw' },
      ...(record.cell.messageSource === undefined
        ? []
        : [{ id: 'source', label: 'Source' } as const]),
    ]
  }
  return [
    { id: 'overview', label: 'Summary' },
    ...(record.cell.inputDetail ? [{ id: 'input', label: 'Payload' } as const] : []),
    ...(record.cell.outputDetail ? [{ id: 'output', label: 'Result' } as const] : []),
    { id: 'schema', label: 'Schema' },
    { id: 'timing', label: 'Timing' },
  ]
}

function recordDisplayText(cell: TrajectoryCellProps): string {
  if (isToolCallOnly(cell)) return ''
  if (cell.previewMarkdown !== undefined) {
    const preview = trajectoryPreviewText(cell.previewMarkdown)
    if (cell.text === '') return preview
    return preview === '' ? cell.text : `${cell.text} · ${preview}`
  }
  if (cell.text !== '') return cell.text
  const markdown = cell.kind === 'user' || cell.kind === 'context'
    ? cell.inputDetail
    : cell.kind === 'message'
      ? cell.outputDetail ?? cell.thinkingDetail
      : undefined
  return markdown === undefined ? '' : trajectoryPreviewText(markdown)
}

function recordResultText(cell: TrajectoryCellProps): string | undefined {
  return cell.resultPreviewMarkdown === undefined
    ? cell.result
    : trajectoryPreviewText(cell.resultPreviewMarkdown)
}

function toolCallTextParts(
  kind: TrajectoryCellKind,
  text: string,
): ToolCallTextParts | undefined {
  if (kind !== 'tool' && kind !== 'subtool') return undefined
  const separator = text.indexOf(' · ')
  if (separator === -1) return { name: text }
  return {
    name: text.slice(0, separator),
    args: text.slice(separator + 3),
  }
}

function isToolCallOnly(cell: TrajectoryCellProps): boolean {
  return cell.kind === 'message'
    && !cell.outputDetail
    && !cell.thinkingDetail
    && cell.text === 'Tool call only'
}

interface RecordPresentationValue {
  displayText: string
  listDisplayText: string
  resultText: string | undefined
  toolCallOnly: boolean
  toolCallText: ToolCallTextParts | undefined
}

function recordPresentation(cell: TrajectoryCellProps): RecordPresentationValue {
  const displayText = recordDisplayText(cell)
  const resultText = recordResultText(cell)
  const toolCallOnly = isToolCallOnly(cell)
  const toolCallText = toolCallTextParts(cell.kind, displayText)
  const listDisplayText = toolCallOnly
    ? '(tool call only)'
    : toolCallText === undefined
      ? displayText
      : [toolCallText.name, toolCallText.args].filter(Boolean).join(' ')
  return {
    displayText,
    listDisplayText,
    resultText,
    toolCallOnly,
    toolCallText,
  }
}

function RecordListText({
  displayText,
  toolCallOnly,
  toolCallText,
}: Pick<RecordPresentationValue, 'displayText' | 'toolCallOnly' | 'toolCallText'>): VNode | string {
  if (toolCallOnly) {
    return <span class={css.toolCallOnly ?? ''}>(tool call only)</span>
  }
  if (toolCallText === undefined) return displayText || '—'
  return [
    <span class={css.toolCallNameTypeface ?? ''}>
      {toolCallText.name || '—'}
    </span>,
    toolCallText.args !== undefined
      ? (
        <span class={css.toolCallPayload ?? ''}>
          {toolCallText.args}
        </span>
      )
      : null,
  ] as unknown as VNode
}

function MarkdownFragment({
  text,
  rendered,
  preview,
}: {
  text: string
  rendered: boolean
  preview: boolean
}): JSX.Element {
  if (rendered) {
    return (
      <div class={(preview ? css.markdownPreview : css.markdownPayload) ?? ''}>
        <MarkdownText text={text} />
      </div>
    )
  }
  return (
    <pre class={`${css.payload ?? ''} ${preview ? css.payloadPreview ?? '' : ''}`}>
      {text}
    </pre>
  )
}

function SourceBlocks({
  blocks,
  onOpenCall,
}: {
  blocks: readonly TrajectorySourceBlock[]
  onOpenCall: (callId: string) => void
}): JSX.Element {
  return (
    <div class={css.sourceBlocks ?? ''}>
      {blocks.map((block, index) => (
        <section class={css.sourceBlock ?? ''} key={index}>
          {block.callId !== undefined
            ? (
              <button
                type="button"
                class={css.sourceBlockJumpTarget ?? ''}
                aria-label={`Open Block #${index + 1} tool call summary`}
                title="Open tool call summary"
                onclick={() => {
                  if (block.callId !== undefined) onOpenCall(block.callId)
                }}
              >
                <span class={css.sourceBlockLabel ?? ''}>
                  {`Block #${index + 1} ${block.type}`}
                </span>
                <IconChevronRightOutline14 className={css.sourceBlockJumpIcon} size={12} />
              </button>
            )
            : (
              <div class={css.sourceBlockHeader ?? ''}>
                <span class={css.sourceBlockLabel ?? ''}>
                  {`Block #${index + 1} ${block.type}`}
                </span>
              </div>
            )}
          {block.imageSrc !== undefined
            ? <PanelImage block={block} />
            : <pre class={css.sourceBlockContent ?? ''}>{block.content}</pre>}
        </section>
      ))}
    </div>
  )
}

function PanelImage({
  block,
  preview = false,
}: {
  block: TrajectorySourceBlock
  preview?: boolean
}): JSX.Element | null {
  if (block.imageSrc === undefined) return null
  return (
    <a
      class={(preview ? `${css.panelImageLink ?? ''} ${css.panelImageLinkPreview ?? ''}` : css.panelImageLink) ?? ''}
      href={block.imageSrc}
      target="_blank"
      rel="noopener noreferrer"
      title="Open image"
    >
      <img
        class={css.panelImage ?? ''}
        src={block.imageSrc}
        alt={block.imageAlt ?? ''}
      />
    </a>
  )
}

function MessageImages({
  blocks,
  preview,
}: {
  blocks: readonly TrajectorySourceBlock[] | undefined
  preview: boolean
}): JSX.Element | null {
  const images = blocks?.filter(block => block.imageSrc !== undefined) ?? []
  if (images.length === 0) return null
  return (
    <div class={(preview ? `${css.messageImages ?? ''} ${css.messageImagesPreview ?? ''}` : css.messageImages) ?? ''}>
      {images.map((block, index) => <PanelImage block={block} preview={preview} key={index} />)}
    </div>
  )
}

function AssistantToolCalls({
  blocks,
  preview,
  onOpenCall,
}: {
  blocks: readonly TrajectorySourceBlock[] | undefined
  preview: boolean
  onOpenCall: (callId: string) => void
}): JSX.Element | null {
  const calls = blocks?.filter(block => block.type === 'tool-call') ?? []
  if (calls.length === 0) return null
  return (
    <ul class={(preview
      ? `${css.assistantToolCalls ?? ''} ${css.assistantToolCallsPreview ?? ''}`
      : css.assistantToolCalls) ?? ''}
    >
      {calls.map((call, index) => (
        <li key={call.callId ?? index}>
          <button
            type="button"
            class={css.assistantToolCallButton ?? ''}
            title="Open tool call summary"
            onclick={() => {
              if (call.callId !== undefined) onOpenCall(call.callId)
            }}
          >
            <svg
              class={css.assistantToolCallIcon ?? ''}
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
            <span class={css.assistantToolCallText ?? ''}>
              <span class={css.assistantToolCallName ?? ''}>
                {call.toolName ?? 'tool-call'}
              </span>
              {call.content !== '' && (
                <span class={css.assistantToolCallArgs ?? ''}>{call.content}</span>
              )}
            </span>
          </button>
        </li>
      ))}
    </ul>
  )
}

function ToolGlyph(): JSX.Element {
  return (
    <svg
      class={css.toolCatalogIcon ?? ''}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94z"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  )
}

function ToolCatalog({ tools }: { tools: ConversationPromptSnapshot['tools'] }): JSX.Element {
  if (tools.length === 0) return <p class={css.noPayload ?? ''}>No tools in this request</p>
  return (
    <div class={css.toolCatalog ?? ''}>
      {tools.map((tool, index) => (
        <details class={css.toolCatalogItem ?? ''} key={`${tool.name}:${index}`}>
          <summary class={css.toolCatalogSummary ?? ''}>
            <IconChevronRightOutline14 className={css.toolCatalogChevron} size={12} />
            <ToolGlyph />
            <span class={css.toolCatalogName ?? ''}>{tool.name}</span>
            <span class={css.toolCatalogDescription ?? ''}>{tool.description}</span>
          </summary>
          <div class={css.toolCatalogDefinition ?? ''}>
            {tool.description !== '' && (
              <p class={css.toolCatalogFullDescription ?? ''}>{tool.description}</p>
            )}
            <JsonTree
              data={tool.parameters}
              label={`${tool.name} parameters JSON`}
              className={css.toolCatalogTree}
            /> as unknown as VNode
          </div>
        </details>
      ))}
    </div>
  )
}

interface PromptDiffLine {
  kind: 'meta' | 'context' | 'added' | 'removed'
  text: string
}

function promptDiffLines(before: string, after: string): readonly PromptDiffLine[] {
  const patch = structuredPatch('', '', before, after, undefined, undefined, { context: 3 })
  return patch.hunks.flatMap((hunk, hunkIndex) => [
    ...(hunkIndex === 0 ? [] : [{ kind: 'meta' as const, text: '' }]),
    {
      kind: 'meta' as const,
      text: `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
    },
    ...hunk.lines.flatMap((line): PromptDiffLine[] => {
      if (line.startsWith('\\')) return []
      if (line.startsWith('+')) return [{ kind: 'added', text: line }]
      if (line.startsWith('-')) return [{ kind: 'removed', text: line }]
      return [{ kind: 'context', text: line }]
    }),
  ])
}

function PromptDiffSection({
  title,
  before,
  after,
}: {
  title: string
  before: string
  after: string
}): JSX.Element | null {
  const lines = promptDiffLines(before, after)
  if (lines.length === 0) return null
  return (
    <section class={css.promptDiffSection ?? ''}>
      <h3 class={css.promptDiffTitle ?? ''}>{title}</h3>
      <pre class={css.promptDiff ?? ''}>
        {lines.map((line, index) => (
          <span class={css[`promptDiffLine${line.kind}`] ?? ''} key={index}>
            {line.text || ' '}
            {'\n'}
          </span>
        ))}
      </pre>
    </section>
  )
}

function SystemPromptDiff({
  before,
  after,
}: {
  before: ConversationPromptSnapshot
  after: ConversationPromptSnapshot
}): JSX.Element {
  const toolsBefore = JSON.stringify(before.tools, null, 2)
  const toolsAfter = JSON.stringify(after.tools, null, 2)
  return (
    <div class={css.promptDiffSections ?? ''}>
      {before.system !== after.system && (
        <PromptDiffSection
          title="System Prompt"
          before={before.system}
          after={after.system}
        />
      )}
      {toolsBefore !== toolsAfter && (
        <PromptDiffSection
          title="Tools"
          before={toolsBefore}
          after={toolsAfter}
        />
      )}
    </div>
  )
}

function ToolOutputBlocks({
  blocks,
  error,
  preview,
}: {
  blocks: readonly TrajectorySourceBlock[]
  error: boolean
  preview: boolean
}): JSX.Element {
  return (
    <div class={[
      css.resultBlocks,
      preview ? css.resultBlocksPreview : undefined,
      error ? css.errorPayload : undefined,
    ].filter((value): value is string => value !== undefined).join(' ')}
    >
      {blocks.map((block, index) => (
        block.imageSrc !== undefined
          ? <PanelImage block={block} preview={preview} key={index} />
          : block.content !== ''
            ? <pre class={css.resultBlockText ?? ''} key={index}>{block.content}</pre>
            : null
      ))}
    </div>
  )
}

function MarkdownRecordContent({
  record,
  rendered,
  preview = false,
  thinkingExpanded,
  onThinkingExpandedChange,
  onOpenCall,
}: {
  record: TableRecord
  rendered: boolean
  preview?: boolean
  thinkingExpanded: boolean
  onThinkingExpandedChange: (expanded: boolean) => void
  onOpenCall: (callId: string) => void
}): JSX.Element {
  if (!rendered && record.cell.sourceBlocks && record.cell.sourceBlocks.length > 0) {
    return <SourceBlocks blocks={record.cell.sourceBlocks} onOpenCall={onOpenCall} />
  }
  if (record.cell.thinkingDetail) {
    if (!rendered) {
      const source = [
        record.cell.thinkingDetail,
        record.cell.outputDetail,
      ].filter((value): value is string => value !== undefined && value !== '').join('\n\n')
      return <MarkdownFragment text={source} rendered={false} preview={preview} />
    }
    return (
      <div class={`${css.assistantContent ?? ''} ${css.assistantContentRendered ?? ''}`}>
        <div class={
          (preview && !record.cell.outputDetail
            ? `${css.thinkingQuote ?? ''} ${css.thinkingQuoteOnlyPreview ?? ''}`
            : css.thinkingQuote) ?? ''
        }
        >
          <button
            type="button"
            class={css.thinkingToggle ?? ''}
            aria-expanded={thinkingExpanded}
            onclick={() => { onThinkingExpandedChange(!thinkingExpanded) }}
          >
            Thinking
            <IconChevronRightOutline14 className={css.thinkingChevron} size={12} />
          </button>
          {thinkingExpanded && (
            <MarkdownFragment
              text={record.cell.thinkingDetail}
              rendered={rendered}
              preview={preview}
            />
          )}
        </div>
        {record.cell.outputDetail && (
          <div class={css.assistantOutput ?? ''}>
            <MarkdownFragment
              text={record.cell.outputDetail}
              rendered={rendered}
              preview={preview}
            />
          </div>
        )}
        <AssistantToolCalls
          blocks={record.cell.sourceBlocks}
          preview={preview}
          onOpenCall={onOpenCall}
        />
        <MessageImages
          blocks={record.cell.sourceBlocks}
          preview={preview}
        />
      </div>
    )
  }
  const source = markdownSource(record)
  const hasImages = record.cell.sourceBlocks?.some(block => block.imageSrc !== undefined) === true
  const hasToolCalls = record.cell.kind === 'message'
    && record.cell.sourceBlocks?.some(block => block.type === 'tool-call') === true
  if (!source && !hasImages && !hasToolCalls) {
    const emptyLabel = isToolCallOnly(record.cell)
      ? 'Tool call only'
      : record.cell.text || 'No content'
    return <p class={css.noPayload ?? ''}>{emptyLabel}</p>
  }
  if (!rendered || (!hasImages && !hasToolCalls)) {
    return <MarkdownFragment text={source ?? ''} rendered={rendered} preview={preview} />
  }
  return (
    <div>
      {source && <MarkdownFragment text={source} rendered preview={preview} />}
      {record.cell.kind === 'message' && (
        <AssistantToolCalls
          blocks={record.cell.sourceBlocks}
          preview={preview}
          onOpenCall={onOpenCall}
        />
      )}
      <MessageImages blocks={record.cell.sourceBlocks} preview={preview} />
    </div>
  )
}

function RecordTiming({
  record,
  showUnix,
  onToggleUnix,
}: {
  record: TableRecord
  showUnix: boolean
  onToggleUnix: () => void
}): JSX.Element {
  return record.cell.kind === 'message' && record.cell.assistantMetrics !== undefined
    ? <AssistantTimingPanel metrics={record.cell.assistantMetrics} showUnix={showUnix} onToggleUnix={onToggleUnix} />
    : (
      <dl class={css.overview ?? ''}>
        <div><dt>Started</dt><StartedAtValue timestamp={record.cell.startedAt ?? null} showUnix={showUnix} onToggle={onToggleUnix} /></div>
        <div><dt>Duration</dt><dd>{formatElapsedSeconds(record.cell.timeSeconds)}</dd></div>
        <div><dt>Timing source</dt><dd>{record.cell.timeSeconds === null ? 'Not available' : 'Session timestamps'}</dd></div>
      </dl>
    )
}

function RequestTiming({
  assistant,
  anchor,
  request,
  showUnix,
  onToggleUnix,
}: {
  assistant: TableRecord | undefined
  anchor: TableRecord | undefined
  request: TrajectoryRequestNumber | undefined
  showUnix: boolean
  onToggleUnix: () => void
}): JSX.Element {
  if (assistant !== undefined) return <RecordTiming record={assistant} showUnix={showUnix} onToggleUnix={onToggleUnix} />
  if (request?.startedAt !== undefined) {
    const duration = request.completedAt === null || request.completedAt === undefined
      ? null
      : Math.max(0, (request.completedAt - request.startedAt) / 1000)
    return (
      <dl class={css.overview ?? ''}>
        <div><dt>Started</dt><StartedAtValue timestamp={request.startedAt} showUnix={showUnix} onToggle={onToggleUnix} /></div>
        <div><dt>Duration</dt><dd>{formatElapsedSeconds(duration)}</dd></div>
        <div>
          <dt>Timing source</dt>
          <dd>{duration === null ? 'Session timestamps (running)' : 'Session timestamps'}</dd>
        </div>
      </dl>
    )
  }
  return (
    <dl class={css.overview ?? ''}>
      <div>
        <dt>Started</dt>
        <StartedAtValue timestamp={anchor?.cell.startedAt ?? null} showUnix={showUnix} onToggle={onToggleUnix} />
      </div>
      <div><dt>Duration</dt><dd>{formatElapsedSeconds(null)}</dd></div>
    </dl>
  )
}

function RecordPayload({
  record,
  direction,
  preview = false,
}: {
  record: TableRecord
  direction: 'input' | 'output'
  preview?: boolean
}): JSX.Element {
  const value = direction === 'input' ? record.cell.inputDetail : record.cell.outputDetail
  const missing = direction === 'input'
    ? 'No payload captured'
    : 'No result captured'
  if (!value) return <p class={css.noPayload ?? ''}>{missing}</p>
  const error = direction === 'output' && record.cell.isError === true
  const payloadClass = preview ? css.jsonPreview : css.jsonPayload
  const payloadClassName = error ? `${payloadClass ?? ''} ${css.errorPayload ?? ''}` : payloadClass

  const json = parseJsonContainer(value)
  const singleTextResult = direction === 'output'
    && record.cell.outputBlocks?.length === 1
    && record.cell.outputBlocks[0]?.type === 'text'
  if (singleTextResult && json !== undefined) {
    return (
      <JsonTree
        data={json}
        label="Result JSON"
        className={payloadClassName}
      /> as unknown as JSX.Element
    )
  }

  if (
    direction === 'output'
    && record.cell.outputBlocks?.some(block =>
      block.imageSrc !== undefined || block.content !== '') === true
  ) {
    return (
      <ToolOutputBlocks
        blocks={record.cell.outputBlocks}
        error={error}
        preview={preview}
      />
    )
  }

  const markdown = (
    direction === 'input'
    && (record.cell.kind === 'user' || record.cell.kind === 'context')
  ) || (
    direction === 'output' && record.cell.kind === 'message'
  )
  if (markdown) {
    return (
      <div class={[
        preview ? css.markdownPreview : css.markdownPayload,
        error ? css.errorPayload : undefined,
      ].filter((className): className is string => className !== undefined).join(' ')}
      >
        <MarkdownText text={value} />
      </div>
    )
  }
  if (json !== undefined) {
    return (
      <JsonTree
        data={json}
        label={`${direction === 'input' ? 'Payload' : 'Result'} JSON`}
        className={payloadClassName}
      /> as unknown as JSX.Element
    )
  }
  return (
    <pre class={[
      css.payload,
      preview ? css.payloadPreview : undefined,
      error ? css.errorPayload : undefined,
      value === 'No output' ? css.noOutputText : undefined,
    ].filter((value): value is string => value !== undefined).join(' ')}
    >
      {value}
    </pre>
  )
}

function RecordSchema({
  record,
  preview = false,
}: {
  record: TableRecord
  preview?: boolean
}): JSX.Element {
  if (!record.cell.schemaDetail) {
    return <p class={css.noPayload ?? ''}>Schema unavailable</p>
  }
  const schema = parseToolSchema(record.cell.schemaDetail)
  if (schema !== undefined) {
    return (
      <div class={(preview ? `${css.schema ?? ''} ${css.schemaPreview ?? ''}` : css.schema) ?? ''}>
        <header class={css.schemaIntro ?? ''}>
          <h3 class={css.schemaName ?? ''}>{schema.name}</h3>
          <p class={css.schemaDescription ?? ''}>{schema.description}</p>
        </header>
        <section class={css.schemaParameters ?? ''}>
          <h4 class={css.schemaParametersTitle ?? ''}>Parameters</h4>
          <JsonTree
            data={schema.parameters}
            label={`${schema.name} parameters JSON`}
            className={css.schemaTree}
          /> as unknown as VNode
        </section>
      </div>
    )
  }
  return (
    <pre class={`${css.payload ?? ''} ${preview ? css.payloadPreview ?? '' : ''}`}>
      {record.cell.schemaDetail}
    </pre>
  )
}

interface ParsedToolSchema {
  name: string
  description: string
  parameters: object
}

function parseToolSchema(value: string): ParsedToolSchema | undefined {
  try {
    const parsed: unknown = JSON.parse(value)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const schema = parsed as Record<string, unknown>
    if (
      typeof schema.name !== 'string'
      || typeof schema.description !== 'string'
      || typeof schema.parameters !== 'object'
      || schema.parameters === null
      || Array.isArray(schema.parameters)
    ) return undefined
    return {
      name: schema.name,
      description: schema.description,
      parameters: schema.parameters,
    }
  } catch {
    return undefined
  }
}

function parseJsonContainer(value: string): object | undefined {
  try {
    const parsed: unknown = JSON.parse(value)
    return typeof parsed === 'object' && parsed !== null ? parsed : undefined
  } catch {
    return undefined
  }
}

function OverviewSection({
  label,
  onOpen,
  children,
}: {
  label: string
  onOpen: () => void
  children: VNode | VNode[] | string | null
}): JSX.Element {
  return (
    <section class={css.overviewSection ?? ''}>
      <h3 class={css.overviewHeading ?? ''}>
        <button
          type="button"
          class={css.overviewTitle ?? ''}
          onclick={onOpen}
        >
          <span>{label}</span>
          <IconChevronRightOutline14 className={css.overviewTitleIcon} size={12} />
        </button>
      </h3>
      <div
        class={`${css.overviewPreview ?? ''} ${css.summaryScrollRegion ?? ''}`}
        data-summary-scroll-region=""
      >
        {children}
      </div>
    </section>
  )
}

interface VirtualState {
  virtualizer: Virtualizer<HTMLDivElement, HTMLTableRowElement> | null
  cleanup: (() => void) | null
  structureCache: { rows: readonly TrajectoryVirtualRow<TableRecord>[]; structure: readonly VirtualRowStructure[] }
}

/**
 * Render trajectory events as a dense ledger with turn and step separators.
 * Clicking ledger whitespace clears the active record or request selection.
 * A stateful HTMLElement custom element: virtualizer lifecycle, local
 * inspector selection, resize-drag, and scroll-follow state all live as
 * private fields, re-rendered through an explicit `applyDiff` call.
 */
export class DshTrajectoryTable extends HTMLElement {
  #props: TrajectoryTableProps = {
    turns: [], collapsedTurns: new Set(), onToggleTurn: () => {},
    collapsedAssistants: new Set(), onToggleAssistant: () => {},
  }

  #selectedRecordId: string | null = null
  #selectedRequest: SelectedRequest | null = null
  #activeTab: DetailTab = 'overview'
  #thinkingExpanded = false
  #detailsWidth: number | null = null
  #toolRequestOffset: number | null = null
  #detailsResizeDrag: DetailsResizeDrag | null = null
  #appliedRecordSelection: TrajectoryTableProps['recordSelection'] = null
  #appliedRecordFocus: TrajectoryTableProps['recordFocus'] = null
  #tabHistory = new Set<DetailTab>(['overview'])
  #followsTableTail = false
  #tableScrollInitialized = false
  #tableScrollReady = false
  #pendingScrollRecordId: string | null = null
  #loadingOlder = false
  #olderLoading = false
  #olderLoadAnchor: OlderLoadAnchor | null = null
  #showUnix = false

  #tablePaneEl: HTMLDivElement | null = null
  #virtual: VirtualState = { virtualizer: null, cleanup: null, structureCache: { rows: [], structure: [] } }
  #resizeObserver: ResizeObserver | null = null

  setProps(props: TrajectoryTableProps): void {
    this.#props = props
    this.#syncInspectRequest()
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  disconnectedCallback(): void {
    this.#destroyVirtualizer()
    if (this.#resizeObserver !== null) {
      this.#resizeObserver.disconnect()
      this.#resizeObserver = null
    }
  }

  #destroyVirtualizer(): void {
    this.#virtual.cleanup?.()
    this.#virtual.cleanup = null
    this.#virtual.virtualizer = null
  }

  #allRecords(): TableRecord[] {
    return flattenRecords(this.#props.turns)
  }

  #streamingCellsByIndex(): Map<number, TrajectoryCellProps> {
    return new Map((this.#props.streamingCells ?? []).map(cell => [cell.index, cell]))
  }

  #currentRecord(record: TableRecord, byIndex: Map<number, TrajectoryCellProps>): TableRecord {
    const cell = byIndex.get(record.cell.index)
    return cell === undefined ? record : { ...record, cell }
  }

  #records(allRecords: TableRecord[]): TableRecord[] {
    const { searchMatchIndexes = null, collapsedTurns, collapsedAssistants } = this.#props
    if (searchMatchIndexes !== null) return filterRecords(allRecords, searchMatchIndexes)
    const turnRecords = collapsedTurns.size === 0
      ? allRecords
      : collapseTurnRecords(allRecords, collapsedTurns)
    return collapsedAssistants.size === 0
      ? turnRecords
      : collapseAssistantRecords(turnRecords, collapsedAssistants)
  }

  #activateTab(tab: DetailTab): void {
    this.#tabHistory.delete(tab)
    this.#tabHistory.add(tab)
    this.#activeTab = tab
    this.#render()
  }

  #clearInspectorSelection(): void {
    this.#selectedRecordId = null
    this.#selectedRequest = null
    this.#render()
  }

  #clearAllSelections(): void {
    this.#selectedRecordId = null
    this.#selectedRequest = null
    this.#props.onClearSelection?.()
    this.#render()
  }

  #selectRecord(index: number): void {
    const allRecords = this.#allRecords()
    const record = allRecords.find(candidate => candidate.cell.index === index)
    this.#props.onRecordSelect?.(index)
    this.#selectedRequest = null
    this.#selectedRecordId = record === undefined ? null : trajectoryRecordId(record.cell)
    if (record !== undefined) {
      const tabs = detailTabs(record)
      const available = new Set(tabs.map(tab => tab.id))
      const recent = [...this.#tabHistory].reverse().find(tab => available.has(tab))
      this.#activeTab = recent ?? tabs[0]?.id ?? 'overview'
    }
    this.#render()
  }

  #selectRequest(request: SelectedRequest, tab: 'overview' | 'timing' = 'overview'): void {
    this.#selectedRecordId = null
    this.#selectedRequest = request
    this.#activateTab(tab)
  }

  #openRecordSummary(target: TableRecord): void {
    const { collapsedTurns, onToggleTurn, collapsedAssistants, onToggleAssistant } = this.#props
    const allRecords = this.#allRecords()
    const targetAt = allRecords.findIndex(record => record.cell.index === target.cell.index)
    if (target.turn !== null && collapsedTurns.has(target.turn)) onToggleTurn(target.turn)
    if (target.cell.kind === 'tool' || target.cell.kind === 'subtool') {
      for (let i = targetAt - 1; i >= 0; i--) {
        const candidate = allRecords[i]
        if (candidate === undefined || candidate.turn !== target.turn) break
        if (candidate.cell.kind !== 'message') continue
        const assistantId = trajectoryRecordId(candidate.cell)
        if (collapsedAssistants.has(assistantId)) onToggleAssistant(assistantId)
        break
      }
    }
    this.#selectedRequest = null
    this.#selectedRecordId = trajectoryRecordId(target.cell)
    this.#activateTab('overview')
  }

  #openCallSummary(callId: string): void {
    const target = this.#allRecords().find(record => record.cell.callId === callId)
    if (target !== undefined) this.#openRecordSummary(target)
  }

  /** Cross-view inspect handoff: resolve requested call to its record, open
   * its summary, remember the row to scroll once rendered. Runs once per
   * distinct `inspectCallId` (mirrors the React version's effect + ref ack). */
  #syncInspectRequest(): void {
    const { inspectCallId = null, onInspectApplied, recordSelection = null, recordFocus = null } = this.#props
    if (inspectCallId !== null) {
      const target = flattenRecords(this.#props.turns).find(record => record.cell.callId === inspectCallId)
      if (target !== undefined) {
        this.#openRecordSummary(target)
        this.#pendingScrollRecordId = trajectoryRecordId(target.cell)
        onInspectApplied?.()
      }
    }
    if (recordSelection !== null && this.#appliedRecordSelection !== recordSelection) {
      this.#appliedRecordSelection = recordSelection
      this.#selectRecord(recordSelection.index)
      const record = this.#allRecords().find(candidate => candidate.cell.index === recordSelection.index)
      this.#pendingScrollRecordId = record === undefined ? null : trajectoryRecordId(record.cell)
    }
    if (recordFocus !== null && this.#appliedRecordFocus !== recordFocus) {
      this.#appliedRecordFocus = recordFocus
      const record = this.#allRecords().find(candidate => candidate.cell.index === recordFocus.index)
      this.#pendingScrollRecordId = record === undefined ? null : trajectoryRecordId(record.cell)
    }
  }

  #requestOlder(pane: HTMLDivElement, requireTop: boolean): void {
    const { hasOlderRecords = false, onLoadOlder, olderHistoryLoading = false, historyStartSeq } = this.#props
    if (
      !hasOlderRecords
      || onLoadOlder === undefined
      || this.#loadingOlder
      || olderHistoryLoading
      || (requireTop && pane.scrollTop > OLDER_LOAD_THRESHOLD_PX)
    ) return
    this.#loadingOlder = true
    this.#olderLoading = true
    this.#olderLoadAnchor = {
      historyStartSeq,
      scrollHeight: pane.scrollHeight,
      scrollTop: pane.scrollTop,
    }
    this.#render()
    void onLoadOlder().then((advanced) => {
      if (!advanced) this.#olderLoadAnchor = null
    }).finally(() => {
      this.#loadingOlder = false
      this.#olderLoading = false
      this.#render()
    })
  }

  #ensureVirtualizer(
    virtualizationEnabled: boolean,
    count: number,
    estimateSize: (index: number) => number,
    getItemKey: (index: number) => string | number,
    scrollMargin: number,
  ): Virtualizer<HTMLDivElement, HTMLTableRowElement> | null {
    const pane = this.#tablePaneEl
    if (pane === null) return null
    const options: VirtualizerOptions<HTMLDivElement, HTMLTableRowElement> = {
      count: virtualizationEnabled ? count : 0,
      enabled: virtualizationEnabled,
      estimateSize,
      getItemKey,
      getScrollElement: () => this.#tablePaneEl,
      scrollToFn: (offset, scrollOptions, instance) => {
        const target = instance.scrollElement
        if (target === null) return
        target.scrollTo(
          scrollOptions.behavior === undefined
            ? { top: offset }
            : { top: offset, behavior: scrollOptions.behavior },
        )
      },
      observeElementRect: (instance, cb) => {
        const element = instance.scrollElement
        if (element === null) return undefined
        const notify = () => cb({ width: element.clientWidth, height: element.clientHeight })
        notify()
        const observer = new ResizeObserver(notify)
        observer.observe(element)
        return () => { observer.disconnect() }
      },
      observeElementOffset: (instance, cb) => {
        const element = instance.scrollElement
        if (element === null) return undefined
        const notify = () => { cb(element.scrollTop, false) }
        notify()
        element.addEventListener('scroll', notify, { passive: true })
        return () => { element.removeEventListener('scroll', notify) }
      },
      initialRect: { width: 0, height: VIRTUAL_INITIAL_VIEWPORT_HEIGHT_PX },
      anchorTo: 'end',
      overscan: VIRTUAL_OVERSCAN_ROWS,
      scrollMargin,
      scrollEndThreshold: BOTTOM_FOLLOW_THRESHOLD_PX,
    }
    if (this.#virtual.virtualizer === null) {
      const virtualizer = new Virtualizer(options)
      const cleanup = virtualizer._didMount()
      virtualizer.setOptions({
        ...options,
        onChange: () => { this.#render() },
      })
      virtualizer._willUpdate()
      virtualizer.measure()
      this.#virtual.virtualizer = virtualizer
      this.#virtual.cleanup = cleanup
    } else {
      this.#virtual.virtualizer.setOptions({
        ...options,
        onChange: () => { this.#render() },
      })
      this.#virtual.virtualizer._willUpdate()
    }
    return this.#virtual.virtualizer
  }

  #render(): void {
    const {
      requestNumbers: sessionRequestNumbers,
      timelineFocusIndexes = null,
      onSelectedIndexChange,
      historyLoading = false,
      olderHistoryLoading = false,
      hasOlderRecords = false,
      onLoadOlder,
      collapsedTurns,
      onToggleTurn,
      onToggleAssistant,
    } = this.#props

    const allRecords = this.#allRecords()
    const streamingCellsByIndex = this.#streamingCellsByIndex()
    const currentRecord = (record: TableRecord) => this.#currentRecord(record, streamingCellsByIndex)
    const selectedTemplate = this.#selectedRecordId === null
      ? undefined
      : allRecords.find(record => trajectoryRecordId(record.cell) === this.#selectedRecordId)
    const selected = selectedTemplate === undefined ? undefined : currentRecord(selectedTemplate)
    const selectedIndex = selected?.cell.index ?? null
    onSelectedIndexChange?.(selectedIndex)

    const requestBoundaries = indexRequestBoundaries(allRecords)
    const requestNumbers = indexRequestNumbers(allRecords, sessionRequestNumbers, requestBoundaries)
    const records = this.#records(allRecords)
    const projectedVirtualRows = groupTrajectoryVirtualRows(records)
    const virtualRowStructure = stableVirtualRowStructure(projectedVirtualRows, this.#virtual.structureCache)
    const virtualizationEnabled = hasOlderRecords || records.length > VIRTUALIZATION_THRESHOLD
    const virtualScrollMargin = hasOlderRecords ? HISTORY_LOAD_ROW_HEIGHT_PX : 0
    const estimateVirtualRowSize = (index: number) => virtualRowStructure[index]?.height ?? 30
    const getVirtualRowKey = (index: number) => virtualRowStructure[index]?.key ?? index

    let rowVirtualizer: Virtualizer<HTMLDivElement, HTMLTableRowElement> | null = null
    if (virtualizationEnabled) {
      rowVirtualizer = this.#ensureVirtualizer(
        true, virtualRowStructure.length, estimateVirtualRowSize, getVirtualRowKey, virtualScrollMargin,
      )
    } else if (this.#virtual.virtualizer !== null) {
      this.#destroyVirtualizer()
    }

    const virtualIndexByRecordId = new Map<string, number>()
    for (const [virtualIndex, row] of projectedVirtualRows.entries()) {
      for (const entry of row.entries) {
        if (entry.record.collapsedSummary === undefined) {
          virtualIndexByRecordId.set(trajectoryRecordId(entry.record.cell), virtualIndex)
        }
      }
    }

    const virtualItems = rowVirtualizer !== null ? rowVirtualizer.getVirtualItems() : []
    const virtualTop = Math.max(0, (virtualItems[0]?.start ?? 0) - virtualScrollMargin)
    const virtualBottom = virtualItems.length === 0 || rowVirtualizer === null
      ? 0
      : Math.max(
        0,
        rowVirtualizer.getTotalSize()
          + virtualScrollMargin
          - (virtualItems.at(-1)?.end ?? 0),
      )
    const renderedRecords = virtualizationEnabled
      ? virtualItems.flatMap((item) => {
        const row = projectedVirtualRows[item.index]
        if (row === undefined) return []
        return row.entries.map((entry, entryIndex) => ({
          record: currentRecord(entry.record),
          position: entry.logicalIndex,
          terminalRequestBoundary:
            entry.record.cell.requestOnly === true
            && row.entries.at(-1)?.record.cell.requestOnly === true
            && entryIndex === row.entries.length - 1,
        }))
      })
      : records.map((record, position) => ({
        record: currentRecord(record),
        position,
        terminalRequestBoundary:
          record.cell.requestOnly === true && position === records.length - 1,
      }))
    const requestBoundaryRuns = indexRequestBoundaryRuns(records)
    const selectedPrompt = selected?.cell.kind === 'system' ? selected.cell.promptDetail : undefined
    const selectedPreviousPrompt = selected?.cell.kind === 'system' ? selected.cell.previousPromptDetail : undefined
    const promptSelected = selectedPrompt !== undefined
    const selectedState = selected === undefined ? undefined : stateOf(selected)
    const selectedRequest = this.#selectedRequest
    const selectedRequestRecordTemplates = selectedRequest === null
      ? []
      : allRecords.filter(record =>
        record.turn === selectedRequest.turn && record.group === selectedRequest.group)
    const selectedRequestRecords = selectedRequestRecordTemplates.map(currentRecord)
    const selectedRequestAssistant = selectedRequestRecords.find(record => record.cell.kind === 'message')
    const selectedRequestAnchor = selectedRequestAssistant ?? selectedRequestRecords[0]
    const selectedRequestNumber = selectedRequest === null
      ? undefined
      : requestNumbers.get(requestKey(selectedRequest.turn, selectedRequest.group))
    const selectedRequestInfo = selectedRequest === null
      ? undefined
      : sessionRequestNumbers?.find(request => selectedRequest.seq === undefined
        ? request.turn === selectedRequest.turn && request.group === selectedRequest.group
        : request.seq === selectedRequest.seq)
    const selectedRequestState: RecordState | undefined = selectedRequest === null
      ? undefined
      : selectedRequestInfo?.status
        ?? (selectedRequestAssistant?.cell.assistantMetrics?.completedTime === null
          ? 'running'
          : selectedRequestAssistant === undefined
            && selectedRequestRecords.some(record => stateOf(record) === 'running')
            ? 'running'
            : 'complete')
    const selectedRequestToolCalls = selectedRequestRecords.filter(record => record.cell.kind === 'tool').length
    const selectedRequestSubtoolCalls = selectedRequestRecords.filter(record => record.cell.kind === 'subtool').length
    const selectedRequestResultTemplate = selectedRequestInfo?.resultSeq === undefined
      ? selectedRequestAssistant
      : allRecords.find(record => record.cell.sourceSeq === selectedRequestInfo.resultSeq)
    const selectedRequestResult = selectedRequestResultTemplate === undefined
      ? undefined
      : currentRecord(selectedRequestResultTemplate)
    const selectedRequestUsage = selectedRequestInfo?.usage ?? (
      selectedRequestAssistant === undefined
        ? undefined
        : {
          ...(selectedRequestAssistant.cell.input === undefined ? {} : { input: selectedRequestAssistant.cell.input }),
          ...(selectedRequestAssistant.cell.cacheRead === undefined ? {} : { cacheRead: selectedRequestAssistant.cell.cacheRead }),
          ...(selectedRequestAssistant.cell.cacheWrite === undefined ? {} : { cacheWrite: selectedRequestAssistant.cell.cacheWrite }),
          ...(selectedRequestAssistant.cell.output === undefined ? {} : { output: selectedRequestAssistant.cell.output }),
          ...(selectedRequestAssistant.cell.think === undefined ? {} : { reasoning: selectedRequestAssistant.cell.think }),
        }
    )
    const selectedRequestCumulativeUsage = selectedRequestInfo?.cumulativeUsage ?? selectedRequestUsage
    const selectedRequestOptions = selectedRequestInfo?.requestConfig
    const activeTurn = selectedRequest === null ? selected?.turn : selectedRequest.turn
    const activeSection = selectedRequest === null ? selected?.section : selectedRequestRecords[0]?.section
    const selectedTabs = selectedRequest !== null
      ? REQUEST_TABS.filter(tab => tab.id !== 'options' || selectedRequestOptions !== undefined)
      : selected === undefined ? [] : detailTabs(selected)
    const selectedParents: ParentRecords = selected === undefined ? {} : parentRecords(allRecords, selected)
    const selectedParentMessage = selectedParents.message
    const selectedParentTool = selectedParents.tool
    const selectedAssistantRequest = selected?.cell.kind === 'message'
      ? requestNumbers.get(requestKey(selected.turn, selected.group))
      : undefined
    const selectedAssistantRequestInfo = selectedAssistantRequest === undefined
      ? undefined
      : sessionRequestNumbers?.find(request => request.number === selectedAssistantRequest)
    const selectedAssistantRequestTarget: SelectedRequest | undefined =
      selected !== undefined && selectedAssistantRequest !== undefined
        ? {
          turn: selected.turn,
          group: selected.group,
          ...(selectedAssistantRequestInfo?.seq === undefined ? {} : { seq: selectedAssistantRequestInfo.seq }),
        }
        : undefined
    const hasSelectedHierarchy = selectedAssistantRequestTarget !== undefined
      || selectedParents.message !== undefined
      || selectedParents.tool !== undefined
    const splitStyle = this.#toolRequestOffset === null
      ? ''
      : `--trajectory-tool-request-width: calc(58cqw - ${this.#toolRequestOffset}px)`

    const toggleUnix = () => { this.#showUnix = !this.#showUnix; this.#render() }

    // Scroll-to-record and timeline-focus effects (post-render, DOM-dependent)
    queueMicrotask(() => {
      this.#applyPendingScroll(records, virtualizationEnabled, virtualIndexByRecordId, rowVirtualizer)
      this.#applyTimelineFocus(
        records, projectedVirtualRows, virtualizationEnabled, virtualIndexByRecordId, rowVirtualizer, timelineFocusIndexes,
      )
      this.#syncScrollInit(historyLoading, virtualizationEnabled, rowVirtualizer)
    })

    const olderBusy = olderHistoryLoading || this.#olderLoading
    const showInitialLoading = historyLoading || !this.#tableScrollReady
    const historyRowOffset = hasOlderRecords ? 1 : 0

    const vdom: VNode = (
      <div class={css.split ?? ''} style={splitStyle}>
        <div
          class={css.tablePane ?? ''}
          data-trajectory-scroll=""
          onscroll={(event: Event) => {
            const pane = event.currentTarget as HTMLDivElement
            this.#followsTableTail =
              pane.scrollHeight - pane.clientHeight - pane.scrollTop <= BOTTOM_FOLLOW_THRESHOLD_PX
            this.#requestOlder(pane, true)
          }}
          onclick={(event: MouseEvent) => {
            if (event.target === event.currentTarget) this.#clearAllSelections()
          }}
        >
          {showInitialLoading && (
            <div class={css.historyLoading ?? ''} role="status" aria-live="polite">
              <span class={css.historyLoadingBar ?? ''}>
                <span class={css.historyLoadingSpinner ?? ''} aria-hidden="true" />
                Loading trajectory…
              </span>
            </div>
          )}
          <table
            class={css.table ?? ''}
            data-scroll-ready={this.#tableScrollReady || undefined}
            aria-rowcount={records.length + historyRowOffset}
          >
            <colgroup>
              <col class={css.eventColumn ?? ''} />
              <col class={css.contentColumn ?? ''} />
            </colgroup>
            <tbody>
              {hasOlderRecords && (
                <tr class={css.historyLoadRow ?? ''} data-history-load="" aria-rowindex={1}>
                  <td colSpan={2}>
                    <button
                      type="button"
                      class={css.historyLoadButton ?? ''}
                      disabled={olderBusy || onLoadOlder === undefined}
                      aria-label={olderBusy ? 'Loading earlier history…' : 'Load earlier history'}
                      onclick={() => {
                        const pane = this.#tablePaneEl
                        if (pane !== null) this.#requestOlder(pane, false)
                      }}
                    >
                      {olderBusy && <span class={css.historyLoadingSpinner ?? ''} aria-hidden="true" />}
                      <span aria-hidden="true">
                        {olderBusy ? 'Loading earlier history…' : 'Load earlier history'}
                      </span>
                      <span class={css.visuallyHidden ?? ''} role="status" aria-live="polite">
                        {olderBusy ? 'Loading earlier history…' : ''}
                      </span>
                    </button>
                  </td>
                </tr>
              )}
              {virtualTop > 0 && (
                <tr class={css.virtualSpacer ?? ''} data-virtual-spacer="top" aria-hidden="true">
                  <td colSpan={2} style={`--trajectory-virtual-spacer-height: ${virtualTop}px`} />
                </tr>
              )}
              {renderedRecords.map(({ record, position, terminalRequestBoundary }) => {
                const { displayText, listDisplayText, resultText, toolCallOnly, toolCallText } = recordPresentation(record.cell)
                const isCollapsedSummary = record.collapsedSummary !== undefined
                const isRequestOnly = record.cell.requestOnly === true
                const isInitialSystem = record.cell.kind === 'system'
                  && record.cell.index === allRecords[0]?.cell.index
                const key = requestKey(record.turn, record.group)
                const request = requestBoundaries.get(key) === record.cell.index
                  && !isCollapsedSummary
                  && (record.turn === null || !collapsedTurns.has(record.turn))
                  ? requestNumbers.get(key)
                  : undefined
                const requestInfo = request === undefined
                  ? undefined
                  : sessionRequestNumbers?.find(candidate => candidate.number === request)
                const requestStatus = requestInfo?.status ?? (record.cell.isError === true ? 'error' : undefined)
                const requestRunIndex = requestBoundaryRuns.get(record.cell.index) ?? 0
                const requestBoundaryStyle = `--request-boundary-offset: ${requestRunIndex * 8}px`
                const requestLabel = request === undefined
                  ? undefined
                  : `Request #${request}${requestInfo?.purpose === 'compaction' ? ' · Compaction' : ''}`
                const requestSelected = request !== undefined
                  && selectedRequest?.turn === record.turn
                  && selectedRequest.group === record.group
                const sectionActive = record.turn === null
                  ? activeSection === record.section
                  : activeTurn === record.turn

                return (
                  <tr
                    tabIndex={isRequestOnly ? -1 : 0}
                    aria-rowindex={position + 1 + historyRowOffset}
                    aria-label={isCollapsedSummary
                      ? `Collapsed ${record.collapsedSummaryKind} summary, ${record.collapsedSummary}`
                      : isRequestOnly
                        ? `Request ${request ?? ''}, compaction`
                        : `${request === undefined ? '' : `Request ${request}, `}${KIND_LABEL[record.cell.kind]}, ${listDisplayText || 'no content'}`}
                    aria-selected={!isCollapsedSummary && !isRequestOnly && selectedIndex === record.cell.index}
                    data-kind={record.cell.kind}
                    data-trajectory-row-key={trajectoryVirtualRecordKey(record)}
                    data-virtual-position={virtualizationEnabled ? position : undefined}
                    data-record-index={!isCollapsedSummary && !isRequestOnly ? record.cell.index : undefined}
                    data-request-only={isRequestOnly || undefined}
                    data-terminal-request-boundary={terminalRequestBoundary || undefined}
                    data-group-start={record.groupStart || undefined}
                    data-turn-start={record.turnStart || undefined}
                    data-error={record.cell.isError || undefined}
                    data-running={stateOf(record) === 'running' || undefined}
                    data-turn-end={record.turnEnd || undefined}
                    data-collapsed-summary={record.collapsedSummaryKind}
                    data-selected={!isCollapsedSummary && selectedIndex === record.cell.index || undefined}
                    data-timeline-focus={isCollapsedSummary || timelineFocusIndexes === null
                      ? undefined
                      : timelineFocusIndexes.has(record.cell.index) ? 'inside' : 'outside'}
                    onclick={isRequestOnly
                      ? null
                      : isCollapsedSummary
                        ? () => {
                          if (record.collapsedSummaryKind === 'turn' && record.turn !== null) {
                            onToggleTurn(record.turn)
                          } else onToggleAssistant(trajectoryRecordId(record.cell))
                        }
                        : () => { this.#selectRecord(record.cell.index) }}
                    ondblclick={(event: MouseEvent) => {
                      if (isCollapsedSummary || isRequestOnly) return
                      if (record.turn !== null && collapsedTurns.has(record.turn)) {
                        event.preventDefault()
                        onToggleTurn(record.turn)
                        return
                      }
                      if (
                        record.cell.kind === 'message'
                        && assistantToolCalls(allRecords, record.cell.index).length > 0
                      ) {
                        event.preventDefault()
                        onToggleAssistant(trajectoryRecordId(record.cell))
                        return
                      }
                      if (!record.turnStart) return
                      if (record.turn === null) return
                      if (allRecords.filter(candidate =>
                        candidate.turn === record.turn
                        && candidate.cell.requestOnly !== true
                        && candidate.cell.kind !== 'system').length <= 1) return
                      event.preventDefault()
                      onToggleTurn(record.turn)
                    }}
                    onkeydown={(event: KeyboardEvent) => {
                      if (isRequestOnly) return
                      if (event.key !== 'Enter' && event.key !== ' ') return
                      event.preventDefault()
                      if (isCollapsedSummary) {
                        if (record.collapsedSummaryKind === 'turn' && record.turn !== null) {
                          onToggleTurn(record.turn)
                        } else onToggleAssistant(trajectoryRecordId(record.cell))
                        return
                      }
                      this.#selectRecord(record.cell.index)
                    }}
                  >
                    <td class={css.event ?? ''}>
                      {request !== undefined && (
                        <button
                          type="button"
                          class={(requestSelected
                            ? `${css.requestBoundaryControl ?? ''} ${css.requestBoundaryControlActive ?? ''}`
                            : css.requestBoundaryControl) ?? ''}
                          aria-label={requestLabel}
                          aria-pressed={requestSelected}
                          data-label={requestLabel}
                          data-request-run-index={requestRunIndex}
                          data-request-status={requestStatus}
                          style={requestBoundaryStyle}
                          onclick={(event: MouseEvent) => {
                            event.stopPropagation()
                            this.#selectRequest({
                              turn: record.turn,
                              group: record.group,
                              ...(requestInfo?.seq === undefined ? {} : { seq: requestInfo.seq }),
                            })
                          }}
                          ondblclick={(event: MouseEvent) => { event.stopPropagation() }}
                        />
                      )}
                      {record.turn !== null && activeTurn === record.turn && !isInitialSystem && (
                        <span class={css.turnRail ?? ''} aria-hidden="true" />
                      )}
                      {!isCollapsedSummary && selectedIndex === record.cell.index && (
                        <span class={css.selectionRail ?? ''} aria-hidden="true" />
                      )}
                      {!isCollapsedSummary && !isRequestOnly && record.turnStart && (
                        <span
                          class={(sectionActive
                            ? `${css.turnLabel ?? ''} ${css.turnLabelActive ?? ''}`
                            : css.turnLabel) ?? ''}
                          aria-label={sectionLabel(record.turn)}
                        >
                          {record.turn === null
                            ? sectionLabel(record.turn)
                            : [
                              <span class={css.turnLabelFull ?? ''} aria-hidden="true">
                                {sectionLabel(record.turn)}
                              </span>,
                              <span class={css.turnLabelCompact ?? ''} aria-hidden="true">
                                #{record.turn}
                              </span>,
                            ]}
                        </span>
                      )}
                      <div class={css.eventInner ?? ''}>
                        {!isCollapsedSummary && !isRequestOnly && (
                          <span class={css.kindSlot ?? ''}>
                            <span
                              class={`${css.kindTag ?? ''} ${
                                (record.cell.kind === 'system'
                                  ? css.systemNeutral
                                  : record.cell.kind === 'context'
                                    ? css.contextGreen
                                    : record.cell.kind === 'compacted'
                                      ? css.compacted
                                      : record.cell.kind === 'tool'
                                        ? css.toolAmber
                                        : record.cell.kind === 'message'
                                          ? css.assistantVioletBright
                                          : record.cell.kind === 'subtool'
                                            ? css.subtoolAmber
                                            : css[record.cell.kind]) ?? ''
                              }`}
                              data-role-kind={record.cell.kind}
                            >
                              <Tooltip label={KIND_LABEL[record.cell.kind]} side="right">
                                <span class={css.kindTagIcon ?? ''} aria-hidden="true">
                                  {kindIcon(record.cell.kind)}
                                </span>
                              </Tooltip>
                              <span class={css.kindTagLabel ?? ''}>
                                {KIND_LABEL[record.cell.kind]}
                              </span>
                            </span>
                          </span>
                        )}
                      </div>
                    </td>
                    <td class={css.content ?? ''}>
                      {isRequestOnly
                        ? null
                        : record.collapsedSummary !== undefined
                          ? (
                            <span class={css.collapsedTurnContent ?? ''} title={record.collapsedSummary}>
                              <span class={css.collapsedTurnEllipsis ?? ''}>…</span>
                              <span class={css.collapsedTurnText ?? ''}>{record.collapsedSummary}</span>
                            </span>
                          )
                          : (
                            <span
                              class={(resultText === undefined ? css.contentText : css.resultPreview) ?? ''}
                              title={resultText === undefined ? listDisplayText : `${listDisplayText} → ${resultText}`}
                            >
                              <span class={(resultText === undefined ? undefined : css.resultRequest) ?? ''}>
                                {RecordListText({
                                  displayText,
                                  toolCallOnly,
                                  toolCallText,
                                })}
                              </span>
                              {resultText !== undefined && (
                                <span class={(record.cell.isError ? `${css.inlineResult ?? ''} ${css.error ?? ''}` : css.inlineResult) ?? ''}>
                                  <span class={css.arrow ?? ''}>→</span>
                                  <span class={(resultText === 'No output'
                                    ? `${css.inlineResultText ?? ''} ${css.noOutputText ?? ''}`
                                    : css.inlineResultText) ?? ''}
                                  >
                                    {resultText}
                                  </span>
                                </span>
                              )}
                            </span>
                          )}
                    </td>
                  </tr>
                )
              })}
              {virtualBottom > 0 && (
                <tr class={css.virtualSpacer ?? ''} data-virtual-spacer="bottom" aria-hidden="true">
                  <td colSpan={2} style={`--trajectory-virtual-spacer-height: ${virtualBottom}px`} />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {(selectedRequest !== null
          || promptSelected
          || (selected !== undefined && selectedState !== undefined)) && (
          <aside
            class={css.details ?? ''}
            aria-label="Event details"
            style={this.#detailsWidth === null ? '' : `width: ${this.#detailsWidth}px`}
          >
            <div
              class={css.detailsResizeHandle ?? ''}
              role="separator"
              aria-label="Resize event details"
              aria-controls="trajectory-detail-panel"
              aria-orientation="vertical"
              tabIndex={0}
              title="Drag to resize. Double-click to reset."
              ondblclick={() => {
                this.#detailsWidth = null
                this.#toolRequestOffset = null
                this.#render()
              }}
              onpointerdown={(event: PointerEvent) => {
                if (event.button !== 0) return
                const details = (event.currentTarget as HTMLElement).parentElement
                if (details === null) return
                const split = details.parentElement
                if (split === null) return
                const splitWidth = split.getBoundingClientRect().width
                this.#detailsResizeDrag = {
                  pointerId: event.pointerId,
                  startX: event.clientX,
                  startWidth: details.getBoundingClientRect().width,
                  splitWidth,
                  startToolRequestOffset: this.#toolRequestOffset ?? (
                    splitWidth * TOOL_REQUEST_SHARE - defaultToolRequestWidth(splitWidth)
                  ),
                }
                ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
                event.preventDefault()
              }}
              onpointermove={(event: PointerEvent) => {
                const drag = this.#detailsResizeDrag
                if (drag === null || drag.pointerId !== event.pointerId) return
                const nextDetailsWidth = clampDetailsWidth(
                  drag.startWidth + drag.startX - event.clientX,
                  drag.splitWidth,
                )
                this.#detailsWidth = nextDetailsWidth
                this.#toolRequestOffset = drag.startToolRequestOffset
                  + (nextDetailsWidth - drag.startWidth) * TOOL_REQUEST_SHARE
                this.#render()
              }}
              onpointerup={(event: PointerEvent) => {
                if (this.#detailsResizeDrag?.pointerId !== event.pointerId) return
                this.#detailsResizeDrag = null
                ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
              }}
              onpointercancel={() => {
                this.#detailsResizeDrag = null
              }}
              onkeydown={(event: KeyboardEvent) => {
                if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
                const details = (event.currentTarget as HTMLElement).parentElement
                if (details === null) return
                const split = details.parentElement
                if (split === null) return
                const direction = event.key === 'ArrowLeft' ? 1 : -1
                const currentDetailsWidth = details.getBoundingClientRect().width
                const splitWidth = split.getBoundingClientRect().width
                const nextDetailsWidth = clampDetailsWidth(
                  currentDetailsWidth + direction * DETAILS_RESIZE_STEP,
                  splitWidth,
                )
                const currentToolRequestOffset = this.#toolRequestOffset ?? (
                  splitWidth * TOOL_REQUEST_SHARE - defaultToolRequestWidth(splitWidth)
                )
                this.#detailsWidth = nextDetailsWidth
                this.#toolRequestOffset = currentToolRequestOffset
                  + (nextDetailsWidth - currentDetailsWidth) * TOOL_REQUEST_SHARE
                this.#render()
                event.preventDefault()
              }}
            />
            <div class={css.detailsHeader ?? ''}>
              <div class={css.detailsTitle ?? ''}>
                {selectedRequest !== null
                  ? [
                    <span class={css.requestDetailsDot ?? ''} aria-hidden="true" />,
                    <span class={css.requestDetailsName ?? ''}>
                      Request #{selectedRequestNumber ?? '—'}
                    </span>,
                    <span class={css.detailsLocation ?? ''}>
                      {selectedRequestInfo?.purpose === 'compaction'
                        ? `Compaction · ${sectionLabel(selectedRequest.turn)}`
                        : sectionLabel(selectedRequest.turn)}
                    </span>,
                  ]
                  : promptSelected
                    ? [
                      <span class={`${css.kindTag ?? ''} ${css.systemNeutral ?? ''}`}>SYSTEM</span>,
                      <span class={css.detailsLocation ?? ''}>{selected?.cell.text}</span>,
                    ]
                    : selected !== undefined
                      ? [
                        <span
                          class={`${css.kindTag ?? ''} ${
                            (selected.cell.kind === 'context'
                              ? css.contextGreen
                              : selected.cell.kind === 'compacted'
                                ? css.compacted
                                : selected.cell.kind === 'tool'
                                  ? css.toolAmber
                                  : selected.cell.kind === 'message'
                                    ? css.assistantVioletBright
                                    : selected.cell.kind === 'subtool'
                                      ? css.subtoolAmber
                                      : css[selected.cell.kind]) ?? ''
                          }`}
                        >
                          {KIND_LABEL[selected.cell.kind]}
                        </span>,
                        <span class={css.detailsLocation ?? ''}>
                          {selected.cell.kind === 'compacted'
                            ? sectionLabel(selected.turn)
                            : `${sectionLabel(selected.turn)} · ${selected.group}`}
                        </span>,
                      ]
                      : null}
              </div>
              <button
                type="button"
                class={css.close ?? ''}
                aria-label="Close details"
                onclick={() => { this.#clearInspectorSelection() }}
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <div class={css.detailTabs ?? ''} role="tablist" aria-label="Event details">
              {selectedTabs.map(tab => (
                <button
                  key={tab.id}
                  id={`trajectory-detail-${tab.id}`}
                  type="button"
                  role="tab"
                  aria-controls="trajectory-detail-panel"
                  aria-selected={this.#activeTab === tab.id}
                  class={(this.#activeTab === tab.id ? `${css.detailTab ?? ''} ${css.detailTabActive ?? ''}` : css.detailTab) ?? ''}
                  onclick={() => { this.#activateTab(tab.id) }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div
              id="trajectory-detail-panel"
              class={(this.#activeTab === 'overview' ? `${css.detailBody ?? ''} ${css.detailBodySummary ?? ''}` : css.detailBody) ?? ''}
              role="tabpanel"
              aria-labelledby={`trajectory-detail-${this.#activeTab}`}
            >
              {selectedRequest !== null && selectedRequestState !== undefined && this.#activeTab === 'overview' && [
                <dl class={`${css.overview ?? ''} ${css.summaryScrollRegion ?? ''}`} data-summary-scroll-region="">
                  <div>
                    <dt>Status</dt>
                    <dd class={(selectedRequestState === 'error' ? css.error : undefined) ?? ''}>
                      {statusLabel(selectedRequestState)}
                    </dd>
                  </div>
                  {selectedRequestInfo?.purpose === 'compaction' && (
                    <div>
                      <dt>Purpose</dt>
                      <dd>Compaction</dd>
                    </div>
                  )}
                  {(selectedRequestInfo?.provider ?? selectedRequestInfo?.requestConfig?.provider) !== undefined && (
                    <div>
                      <dt>Provider</dt>
                      <dd>{selectedRequestInfo?.provider ?? selectedRequestInfo?.requestConfig?.provider}</dd>
                    </div>
                  )}
                  {(selectedRequestInfo?.model ?? selectedRequestInfo?.requestConfig?.model) !== undefined && (
                    <div>
                      <dt>Model</dt>
                      <dd>{selectedRequestInfo?.model ?? selectedRequestInfo?.requestConfig?.model}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Tool calls</dt>
                    <dd>{selectedRequestToolCalls}</dd>
                  </div>
                  {selectedRequestSubtoolCalls > 0 && (
                    <div>
                      <dt>Subtool calls</dt>
                      <dd>{selectedRequestSubtoolCalls}</dd>
                    </div>
                  )}
                  {selectedRequestInfo?.error !== undefined && (
                    <div>
                      <dt>Error</dt>
                      <dd class={css.error ?? ''}>{selectedRequestInfo.error}</dd>
                    </div>
                  )}
                  {selectedRequestInfo?.retry !== undefined && (
                    <div>
                      <dt>Retry</dt>
                      <dd>
                        Scheduled {selectedRequestInfo.retry}
                        {selectedRequestInfo.maxRetries === undefined ? '' : ` of ${selectedRequestInfo.maxRetries}`}
                      </dd>
                    </div>
                  )}
                  {selectedRequestInfo?.retryDelayMs !== undefined && (
                    <div>
                      <dt>Retry delay</dt>
                      <dd>{formatDurationMs(selectedRequestInfo.retryDelayMs)}</dd>
                    </div>
                  )}
                  {selectedRequestResult !== undefined && (
                    <div>
                      <dt>Result</dt>
                      <dd class={css.overviewParentLinks ?? ''}>
                        <button
                          type="button"
                          class={css.overviewHierarchyNavLink ?? ''}
                          onclick={() => { this.#openRecordSummary(selectedRequestResult) }}
                        >
                          <span>
                            {selectedRequestInfo?.purpose === 'compaction' ? 'Compacted' : 'Assistant Message'}
                          </span>
                          <IconChevronRightOutline14 className={css.overviewHierarchyJumpIconTight} size={11} />
                        </button>
                      </dd>
                    </div>
                  )}
                </dl>,
                <div class={css.overviewSections ?? ''}>
                  {selectedRequestOptions !== undefined && (
                    <OverviewSection label="Options" onOpen={() => { this.#activateTab('options') }}>
                      <RequestOptions options={selectedRequestOptions} preview />
                    </OverviewSection>
                  )}
                  <OverviewSection label="Usage" onOpen={() => { this.#activateTab('usage') }}>
                    <UsageRows usage={selectedRequestUsage} />
                  </OverviewSection>
                  <OverviewSection label="Timing" onOpen={() => { this.#activateTab('timing') }}>
                    <RequestTiming
                      assistant={selectedRequestAssistant}
                      anchor={selectedRequestAnchor}
                      request={selectedRequestInfo}
                      showUnix={this.#showUnix}
                      onToggleUnix={toggleUnix}
                    />
                  </OverviewSection>
                </div>,
              ]}
              {selectedRequest !== null && this.#activeTab === 'options' && (
                <RequestOptions options={selectedRequestOptions} />
              )}
              {selectedRequest !== null && this.#activeTab === 'usage' && (
                <RequestUsagePanel usage={selectedRequestUsage} cumulative={selectedRequestCumulativeUsage} />
              )}
              {selectedRequest !== null && this.#activeTab === 'timing' && (
                <RequestTiming
                  assistant={selectedRequestAssistant}
                  anchor={selectedRequestAnchor}
                  request={selectedRequestInfo}
                  showUnix={this.#showUnix}
                  onToggleUnix={toggleUnix}
                />
              )}
              {promptSelected && selectedPreviousPrompt !== undefined && this.#activeTab === 'diff' && (
                <SystemPromptDiff before={selectedPreviousPrompt} after={selectedPrompt} />
              )}
              {promptSelected && this.#activeTab === 'system-prompt' && (
                selectedPrompt.system === ''
                  ? <p class={css.noPayload ?? ''}>No system prompt in this request</p>
                  : (
                    <div class={`${css.markdownPayload ?? ''} ${css.systemPrompt ?? ''}`}>
                      <MarkdownText text={selectedPrompt.system} />
                    </div>
                  )
              )}
              {promptSelected && this.#activeTab === 'tools' && (
                <ToolCatalog tools={selectedPrompt.tools} />
              )}
              {!promptSelected
                && selected?.cell.kind === 'compacted'
                && selectedState !== undefined
                && this.#activeTab === 'overview' && [
                <dl class={`${css.overview ?? ''} ${css.summaryScrollRegion ?? ''}`} data-summary-scroll-region="">
                  <div>
                    <dt>Status</dt>
                    <dd class={(selectedState === 'error' ? css.error : undefined) ?? ''}>
                      {statusLabel(selectedState)}
                    </dd>
                  </div>
                  <div>
                    <dt>Duration</dt>
                    <dd>{formatElapsedSeconds(selected.cell.timeSeconds)}</dd>
                  </div>
                  <div>
                    <dt>Tokens</dt>
                    <dd>—</dd>
                  </div>
                </dl>,
                selected.cell.outputDetail !== undefined
                  ? (
                    <div class={`${css.compactedSummary ?? ''} ${css.summaryScrollRegion ?? ''}`} data-summary-scroll-region="">
                      <MarkdownRecordContent
                        record={selected}
                        rendered
                        thinkingExpanded={this.#thinkingExpanded}
                        onThinkingExpandedChange={(expanded) => { this.#thinkingExpanded = expanded; this.#render() }}
                        onOpenCall={(callId) => { this.#openCallSummary(callId) }}
                      />
                    </div>
                  )
                  : null,
              ]}
              {!promptSelected
                && selected !== undefined
                && selected.cell.kind !== 'compacted'
                && selectedState !== undefined
                && this.#activeTab === 'overview' && [
                <dl class={`${css.overview ?? ''} ${css.summaryScrollRegion ?? ''}`} data-summary-scroll-region="">
                  {selected.cell.messageSource !== undefined && (
                    <div>
                      <dt>Source</dt>
                      <dd class={css.overviewParentLinks ?? ''}>
                        <button
                          type="button"
                          class={css.overviewHierarchyNavLink ?? ''}
                          onclick={() => { this.#activateTab('source') }}
                        >
                          <span>{messageSourceLabel(selected.cell.messageSource)}</span>
                          <IconChevronRightOutline14 className={css.overviewHierarchyJumpIconTight} size={11} />
                        </button>
                      </dd>
                    </div>
                  )}
                  {hasSelectedHierarchy && (
                    <div>
                      <dt>{selectedAssistantRequestTarget !== undefined ? 'Source' : 'Hierarchy'}</dt>
                      <dd class={css.overviewParentLinks ?? ''}>
                        {selectedAssistantRequestTarget !== undefined && (
                          <button
                            type="button"
                            class={css.overviewHierarchyNavLink ?? ''}
                            onclick={() => { this.#selectRequest(selectedAssistantRequestTarget) }}
                          >
                            <span>Request #{selectedAssistantRequest ?? '—'}</span>
                            <IconChevronRightOutline14 className={css.overviewHierarchyJumpIconTight} size={11} />
                          </button>
                        )}
                        {selectedParentMessage !== undefined && (
                          <button
                            type="button"
                            class={css.overviewHierarchyNavLink ?? ''}
                            onclick={() => { this.#openRecordSummary(selectedParentMessage) }}
                          >
                            <span>Assistant Message</span>
                            <IconChevronRightOutline14 className={css.overviewHierarchyJumpIconTight} size={11} />
                          </button>
                        )}
                        {selectedParentTool !== undefined && (
                          <button
                            type="button"
                            class={css.overviewHierarchyNavLink ?? ''}
                            onclick={() => { this.#openRecordSummary(selectedParentTool) }}
                          >
                            <span>Tool Call</span>
                            <IconChevronRightOutline14 className={css.overviewHierarchyJumpIconTight} size={11} />
                          </button>
                        )}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Status</dt>
                    <dd class={(selectedState === 'error' ? css.error : undefined) ?? ''}>
                      {statusLabel(selectedState)}
                    </dd>
                  </div>
                  {selected.cell.kind === 'message' && TokenRows({ cell: selected.cell })}
                  {(selected.cell.kind === 'user' || selected.cell.kind === 'context') && (
                    <div>
                      <dt>Duration</dt>
                      <dd>{formatElapsedSeconds(selected.cell.timeSeconds)}</dd>
                    </div>
                  )}
                </dl>,
                <div class={css.overviewSections ?? ''}>
                  {isMarkdownRecord(selected)
                    ? (
                      <OverviewSection label="Preview" onOpen={() => { this.#activateTab('rendered') }}>
                        <MarkdownRecordContent
                          record={selected}
                          rendered
                          preview
                          thinkingExpanded={this.#thinkingExpanded}
                          onThinkingExpandedChange={(expanded) => { this.#thinkingExpanded = expanded; this.#render() }}
                          onOpenCall={(callId) => { this.#openCallSummary(callId) }}
                        />
                      </OverviewSection>
                    )
                    : [
                      selected.cell.inputDetail
                        ? (
                          <OverviewSection label="Payload" onOpen={() => { this.#activateTab('input') }}>
                            <RecordPayload record={selected} direction="input" preview />
                          </OverviewSection>
                        )
                        : null,
                      selected.cell.outputDetail
                        ? (
                          <OverviewSection label="Result" onOpen={() => { this.#activateTab('output') }}>
                            <RecordPayload record={selected} direction="output" preview />
                          </OverviewSection>
                        )
                        : null,
                      <OverviewSection label="Schema" onOpen={() => { this.#activateTab('schema') }}>
                        <RecordSchema record={selected} preview />
                      </OverviewSection>,
                    ]}
                  {selectedAssistantRequestTarget !== undefined && (
                    <OverviewSection
                      label="Request Timing"
                      onOpen={() => { this.#selectRequest(selectedAssistantRequestTarget, 'timing') }}
                    >
                      <RecordTiming record={selected} showUnix={this.#showUnix} onToggleUnix={toggleUnix} />
                    </OverviewSection>
                  )}
                  {(selected.cell.kind === 'tool' || selected.cell.kind === 'subtool') && (
                    <OverviewSection label="Timing" onOpen={() => { this.#activateTab('timing') }}>
                      <RecordTiming record={selected} showUnix={this.#showUnix} onToggleUnix={toggleUnix} />
                    </OverviewSection>
                  )}
                </div>,
              ]}
              {!promptSelected && selected !== undefined && this.#activeTab === 'rendered' && (
                <MarkdownRecordContent
                  record={selected}
                  rendered
                  thinkingExpanded={this.#thinkingExpanded}
                  onThinkingExpandedChange={(expanded) => { this.#thinkingExpanded = expanded; this.#render() }}
                  onOpenCall={(callId) => { this.#openCallSummary(callId) }}
                />
              )}
              {!promptSelected && selected !== undefined && this.#activeTab === 'raw' && (
                <MarkdownRecordContent
                  record={selected}
                  rendered={false}
                  thinkingExpanded={this.#thinkingExpanded}
                  onThinkingExpandedChange={(expanded) => { this.#thinkingExpanded = expanded; this.#render() }}
                  onOpenCall={(callId) => { this.#openCallSummary(callId) }}
                />
              )}
              {!promptSelected && selected !== undefined && this.#activeTab === 'source' && (
                <MessageSource record={selected} />
              )}
              {!promptSelected && selected !== undefined && this.#activeTab === 'input' && (
                <RecordPayload record={selected} direction="input" />
              )}
              {!promptSelected && selected !== undefined && this.#activeTab === 'output' && (
                <RecordPayload record={selected} direction="output" />
              )}
              {!promptSelected && selected !== undefined && this.#activeTab === 'schema' && (
                <RecordSchema record={selected} />
              )}
              {!promptSelected && selected !== undefined && this.#activeTab === 'timing' && (
                <RecordTiming record={selected} showUnix={this.#showUnix} onToggleUnix={toggleUnix} />
              )}
            </div>
          </aside>
        )}
      </div>
    )
    applyDiff(this, vdom)
    this.#tablePaneEl = this.querySelector<HTMLDivElement>(`.${css.tablePane}`)
    if (virtualizationEnabled && this.#tablePaneEl !== null && this.#virtual.virtualizer !== null) {
      // Ensure the virtualizer observes the (possibly newly mounted) pane.
      this.#virtual.virtualizer.scrollElement = this.#tablePaneEl
    }
    this.#syncScrollInit(historyLoading, virtualizationEnabled, rowVirtualizer)
  }

  #applyPendingScroll(
    records: TableRecord[],
    virtualizationEnabled: boolean,
    virtualIndexByRecordId: Map<string, number>,
    rowVirtualizer: Virtualizer<HTMLDivElement, HTMLTableRowElement> | null,
  ): void {
    const id = this.#pendingScrollRecordId
    if (id === null) return
    const position = records.findIndex(record =>
      trajectoryRecordId(record.cell) === id && record.collapsedSummary === undefined)
    if (position === -1) return
    if (virtualizationEnabled) {
      const virtualIndex = virtualIndexByRecordId.get(id)
      if (virtualIndex === undefined) return
      this.#pendingScrollRecordId = null
      this.#followsTableTail = false
      rowVirtualizer?.scrollToIndex(virtualIndex, { behavior: 'smooth', align: 'center' })
      return
    }
    this.#pendingScrollRecordId = null
    this.#followsTableTail = false
    const recordIndex = records[position]?.cell.index
    const row = recordIndex === undefined
      ? null
      : this.querySelector<HTMLElement>(`tr[data-record-index="${recordIndex}"]`)
    if (row !== undefined && row !== null && typeof row.scrollIntoView === 'function') {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }

  #applyTimelineFocus(
    records: TableRecord[],
    projectedVirtualRows: readonly TrajectoryVirtualRow<TableRecord>[],
    virtualizationEnabled: boolean,
    virtualIndexByRecordId: Map<string, number>,
    rowVirtualizer: Virtualizer<HTMLDivElement, HTMLTableRowElement> | null,
    timelineFocusIndexes: ReadonlySet<number> | null,
  ): void {
    if (timelineFocusIndexes === null || timelineFocusIndexes.size === 0) return
    const focusedPositions = records.flatMap((record, position) =>
      record.collapsedSummary === undefined
      && record.cell.requestOnly !== true
      && timelineFocusIndexes.has(record.cell.index)
        ? [position]
        : [])
    const first = focusedPositions.at(0)
    const last = focusedPositions.at(-1)
    if (first === undefined || last === undefined) return
    if (!virtualizationEnabled) {
      const focusedRows = [...this.querySelectorAll<HTMLElement>('tr[data-timeline-focus="inside"]')]
      const firstRow = focusedRows.at(0)
      const lastRow = focusedRows.at(-1)
      if (firstRow === undefined || lastRow === undefined) return
      const focusHeight = lastRow.getBoundingClientRect().bottom - firstRow.getBoundingClientRect().top
      const ledgerHeight = this.clientHeight
      const target = focusHeight > ledgerHeight
        ? firstRow
        : focusedRows[Math.floor((focusedRows.length - 1) / 2)]
      if (target !== undefined && typeof target.scrollIntoView === 'function') {
        this.#followsTableTail = false
        target.scrollIntoView({
          behavior: 'smooth',
          block: focusHeight > ledgerHeight ? 'start' : 'center',
        })
      }
      return
    }
    const focusedVirtualIndexes = [...new Set(focusedPositions.flatMap((position) => {
      const record = records[position]
      if (record === undefined) return []
      const virtualIndex = virtualIndexByRecordId.get(trajectoryRecordId(record.cell))
      return virtualIndex === undefined ? [] : [virtualIndex]
    }))].sort((left, right) => left - right)
    const firstVirtual = focusedVirtualIndexes.at(0)
    const lastVirtual = focusedVirtualIndexes.at(-1)
    if (firstVirtual === undefined || lastVirtual === undefined) return
    const paneHeight = this.#tablePaneEl?.clientHeight ?? 0
    const focusHeight = projectedVirtualRows
      .slice(firstVirtual, lastVirtual + 1)
      .reduce((height, row) => height + row.height, 0)
    this.#followsTableTail = false
    rowVirtualizer?.scrollToIndex(
      focusHeight > paneHeight
        ? firstVirtual
        : focusedVirtualIndexes[Math.floor((focusedVirtualIndexes.length - 1) / 2)] ?? firstVirtual,
      {
        behavior: 'smooth',
        align: focusHeight > paneHeight ? 'start' : 'center',
      },
    )
  }

  #syncScrollInit(
    historyLoading: boolean,
    virtualizationEnabled: boolean,
    rowVirtualizer: Virtualizer<HTMLDivElement, HTMLTableRowElement> | null,
  ): void {
    const pane = this.#tablePaneEl
    if (pane === null) return
    const { historyStartSeq } = this.#props
    const anchor = this.#olderLoadAnchor
    if (anchor !== null && anchor.historyStartSeq !== historyStartSeq) {
      if (!virtualizationEnabled) {
        pane.scrollTop = anchor.scrollTop + pane.scrollHeight - anchor.scrollHeight
      }
      this.#olderLoadAnchor = null
      this.#followsTableTail = false
      return
    }
    if (!this.#tableScrollInitialized) {
      if (historyLoading) return
      this.#tableScrollInitialized = true
      this.#followsTableTail = true
      if (virtualizationEnabled) rowVirtualizer?.scrollToEnd({ behavior: 'auto' })
      else pane.scrollTop = pane.scrollHeight
      this.#tableScrollReady = true
      this.#render()
      return
    }
    if (!this.#followsTableTail) return
    if (virtualizationEnabled) rowVirtualizer?.scrollToEnd({ behavior: 'auto' })
    else pane.scrollTop = pane.scrollHeight
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-trajectory-table') === undefined) {
  customElements.define('dsh-trajectory-table', DshTrajectoryTable)
}

/** Create and mount a TrajectoryTable element in place of the old function-component call. */
export function TrajectoryTable(props: TrajectoryTableProps): JSX.Element {
  const el = document.createElement('dsh-trajectory-table') as DshTrajectoryTable
  el.setProps(props)
  return el as unknown as JSX.Element
}
