// CodeBlock: one code surface for every consumer — markdown fences, the
// run_code program body, and the details panel's raw args/output — with
// shiki highlighting for the registered grammars and an identical-geometry
// plain fallback for everything else. Chrome (language banner + copy) matches
// deepsuite `@deepseek/md` code blocks; token colors stay on `--shiki-*`.
//
// Converted from a React hooks component to a webjsx custom element: the
// `copied` useState becomes a private field, the useSyncExternalStore grammar
// subscription becomes an explicit subscribe/unsubscribe pair in
// connectedCallback/disconnectedCallback, the useMemo'd highlight becomes a
// plain recompute inside #render (cheap relative to the DOM diff), and the
// rootRef becomes `this` itself (the element IS the root).

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import clsx from 'clsx'
import { writeClipboard } from '../clipboard.ts'
import { highlightToHtml, subscribeGrammarLoaded } from './highlight.ts'
import css from './CodeBlock.css.ts'

export interface CodeBlockProps {
  /** The source text, rendered verbatim (trailing newline trimmed for display). */
  code: string
  /** Grammar hint (markdown fence info string or a fixed caller id); unknown = plain. */
  lang?: string | undefined
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  class?: string | undefined
  /** Copy-button idle label; the owner passes localized copy (this package is cordis-free, so copy arrives via props). */
  copyLabel?: string | undefined
  /** Copy-button label during the post-copy confirmation window. */
  copiedLabel?: string | undefined
}

export class DshCodeBlock extends HTMLElement {
  #props: CodeBlockProps = { code: '' }
  #copied = false
  #unsubscribe: (() => void) | null = null

  setProps(props: CodeBlockProps): void {
    this.#props = props
    this.#copied = false
    this.#render()
  }

  connectedCallback(): void {
    this.#unsubscribe = subscribeGrammarLoaded(() => {
      this.#render()
    })
    this.#render()
  }

  disconnectedCallback(): void {
    this.#unsubscribe?.()
    this.#unsubscribe = null
  }

  #onCopy = (): void => {
    if (this.#copied) return
    const trimmed = this.#trimmed()
    /* v8 ignore next -- both arms always mount a <pre>; trimmed is the
       typed fallback if the DOM shape ever diverges. */
    const text = this.querySelector('pre')?.textContent ?? trimmed
    void writeClipboard(text).then((ok) => {
      if (!ok) return
      this.#copied = true
      this.#render()
      window.setTimeout(() => {
        this.#copied = false
        this.#render()
      }, 1000)
    })
  }

  #trimmed(): string {
    const { code } = this.#props
    return code.endsWith('\n') ? code.slice(0, -1) : code
  }

  #render(): void {
    const { lang, class: extraClass, copyLabel = '复制', copiedLabel = '复制成功' } = this.#props
    const trimmed = this.#trimmed()
    const html = highlightToHtml(trimmed, lang)

    const body: VNode = html === undefined
      ? (
        <pre class={css.plain ?? ''}><code>{trimmed}</code></pre>
      )
      // shiki's output is a static span tree it generated from `code` (no user
      // HTML passes through), the sanctioned innerHTML consumption path per
      // shiki's own docs.
      : <div dangerouslySetInnerHTML={{ __html: html }} />

    const vdom = (
      <div class={clsx(css.block, 'md-code-block', extraClass)}>
        <div class={css.bannerWrap ?? ''}>
          <div class={css.banner ?? ''}>
            <div class={css.infostring ?? ''}>{lang ?? ''}</div>
            <div class={css.action ?? ''}>
              <button type="button" class={css.copyButton ?? ''} onclick={this.#onCopy}>
                {this.#copied ? copiedLabel : copyLabel}
              </button>
            </div>
          </div>
        </div>
        {body}
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-code-block') === undefined) {
  customElements.define('dsh-code-block', DshCodeBlock)
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      /** The custom element itself; props flow through the `ref`-driven
       * setProps call render.tsx makes, not JSX attributes — this host tag
       * exists only so applyDiff has a real element to key and reconcile. */
      'dsh-code-block': { key?: string | number; ref?: (node: DshCodeBlock | null) => void }
    }
  }
}

/**
 * Create (if needed) or update a CodeBlock element in place.
 * @param el - an existing `dsh-code-block` element to update, or null to create one.
 * @param props - see {@link CodeBlockProps}.
 * @returns the `dsh-code-block` element; keep it and pass it back in to update.
 */
export function renderCodeBlock(el: DshCodeBlock | null, props: CodeBlockProps): DshCodeBlock {
  const target = el ?? document.createElement('dsh-code-block') as DshCodeBlock
  target.setProps(props)
  return target
}

/** One-shot creation helper preserving the original function-component call shape. */
export function CodeBlock(props: CodeBlockProps): JSX.Element {
  return renderCodeBlock(null, props) as unknown as JSX.Element
}
