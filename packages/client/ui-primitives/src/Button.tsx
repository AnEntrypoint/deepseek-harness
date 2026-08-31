// Button: token-styled button atom. Variants map to the --dsw-alias-button-*
// fill families; no framework imports, all behavior via props.

import type { VNode } from 'webjsx'
import clsx from 'clsx'
import css from './Button.module.css'

/** Visual variant, each backed by its --dsw-alias-button-* token family. */
export type ButtonVariant = 'primary' | 'ghost' | 'outline' | 'toolbar'

/**
 * Render a button.
 * @param props.variant - visual family (default 'ghost').
 * @param props.size - 'md' 36px capsule (figma Button) or 'sm' 28px compact.
 * @param props.icon - optional leading 16px icon node.
 * @returns the button vnode; native button attributes pass through.
 */
export function Button({ variant = 'ghost', size = 'md', icon, class: extraClass, children, ...rest }: {
  variant?: ButtonVariant
  size?: 'md' | 'sm'
  icon?: VNode | string | null
  class?: string | undefined
  children?: VNode | VNode[] | string | null
} & Record<string, unknown>): JSX.Element {
  return (
    <button type="button" class={clsx(css.button, css[variant], css[size], extraClass)} {...rest}>
      {icon != null && <span class={css.icon ?? ''}>{icon}</span>}
      {children}
    </button>
  )
}
