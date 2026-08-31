// Queue dock entry: renders the authoritative transient inbox snapshot and
// addresses per-row mutations through the session-scoped conversation face.
//
// The 'conversation.input.dock' SlotMap declaration lives in
// ../contract/slots.ts beside the other input-region slots.
//
// Converted from a React hooks component to a webjsx custom element:
// editing/busy/collapsed become instance fields, the auto-collapse effect
// becomes an explicit sync call inside setProps, and re-render is an
// explicit applyDiff(this, vdom) call (Toast.tsx's pattern).

import type { Context } from '@deepseek-ai/cordis'
import { applyDiff } from 'webjsx'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import {
  IconCheckOutline16, IconChevronDownOutline14, IconChevronUpOutline14, IconCloseOutline16,
  IconEditOutline16, IconQueueOutline14, IconSendOutline14, IconTrashOutline16, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { QueueAction, QueueItemId } from '../contract/queue.ts'
import { NS } from '../locales.ts'
import css from './QueueDock.module.css'

/** Queue operations injected by the session-scoped registration. */
export interface QueueDockInjected {
  updateQueue: (itemId: QueueItemId, action: QueueAction) => Promise<void>
  notify: (level: 'info' | 'error', text: string) => void
}

/** Full props of a dock entry: InputZone owner share + session standard kit + global seat + the locale seat. */
export type QueueDockProps = PropsRuntime<'conversation.input.dock'> & QueueDockInjected & PropsLocale<'conversation'>

let listIdSeq = 0

/**
 * Queue strip custom element: one item renders directly; multiple items
 * default to a collapsible count header; an empty queue renders nothing.
 */
export class DshQueueDock extends HTMLElement {
  #props: QueueDockProps | null = null
  #editing: { id: QueueItemId; text: string } | null = null
  #busy: QueueItemId | null = null
  #collapsed = true
  #listId = `queue-dock-list-${String(++listIdSeq)}`

  setProps(props: QueueDockProps): void {
    this.#props = props
    this.#syncFromProps()
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  #syncFromProps(): void {
    if (this.#props === null) return
    const inbox = this.#props.useSession(s => s.queue)
    const queue = inbox.filter(row => row.placement === 'queued')
    const queueMutable = this.#props.useSession(s => s.subagent === null)
    if (queue.length === 0 && !this.#collapsed) this.#collapsed = true
    if (this.#editing !== null && (!queueMutable || !queue.some(row => row.id === this.#editing?.id))) {
      this.#editing = null
    }
  }

  async #applyAction(itemId: QueueItemId, action: QueueAction, failure: string): Promise<boolean> {
    if (this.#props === null) return false
    this.#busy = itemId
    this.#render()
    try {
      await this.#props.updateQueue(itemId, action)
      return true
    } catch {
      this.#props.notify('error', failure)
      return false
    } finally {
      const current: QueueItemId | null = this.#busy
      this.#busy = current === itemId ? null : current
      this.#render()
    }
  }

  async #saveEdit(): Promise<void> {
    if (this.#props === null || this.#editing === null || this.#editing.text.trim() === '') return
    const t = this.#props.t
    if (await this.#applyAction(
      this.#editing.id,
      { kind: 'edit', content: [{ type: 'text', text: this.#editing.text }] },
      t('queue.editFailed'),
    )) {
      this.#editing = null
      this.#render()
    }
  }

  #render(): void {
    if (this.#props === null) return
    const { useSession, t } = this.#props
    const inbox = useSession(s => s.queue)
    const queue = inbox.filter(row => row.placement === 'queued')
    const running = useSession(s => s.running)
    const queueMutable = useSession(s => s.subagent === null)
    const editing = this.#editing
    const busy = this.#busy
    const listId = this.#listId

    if (queue.length === 0) {
      applyDiff(this, <div />)
      return
    }

    const interactionActive = queueMutable && (editing !== null || busy !== null)
    const expanded = !this.#collapsed || interactionActive
    const listVisible = queue.length === 1 || expanded

    const vdom = (
      <div class={css.dock ?? ''} data-queue-dock="">
        <div class={css.panel ?? ''}>
          {queue.length > 1 && (
            <button
              type="button"
              class={css.header ?? ''}
              aria-controls={listId}
              aria-expanded={expanded}
              disabled={interactionActive}
              onclick={() => { this.#collapsed = !this.#collapsed; this.#render() }}
            >
              <span class={css.lead ?? ''} aria-hidden><IconQueueOutline14 /></span>
              <span class={css.count ?? ''}>{t('queue.count', { n: queue.length })}</span>
              <span class={css.chevron ?? ''} aria-hidden>
                {expanded ? <IconChevronDownOutline14 /> : <IconChevronUpOutline14 />}
              </span>
            </button>
          )}
          <ul id={listId} class={css.list ?? ''} hidden={!listVisible}>
            {listVisible && queue.map(row => (
              <li key={row.id} class={css.row ?? ''}>
                {/* Single-item strip has no count header, so the row itself carries the queue glyph. */}
                {queue.length === 1 && <span class={css.lead ?? ''} aria-hidden><IconQueueOutline14 /></span>}
                {editing?.id === row.id
                  ? (
                    <input
                      autofocus
                      class={css.editor ?? ''}
                      aria-label={t('queue.edit')}
                      value={editing.text}
                      onchange={(event: Event) => {
                        const value = (event.currentTarget as HTMLInputElement).value
                        this.#editing = { id: row.id, text: value }
                        this.#render()
                      }}
                      onkeydown={(event: KeyboardEvent) => {
                        if (event.key === 'Escape') {
                          this.#editing = null
                          this.#render()
                          return
                        }
                        if (event.key === 'Enter' && !event.isComposing) {
                          event.preventDefault()
                          void this.#saveEdit()
                        }
                      }}
                    />
                  )
                  : <span class={css.preview ?? ''}>{row.preview}</span>}
                {queueMutable && <div class={css.actions ?? ''}>
                  {editing?.id === row.id
                    ? (
                      [
                        <Tooltip label={t('queue.save')} side="bottom" delayMs={500}>
                          <button
                            type="button"
                            class={css.action ?? ''}
                            aria-label={t('queue.save')}
                            disabled={busy !== null || editing.text.trim() === ''}
                            onclick={() => { void this.#saveEdit() }}
                          >
                            <IconCheckOutline16 size={14} />
                          </button>
                        </Tooltip>,
                        <Tooltip label={t('queue.cancelEdit')} side="bottom" delayMs={500}>
                          <button
                            type="button"
                            class={css.action ?? ''}
                            aria-label={t('queue.cancelEdit')}
                            disabled={busy !== null}
                            onclick={() => { this.#editing = null; this.#render() }}
                          >
                            <IconCloseOutline16 size={14} />
                          </button>
                        </Tooltip>,
                      ]
                    )
                    : (
                      [
                        <Tooltip label={t('queue.edit')} side="bottom" delayMs={500} disabled={row.text === null}>
                          <button
                            type="button"
                            class={css.action ?? ''}
                            aria-label={t('queue.edit')}
                            // Disabled buttons fire no hover events, so the
                            // unsupported hint stays a native title.
                            title={row.text === null ? t('queue.edit.unsupported') : null}
                            disabled={busy !== null || row.text === null}
                            onclick={() => {
                              if (row.text !== null) { this.#editing = { id: row.id, text: row.text }; this.#render() }
                            }}
                          >
                            <IconEditOutline16 size={14} />
                          </button>
                        </Tooltip>,
                        <Tooltip label={t('queue.remove')} side="bottom" delayMs={500}>
                          <button
                            type="button"
                            class={css.action ?? ''}
                            aria-label={t('queue.remove')}
                            disabled={busy !== null}
                            onclick={() => {
                              void this.#applyAction(
                                row.id,
                                { kind: 'remove' },
                                t('queue.removeFailed'),
                              )
                            }}
                          >
                            <IconTrashOutline16 size={14} />
                          </button>
                        </Tooltip>,
                        <Tooltip label={t('queue.steer')} side="bottom" delayMs={500} disabled={!running}>
                          <button
                            type="button"
                            class={css.action ?? ''}
                            aria-label={t('queue.steer')}
                            title={running ? null : t('queue.steer.unavailable')}
                            disabled={busy !== null || !running}
                            onclick={() => {
                              void this.#applyAction(
                                row.id,
                                { kind: 'steer' },
                                t('queue.steerFailed'),
                              )
                            }}
                          >
                            <IconSendOutline14 />
                          </button>
                        </Tooltip>,
                      ]
                    )}
                </div>}
              </li>
            ))}
          </ul>
        </div>
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-queue-dock') === undefined) {
  customElements.define('dsh-queue-dock', DshQueueDock)
}

/** One-shot creation/update helper preserving the original function-component call shape. */
export function QueueDock(props: QueueDockProps): JSX.Element {
  const el = document.createElement('dsh-queue-dock') as DshQueueDock
  el.setProps(props)
  return el as unknown as JSX.Element
}

/**
 * The dock entry as a plain registrant plugin. The conversation service is
 * the action contract; the slot declaration has an independent lifecycle boundary.
 */
export const queueDockEntry = {
  name: 'conversation-queue-dock',
  inject: ['slots', 'conversation', 'sessions'],
  /**
   * Register the queue strip as the terminal input-dock entry (order 20).
   * @param ctx - registrant context (disposal rides ctx.effect inside slots.register).
   */
  apply(ctx: Context): void {
    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
      name: 'conversation.input.dock',
      id: 'queue',
      order: 20,
      locale: NS,
      inject: (sessionId: SessionId): QueueDockInjected => {
        const actx = ctx.sessions.scope(sessionId)
        if (actx === undefined) throw new Error(`queue dock: session "${sessionId}" resolved no scope`)
        const conversation = actx.get('conversation')
        if (conversation === undefined) throw new Error('queue dock: conversation service unavailable')
        return {
          updateQueue: (itemId, action) => conversation.updateQueue(itemId, action),
          notify: (level, text) => { conversation.input.for(actx).notify(level, text) },
        }
      },
    }, QueueDock))
  },
}
