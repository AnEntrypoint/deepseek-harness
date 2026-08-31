/**
 * GoalBar: the goal indicator docked above the message composer (input dock
 * strip). A present goal shows a goal glyph, a phase label, the truncated
 * objective, and icon actions — resume when paused, edit (inline form in the
 * same strip), and clear. Goal creation lives on the `/goal` command, not
 * here: loading (undefined), no goal (null), and complete goals render
 * nothing. Live state arrives as the projected whole snapshot; the verbs are
 * the injected face.
 *
 * Converted from a React hooks component to a webjsx custom element:
 * editing/draft/pending/actionError/clearedGoalId become instance fields,
 * the goal-identity reset effect becomes an explicit check in setProps, and
 * re-render is an explicit applyDiff(this, vdom) call (Toast.tsx's pattern).
 */

import { applyDiff } from 'webjsx'
import type { GoalSnapshot } from '@deepseek-ai/dsh-goal/client'
import {
  IconCheckOutline16, IconCloseOutline16, IconEditOutline16, IconGoalOutline16,
  IconPauseOutline16, IconPlayOutline16, IconTrashOutline16, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GoalActionResult, GoalBarActions } from './slots.ts'
import type { GoalKey } from './locales.ts'
import css from './GoalBar.module.css'

export interface GoalBarProps extends GoalBarActions {
  /** Current goal snapshot; undefined = capability absent or loading, null = no goal set. */
  goal: GoalSnapshot | null | undefined
}

/** Strip label keys per visible phase; complete goals render nothing. */
const PHASE_LABELS = {
  active: 'phase.active',
  paused: 'phase.paused',
  blocked: 'phase.blocked',
} as const satisfies Record<string, GoalKey>

type GoalBarFullProps = GoalBarProps & PropsLocale<'goal'>

const DEFAULT_PROPS: GoalBarFullProps = {
  goal: undefined,
  onEdit: async () => ({ ok: false, error: { code: 'no-current-goal', message: '', details: {} } }),
  onPause: async () => ({ ok: false, error: { code: 'no-current-goal', message: '', details: {} } }),
  onResume: async () => ({ ok: false, error: { code: 'no-current-goal', message: '', details: {} } }),
  onClear: async () => ({ ok: false, error: { code: 'no-current-goal', message: '', details: {} } }),
  t: ((key: string) => key) as GoalBarFullProps['t'],
}

/** Goal indicator strip custom element. */
export class DshGoalBar extends HTMLElement {
  #props: GoalBarFullProps = DEFAULT_PROPS
  #editing = false
  #draft = ''
  #pending = false
  #pendingFlag = false
  #actionError: string | null = null
  #clearedGoalId: GoalSnapshot['id'] | null = null

  setProps(props: GoalBarFullProps): void {
    const prevGoalId = this.#props.goal?.id
    this.#props = props
    // A new goal identity (cleared/completed/replaced externally) invalidates
    // local edit state: without the reset a surviving draft's Enter would
    // write over the NEW goal.
    if (props.goal?.id !== prevGoalId) {
      this.#editing = false
      this.#actionError = null
      this.#clearedGoalId = null
    }
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  disconnectedCallback(): void {
    // No pending timers/listeners to release.
  }

  async #runAction(action: () => Promise<GoalActionResult>): Promise<GoalActionResult | undefined> {
    if (this.#pendingFlag) return undefined
    this.#pendingFlag = true
    this.#pending = true
    this.#actionError = null
    const result = await action()
    this.#pendingFlag = false
    this.#pending = false
    if (!result.ok) this.#actionError = `${result.error.message} (${result.error.code})`
    this.#render()
    return result
  }

  async #handleEdit(): Promise<void> {
    const trimmed = this.#draft.trim()
    if (trimmed === '') return
    const result = await this.#runAction(() => this.#props.onEdit(trimmed))
    if (result?.ok) { this.#editing = false; this.#render() }
  }

  async #handleClear(clearedId: GoalSnapshot['id']): Promise<void> {
    const result = await this.#runAction(this.#props.onClear)
    if (result?.ok) { this.#clearedGoalId = clearedId; this.#render() }
  }

  #render(): void {
    const { goal, onPause, onResume, t } = this.#props

    // Loading, absent, and complete goals have no strip at all.
    if (goal === undefined || goal === null || goal.phase === 'complete' || goal.id === this.#clearedGoalId) {
      applyDiff(this, [])
      return
    }

    if (this.#editing) {
      const vdom = (
        <div class={css.dock ?? ''} data-goal-bar>
          <div class={css.bar ?? ''}>
            <input
              class={css.objectiveInput ?? ''}
              type="text"
              aria-label={t('objective.aria')}
              value={this.#draft}
              oninput={(e: InputEvent) => {
                this.#draft = (e.target as HTMLInputElement).value
              }}
              onkeydown={(e: KeyboardEvent) => {
                if (e.key === 'Enter') void this.#handleEdit()
                if (e.key === 'Escape') { this.#editing = false; this.#render() }
              }}
              autofocus
            />
            {this.#actionError !== null && <span class={css.error ?? ''} role="alert">{this.#actionError}</span>}
            <div class={css.actions ?? ''}>
              <Tooltip label={t('action.save')} side="bottom" delayMs={500}>
                <button
                  type="button"
                  class={css.iconBtn ?? ''}
                  onclick={() => { void this.#handleEdit() }}
                  disabled={this.#pending || this.#draft.trim() === ''}
                  aria-label={t('action.save')}
                >
                  <IconCheckOutline16 size={14} />
                </button>
              </Tooltip>
              <Tooltip label={t('action.cancel')} side="bottom" delayMs={500}>
                <button
                  type="button"
                  class={css.iconBtn ?? ''}
                  onclick={() => { this.#editing = false; this.#render() }}
                  disabled={this.#pending}
                  aria-label={t('action.cancel')}
                >
                  <IconCloseOutline16 size={14} />
                </button>
              </Tooltip>
            </div>
          </div>
        </div>
      )
      applyDiff(this, vdom)
      return
    }

    const title = goal.phase === 'blocked' ? goal.blockedReason?.message : undefined
    const vdom = (
      <div class={css.dock ?? ''} data-goal-bar>
        <div class={css.bar ?? ''} title={title}>
          <span class={css.goalGlyph ?? ''}><IconGoalOutline16 size={14} /></span>
          <span class={css.label ?? ''}>{t(PHASE_LABELS[goal.phase])}</span>
          <span class={css.objective ?? ''}>{goal.objective}</span>
          {this.#actionError !== null && <span class={css.error ?? ''} role="alert">{this.#actionError}</span>}
          <div class={css.actions ?? ''}>
            {goal.phase === 'active' && (
              <Tooltip label={t('action.pause')} side="bottom" delayMs={500}>
                <button type="button" class={css.iconBtn ?? ''} disabled={this.#pending} onclick={() => { void this.#runAction(onPause) }} aria-label={t('action.pause')}>
                  <IconPauseOutline16 size={14} />
                </button>
              </Tooltip>
            )}
            {goal.phase === 'paused' && (
              <Tooltip label={t('action.resume')} side="bottom" delayMs={500}>
                <button type="button" class={css.iconBtn ?? ''} disabled={this.#pending} onclick={() => { void this.#runAction(onResume) }} aria-label={t('action.resume')}>
                  <IconPlayOutline16 size={14} />
                </button>
              </Tooltip>
            )}
            <Tooltip label={t('action.edit')} side="bottom" delayMs={500}>
              <button
                type="button"
                class={css.iconBtn ?? ''}
                disabled={this.#pending}
                onclick={() => { this.#draft = goal.objective; this.#editing = true; this.#render() }}
                aria-label={t('action.edit')}
              >
                <IconEditOutline16 size={14} />
              </button>
            </Tooltip>
            <Tooltip label={t('action.clear')} side="bottom" delayMs={500}>
              <button type="button" class={css.iconBtn ?? ''} disabled={this.#pending} onclick={() => { void this.#handleClear(goal.id) }} aria-label={t('action.clear')}>
                <IconTrashOutline16 size={14} />
              </button>
            </Tooltip>
          </div>
        </div>
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-goal-bar') === undefined) {
  customElements.define('dsh-goal-bar', DshGoalBar)
}

/** Full props of the dock entry: InputZone owner share + session standard kit + injected verbs + the locale seat. */
export type GoalDockProps = PropsRuntime<'conversation.input.dock'> & GoalBarActions & PropsLocale<'goal'>

/**
 * Dock adapter custom element: reads the host-computed 'goal' projection
 * (whole value; absent or null renders nothing) and hosts a DshGoalBar.
 * Converted from a React hooks component (useProjection subscription) to a
 * webjsx custom element: `useProjection` is read directly inside `#render()`
 * on every `setProps` call (the WebjsxBridge re-invokes `setProps` on every
 * host re-render), matching ui-plan's `DshPlanChip` pattern — no separate
 * subscription lifecycle is needed.
 */
export class DshGoalDock extends HTMLElement {
  #props: GoalDockProps | null = null
  #bar: DshGoalBar | null = null

  setProps(props: GoalDockProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  disconnectedCallback(): void {
    // No pending timers/listeners to release.
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const { useProjection, onEdit, onPause, onResume, onClear, t } = props
    const projection = useProjection('goal')
    const goal = projection === undefined ? undefined : projection === null ? null : projection.goal

    if (this.#bar === null) {
      this.#bar = document.createElement('dsh-goal-bar') as DshGoalBar
      this.appendChild(this.#bar)
    }
    this.#bar.setProps({ goal, onEdit, onPause, onResume, onClear, t })
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-goal-dock') === undefined) {
  customElements.define('dsh-goal-dock', DshGoalDock)
}

/**
 * Create and mount (or update) a GoalBar element for a given goal snapshot.
 * @param el - an existing `dsh-goal-bar` element to update, or null to create one.
 * @param props - see {@link GoalBarFullProps}.
 * @returns the `dsh-goal-bar` element; keep it and pass it back in to update.
 */
export function renderGoalBar(el: DshGoalBar | null, props: GoalBarFullProps): DshGoalBar {
  const target = el ?? document.createElement('dsh-goal-bar') as DshGoalBar
  target.setProps(props)
  return target
}

/** One-shot creation helper preserving the original function-component call shape. */
export function GoalBar(props: GoalBarFullProps): DshGoalBar {
  return renderGoalBar(null, props)
}

/**
 * Create and mount (or update) a GoalDock element.
 * @param el - an existing `dsh-goal-dock` element to update, or null to create one.
 * @param props - see {@link GoalDockProps}.
 * @returns the `dsh-goal-dock` element; keep it and pass it back in to update.
 */
export function renderGoalDock(el: DshGoalDock | null, props: GoalDockProps): DshGoalDock {
  const target = el ?? document.createElement('dsh-goal-dock') as DshGoalDock
  target.setProps(props)
  return target
}

/** One-shot creation helper preserving the original function-component call shape. */
export function GoalDock(props: GoalDockProps): DshGoalDock {
  return renderGoalDock(null, props)
}
