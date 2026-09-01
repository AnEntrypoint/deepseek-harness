import { applyDiff } from 'webjsx'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { IconCloseFill14 } from '@deepseek-ai/dsh-client-ui-primitives'
// Type-only: pulls the ui-conversation SlotMap merge (the input.plan seat and
// its {locked} owner share).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PlanChipInjected } from './index.ts'
import css from './PlanModeControl.css.ts'

/** Full plan-seat component props: runtime share (standard kit + locked owner prop) & injected share & the locale seat. */
export type PlanChipProps =
  PropsRuntime<'conversation.input.plan'> & InjectFace<PlanChipInjected> & PropsLocale<'plan'>

/**
 * Plan-mode status over the host-computed `plan` projection. The chip renders
 * only while the effective target is plan mode (`pending ? !active : active`
 * — a folded host value, not client optimism) and executes /plan off.
 *
 * Converted from a React hooks component to a webjsx custom element:
 * leaving/error state become instance fields, the alive-tracking useEffect
 * becomes connectedCallback/disconnectedCallback, and re-render is an
 * explicit applyDiff(this, vdom) call (Toast.tsx's pattern).
 */
export class DshPlanChip extends HTMLElement {
  #props: PlanChipProps | null = null
  #leaving = false
  #error: string | null = null
  #alive = true

  /** Set/replace props and re-render; call after creating or updating the element. */
  setProps(props: PlanChipProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#alive = true
    this.#render()
  }

  disconnectedCallback(): void {
    this.#alive = false
  }

  #off(): void {
    const props = this.#props
    if (props === null) return
    const { exitPlanMode } = props
    // No leaving/locked guard: both disable the button, so no click arrives.
    this.#leaving = true
    this.#error = null
    this.#render()
    void exitPlanMode().then((failure) => {
      if (!this.#alive) return
      this.#leaving = false
      this.#error = failure
      this.#render()
    }, (reason: unknown) => {
      if (!this.#alive) return
      this.#leaving = false
      this.#error = reason instanceof Error ? reason.message : String(reason)
      this.#render()
    })
  }

  #render(): void {
    const props = this.#props
    if (props === null) { applyDiff(this, []); return }
    const { useProjection, locked, t } = props
    const plan = useProjection('plan')
    if (plan === undefined) { applyDiff(this, []); return }
    const target = plan.pending ? !plan.active : plan.active
    if (!target) { applyDiff(this, []); return }

    const vdom = (
      <span class={css.wrap ?? ''}>
        <button
          type="button"
          class={css.chip ?? ''}
          aria-label={t('chip.on.aria')}
          title={t('chip.on.title')}
          disabled={locked || this.#leaving}
          onclick={() => { this.#off() }}
        >
          {/* Design literal, not copy: the chip wordmark stays 'Plan' in every locale. */}
          Plan
          <span class={css.close ?? ''} aria-hidden>
            <IconCloseFill14 size={12} />
          </span>
        </button>
        {/* Failure copy stays English (error-surface policy: not localized). */}
        {this.#error !== null && <span class={css.error ?? ''} role="status" title={this.#error}>failed to exit plan mode</span>}
      </span>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-plan-chip') === undefined) {
  customElements.define('dsh-plan-chip', DshPlanChip)
}

/** One-shot creation helper preserving the original function-component call shape. */
export function PlanChip(props: PlanChipProps): DshPlanChip {
  const el = document.createElement('dsh-plan-chip') as DshPlanChip
  el.setProps(props)
  return el
}
