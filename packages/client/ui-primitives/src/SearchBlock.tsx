// SearchBlock: the search surface for a completed content or path search — a
// banner (result summary that folds the pre-cap total in when the tool capped
// the result, plus a copy control), then either grep matches grouped by file
// (each file a bold
// path header with its `lineNumber: line` rows, the group collapsible) or a
// flat glob path list. Both shapes flatten to one list of rows the height cap
// slices head/tail over, and neither soft-wraps: a long match line or path
// scrolls horizontally instead of folding. Geometry mirrors CodeBlock and
// TerminalBlock so a search card reads as one family with them.
//
// Converted from a React hooks component to a webjsx custom element:
// expanded/collapsed become instance fields, and copy feedback now uses the
// createCopyFeedback factory (replacing the old useCopyFeedback hook) driven
// from connectedCallback/disconnectedCallback. Re-render is an explicit
// applyDiff(this, vdom) call (Toast.tsx's pattern).

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import clsx from 'clsx'
import { headTailCap } from './head-tail-cap.ts'
import { createCopyFeedback, type CopyFeedbackController } from './use-copy-feedback.ts'
import css from './SearchBlock.css.ts'

/**
 * Result rows shown before the height cap collapses the middle. Matches
 * {@link DEFAULT_TERMINAL_MAX_LINES} so a search card and a terminal card cut a
 * long result at the same place.
 */
export const DEFAULT_SEARCH_MAX_LINES = 16

/** One matched line inside a {@link SearchFileGroup}: its 1-based line number and text. */
export interface SearchBlockLineMatch {
  /** 1-based line number of the match within its file. */
  lineNumber: number
  /** The matched line text, as the tool surfaced it. */
  line: string
}

/** One file's grouped matches, in first-seen file order. */
export interface SearchFileGroup {
  /** The file the matches belong to (the display path). */
  path: string
  /** The file's matched lines, in output order. */
  matches: SearchBlockLineMatch[]
}

/** Fields both search shapes carry (the render site positions; this component draws). */
interface SearchBlockCommon {
  /**
   * Whether the tool capped the inline result: the shape carries only the
   * retained results, not every result the search found. The banner summary
   * folds the pre-cap `total` in (`显示 X / 共 N …`) so the card never presents a
   * capped result as complete.
   */
  truncated: boolean
  /** Total results the search found before capping (equals the retained count when not `truncated`). */
  total: number
  /** Height cap in rows before the middle collapses (default {@link DEFAULT_SEARCH_MAX_LINES}). */
  maxLines?: number | undefined
  /** Extra class merged onto the wrapper. */
  className?: string | undefined
}

/** Props for the grouped-matches (`grep`) shape. */
export interface SearchMatchesBlockProps extends SearchBlockCommon {
  kind: 'matches'
  /** Matched lines grouped by file, in first-seen file order. */
  files: SearchFileGroup[]
}

/** Props for the flat-path (`glob`) shape. */
export interface SearchPathsBlockProps extends SearchBlockCommon {
  kind: 'paths'
  /** The discovered paths, in the tool's result order (the retained page when `truncated`). */
  paths: string[]
}

/** {@link SearchBlock} props: one card, two `kind`-discriminated shapes. */
export type SearchBlockProps = SearchMatchesBlockProps | SearchPathsBlockProps

/**
 * One flattened render row. A matches card produces a `file` header row per
 * group followed by a `match` row per retained line while the group is
 * expanded; a paths card produces one `path` row per path. The height cap
 * counts these rows uniformly, so a file header costs one row exactly as a
 * match line or a path does.
 */
type SearchRow =
  | { type: 'file'; path: string; count: number; index: number; collapsed: boolean }
  | { type: 'match'; lineNumber: number; line: string; key: string; fileIndex: number }
  | { type: 'path'; path: string }

function copyText(props: SearchBlockProps): string {
  if (props.kind === 'paths') return props.paths.join('\n')
  return props.files
    .map(file => [file.path, ...file.matches.map(m => `${m.lineNumber}: ${m.line}`)].join('\n'))
    .join('\n\n')
}

function shownCount(props: SearchBlockProps): number {
  return props.kind === 'paths'
    ? props.paths.length
    : props.files.reduce((sum, file) => sum + file.matches.length, 0)
}

function summaryText(props: SearchBlockProps, shown: number, truncated: boolean, total: number): string {
  const count = truncated ? `显示 ${shown} / 共 ${total}` : `${shown}`
  return props.kind === 'paths'
    ? `${count} 个路径`
    : `${count} 处匹配 · ${props.files.length} 个文件`
}

function toRows(props: SearchBlockProps, collapsed: ReadonlySet<number>): SearchRow[] {
  if (props.kind === 'paths') return props.paths.map((path): SearchRow => ({ type: 'path', path }))
  const rows: SearchRow[] = []
  props.files.forEach((file, index) => {
    const isCollapsed = collapsed.has(index)
    rows.push({ type: 'file', path: file.path, count: file.matches.length, index, collapsed: isCollapsed })
    if (isCollapsed) return
    for (const match of file.matches) {
      rows.push({ type: 'match', lineNumber: match.lineNumber, line: match.line, key: `${index}:${match.lineNumber}`, fileIndex: index })
    }
  })
  return rows
}

function rowKey(row: SearchRow): string {
  switch (row.type) {
    case 'match': return `match:${row.key}`
    case 'file': return `file:${row.index}`
    case 'path': return `path:${row.path}`
  }
}

const DEFAULT_PROPS: SearchBlockProps = { kind: 'paths', truncated: false, total: 0, paths: [] }

/** Completed grep/glob search surface, as a custom element. */
export class DshSearchBlock extends HTMLElement {
  #props: SearchBlockProps = DEFAULT_PROPS
  #expanded = false
  #collapsed: ReadonlySet<number> = new Set()
  #copyFeedback: CopyFeedbackController | null = null

  setProps(props: SearchBlockProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#copyFeedback = createCopyFeedback(() => copyText(this.#props), () => { this.#render() })
    this.#render()
  }

  disconnectedCallback(): void {
    this.#copyFeedback?.stop()
    this.#copyFeedback = null
  }

  #toggleFile(index: number): void {
    const next = new Set(this.#collapsed)
    if (next.has(index)) next.delete(index)
    else next.add(index)
    this.#collapsed = next
    this.#render()
  }

  #renderRow(row: SearchRow): VNode {
    if (row.type === 'path') return <div class={css.line ?? ''}>{row.path}</div>
    if (row.type === 'match') {
      return (
        <div class={css.line ?? ''}>
          <span class={css.lineNumber ?? ''}>{row.lineNumber}: </span>
          {row.line}
        </div>
      )
    }
    return (
      <button
        type="button"
        class={css.fileHeader ?? ''}
        aria-expanded={!row.collapsed}
        onclick={() => { this.#toggleFile(row.index) }}
      >
        <span class={css.filePath ?? ''}>{row.path}</span>
        <span class={css.fileCount ?? ''}>{row.count}</span>
      </button>
    )
  }

  #render(): void {
    const props = this.#props
    const { truncated, total, maxLines = DEFAULT_SEARCH_MAX_LINES, className } = props
    const rows = toRows(props, this.#collapsed)
    const shown = shownCount(props)
    const empty = rows.length === 0
    const copied = this.#copyFeedback?.copied ?? false

    const { hidden, capped, headLines, tailLines } = headTailCap(rows.length, maxLines, this.#expanded)
    const head = capped ? rows.slice(0, headLines) : rows
    const naturalTail = capped ? rows.slice(rows.length - tailLines) : []
    const tailLead = naturalTail[0]
    const tailHeader = tailLead?.type === 'match'
      && !head.some(row => row.type === 'file' && row.index === tailLead.fileIndex)
      ? rows.find((row): row is Extract<SearchRow, { type: 'file' }> =>
        row.type === 'file' && row.index === tailLead.fileIndex)
      : undefined
    const tail = tailHeader === undefined ? naturalTail : naturalTail.slice(1)

    const vdom = (
      <div class={clsx(css.block, className)} data-search={props.kind}>
        <div class={css.header ?? ''}>
          <span class={css.summary ?? ''}>{summaryText(props, shown, truncated, total)}</span>
          {!empty && (
            <button type="button" class={css.copyButton ?? ''} onclick={() => this.#copyFeedback?.onCopy()}>
              {copied ? '复制成功' : '复制'}
            </button>
          )}
        </div>
        {empty
          ? <div class={css.empty ?? ''}>无结果</div>
          : (
            <div class={css.body ?? ''}>
              {head.map(row => (
                <div key={rowKey(row)}>{this.#renderRow(row)}</div>
              ))}
              {hidden > 0 && (
                <button
                  type="button"
                  class={css.expand ?? ''}
                  aria-expanded={this.#expanded}
                  aria-label={this.#expanded ? '收起结果' : `展开其余 ${hidden} 行结果`}
                  onclick={() => { this.#expanded = !this.#expanded; this.#render() }}
                >
                  {this.#expanded ? '收起' : `… 其余 ${hidden} 行`}
                </button>
              )}
              {tailHeader !== undefined && (
                <div key={`tailHeader:${rowKey(tailHeader)}`}>{this.#renderRow(tailHeader)}</div>
              )}
              {tail.map(row => (
                <div key={rowKey(row)}>{this.#renderRow(row)}</div>
              ))}
            </div>
          )}
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-search-block') === undefined) {
  customElements.define('dsh-search-block', DshSearchBlock)
}

/**
 * Create (if needed) or update a SearchBlock element in place.
 * @param el - an existing `dsh-search-block` element to update, or null to create one.
 * @param props - see {@link SearchBlockProps}.
 * @returns the `dsh-search-block` element; keep it and pass it back in to update.
 */
export function renderSearchBlock(el: DshSearchBlock | null, props: SearchBlockProps): DshSearchBlock {
  const target = el ?? document.createElement('dsh-search-block') as DshSearchBlock
  target.setProps(props)
  return target
}

/** One-shot creation helper preserving the original function-component call shape. */
export function SearchBlock(props: SearchBlockProps): JSX.Element {
  return renderSearchBlock(null, props) as unknown as JSX.Element
}
