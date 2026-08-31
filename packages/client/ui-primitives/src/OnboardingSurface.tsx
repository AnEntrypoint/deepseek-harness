// OnboardingSurface: the full-viewport first-run takeover an onboarding step
// wraps its visible content in. The overlay portals to this document's body
// (the Modal precedent: ancestor stacking contexts cannot leave sticky page
// controls above the mask), and the surface holds `#root` inert for exactly
// its own lifetime — a step that renders null paints nothing and blocks
// nothing, so "should onboarding show right now" stays a plain render
// decision inside the step component.
//
// Converted from a React hooks component to a webjsx custom element: the
// inert-toggle that was useEffect becomes connectedCallback/
// disconnectedCallback, and re-render is an explicit applyDiff(this, vdom)
// call (Toast.tsx's pattern).

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import css from './OnboardingSurface.module.css'

export interface OnboardingSurfaceProps {
  children?: VNode | VNode[] | string | null
}

/**
 * Onboarding takeover chrome (mask + opaque stage) around one step's content,
 * as a custom element that keeps the application root inert while mounted.
 * Attaches itself to `document.body` on connect.
 */
export class DshOnboardingSurface extends HTMLElement {
  #props: OnboardingSurfaceProps = {}

  /** Set/replace props and re-render; call after creating or updating the element. */
  setProps(props: OnboardingSurfaceProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    const appRoot = document.getElementById('root')
    if (appRoot !== null) appRoot.inert = true
    this.#render()
  }

  disconnectedCallback(): void {
    const appRoot = document.getElementById('root')
    if (appRoot !== null) appRoot.inert = false
  }

  #render(): void {
    const { children } = this.#props
    const vdom = (
      <div class={css.onboardingOverlay ?? ''} role="presentation">
        <div class={css.onboardingMask ?? ''} aria-hidden="true" />
        <div class={css.onboardingStage ?? ''}>{children}</div>
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-onboarding-surface') === undefined) {
  customElements.define('dsh-onboarding-surface', DshOnboardingSurface)
}

/**
 * Create and mount an OnboardingSurface onto `document.body`.
 * @param props.children - the step's page content, centered on the stage.
 * @returns the mounted `dsh-onboarding-surface` element; call `.remove()` when the step unmounts.
 */
export function OnboardingSurface(props: OnboardingSurfaceProps): DshOnboardingSurface {
  const el = document.createElement('dsh-onboarding-surface') as DshOnboardingSurface
  document.body.appendChild(el)
  el.setProps(props)
  return el
}
