/**
 * Shared modal chrome for every step registered by this onboarding plugin.
 *
 * Converted from a React hooks component: the root-inert toggle and
 * title-focus effects were `useEffect`s tied to mount/unmount and prop
 * changes. This component always renders open (never toggled by a `open`
 * prop), so the effects collapse to plain imperative calls made once, here,
 * each time the step calls this function to build its VNode — matching the
 * lifetime of the returned `Modal` element.
 */

import type { VNode } from 'webjsx'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './OnboardingModal.module.css'

const ignoreImplicitDismiss = (): void => {}

export interface OnboardingModalProps {
  title: string
  focusTitle?: boolean
  children?: VNode | VNode[] | string | null
}

/**
 * Render a blocking onboarding dialog and keep the application root inert
 * for as long as the step keeps rendering this modal.
 * @param props.title - accessible and visible dialog title.
 * @param props.focusTitle - focus the title when the step has no form control.
 * @param props.children - step-owned body and actions.
 * @returns the body-portaled modal.
 */
export function OnboardingModal({
  title, focusTitle = false, children,
}: OnboardingModalProps): JSX.Element {
  const appRoot = document.getElementById('root')
  if (appRoot !== null && !appRoot.inert) appRoot.inert = true

  const bindTitle = (el: HTMLHeadingElement | null): void => {
    if (el !== null && focusTitle) el.focus()
  }

  return (
    <Modal
      open
      title={title}
      onClose={ignoreImplicitDismiss}
      headless
      className={css.dialog as string}
    >
      <div class={css.content ?? ''}>
        <h2 ref={bindTitle} class={css.title ?? ''} tabindex={focusTitle ? -1 : undefined}>{title}</h2>
        <div class={css.body ?? ''}>{children}</div>
      </div>
    </Modal>
  )
}
