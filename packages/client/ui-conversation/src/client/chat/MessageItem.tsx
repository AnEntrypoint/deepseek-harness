// MessageItem: simple chat nodes — user and consumed-steering bubbles
// (right-aligned, with clock + copy IconActions; branch lives only under
// assistant answers), pending steering (copy only), context injection,
// compaction marker, retry disclosure, and unknown-surface JSON rows.
//
// Converted from React function components (some memo-wrapped, one with
// useState/useEffect/useMemo for the retry countdown) to plain webjsx
// functions plus one custom element for ModelRetryItem's timer state.

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import type {
  ModelRetryNode, TurnErrorNode, UserMessageNode,
} from '@deepseek-ai/dsh-client-runtime/client'
import { JsonBlock, MessageText, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatNodeOwnerProps, ChatNodeViewProps, ChatViewSlotProps } from '../contract/slots.ts'
import { ReferenceIcon } from '../reference/ReferenceIcon.tsx'
import { CompactionItem } from './CompactionItem.tsx'
import { ContextInjectionRow } from './ContextInjectionRow.tsx'
import { MessageIconActions } from './MessageIconActions.tsx'
import css from './MessageItem.module.css'

type UserImage = Extract<UserMessageNode['content'][number], { type: 'image' }>

function contentParts(content: readonly unknown[]): {
  text: string
  images: { attachment: UserImage['attachment'] }[]
  rest: unknown[]
} {
  const texts: string[] = []
  const images: { attachment: UserImage['attachment'] }[] = []
  const rest: unknown[] = []
  for (const block of content) {
    const b = block as { type?: string; text?: string; attachment?: unknown }
    if (b.type === 'text' && typeof b.text === 'string') texts.push(b.text)
    else if (b.type === 'image' && b.attachment !== undefined) {
      images.push({ attachment: (b as UserImage).attachment })
    }
    else rest.push(block)
  }
  return { text: texts.join(''), images, rest }
}

function retrySeconds(milliseconds: number): number {
  return Math.max(1, Math.ceil(milliseconds / 1_000))
}

/** Correlated retry-chain row: a countdown custom element (private timer state). */
export interface ModelRetryItemProps {
  node: ModelRetryNode
  active: boolean
  t: ChatViewSlotProps['t']
}

const DEFAULT_RETRY_PROPS: ModelRetryItemProps = {
  node: { delayMs: 0, seq: 0, mode: 'normal', maxRetries: 0, retry: 0, retryState: 'scheduled', failure: { message: '' } } as unknown as ModelRetryNode,
  active: false,
  t: (key: string) => key,
}

/** Retry countdown row custom element: the deadline/interval timer becomes private state. */
export class DshModelRetryItem extends HTMLElement {
  #props: ModelRetryItemProps = DEFAULT_RETRY_PROPS
  #deadline = 0
  #deadlineKey: string | null = null
  #timer: ReturnType<typeof setInterval> | null = null

  setProps(props: ModelRetryItemProps): void {
    const key = `${props.node.delayMs}:${props.node.seq}`
    this.#props = props
    if (key !== this.#deadlineKey) {
      // Anchor the host-scheduled delay to this browser's first render of the
      // retry node. Host event time and Date.now() may belong to different clocks.
      this.#deadlineKey = key
      this.#deadline = Date.now() + props.node.delayMs
    }
    this.#syncTimer()
    this.#render()
  }

  connectedCallback(): void {
    this.#syncTimer()
    this.#render()
  }

  disconnectedCallback(): void {
    this.#clearTimer()
  }

  #clearTimer(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer)
      this.#timer = null
    }
  }

  #syncTimer(): void {
    this.#clearTimer()
    if (!this.#props.active) return
    const tick = (): void => {
      const next = retrySeconds(this.#deadline - Date.now())
      this.#render()
      if (next === 1) this.#clearTimer()
    }
    if (retrySeconds(this.#deadline - Date.now()) === 1) return
    this.#timer = setInterval(tick, 250)
  }

  #render(): void {
    const { node, active, t } = this.#props
    const scheduledSeconds = retrySeconds(node.delayMs)
    const maximum = node.mode === 'normal' ? node.maxRetries : '∞'
    const remainingSeconds = retrySeconds(this.#deadline - Date.now())
    const label = active
      ? t('message.retry.active')
      : node.retryState === 'cancelled'
        ? t('message.retry.cancelled')
        : node.retryState === 'started'
          ? t('message.retry.started')
          : t('message.retry.scheduled')
    const seconds = active ? remainingSeconds : scheduledSeconds

    const vdom = (
      <details class={css.retryRow ?? ''} data-active={active || undefined}>
        <summary class={css.retrySummary ?? ''}>
          <span class={css.retryText ?? ''} role="status">
            {t('message.retry.status', { label, retry: node.retry, maximum, seconds })}
          </span>
        </summary>
        <div class={css.retryDetails ?? ''}>
          <div>
            <span class={css.retryDetailLabel ?? ''}>{t('message.retry.delay')}</span>
            {Math.round(node.delayMs)}ms
          </div>
          <div>
            <span class={css.retryDetailLabel ?? ''}>{t('message.retry.failure')}</span>
            {node.failure.message}
          </div>
        </div>
      </details>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-model-retry-item') === undefined) {
  customElements.define('dsh-model-retry-item', DshModelRetryItem)
}

function renderModelRetryItem(el: DshModelRetryItem | null, props: ModelRetryItemProps): DshModelRetryItem {
  const target = el ?? document.createElement('dsh-model-retry-item') as DshModelRetryItem
  target.setProps(props)
  return target
}

function ModelRetryItem(props: ModelRetryItemProps): JSX.Element {
  return renderModelRetryItem(null, props) as unknown as JSX.Element
}

/** Persistent, turn-positioned feedback for a terminal failure. */
function TurnErrorItem({ node, t }: {
  node: TurnErrorNode
  t: ChatViewSlotProps['t']
}): JSX.Element {
  return (
    <div class={css.turnErrorRow ?? ''} role="status">
      <StateDot state="error" className={css.turnErrorDot} />
      <div class={css.turnErrorCopy ?? ''}>
        <span class={css.turnErrorTitle ?? ''}>{t('message.turnError')}</span>
        <span class={css.turnErrorMessage ?? ''}>{node.message}</span>
      </div>
      {node.code !== undefined && <code class={css.turnErrorCode ?? ''}>{node.code}</code>}
    </div>
  )
}

/** Persistent, turn-positioned notice for a turn ended at the output-token cap. */
function TurnMaxTokensItem({ t }: {
  t: ChatViewSlotProps['t']
}): JSX.Element {
  return (
    <div class={css.turnErrorRow ?? ''} role="status">
      <StateDot state="warning" className={css.turnErrorDot} />
      <div class={css.turnErrorCopy ?? ''}>
        <span class={css.maxTokensTitle ?? ''}>{t('message.maxTokens')}</span>
        <span class={css.turnErrorMessage ?? ''}>{t('message.maxTokens.hint')}</span>
      </div>
    </div>
  )
}

/**
 * Display projection of reference forms in a user bubble (free geometry — no
 * textarea alignment constraint here); everything else stays plain text. The
 * logged model text remains the single truth; this is presentation only.
 * Plain-text `/name` / `@name` word-boundary tokens decorate (the sent text
 * IS the reference — the bubble uses the same plainest token
 * scan as the composer, minus the lexicon: sent tokens were validated at
 * compose time, so shape alone decorates).
 */
function projectUserText(text: string, sessionLabels: readonly string[]): VNode | VNode[] {
  const ranges: { start: number; end: number; label: string; kind: 'session' | 'plain' }[] = []
  for (const rawLabel of [...new Set(sessionLabels)].sort((a, b) => b.length - a.length)) {
    const label = `@${rawLabel}`
    let start = text.indexOf(label)
    while (start >= 0) {
      ranges.push({ start, end: start + label.length, label, kind: 'session' })
      start = text.indexOf(label, start + label.length)
    }
  }
  const re = /(^|\s)(\/[\w-]+|@"[^"\n]+"|@[^\s]+)/gu
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const tokenStart = m.index + (m[1]?.length ?? 0)
    const rawLabel = m[2] ?? ''
    const label = rawLabel.startsWith('@"')
      ? rawLabel
      : rawLabel.replace(/[.,;:!?，。；：！？]+$/gu, '')
    if (label.length <= 1) continue
    ranges.push({ start: tokenStart, end: tokenStart + label.length, label, kind: 'plain' })
  }
  ranges.sort((a, b) => a.start - b.start
    || (a.kind === b.kind ? b.end - a.end : a.kind === 'session' ? -1 : 1))
  const parts: VNode[] = []
  let cursor = 0
  for (const range of ranges) {
    if (range.start < cursor) continue
    const { start: tokenStart, end, label, kind } = range
    if (tokenStart > cursor) parts.push(<MessageText key={cursor} text={text.slice(cursor, tokenStart)} />)
    const referenceKind = kind === 'session'
      ? 'session'
      : label.startsWith('@')
        ? label.endsWith('/') ? 'folder' : 'file'
        : undefined
    const displayLabel = referenceKind === undefined
      ? label
      : referenceKind === 'session'
        ? label.slice(1)
        : label.slice(1).replace(/^"|"$/gu, '').split(/[\\/]/u).filter(Boolean).at(-1) ?? label.slice(1)
    parts.push(
      <span
        key={tokenStart}
        class={css.refChip ?? ''}
        data-ref-chip={referenceKind ?? 'skill'}
        title={label}
      >
        {referenceKind !== undefined && (
          <ReferenceIcon kind={referenceKind} size={16} className={css.refIcon} />
        )}
        {displayLabel}
      </span>,
    )
    cursor = end
  }
  if (parts.length === 0) return <MessageText text={text} />
  if (cursor < text.length) parts.push(<MessageText key={cursor} text={text.slice(cursor)} />)
  return parts
}

/** Right-aligned bubble shared by user and steering rows. */
function UserStyleBubble({
  content, renderMessageImages, actions, pending = false, referenceLabels = [], t,
}: {
  content: readonly unknown[]
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  /** Optional IconActions (or similar) below the bubble; receives the joined text. */
  actions?: ((text: string) => VNode) | undefined
  /** Whether this is the Host-authoritative pre-admission steering projection. */
  pending?: boolean
  /** Exact session mention labels associated by the adjacent recall node. */
  referenceLabels?: readonly string[]
  t: ChatViewSlotProps['t']
}): JSX.Element {
  const { text, images, rest } = contentParts(content)
  const truncated = (total: number): string => t('json.truncated', { total })
  const showBubble = text !== '' || rest.length > 0
  return (
    <div class={css.userRow ?? ''} data-pending-steering={pending || undefined} data-time-hover-root>
      <div class={css.userStack ?? ''}>
        {renderMessageImages({ images, align: 'end' })}
        {showBubble && <div class={css.bubble ?? ''}>
          {projectUserText(text, referenceLabels)}
          {rest.map((block, i) => <JsonBlock key={i} label={t('message.extraBlock')} payload={block} truncatedLabel={truncated} />)}
        </div>}
        {referenceLabels.length > 0 && (
          <div class={css.referenceSummary ?? ''}>
            {t('message.referenceSummary', { labels: referenceLabels.join(t('message.referenceSeparator')) })}
          </div>
        )}
      </div>
      {actions?.(text)}
    </div>
  )
}

/**
 * Render one Host-authoritative pending steering item with the same visual
 * language as its eventual durable transcript node.
 * @param props - Pending message content and conversation translator.
 * @returns the pending steering bubble.
 */
export function PendingSteeringBubble({ content, renderMessageImages, t }: {
  content: readonly unknown[]
  renderMessageImages: ChatNodeOwnerProps['renderMessageImages']
  t: ChatViewSlotProps['t']
}): JSX.Element {
  return (
    <UserStyleBubble
      content={content}
      renderMessageImages={renderMessageImages}
      pending
      t={t}
      actions={text => (
        <MessageIconActions
          text={text}
          clock="start"
          className={css.actions}
          t={t}
        /> as unknown as VNode
      )}
    />
  )
}

/** User and admitted-steering keyed Chat renderer. */
export function UserMessageNodeView({
  node, renderMessageImages, t,
}: ChatNodeViewProps<'user' | 'steering'>): JSX.Element {
  const data = node.data
  return (
    <UserStyleBubble
      content={data.content}
      renderMessageImages={renderMessageImages}
      {...data.referenceLabels === undefined ? {} : { referenceLabels: data.referenceLabels }}
      t={t}
      actions={text => (
        <MessageIconActions
          text={text}
          time={data.time}
          clock="start"
          className={css.actions}
          t={t}
        /> as unknown as VNode
      )}
    />
  )
}

/** Injected-context keyed Chat renderer. */
export function ContextMessageNodeView({ node, t }: ChatNodeViewProps<'context'>): JSX.Element {
  const data = node.data
  return (
    <ContextInjectionRow
      content={data.content}
      source={data.source}
      provenance={data.provenance}
      form={data.form}
      t={t}
    /> as unknown as JSX.Element
  )
}

/** Automatic compaction keyed Chat renderer. */
export function CompactionNodeView({ node, t }: ChatNodeViewProps<'compaction'>): JSX.Element {
  return <CompactionItem node={node.data} t={t} /> as unknown as JSX.Element
}

/** Correlated retry-chain keyed Chat renderer. */
export function RetryNodeView({ node, t }: ChatNodeViewProps<'model-retry'>): JSX.Element {
  const data = node.data
  return <ModelRetryItem node={data.current} active={data.current.retryState === 'scheduled'} t={t} /> as unknown as JSX.Element
}

/** Terminal turn-error keyed Chat renderer. */
export function TurnErrorNodeView({ node, t }: ChatNodeViewProps<'turn-error'>): JSX.Element {
  return <TurnErrorItem node={node.data} t={t} />
}

/** Max-tokens turn-end notice keyed Chat renderer. */
export function TurnMaxTokensNodeView({ t }: ChatNodeViewProps<'turn-max-tokens'>): JSX.Element {
  return <TurnMaxTokensItem t={t} />
}

/** Explicit unknown-surface keyed Chat renderer. */
export function UnknownNodeView({ node, t }: ChatNodeViewProps<'unknown'>): JSX.Element {
  const data = node.data
  return (
    <div class={css.contextRow ?? ''}>
      <JsonBlock
        label={t('message.unknownSurface', { type: data.type })}
        payload={data.data}
        truncatedLabel={total => t('json.truncated', { total })}
      />
    </div>
  )
}
