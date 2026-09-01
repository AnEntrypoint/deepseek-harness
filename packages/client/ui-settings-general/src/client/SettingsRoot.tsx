/**
 * Settings shell root: the sidebar-foot trigger row plus the centered modal
 * panel (figma 501:29947, 1080x700) with the section nav rail. The shell is
 * a pure composition face — every piece of text (trigger label, panel title,
 * close label, sections) arrives from registrants through slots; accessible
 * names resolve to that content (trigger: its own text; dialog:
 * aria-labelledby the title node; close: visually-hidden slot text). Modal
 * open state and the active section id are component-local viewing state;
 * the onboarding coordinator mounts exactly one ordered registrant while the
 * sessions-derived empty-Hero fact is active. Visible dialog chrome belongs
 * to the step, so a mounted-but-deciding step paints nothing here.
 *
 * Converted from a React hooks component to a webjsx custom element:
 * open/activeId/completedOnboarding become instance fields; the Escape-key
 * listener and initial-focus effects become connectedCallback/
 * disconnectedCallback bookkeeping tied to the panel's own open/close
 * transitions; re-render is an explicit applyDiff(this, vdom) call.
 */
import { applyDiff } from 'webjsx'
import clsx from 'clsx'
import {
  IconAgentPresetOutline16, IconCloseOutline16, IconDataOutline16,
  IconPersonalizationOutline16, IconSettingsOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { VNode } from 'webjsx'
import type { SettingsRootComponentProps, SettingsSectionRow } from './shell-contract.ts'
import css from './SettingsRoot.css.ts'

/** Cast a renderSlot() RenderOutput result into a webjsx-embeddable child (matches AppFrame's asChild). */
function asChild(node: unknown): VNode {
  return node as unknown as VNode
}

/** Nav glyph by section id; unknown ids fall back to the settings gear. */
function navIcon(id: string): JSX.Element {
  if (id === 'models') return <IconDataOutline16 className={css.navIcon} size={16} />
  if (id === 'agent-presets') return <IconAgentPresetOutline16 className={css.navIcon} size={16} />
  if (id === 'plugins') return <IconPersonalizationOutline16 className={css.navIcon} size={16} />
  return <IconSettingsOutline16 className={css.navIcon} size={16} />
}

/** Settings shell root custom element, owning open/active-section/onboarding-progress state. */
export class DshSettingsRoot extends HTMLElement {
  #props: SettingsRootComponentProps | null = null
  #open = false
  #activeId: string | undefined = undefined
  #completedOnboarding: ReadonlySet<string> = new Set()
  #lastOnboardingActive: boolean | undefined = undefined
  #escapeHandler: ((e: KeyboardEvent) => void) | null = null
  #closeButtonFocused = false

  /** Set/replace props and re-render; the owning renderer calls this on every update. */
  setProps(props: SettingsRootComponentProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  disconnectedCallback(): void {
    this.#unbindEscape()
  }

  #close = (): void => {
    this.#open = false
    this.#activeId = undefined
    this.#render()
  }

  #openSection = (id: string): void => {
    this.#activeId = id
    this.#open = true
    this.#render()
  }

  #bindEscape(): void {
    if (this.#escapeHandler !== null) return
    this.#escapeHandler = (e) => {
      if (e.key === 'Escape') this.#close()
    }
    document.addEventListener('keydown', this.#escapeHandler)
  }

  #unbindEscape(): void {
    if (this.#escapeHandler === null) return
    document.removeEventListener('keydown', this.#escapeHandler)
    this.#escapeHandler = null
  }

  #renderPanel(rows: readonly SettingsSectionRow[], renderSlot: SettingsRootComponentProps['renderSlot']): JSX.Element {
    const active = rows.find(r => r.id === this.#activeId)?.id ?? rows[0]?.id
    const titleId = 'dsh-settings-root-title'
    return (
      <div class={css.overlay ?? ''} role="presentation">
        <div class={css.mask ?? ''} aria-hidden="true" onclick={this.#close} />
        <div class={css.panel ?? ''} role="dialog" aria-modal="true" aria-labelledby={titleId}>
          <nav class={css.nav ?? ''}>
            <div class={css.navTitle ?? ''} id={titleId}>{asChild(renderSlot('settings.header', {}))}</div>
            <div class={css.navList ?? ''}>
              {rows.map(row => (
                <button
                  type="button"
                  class={clsx(css.navCell, row.id === active && css.active)}
                  aria-current={row.id === active ? 'true' : null}
                  onclick={() => { this.#activeId = row.id; this.#render() }}
                >
                  {navIcon(row.id)}
                  <span class={css.navLabel ?? ''}>{row.label}</span>
                </button>
              ))}
            </div>
          </nav>
          <div class={css.content ?? ''}>
            <div class={css.header ?? ''}>
              <div class={css.actions ?? ''}>{asChild(renderSlot('settings.action', {}))}</div>
              <button data-close-button="" type="button" class={css.close ?? ''} onclick={this.#close}>
                <IconCloseOutline16 size={14} />
                <span class={css.hiddenLabel ?? ''}>{asChild(renderSlot('settings.close', {}))}</span>
              </button>
            </div>
            <div class={css.options ?? ''}>
              {active !== undefined && asChild(renderSlot('settings.section', { close: this.#close }, { only: active }))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const { wide, useSections, useOnboardingSteps, useSessions, renderSlot } = props

    const rows = useSections(s => s)
    const onboardingSteps = useOnboardingSteps(s => s)
    const onboardingActive = useSessions(state =>
      state.phase === 'ready'
      && (state.current === undefined || state.byId[state.current]?.blank === true))

    if (onboardingActive !== this.#lastOnboardingActive) {
      this.#lastOnboardingActive = onboardingActive
      if (!onboardingActive) this.#completedOnboarding = new Set()
    }

    const onboardingStep = onboardingActive
      ? onboardingSteps.find(step => !this.#completedOnboarding.has(step.id))
      : undefined

    const completeOnboardingStep = (id: string): void => {
      if (this.#completedOnboarding.has(id)) return
      this.#completedOnboarding = new Set([...this.#completedOnboarding, id])
      this.#render()
    }

    const vdom = [
      <button
        type="button"
        class={clsx(css.trigger, !wide && css.rail)}
        aria-haspopup="dialog"
        aria-expanded={String(this.#open)}
        onclick={() => { this.#open = true; this.#render() }}
      >
        {asChild(renderSlot('settings.trigger', { wide }))}
      </button>,
      ...(this.#open ? [this.#renderPanel(rows, renderSlot)] : []),
      ...(onboardingStep !== undefined
        ? [asChild(renderSlot('settings.onboarding', {
          stepId: onboardingStep.id,
          complete: () => { completeOnboardingStep(onboardingStep.id) },
          openSection: this.#openSection,
        }, { only: onboardingStep.id }))]
        : []),
    ]
    applyDiff(this, vdom as JSX.Element[])

    if (this.#open) {
      this.#bindEscape()
      if (!this.#closeButtonFocused) {
        this.#closeButtonFocused = true
        this.querySelector<HTMLButtonElement>('[data-close-button]')?.focus()
      }
    } else {
      this.#unbindEscape()
      this.#closeButtonFocused = false
    }
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-settings-root') === undefined) {
  customElements.define('dsh-settings-root', DshSettingsRoot)
}

/**
 * Render the settings trigger and panel.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the settings shell element.
 */
export function SettingsRoot(props: SettingsRootComponentProps): JSX.Element {
  const el = document.createElement('dsh-settings-root') as DshSettingsRoot
  el.setProps(props)
  return el as unknown as JSX.Element
}
