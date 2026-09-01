// TerminalBlock: the terminal surface for a shell command and its output —
// prompt line (run-state dot + shortened cwd + command), ANSI-colored output,
// settled exit status, and a copy control for the raw output. Output never soft-wraps:
// column-aligned output (ls, tables, box drawing) keeps its alignment and
// scrolls horizontally instead of folding. Colors resolve through --dsw-*
// tokens; ANSI parsing lives in ansi.ts.
//
// Converted from a React hooks component to a webjsx custom element:
// expanded becomes an instance field, and copy feedback now uses the
// createCopyFeedback factory (replacing the old useCopyFeedback hook) driven
// from connectedCallback/disconnectedCallback. Re-render is an explicit
// applyDiff(this, vdom) call (Toast.tsx's pattern).

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import clsx from 'clsx'
import { parseAnsiLines, type AnsiLine } from './ansi.ts'
import { headTailCap } from './head-tail-cap.ts'
import { createCopyFeedback, type CopyFeedbackController } from './use-copy-feedback.ts'
import { Pill } from './Pill.tsx'
import { StateDot, type StateDotState } from './StateDot.tsx'
import css from './TerminalBlock.css.ts'

/**
 * Output lines shown before the height cap collapses the middle. Matches the
 * TUI transcript's default tool-output budget so both front ends cut a long
 * command's output at the same place.
 */
export const DEFAULT_TERMINAL_MAX_LINES = 16

/**
 * Display copy for the terminal surface; the owner passes localized labels
 * (this package is cordis-free, so copy arrives via props). Every field
 * defaults to the current built-in value, so existing consumers render
 * unchanged.
 */
export interface TerminalBlockLabels {
  /** Status pill text for a signal-terminated command. */
  signal: (signal: string) => string
  /** Status pill text for a non-zero exit code. */
  exitCode: (exitCode: number) => string
  /** Run-state text while the command is still running. */
  running: string
  /** Run-state text for a signal or non-zero-exit settle. */
  failed: string
  /** Run-state text for a clean settle. */
  done: string
  /** Copy-button idle label. */
  copy: string
  /** Copy-button label during the post-copy confirmation window. */
  copied: string
  /** Placeholder when a settled command produced no visible output. */
  noOutput: string
  /** Collapse-toggle aria label while expanded. */
  collapseAria: string
  /** Collapse-toggle text while expanded. */
  collapse: string
  /** Expand-toggle aria label while capped, given the hidden line count. */
  expandAria: (hidden: number) => string
  /** Expand-toggle text while capped, given the hidden line count. */
  expand: (hidden: number) => string
}

const DEFAULT_LABELS: TerminalBlockLabels = {
  signal: signal => `信号 ${signal}`,
  exitCode: exitCode => `退出码 ${exitCode}`,
  running: '运行中',
  failed: '失败',
  done: '已完成',
  copy: '复制',
  copied: '复制成功',
  noOutput: '无输出',
  collapseAria: '收起输出',
  collapse: '收起',
  expandAria: hidden => `展开其余 ${hidden} 行输出`,
  expand: hidden => `… 其余 ${hidden} 行`,
}

export interface TerminalBlockProps {
  /** The command line, rendered verbatim after the prompt label. */
  command: string
  /** Working directory for the prompt label; absent renders a plain `$`. */
  cwd?: string | undefined
  /** Absolute home directory, so a cwd equal to it collapses to `~`; absent disables that collapse. */
  home?: string | undefined
  /** The command's output text; may contain ANSI escape sequences. */
  output?: string | undefined
  /** Settled exit code; a non-zero value renders the status pill. */
  exitCode?: number | undefined
  /** Settled terminating signal name; any value renders the status pill, taking precedence over the exit code. */
  signal?: string | undefined
  /** The command is still running: the block shows the prompt line alone. */
  running?: boolean | undefined
  /** Height cap in output lines before the middle collapses (default {@link DEFAULT_TERMINAL_MAX_LINES}); Infinity disables the cap. */
  maxLines?: number | undefined
  /** Extra class merged onto the wrapper (callers position; this component draws). */
  className?: string | undefined
  /** Localized display copy; omitted fields keep the built-in defaults. */
  labels?: Partial<TerminalBlockLabels> | undefined
}

/**
 * Prompt label for a working directory: `~` for the home directory itself,
 * otherwise the path's last segment (both separators accepted, trailing
 * separators ignored), falling back to the path itself when it has no
 * segment.
 * @param cwd - the working directory path.
 * @param home - absolute home directory, when the caller knows it.
 * @returns the prompt label.
 */
function promptLabel(cwd: string, home: string | undefined): string {
  const trimmed = cwd.replace(/[/\\]+$/, '')
  if (home !== undefined && trimmed === home.replace(/[/\\]+$/, '')) return '~'
  const segment = trimmed.split(/[/\\]/).pop()
  return segment === undefined || segment === '' ? cwd : segment
}

function statusText(
  exitCode: number | undefined,
  signal: string | undefined,
  labels: TerminalBlockLabels,
): string | undefined {
  if (signal !== undefined) return labels.signal(signal)
  if (exitCode !== undefined && exitCode !== 0) return labels.exitCode(exitCode)
  return undefined
}

function runState(
  running: boolean,
  exitCode: number | undefined,
  signal: string | undefined,
  labels: TerminalBlockLabels,
): { state: StateDotState; label: string } {
  if (running) return { state: 'ongoing', label: labels.running }
  if (statusText(exitCode, signal, labels) !== undefined) return { state: 'error', label: labels.failed }
  return { state: 'done', label: labels.done }
}

function renderLine(line: AnsiLine): (VNode | string)[] {
  return line.map((span, index) => span.style === undefined
    ? span.text
    : <span key={index} style={span.style}>{span.text}</span>)
}

const DEFAULT_PROPS: TerminalBlockProps = { command: '' }

/** Shell command + output terminal surface, as a custom element. */
export class DshTerminalBlock extends HTMLElement {
  #props: TerminalBlockProps = DEFAULT_PROPS
  #expanded = false
  #copyFeedback: CopyFeedbackController | null = null

  setProps(props: TerminalBlockProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    // The raw output, never the rendered tree: the prompt line and the status
    // pill are chrome the user did not run.
    this.#copyFeedback = createCopyFeedback(() => this.#props.output ?? '', () => { this.#render() })
    this.#render()
  }

  disconnectedCallback(): void {
    this.#copyFeedback?.stop()
    this.#copyFeedback = null
  }

  #render(): void {
    const {
      command, cwd, home, output, exitCode, signal, running = false,
      maxLines = DEFAULT_TERMINAL_MAX_LINES, className, labels,
    } = this.#props
    const copy: TerminalBlockLabels = labels === undefined ? DEFAULT_LABELS : { ...DEFAULT_LABELS, ...labels }
    const text = output ?? ''

    // A command's output ends with a newline; that terminator is not an extra
    // blank line to draw or to count against the height cap.
    const parsed = parseAnsiLines(text)
    const last = parsed[parsed.length - 1]
    const terminated = parsed.length > 1 && last !== undefined
      && last.every(span => span.text === '')
    const lines = terminated ? parsed.slice(0, -1) : parsed

    const copied = this.#copyFeedback?.copied ?? false

    const status = statusText(exitCode, signal, copy)
    const state = runState(running, exitCode, signal, copy)
    const body = command.endsWith('\n') ? command.slice(0, -1) : command
    const commandLines = body.split('\n')
    const empty = lines.every(line => line.every(span => span.text.trim() === ''))
    const { hidden, capped, headLines, tailLines } = headTailCap(lines.length, maxLines, this.#expanded)

    const vdom = (
      <div class={clsx(css.block, className)} data-terminal="" data-running={running ? '' : undefined}>
        <div class={css.header ?? ''}>
          <div class={css.prompt ?? ''}>
            <span class={css.runStateLabel ?? ''}>{state.label}</span>
            {commandLines.map((line, index) => (
              <div key={index} class={css.promptLine ?? ''}>
                {index === 0 && <StateDot state={state.state} className={css.runState} />}
                <span class={css.cwd ?? ''}>
                  {index > 0 || cwd === undefined ? '$' : promptLabel(cwd, home)}
                </span>
                <span class={css.command ?? ''}>{line}</span>
              </div>
            ))}
          </div>
          {status !== undefined && <Pill class={css.status ?? ''}>{status}</Pill>}
          {!running && !empty && (
            <button type="button" class={css.copyButton ?? ''} onclick={() => this.#copyFeedback?.onCopy()}>
              {copied ? copy.copied : copy.copy}
            </button>
          )}
        </div>
        {!running && (empty
          ? <div class={css.empty ?? ''}>{copy.noOutput}</div>
          : (
            <div class={css.output ?? ''}>
              {(capped ? lines.slice(0, headLines) : lines).map((line, index) => (
                <div key={index} class={css.line ?? ''}>{renderLine(line)}</div>
              ))}
              {hidden > 0 && (
                <button
                  type="button"
                  class={css.expand ?? ''}
                  aria-expanded={this.#expanded}
                  aria-label={this.#expanded ? copy.collapseAria : copy.expandAria(hidden)}
                  onclick={() => { this.#expanded = !this.#expanded; this.#render() }}
                >
                  {this.#expanded ? copy.collapse : copy.expand(hidden)}
                </button>
              )}
              {capped && lines.slice(lines.length - tailLines).map((line, index) => (
                <div key={index} class={css.line ?? ''}>{renderLine(line)}</div>
              ))}
            </div>
          ))}
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-terminal-block') === undefined) {
  customElements.define('dsh-terminal-block', DshTerminalBlock)
}

/**
 * Create (if needed) or update a TerminalBlock element in place.
 * @param el - an existing `dsh-terminal-block` element to update, or null to create one.
 * @param props - see {@link TerminalBlockProps}.
 * @returns the `dsh-terminal-block` element; keep it and pass it back in to update.
 */
export function renderTerminalBlock(el: DshTerminalBlock | null, props: TerminalBlockProps): DshTerminalBlock {
  const target = el ?? document.createElement('dsh-terminal-block') as DshTerminalBlock
  target.setProps(props)
  return target
}

/** One-shot creation helper preserving the original function-component call shape. */
export function TerminalBlock(props: TerminalBlockProps): JSX.Element {
  return renderTerminalBlock(null, props) as unknown as JSX.Element
}
