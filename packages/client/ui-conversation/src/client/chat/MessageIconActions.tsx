// Shared IconActions chrome for user and assistant messages: copy
// live, optional branch wiring, and an optional date-aware clock.
//
// Converted from a React hooks component to a webjsx custom element:
// copied/copyPending/copyTimer/copyEpoch useState/useRef become private
// fields, useId becomes a per-instance generated id, useCallback/useEffect
// become plain methods plus connectedCallback/disconnectedCallback, and
// re-render is an explicit applyDiff(this, vdom) call.

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import {
  IconBranchOutline16, IconCheckOutline16, IconCopyOutline16, Tooltip, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { formatLatencySeconds, formatMessageClock, formatRunDuration, formatTokensPerSecond } from './message-chrome.ts'
import { createCalendarDay } from './use-calendar-day.ts'
import css from './MessageIconActions.module.css'

export interface MessageIconActionsProps {
  /** Plain text the copy action writes. */
  text: string
  /** Unix epoch ms for the clock label; omitted for transient messages. */
  time?: number | undefined
  /** Turn wall time in ms, appended to the clock as `· Ran for 15s`; omitted when the turn's start is unknown. */
  runMs?: number | undefined
  /** Turn first-step TTFT in ms, appended as `· TTFT 1.2s`; omitted when unrecorded. */
  ttftMs?: number | undefined
  /** Turn decode throughput, appended as `· 34 tok/s`; omitted when unrecorded. */
  tokensPerSecond?: number | undefined
  /** Clock before icons (user) or after (assistant). */
  clock: 'start' | 'end'
  /** Fork the session at this message; omission hides the branch action. */
  onBranch?: (() => void) | undefined
  /** The message is not a completed transcript tail, so branch stays visible but unavailable. */
  branchUnavailable?: boolean | undefined
  /** Parent layout class composed onto the actions row. */
  className?: string | undefined
  /**
   * Slot-rendered actions owned by independent plugins, placed between the
   * built-in copy and branch controls.
   */
  extraActions?: VNode | VNode[] | string | null
  /** The owning view's locale seat, passed down as a plain prop. */
  t: ChatViewSlotProps['t']
}

const DEFAULT_PROPS: MessageIconActionsProps = { text: '', clock: 'start', t: (key: string) => key }

let nextReasonId = 0

/**
 * Copy / branch (/ clock) IconActions row shared by user and assistant chrome.
 */
export class DshMessageIconActions extends HTMLElement {
  #props: MessageIconActionsProps = DEFAULT_PROPS
  #reasonId = `message-icon-actions-branch-reason-${(nextReasonId += 1)}`
  // Same success chrome as CodeBlock: a short check swap after the write,
  // gated so re-clicks during the window neither re-copy nor stack timers.
  #copied = false
  #copyPending = false
  #copyTimer: ReturnType<typeof setTimeout> | null = null
  #copyEpoch = 0
  #day = createCalendarDay(() => { this.#render() })

  setProps(props: MessageIconActionsProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  disconnectedCallback(): void {
    this.#copyEpoch += 1
    this.#copyPending = false
    if (this.#copyTimer !== null) clearTimeout(this.#copyTimer)
    this.#day.stop()
  }

  #onCopy = (): void => {
    if (this.#copied || this.#copyPending) return
    const epoch = this.#copyEpoch
    this.#copyPending = true
    void writeClipboard(this.#props.text).then((ok) => {
      if (epoch !== this.#copyEpoch) return
      this.#copyPending = false
      if (!ok) return
      this.#copied = true
      this.#render()
      this.#copyTimer = window.setTimeout(() => {
        this.#copyTimer = null
        this.#copied = false
        this.#render()
      }, 1000)
    })
  }

  #render(): void {
    const {
      text: _text, time, runMs, ttftMs, tokensPerSecond, clock, onBranch, branchUnavailable = false, className,
      extraActions, t,
    } = this.#props
    const copied = this.#copied
    const day = this.#day.day
    // The dot is decorative and stays hidden, but its margins separate the
    // readings only on screen: without the flanking spaces a reader hears one
    // run-on string ("Ran for 13sTTFT 0.2s12 tok/s") instead of three facts.
    const clockEl = time === undefined ? null : (
      <span class={(clock === 'start' ? css.timeStart : css.timeEnd) ?? ''}>
        {formatMessageClock(time, t, day)}
        {runMs !== undefined && (
          <>
            {' '}
            <span class={css.runTimeDot ?? ''} aria-hidden>·</span>
            {' '}
            {t('message.ranFor', { duration: formatRunDuration(runMs, t) })}
          </>
        )}
        {ttftMs !== undefined && (
          <>
            {' '}
            <span class={css.runTimeDot ?? ''} aria-hidden>·</span>
            {' '}
            {t('message.ttft', { seconds: formatLatencySeconds(ttftMs) })}
          </>
        )}
        {tokensPerSecond !== undefined && (
          <>
            {' '}
            <span class={css.runTimeDot ?? ''} aria-hidden>·</span>
            {' '}
            {t('message.tokensPerSecond', { tps: formatTokensPerSecond(tokensPerSecond) })}
          </>
        )}
      </span>
    )
    const vdom = (
      <div class={className === undefined ? css.actions ?? '' : `${css.actions ?? ''} ${className}`}>
        {clock === 'start' ? clockEl : null}
        <Tooltip label={copied ? t('copied') : t('copy')} side="bottom">
          <button type="button" class={css.action ?? ''} aria-label={copied ? t('copied') : t('copy')} onclick={this.#onCopy}>
            {copied ? <IconCheckOutline16 /> : <IconCopyOutline16 />}
          </button>
        </Tooltip>
        {extraActions}
        {onBranch !== undefined && (
          <Tooltip label={branchUnavailable ? t('message.branchUnavailable') : t('message.branch')} side="bottom">
            {/* Native disabled buttons do not deliver the hover/focus events Tooltip needs. */}
            <button
              type="button"
              class={css.action ?? ''}
              aria-label={t('message.branch')}
              aria-disabled={branchUnavailable || undefined}
              aria-describedby={branchUnavailable ? this.#reasonId : undefined}
              data-unavailable={branchUnavailable || undefined}
              onclick={branchUnavailable ? null : onBranch}
            >
              <IconBranchOutline16 />
            </button>
          </Tooltip>
        )}
        {onBranch !== undefined && branchUnavailable && (
          <span id={this.#reasonId} class={css.visuallyHidden ?? ''}>{t('message.branchUnavailable')}</span>
        )}
        {clock === 'end' ? clockEl : null}
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-message-icon-actions') === undefined) {
  customElements.define('dsh-message-icon-actions', DshMessageIconActions)
}

/**
 * Create (if needed) or update a MessageIconActions element in place.
 * @param el - an existing `dsh-message-icon-actions` element to update, or null to create one.
 * @param props - see {@link MessageIconActionsProps}.
 * @returns the `dsh-message-icon-actions` element; keep it and pass it back in to update.
 */
export function renderMessageIconActions(
  el: DshMessageIconActions | null,
  props: MessageIconActionsProps,
): DshMessageIconActions {
  const target = el ?? document.createElement('dsh-message-icon-actions') as DshMessageIconActions
  target.setProps(props)
  return target
}

/** One-shot creation helper preserving the original function-component call shape. */
export function MessageIconActions(props: MessageIconActionsProps): JSX.Element {
  return renderMessageIconActions(null, props) as unknown as JSX.Element
}
