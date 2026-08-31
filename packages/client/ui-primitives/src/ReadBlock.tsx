// ReadBlock: the file surface for a read tool result — a banner (label +
// language + a "showing N of M" note when the read is a window + a copy
// control) over line-numbered, syntax-highlighted source. Each row carries the
// file's OWN line number in a gutter, so a windowed read past an offset keeps
// its file numbering rather than re-counting from 1. Highlighting reuses the
// CodeBlock shiki path (highlight.ts) at the per-line granularity a gutter
// needs; an unknown or absent language renders plain monospace. Long content is
// height-capped with the same head/tail arithmetic TerminalBlock uses, so the
// two cards collapse a long body at the same place. Colors resolve through
// --shiki-*/--dsw-* tokens.
//
// Converted from a React hooks component to a webjsx custom element:
// expanded/copied become instance fields, and copy feedback now uses the
// createCopyFeedback factory (replacing the old useCallback/useState pair)
// driven from connectedCallback/disconnectedCallback. The former
// useSyncExternalStore subscription to the lazy-grammar-loaded signal becomes
// a direct subscribeGrammarLoaded(...) call in connectedCallback that
// triggers #render, unsubscribed in disconnectedCallback. Re-render is an
// explicit applyDiff(this, vdom) call (Toast.tsx's pattern); the raw-text and
// highlight useMemo's become plain recomputes inside #render guarded by a
// last-props identity check.

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import clsx from 'clsx'
import {
  highlightLines,
  subscribeGrammarLoaded,
  type HighlightSpan,
} from './markdown/highlight.ts'
import { createCopyFeedback, type CopyFeedbackController } from './use-copy-feedback.ts'
import css from './ReadBlock.module.css'

/**
 * Content lines shown before the height cap collapses the middle. Matches
 * TerminalBlock's default so a long read and a long command output cut at the
 * same place in the same flow.
 */
export const DEFAULT_READ_MAX_LINES = 16

/** One line of the read window: its file line number and its text (no trailing newline). */
export interface ReadBlockLine {
  /** 1-based line number in the file (a window past an offset keeps the file's own numbering). */
  number: number
  /** The line's text, already truncated to the read tool's per-line cap. */
  text: string
}

export interface ReadBlockProps {
  /** Banner label (the file path, or a tool-supplied replacement title); omitted draws no label. */
  label?: string | undefined
  /** The returned window's lines, in file order, each keeping its file line number. */
  lines: readonly ReadBlockLine[]
  /** Exact total line count in the file, for the "showing N of M" note when the read is a window. */
  totalLines: number
  /** Grammar hint (a file-extension-derived language id); unknown or absent = plain monospace. */
  lang?: string | undefined
  /** Height cap in content lines before the middle collapses (default {@link DEFAULT_READ_MAX_LINES}). */
  maxLines?: number | undefined
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
}

/**
 * Render one line's highlighted runs. The css-variables theme colors every run,
 * so each run is a styled span; a line with no highlighting at all takes the
 * bare-text path in the caller instead (an unknown or absent language).
 * @param spans - the line's styled runs.
 * @returns the line's children.
 */
function renderSpans(spans: readonly HighlightSpan[]): VNode[] {
  return spans.map((span, index) => <span key={index} style={span.style}>{span.text}</span>)
}

const DEFAULT_PROPS: ReadBlockProps = { lines: [], totalLines: 0 }

/** Read-tool-result line-numbered file view, as a custom element. */
export class DshReadBlock extends HTMLElement {
  #props: ReadBlockProps = DEFAULT_PROPS
  #expanded = false
  #copyFeedback: CopyFeedbackController | null = null
  #unsubscribeGrammar: (() => void) | null = null
  #lastLines: readonly ReadBlockLine[] | null = null
  #lastRaw = ''

  setProps(props: ReadBlockProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    // The window's raw text, never the rendered tree: the gutter numbers and the
    // banner are chrome the file does not contain.
    this.#copyFeedback = createCopyFeedback(() => this.#raw(), () => { this.#render() })
    // Re-render when a lazy grammar finishes loading, so a read card that showed
    // plain text while its language's grammar imported picks up highlighting.
    this.#unsubscribeGrammar = subscribeGrammarLoaded(() => { this.#render() })
    this.#render()
  }

  disconnectedCallback(): void {
    this.#copyFeedback?.stop()
    this.#copyFeedback = null
    this.#unsubscribeGrammar?.()
    this.#unsubscribeGrammar = null
  }

  #raw(): string {
    if (this.#lastLines !== this.#props.lines) {
      this.#lastLines = this.#props.lines
      this.#lastRaw = this.#props.lines.map(line => line.text).join('\n')
    }
    return this.#lastRaw
  }

  #render(): void {
    const {
      label,
      lines,
      totalLines,
      lang,
      maxLines = DEFAULT_READ_MAX_LINES,
      className,
    } = this.#props
    // Highlighting the whole window in one call (not line by line) keeps grammar
    // context across lines — a multi-line string or comment stays one construct.
    const raw = this.#raw()
    // Per-line highlighted runs aligned 1:1 with `lines`; undefined for an
    // unknown/absent (or not-yet-loaded) language, when every line renders as
    // bare text.
    const highlighted = highlightLines(raw, lang)
    const copied = this.#copyFeedback?.copied ?? false

    const hidden = lines.length - maxLines
    const capped = hidden > 0 && !this.#expanded
    // Same split arithmetic as TerminalBlock's height cap, so a long read and a
    // long command output slice their head and tail at the same place.
    const headLines = Math.ceil(maxLines / 2)
    const tailLines = maxLines - headLines
    // A read is a window when its returned lines are fewer than the file's total;
    // the note states that so a reader is not misled that the file ends here.
    const windowed = lines.length < totalLines

    /**
     * Render a slice of the line array as gutter-numbered rows.
     * @param slice - the lines to draw, each with its aligned run array.
     * @returns the row elements.
     */
    const rows = (slice: readonly (readonly [ReadBlockLine, readonly HighlightSpan[] | undefined])[]): VNode[] =>
      slice.map(([line, spans]) => (
        <div key={line.number} class={css.line ?? ''}>
          <span class={css.gutter ?? ''} aria-hidden>{line.number}</span>
          <span class={css.content ?? ''}>{spans === undefined ? line.text : renderSpans(spans)}</span>
        </div>
      ))

    // Pair each line with its aligned run array up front, so head/tail slicing
    // keeps the two in step without re-indexing.
    const paired = lines.map((line, index): readonly [ReadBlockLine, readonly HighlightSpan[] | undefined] =>
      [line, highlighted?.[index]])

    const vdom: VNode = (
      <div class={clsx(css.block, className)} data-read="">
        <div class={css.banner ?? ''}>
          <div class={css.label ?? ''}>{label ?? ''}</div>
          <div class={css.action ?? ''}>
            {windowed && (
              <span class={css.count ?? ''}>{`显示 ${lines.length} / ${totalLines} 行`}</span>
            )}
            <span class={css.lang ?? ''}>{lang ?? ''}</span>
            {/* Hide copy on an empty window, matching TerminalBlock's empty-output
                guard: a successful read of an empty file returns lines: [] with
                card:'read', so this branch is reachable, and copying then would
                wipe the clipboard with an empty string. */}
            {lines.length > 0 && (
              <button type="button" class={css.copyButton ?? ''} onclick={() => this.#copyFeedback?.onCopy()}>
                {copied ? '复制成功' : '复制'}
              </button>
            )}
          </div>
        </div>
        <div class={css.body ?? ''}>
          {rows(capped ? paired.slice(0, headLines) : paired)}
          {hidden > 0 && (
            <button
              type="button"
              class={css.expand ?? ''}
              aria-expanded={this.#expanded}
              aria-label={this.#expanded ? '收起内容' : `展开其余 ${hidden} 行`}
              onclick={() => { this.#expanded = !this.#expanded; this.#render() }}
            >
              {this.#expanded ? '收起' : `… 其余 ${hidden} 行`}
            </button>
          )}
          {capped && rows(paired.slice(paired.length - tailLines))}
        </div>
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-read-block') === undefined) {
  customElements.define('dsh-read-block', DshReadBlock)
}

/**
 * Create (if needed) or update a ReadBlock element in place.
 * @param el - an existing `dsh-read-block` element to update, or null to create one.
 * @param props - see {@link ReadBlockProps}.
 * @returns the `dsh-read-block` element; keep it and pass it back in to update.
 */
export function renderReadBlock(el: DshReadBlock | null, props: ReadBlockProps): DshReadBlock {
  const target = el ?? document.createElement('dsh-read-block') as DshReadBlock
  target.setProps(props)
  return target
}

/**
 * One-shot creation helper preserving the original function-component call
 * shape. Cast to `JSX.Element` (Modal.tsx's pattern) so `<ReadBlock ... />`
 * typechecks as a JSX component call.
 */
export function ReadBlock(props: ReadBlockProps): JSX.Element {
  return renderReadBlock(null, props) as unknown as JSX.Element
}
