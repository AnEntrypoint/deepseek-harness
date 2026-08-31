// Pill: small rounded label chip (view switcher tabs, filters, badges).

import type { VNode } from 'webjsx'
import clsx from 'clsx'
import css from './Pill.module.css'

/**
 * Render a pill chip. Interactive when onclick is supplied (renders a button);
 * otherwise a static span.
 * @param props.active - selected/active visual state.
 * @returns pill element.
 */
export function Pill({ active = false, class: extraClass, children, onclick, ...rest }: {
  active?: boolean
  // `| undefined` so a caller can forward an optional class straight through
  // under exactOptionalPropertyTypes (a CSS-module lookup is string|undefined).
  class?: string | undefined
  children?: VNode | VNode[] | string | null
  onclick?: ((event: MouseEvent) => void) | undefined
} & Record<string, unknown>): JSX.Element {
  if (!onclick) {
    return <span class={clsx(css.pill, active && css.active, extraClass)}>{children}</span>
  }
  return (
    <button
      type="button"
      class={clsx(css.pill, css.interactive, active && css.active, extraClass)}
      onclick={onclick}
      {...rest}
    >
      {children}
    </button>
  )
}
