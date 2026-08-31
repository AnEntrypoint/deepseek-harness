// JsonTree: read-only, keyboard-accessible JSON inspector tree with
// hover-triggered per-row copy controls (value/JSON/path via a right-click
// or long-press menu). Converted from a React hooks component to a webjsx
// custom element: every useState becomes an instance field, useEffect
// mount/cleanup becomes connectedCallback/disconnectedCallback, and
// re-render is an explicit applyDiff(this, vdom) call (Toast.tsx's
// pattern). The copy control's Menu is now the class-based DshMenu; it is
// created once and updated via setProps rather than re-mounted every render.

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import clsx from 'clsx'
import { IconCheckOutline16, IconCopyOutline16 } from './icons/index.tsx'
import { renderMenu, type DshMenu, type MenuEntry } from './Menu.tsx'
import css from './JsonTree.module.css'

const OBJECT_PREVIEW_LIMIT = 4
const ARRAY_PREVIEW_LIMIT = 5
const PREVIEW_DEPTH_LIMIT = 2

/**
 * Display copy for the tree's copy affordance; the owner passes localized
 * labels (this package is cordis-free, so copy arrives via props). Every
 * field defaults to the current built-in value, so existing consumers render
 * unchanged.
 */
export interface JsonTreeLabels {
  /** Menu item: copy the raw primitive value. */
  copyValue: string
  /** Menu item: copy the value as compact JSON (primitive rows). */
  copyJson: string
  /** Menu item: copy the property path. */
  copyPath: string
  /** Menu item: copy the value as pretty-printed JSON. */
  copyPrettyJson: string
  /** Menu item: copy the value as compact JSON (object rows). */
  copyCompactJson: string
  /** Copy-button state label after a successful copy. */
  copied: string
  /** Copy-button state label after a failed copy. */
  copyFailed: string
  /** Expander aria label while expanded. */
  collapseNode: string
  /** Expander aria label while collapsed. */
  expandNode: string
  /** Copy-button tooltip, given the current action label. */
  copyButtonTitle: (action: string) => string
}

const DEFAULT_LABELS: JsonTreeLabels = {
  copyValue: 'Copy value',
  copyJson: 'Copy JSON',
  copyPath: 'Copy property path',
  copyPrettyJson: 'Copy pretty JSON',
  copyCompactJson: 'Copy compact JSON',
  copied: 'Copied',
  copyFailed: 'Copy failed',
  collapseNode: 'Collapse JSON node',
  expandNode: 'Expand JSON node',
  copyButtonTitle: action => `${action}; right-click for copy options`,
}

function valueCopyMenuItems(labels: JsonTreeLabels): readonly MenuEntry[] {
  return [
    { id: 'value', label: labels.copyValue },
    { id: 'json', label: labels.copyJson },
    { id: 'path', label: labels.copyPath },
  ]
}

function objectCopyMenuItems(labels: JsonTreeLabels): readonly MenuEntry[] {
  return [
    { id: 'prettyJson', label: labels.copyPrettyJson },
    { id: 'json', label: labels.copyCompactJson },
    { id: 'path', label: labels.copyPath },
  ]
}

type JsonPath = readonly (number | string)[]

interface RowTarget {
  path: JsonPath
  value: unknown
}

interface CopyTarget extends RowTarget {
  left: number
  side: 'bottom' | 'top'
  top: number
}

function isExpandableValue(value: unknown): value is object | unknown[] {
  return typeof value === 'object' && value !== null && !(value instanceof Date)
}

function entriesOf(value: object | unknown[]): readonly (readonly [string, unknown])[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => [String(index), item] as const)
  }
  return Object.keys(value).map(key => [
    key,
    (value as Record<string, unknown>)[key],
  ] as const)
}

function bracketOf(value: object | unknown[]): readonly [string, string] {
  return Array.isArray(value) ? ['[', ']'] : ['{', '}']
}

function previewPrimitive(value: unknown): VNode | string | null {
  if (value === null) return <span class={css.keywordValue ?? ''}>null</span>
  if (typeof value === 'string') {
    return <span class={css.stringValue ?? ''}>{JSON.stringify(value)}</span>
  }
  if (typeof value === 'number') {
    return <span class={css.numberValue ?? ''}>{String(value)}</span>
  }
  if (typeof value === 'boolean') {
    return <span class={css.keywordValue ?? ''}>{String(value)}</span>
  }
  if (typeof value === 'bigint') {
    return <span class={css.otherValue ?? ''}>{value.toString()}</span>
  }
  if (typeof value === 'undefined') {
    return <span class={css.otherValue ?? ''}>undefined</span>
  }
  if (typeof value === 'symbol') {
    return <span class={css.otherValue ?? ''}>{value.description ?? 'Symbol'}</span>
  }
  if (typeof value === 'function') {
    return <span class={css.otherValue ?? ''}>{value.name || 'Function'}</span>
  }
  return null
}

function previewValue(value: unknown, depth: number): VNode | string | null {
  if (!isExpandableValue(value)) return previewPrimitive(value)

  const array = Array.isArray(value)
  const entries = entriesOf(value)
  const limit = array ? ARRAY_PREVIEW_LIMIT : OBJECT_PREVIEW_LIMIT
  const visible = entries.slice(0, limit)
  const [open, close] = bracketOf(value)

  return (
    <>
      <span class={css.punctuation ?? ''}>{open}</span>
      {depth >= PREVIEW_DEPTH_LIMIT
        ? <span class={css.previewEllipsis ?? ''}>…</span>
        : visible.map(([key, item], index) => (
          <span key={key}>
            {index > 0 && <span class={css.punctuation ?? ''}>, </span>}
            {!array && (
              <>
                <span class={css.previewProperty ?? ''}>{key}</span>
                <span class={css.punctuation ?? ''}>: </span>
              </>
            )}
            {previewValue(item, depth + 1)}
          </span>
        ))}
      {depth < PREVIEW_DEPTH_LIMIT && entries.length > limit && (
        <span class={css.previewEllipsis ?? ''}>, …</span>
      )}
      <span class={css.punctuation ?? ''}>{close}</span>
    </>
  )
}

function primitiveValue(value: unknown): VNode | string {
  if (value === null) return <span class={css.keywordValue ?? ''}>null</span>
  if (typeof value === 'string') {
    return <span class={css.stringValue ?? ''}>{JSON.stringify(value)}</span>
  }
  if (typeof value === 'boolean') {
    return <span class={css.keywordValue ?? ''}>{String(value)}</span>
  }
  if (typeof value === 'number') {
    return <span class={css.numberValue ?? ''}>{String(value)}</span>
  }
  if (typeof value === 'bigint') {
    return <span class={css.numberValue ?? ''}>{`${value.toString()}n`}</span>
  }
  if (value instanceof Date) {
    return <span class={css.otherValue ?? ''}>{value.toISOString()}</span>
  }
  if (typeof value === 'function') {
    return <span class={css.otherValue ?? ''}>function() {'{ }'}</span>
  }
  if (typeof value === 'undefined') {
    return <span class={css.otherValue ?? ''}>undefined</span>
  }
  return <span class={css.otherValue ?? ''}>{(value as symbol).toString()}</span>
}

function fieldText(field: string): string {
  return field === '' ? '""' : field
}

function pathId(path: JsonPath): string {
  return path.map(part => (
    typeof part === 'number' ? `n${String(part)}` : `s${String(part.length)}:${part}`
  )).join('/')
}

function claimFocus(button: HTMLElement): void {
  button.focus()
}

function moveFocus(button: HTMLElement, direction: -1 | 1): void {
  const tree = button.closest<HTMLElement>('[role="tree"]')
  if (tree === null) return
  const expanders = Array.from(tree.querySelectorAll<HTMLElement>('[data-json-expander]'))
  const current = expanders.indexOf(button)
  if (current < 0 || expanders.length === 0) return
  const next = (current + direction + expanders.length) % expanders.length
  const nextExpander = expanders[next]
  if (nextExpander !== undefined) claimFocus(nextExpander)
}

function renderNodeField(field: string | undefined, expandable: boolean, onToggle: () => void): VNode | null {
  if (field === undefined) return null
  return (
    <span
      class={clsx(css.label, expandable && css.clickableLabel)}
      onclick={expandable ? onToggle : null}
    >
      {fieldText(field)}:
    </span>
  )
}

/** Per-node expansion state, keyed by the node's stable path id, owned by the tree root (mirrors each node's own former useState). */
interface NodeExpandState {
  get: (nodeId: string, initial: boolean) => boolean
  set: (nodeId: string, value: boolean) => void
}

interface JsonTreeNodeArgs {
  field?: string
  initialExpanded: boolean
  labels: JsonTreeLabels
  lastElement: boolean
  onClaimTabStop: (id: string) => void
  onRowHover: (row: HTMLElement, target: RowTarget) => void
  path: JsonPath
  tabStopId: string | null
  value: unknown
  expandState: NodeExpandState
  rerender: () => void
}

function renderJsonTreeNode(args: JsonTreeNodeArgs): VNode {
  const { field, initialExpanded, labels, lastElement, onClaimTabStop, onRowHover, path, tabStopId, value, expandState, rerender } = args
  const nodeId = pathId(path)
  const container = isExpandableValue(value)
  const entries = container ? entriesOf(value) : []
  const expandable = entries.length > 0
  const expanded = expandState.get(nodeId, initialExpanded)

  const toggle = (): void => {
    expandState.set(nodeId, !expanded)
    rerender()
    // Refocus the expander after the diff lands.
    queueMicrotask(() => {
      const el = document.querySelector<HTMLElement>(`[data-json-expander][data-node-id="${nodeId}"]`)
      if (el !== null) claimFocus(el)
    })
  }

  const onExpanderKeyDown = (event: KeyboardEvent): void => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault()
      expandState.set(nodeId, event.key === 'ArrowRight')
      rerender()
      return
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault()
      moveFocus(event.currentTarget as HTMLElement, event.key === 'ArrowUp' ? -1 : 1)
    }
  }

  const row = (children: VNode | VNode[], ariaExpanded?: boolean): VNode => (
    <div
      class={css.row ?? ''}
      role="treeitem"
      aria-expanded={ariaExpanded}
      onmouseover={(event: MouseEvent) => {
        event.stopPropagation()
        onRowHover(event.currentTarget as HTMLElement, { path, value })
      }}
    >
      {children}
    </div>
  )

  if (!container) {
    return row((
      <>
        {renderNodeField(field, false, toggle)}
        {primitiveValue(value)}
        {!lastElement && <span class={css.punctuation ?? ''}>,</span>}
      </>
    ))
  }

  const [open, close] = bracketOf(value)
  if (!expandable) {
    return row((
      <>
        {renderNodeField(field, false, toggle)}
        <span class={css.punctuation ?? ''}>{open}</span>
        <span class={css.punctuation ?? ''}>{close}</span>
        {!lastElement && <span class={css.punctuation ?? ''}>,</span>}
      </>
    ))
  }

  return row((
    <>
      <span
        class={clsx(css.expander, expanded ? css.collapseIcon : css.expandIcon)}
        data-json-expander
        data-node-id={nodeId}
        role="button"
        aria-label={expanded ? labels.collapseNode : labels.expandNode}
        aria-expanded={expanded}
        tabIndex={tabStopId === nodeId ? 0 : -1}
        onfocus={() => { onClaimTabStop(nodeId) }}
        onclick={toggle}
        onkeydown={onExpanderKeyDown}
      />
      {renderNodeField(field, true, toggle)}
      <span class={css.preview ?? ''}>{previewValue(value, 0)}</span>
      {!lastElement && <span class={css.punctuation ?? ''}>,</span>}
      {expanded && (
        <ul role="group" class={css.children ?? ''}>
          {entries.map(([key, item], index) => (
            renderJsonTreeNode({
              field: key,
              value: item,
              path: [...path, Array.isArray(value) ? index : key],
              labels,
              lastElement: index === entries.length - 1,
              initialExpanded: false,
              tabStopId,
              onClaimTabStop,
              onRowHover,
              expandState,
              rerender,
            })
          ))}
        </ul>
      )}
    </>
  ), expanded)
}

function formattedPath(path: JsonPath): string {
  return path.reduce<string>((result, part) => {
    if (typeof part === 'number') return `${result}[${String(part)}]`
    return /^[A-Za-z_$][\w$]*$/.test(part)
      ? `${result}.${part}`
      : `${result}[${JSON.stringify(part)}]`
  }, '$')
}

function copyText(target: CopyTarget, mode: 'json' | 'path' | 'prettyJson' | 'value'): string {
  if (mode === 'path') return formattedPath(target.path)
  if (mode === 'prettyJson') return JSON.stringify(target.value, null, 2)
  if (mode === 'json') return JSON.stringify(target.value)
  if (typeof target.value === 'string') return target.value
  if (typeof target.value === 'undefined') return 'undefined'
  if (typeof target.value === 'bigint') return target.value.toString()
  if (typeof target.value === 'symbol') return target.value.description ?? 'Symbol'
  if (typeof target.value === 'function') return target.value.name || 'Function'
  return JSON.stringify(target.value)
}

/** Props for the read-only, token-themed JSON tree. */
export interface JsonTreeProps {
  /** Parsed JSON object or array. */
  data: object | unknown[]
  /** Accessible label for the tree. */
  label?: string
  /** Optional positioning class owned by the caller. */
  className?: string | undefined
  /** Whether JSON rows expose copy actions. */
  copyable?: boolean
  /** Whether the top-level object or array is always expanded. */
  expandTopLevel?: boolean
  /** Localized display copy; omitted fields keep the built-in defaults. */
  labels?: Partial<JsonTreeLabels> | undefined
}

const DEFAULT_PROPS: JsonTreeProps = { data: {} }

/** Read-only, keyboard-accessible JSON inspector tree custom element. */
export class DshJsonTree extends HTMLElement {
  #props: JsonTreeProps = DEFAULT_PROPS
  #activeRow: HTMLElement | undefined
  #copyMenuOpen = false
  #resetTimer: ReturnType<typeof setTimeout> | undefined
  #copyTarget: CopyTarget | undefined
  #copyState: 'idle' | 'copied' | 'failed' = 'idle'
  #tabStopId: string | null = null
  #expandMap = new Map<string, boolean>()
  #scrollHandler: (() => void) | null = null
  #menuEl: DshMenu | null = null
  #lastDataRef: unknown = undefined

  setProps(props: JsonTreeProps): void {
    const dataChanged = props.data !== this.#lastDataRef
    this.#props = props
    if (dataChanged) {
      this.#lastDataRef = props.data
      this.#activeRow?.removeAttribute('data-json-copy-active')
      this.#activeRow = undefined
      this.#copyMenuOpen = false
      this.#copyTarget = undefined
      this.#copyState = 'idle'
      this.#expandMap.clear()
      this.#tabStopId = this.#computeInitialTabStopId()
    }
    this.#render()
  }

  connectedCallback(): void {
    this.#tabStopId = this.#computeInitialTabStopId()
    const reposition = (): void => {
      const row = this.#activeRow
      if (row !== undefined) this.#repositionCopyButton(row)
    }
    this.#scrollHandler = reposition
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)
    this.#render()
  }

  disconnectedCallback(): void {
    if (this.#resetTimer !== undefined) clearTimeout(this.#resetTimer)
    this.#activeRow?.removeAttribute('data-json-copy-active')
    if (this.#scrollHandler !== null) {
      window.removeEventListener('scroll', this.#scrollHandler, true)
      window.removeEventListener('resize', this.#scrollHandler)
      this.#scrollHandler = null
    }
    this.#menuEl?.remove()
    this.#menuEl = null
  }

  #computeInitialTabStopId(): string | null {
    const { data, expandTopLevel = true } = this.#props
    const rootEntries = entriesOf(data)
    const firstExpandableIndex = rootEntries.findIndex(([, value]) => (
      isExpandableValue(value) && entriesOf(value).length > 0
    ))
    const firstExpandableEntry = rootEntries[firstExpandableIndex]
    return expandTopLevel
      ? firstExpandableEntry === undefined
        ? null
        : pathId([Array.isArray(data) ? firstExpandableIndex : firstExpandableEntry[0]])
      : isExpandableValue(data) && rootEntries.length > 0 ? pathId([]) : null
  }

  #setActiveRow(row: HTMLElement | undefined): void {
    this.#activeRow?.removeAttribute('data-json-copy-active')
    this.#activeRow = row
    row?.setAttribute('data-json-copy-active', '')
  }

  #clearCopyTarget(): void {
    this.#setActiveRow(undefined)
    this.#copyTarget = undefined
    this.#copyState = 'idle'
    this.#copyMenuOpen = false
    this.#render()
  }

  #copyPosition(row: HTMLElement): Pick<CopyTarget, 'left' | 'side' | 'top'> {
    const root = this.querySelector<HTMLElement>('[data-json-tree-root]')
    if (root === null) throw new Error('JsonTree root is not mounted')
    const rootRect = root.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    return {
      left: rootRect.left + root.clientWidth - 26,
      side: rowRect.top - rootRect.top > root.clientHeight / 2 ? 'top' : 'bottom',
      top: rowRect.top,
    }
  }

  #positionCopyButton(row: HTMLElement, target: RowTarget): void {
    const position = this.#copyPosition(row)
    this.#copyTarget = { ...target, ...position }
  }

  #repositionCopyButton(row: HTMLElement): void {
    if (this.#copyTarget === undefined) return
    const position = this.#copyPosition(row)
    this.#copyTarget = { ...this.#copyTarget, ...position }
    this.#render()
  }

  #handleRowHover(row: HTMLElement, target: RowTarget): void {
    const { copyable = true } = this.#props
    if (!copyable || this.#copyMenuOpen) return
    if (this.#activeRow === row) return
    this.#setActiveRow(row)
    this.#copyState = 'idle'
    this.#copyMenuOpen = false
    this.#positionCopyButton(row, target)
    this.#render()
  }

  async #copy(mode: 'json' | 'path' | 'prettyJson' | 'value'): Promise<void> {
    if (this.#copyTarget === undefined) return
    try {
      await navigator.clipboard.writeText(copyText(this.#copyTarget, mode))
      this.#copyState = 'copied'
    } catch {
      this.#copyState = 'failed'
    }
    if (this.#resetTimer !== undefined) clearTimeout(this.#resetTimer)
    this.#resetTimer = setTimeout(() => {
      this.#copyState = 'idle'
      this.#render()
    }, 1_500)
    this.#render()
  }

  #render(): void {
    const { data, label = 'JSON', className, copyable = true, expandTopLevel = true, labels } = this.#props
    const copyLabels: JsonTreeLabels = labels === undefined ? DEFAULT_LABELS : { ...DEFAULT_LABELS, ...labels }
    const rootEntries = entriesOf(data)

    const expandState: NodeExpandState = {
      get: (nodeId, initial) => this.#expandMap.get(nodeId) ?? initial,
      set: (nodeId, value) => { this.#expandMap.set(nodeId, value) },
    }
    const rerender = (): void => { this.#render() }

    const [rootOpen, rootClose] = bracketOf(data)
    const copyTargetIsObject = typeof this.#copyTarget?.value === 'object' && this.#copyTarget.value !== null
    const defaultCopyMode = copyTargetIsObject ? 'prettyJson' : 'value'
    const copyTitle = this.#copyState === 'copied'
      ? copyLabels.copied
      : this.#copyState === 'failed'
        ? copyLabels.copyFailed
        : copyTargetIsObject ? copyLabels.copyPrettyJson : copyLabels.copyValue

    const onRowHover = (row: HTMLElement, target: RowTarget): void => { this.#handleRowHover(row, target) }
    const onClaimTabStop = (id: string): void => { this.#tabStopId = id; this.#render() }

    const vdom = (
      <div
        data-json-tree-root
        class={clsx(css.root, className)}
        onmouseover={(event: MouseEvent) => {
          if (!copyable || this.#copyMenuOpen) return
          if (!(event.target instanceof Element)) return
          if (event.target.closest('[data-json-copy-button]') === null) this.#clearCopyTarget()
        }}
        onmouseleave={() => {
          if (!this.#copyMenuOpen) this.#clearCopyTarget()
        }}
        onscroll={() => {
          const row = this.#activeRow
          if (row !== undefined) this.#repositionCopyButton(row)
        }}
      >
        {expandTopLevel
          ? (
            <div class={css.expandedTopLevel ?? ''}>
              <div
                class={clsx(css.row, css.topLevelBracket)}
                data-json-root-row
                onmouseover={(event: MouseEvent) => {
                  event.stopPropagation()
                  onRowHover(event.currentTarget as HTMLElement, { path: [], value: data })
                }}
              >
                <span class={css.punctuation ?? ''}>{rootOpen}</span>
              </div>
              <div
                aria-label={label}
                class={clsx(css.container, css.expandedTopLevelContainer)}
                role="tree"
              >
                {rootEntries.map(([key, value], index) => (
                  renderJsonTreeNode({
                    field: key,
                    value,
                    path: [Array.isArray(data) ? index : key],
                    labels: copyLabels,
                    lastElement: index === rootEntries.length - 1,
                    initialExpanded: false,
                    tabStopId: this.#tabStopId,
                    onClaimTabStop,
                    onRowHover,
                    expandState,
                    rerender,
                  })
                ))}
              </div>
              <div class={clsx(css.row, css.topLevelBracket)}>
                <span class={css.punctuation ?? ''}>{rootClose}</span>
              </div>
            </div>
          )
          : (
            <div aria-label={label} class={css.container ?? ''} role="tree">
              {renderJsonTreeNode({
                value: data,
                path: [],
                labels: copyLabels,
                lastElement: true,
                initialExpanded: true,
                tabStopId: this.#tabStopId,
                onClaimTabStop,
                onRowHover,
                expandState,
                rerender,
              })}
            </div>
          )}
        {this.#copyTarget !== undefined && (
          <span
            data-json-copy-anchor
            class={css.copyAnchor ?? ''}
            style={`left: ${this.#copyTarget.left}px; top: ${this.#copyTarget.top}px`}
          >
            <button
              data-json-copy-button-el
              type="button"
              class={css.copyButton ?? ''}
              data-json-copy-button
              data-state={this.#copyState}
              aria-label={copyTitle}
              title={copyLabels.copyButtonTitle(copyTitle)}
              onclick={() => void this.#copy(defaultCopyMode)}
              oncontextmenu={(event: MouseEvent) => {
                event.preventDefault()
                event.stopPropagation()
                this.#copyMenuOpen = true
                this.#render()
              }}
            >
              {this.#copyState === 'copied'
                ? <IconCheckOutline16 size={12} />
                : <IconCopyOutline16 size={12} />}
            </button>
          </span>
        )}
      </div>
    )
    applyDiff(this, vdom)

    // The copy menu is a separately-managed portal element (Menu's own
    // pattern), wired to the just-rendered copy button.
    if (this.#copyTarget !== undefined) {
      const button = this.querySelector<HTMLButtonElement>('[data-json-copy-button-el]')
      this.#menuEl = renderMenu(this.#menuEl, {
        open: this.#copyMenuOpen,
        compact: true,
        portal: true,
        align: 'end',
        side: this.#copyTarget.side,
        anchor: '',
        items: copyTargetIsObject ? objectCopyMenuItems(copyLabels) : valueCopyMenuItems(copyLabels),
        onSelect: (id) => {
          void this.#copy(id as 'json' | 'path' | 'prettyJson' | 'value')
          this.#copyMenuOpen = false
          this.#render()
        },
        onClose: () => { this.#clearCopyTarget() },
        getAnchorRect: () => button?.getBoundingClientRect() ?? null,
      })
    } else if (this.#menuEl !== null) {
      this.#menuEl.remove()
      this.#menuEl = null
    }
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-json-tree') === undefined) {
  customElements.define('dsh-json-tree', DshJsonTree)
}

/**
 * Create (if needed) or update a JsonTree element in place.
 * @param el - an existing `dsh-json-tree` element to update, or null to create one.
 * @param props - see {@link JsonTreeProps}.
 * @returns the `dsh-json-tree` element; keep it and pass it back in to update.
 */
export function renderJsonTree(el: DshJsonTree | null, props: JsonTreeProps): DshJsonTree {
  const target = el ?? document.createElement('dsh-json-tree') as DshJsonTree
  target.setProps(props)
  return target
}

/** One-shot creation helper preserving the original function-component call shape. */
export function JsonTree(props: JsonTreeProps): JSX.Element {
  return renderJsonTree(null, props) as unknown as JSX.Element
}
