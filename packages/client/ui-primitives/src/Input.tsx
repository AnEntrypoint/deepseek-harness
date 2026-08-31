// Input: single-line text input atom (search boxes, inline forms). Composer
// textareas are NOT this atom — they live with the conversation package.

import type { VNode } from 'webjsx'
import clsx from 'clsx'
import css from './Input.module.css'

/**
 * Render a text input with an optional leading icon.
 * @param props.icon - optional 16px leading icon node.
 * @returns wrapper span containing the native input; input attributes pass through.
 */
export function Input({ icon, class: extraClass, ...rest }: {
  icon?: VNode | string | null
  class?: string | undefined
} & Record<string, unknown>): VNode {
  return (
    <span class={clsx(css.wrap, extraClass)}>
      {icon != null && <span class={css.icon ?? ''}>{icon}</span>}
      <input class={css.input ?? ''} {...rest} />
    </span>
  )
}
