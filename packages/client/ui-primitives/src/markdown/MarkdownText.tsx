/**
 * Untrusted assistant-Markdown renderer over the direct mdast pipeline:
 * `parse.ts` grammars, the incremental streaming parser, and `render.tsx`.
 * While a message streams, all but the trailing two blocks freeze as cached
 * webjsx elements and only the source tail behind them re-parses per chunk,
 * so per-chunk work tracks the tail size instead of the whole reply. Frozen
 * blocks keep their source-offset keys when they cross the freeze boundary,
 * so `applyDiff` reconciles instead of remounting. Known deviation while
 * streaming: a reference-style link or footnote whose definition sits on the
 * other side of the freeze boundary renders literally until the settled
 * full parse self-heals it.
 *
 * Converted from a React `memo` function component (its own `useRef`-held
 * `StreamingRenderer` instance plus a `useMemo`'d children computation) to a
 * webjsx custom element: the refs become private fields, the memo'd
 * computation becomes a plain recompute inside #render guarded by a
 * last-props identity check (mirroring `memo`'s prop-equality skip and the
 * inner `useMemo`'s dependency list), and DOM update is an explicit
 * applyDiff(this, vdom) call.
 */

import { applyDiff } from 'webjsx'
import type { JSXChildTypes, VNode } from 'webjsx'
import { IncrementalMarkdownParser } from './incremental.ts'
import { parseGfm, parseGfmWithMath } from './parse.ts'
import {
  collectReferenceTargets, createReferenceTargets, renderBlocks, renderFootnoteSection,
  wrapBlockChildren,
} from './render.tsx'
import type { MarkdownCodeLabels, MarkdownFileMentions, MarkdownRenderContext, ReferenceTargets } from './render.tsx'
import 'katex/dist/katex.min.css'
import css from './MarkdownText.module.css'

export type { MarkdownCodeLabels, MarkdownFileMentions } from './render.tsx'

type RNode = JSXChildTypes

/** One settled full render: parse with math, resolve references, append the footnote section. */
function renderSettled(
  text: string,
  codeLabels: MarkdownCodeLabels | undefined,
  fileMentions: MarkdownFileMentions | undefined,
): RNode[] {
  const root = parseGfmWithMath(text)
  const targets = createReferenceTargets()
  collectReferenceTargets(root.children, targets)
  const context: MarkdownRenderContext = {
    streaming: false,
    codeLabels,
    fileMentions,
    targets,
    footnoteOrder: [],
    footnoteCounts: new Map(),
  }
  const blocks = wrapBlockChildren(
    renderBlocks(root.children.map((node, index) => ({ node, key: index })), context),
    false,
  )
  const section = renderFootnoteSection(context)
  return section === null ? blocks : [...blocks, '\n', section]
}

/**
 * Streaming render state for one growing message: the incremental parser,
 * the frozen blocks' cached elements, and the reference/footnote state their
 * rendering consumed (footnote numbering assigned to frozen references is
 * final, so the tail continues from a copy of it each frame).
 */
class StreamingRenderer {
  private readonly parser = new IncrementalMarkdownParser(parseGfm)
  private generation = -1
  private frozenCount = 0
  private frozenElements: RNode[] = []
  private frozenTargets: ReferenceTargets = createReferenceTargets()
  private frozenFootnoteOrder: string[] = []
  private frozenFootnoteCounts = new Map<string, number>()
  private lastText: string | null = null
  private lastRendered: RNode[] = []

  /** @param codeLabels - Fence copy labels baked into cached elements; the owner replaces the renderer when they change. */
  constructor(private readonly codeLabels: MarkdownCodeLabels | undefined) {}

  /**
   * Render the current accumulated text. Idempotent per text value, so the
   * caller may invoke it from a render path that re-executes freely.
   * @param text - The full accumulated markdown source.
   * @returns Frozen elements, re-rendered tail, and the footnote section.
   */
  render(text: string): RNode[] {
    if (text === this.lastText) return this.lastRendered
    const { frozen, tail, generation } = this.parser.update(text)
    if (generation !== this.generation) {
      this.generation = generation
      this.frozenCount = 0
      this.frozenElements = []
      this.frozenTargets = createReferenceTargets()
      this.frozenFootnoteOrder = []
      this.frozenFootnoteCounts = new Map()
    }
    const newlyFrozen = frozen.slice(this.frozenCount)
    collectReferenceTargets(newlyFrozen.map(block => block.node), this.frozenTargets)
    // Targets visible this frame: everything frozen so far plus the current
    // tail parse — a newly frozen block's references resolved against the
    // same parse tree its definitions came from.
    const frameTargets: ReferenceTargets = {
      definitions: new Map(this.frozenTargets.definitions),
      footnotes: new Map(this.frozenTargets.footnotes),
    }
    collectReferenceTargets(tail.map(block => block.node), frameTargets)
    if (newlyFrozen.length > 0) {
      const frozenContext: MarkdownRenderContext = {
        streaming: true,
        codeLabels: this.codeLabels,
        fileMentions: undefined,
        targets: frameTargets,
        footnoteOrder: this.frozenFootnoteOrder,
        footnoteCounts: this.frozenFootnoteCounts,
      }
      // Separator newlines are cached alongside the elements so the
      // assembled children match the settled pipeline's block wrapping.
      const batch = [...this.frozenElements]
      for (const element of renderBlocks(newlyFrozen, frozenContext)) {
        if (batch.length > 0) batch.push('\n')
        batch.push(element)
      }
      this.frozenElements = batch
      this.frozenCount = frozen.length
    }
    const tailContext: MarkdownRenderContext = {
      streaming: true,
      codeLabels: this.codeLabels,
      fileMentions: undefined,
      targets: frameTargets,
      footnoteOrder: [...this.frozenFootnoteOrder],
      footnoteCounts: new Map(this.frozenFootnoteCounts),
    }
    const children = [...this.frozenElements]
    for (const element of renderBlocks(tail, tailContext)) {
      if (children.length > 0) children.push('\n')
      children.push(element)
    }
    const section = renderFootnoteSection(tailContext)
    if (section !== null) children.push('\n', section)
    this.lastText = text
    this.lastRendered = children
    return this.lastRendered
  }
}

export interface MarkdownTextProps {
  /** Markdown source text preserved by the session projection. */
  text: string
  /** `streaming` renders fences and TeX plain (highlighting and KaTeX land on
   * the finalize swap) and parses incrementally across chunks. */
  streaming?: boolean
  /** Forwards localized copy-button labels to fence CodeBlocks — pass a
   * reference-stable object (memoized per locale revision), because a new
   * identity discards the streaming render cache mid-message. */
  codeLabels?: MarkdownCodeLabels | undefined
  /** Links inline-code tokens its resolver recognizes as real files; this is
   * the single streaming gate — it applies to settled renders only, because a
   * streaming message's vocabulary is not final and frozen cached elements
   * must not bake in handlers that could go stale. */
  fileMentions?: MarkdownFileMentions | undefined
}

function propsEqual(a: MarkdownTextProps, b: MarkdownTextProps): boolean {
  return a.text === b.text && (a.streaming ?? false) === (b.streaming ?? false)
    && a.codeLabels === b.codeLabels && a.fileMentions === b.fileMentions
}

/**
 * Render untrusted assistant-authored Markdown as semantic webjsx elements.
 * A GFM document with TeX math rendered through KaTeX; raw HTML, relative
 * links, and unsafe protocols are disabled, while absolute HTTP(S) images
 * render directly.
 */
export class DshMarkdownText extends HTMLElement {
  #props: MarkdownTextProps = { text: '' }
  #stream: StreamingRenderer | null = null
  #streamLabels: MarkdownCodeLabels | undefined
  #lastProps: MarkdownTextProps | null = null
  #lastChildren: RNode[] = []

  setProps(props: MarkdownTextProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  #computeChildren(): RNode[] {
    const { text, streaming = false, codeLabels, fileMentions } = this.#props
    if (!streaming) {
      this.#stream = null
      return renderSettled(text, codeLabels, fileMentions)
    }
    if (this.#stream === null || this.#streamLabels !== codeLabels) {
      this.#stream = new StreamingRenderer(codeLabels)
      this.#streamLabels = codeLabels
    }
    return this.#stream.render(text)
  }

  #render(): void {
    // Mirrors the React version's memo (skip on identical props) plus the
    // inner useMemo (recompute children only when a dependency changed).
    const children = this.#lastProps !== null && propsEqual(this.#lastProps, this.#props)
      ? this.#lastChildren
      : this.#computeChildren()
    this.#lastProps = this.#props
    this.#lastChildren = children
    const vdom: VNode = <div class={css.markdown ?? ''}>{children}</div>
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-markdown-text') === undefined) {
  customElements.define('dsh-markdown-text', DshMarkdownText)
}

/**
 * Create (if needed) or update a MarkdownText element in place.
 * @param el - an existing `dsh-markdown-text` element to update, or null to create one.
 * @param props - see {@link MarkdownTextProps}.
 * @returns the `dsh-markdown-text` element; keep it and pass it back in to update
 * (required for the streaming cache and settled-state memoization to persist
 * across renders of the same message).
 */
export function renderMarkdownText(el: DshMarkdownText | null, props: MarkdownTextProps): DshMarkdownText {
  const target = el ?? document.createElement('dsh-markdown-text') as DshMarkdownText
  target.setProps(props)
  return target
}

/**
 * One-shot creation helper preserving the original function-component call
 * shape. Cast to `JSX.Element` (Modal.tsx's pattern) so `<MarkdownText ... />`
 * typechecks as a JSX component call — the returned `DshMarkdownText` is a
 * real custom element, structurally not a webjsx `VElement`, but a caller
 * embedding it as a JSX child (e.g. WebBlock's answer panel) relies on
 * webjsx's DOM-node passthrough, not vdom diffing of its internals.
 */
export function MarkdownText(props: MarkdownTextProps): JSX.Element {
  return renderMarkdownText(null, props) as unknown as JSX.Element
}
