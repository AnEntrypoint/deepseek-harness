/**
 * Product-wide, versioned internal-testing notice.
 *
 * Converted from a React hooks component: the `finished` ref-guarded
 * `complete()` call and the load/acknowledge-triggered effects become plain
 * calls made on each render, guarded the same way the `useRef` guard did —
 * this component is created fresh by the slot renderer on every snapshot
 * change (it is a plain function, not a stateful custom element), so
 * "already finished" state is tracked outside on the store shape itself
 * (`state.acknowledged`) rather than in an instance field.
 */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { WelcomeNoticeState, WelcomeNoticeStore } from './welcome-store.ts'
import type { en } from './locales.ts'
import { OnboardingModal } from './OnboardingModal.tsx'
import css from './WelcomeNotice.css.ts'

/** Registration-side dependencies of {@link WelcomeNotice}. */
export interface WelcomeNoticeInjected {
  hooks: {
    /** Durable or process-local acknowledgement state. */
    welcome: SnapshotStore<WelcomeNoticeState>
  }
  /** Welcome acknowledgement controller. */
  controller: WelcomeNoticeStore
  /** Onboarding copy. */
  t: (key: keyof typeof en) => string
}

/** Coordinator owner props plus this step's injected face. */
export type WelcomeNoticeProps =
  PropsRuntime<'settings.onboarding'> & InjectFace<WelcomeNoticeInjected>

/** Per-store guard so a repeated finished snapshot calls `complete()` once. */
const finishedStores = new WeakSet<WelcomeNoticeStore>()

/**
 * Render the current notice until its exact copy version is acknowledged.
 * @param props - settings-shell owner state and welcome dependencies.
 * @returns the welcome modal or null while the step decides not to show.
 */
export function WelcomeNotice(props: WelcomeNoticeProps): JSX.Element | null {
  const { complete, controller, useWelcome, t } = props
  const state = useWelcome(snapshot => snapshot)

  const finish = (): void => {
    if (finishedStores.has(controller)) return
    finishedStores.add(controller)
    complete()
  }

  if (state.status === 'idle') void controller.load()
  if (state.acknowledged) {
    finish()
    return null
  }
  if (state.status === 'idle' || state.status === 'loading') return null

  const acknowledge = async (): Promise<void> => {
    if (await controller.acknowledge()) finish()
  }
  const paragraphs = t('welcomeBody').split('\n\n')

  return (
    <OnboardingModal title={t('welcomeTitle')} focusTitle>
      <div class={css.copy ?? ''}>
        {paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}
      </div>
      {state.error === null ? null : <p class={css.error ?? ''} role="alert">{t('welcomeError')}</p>}
      <div class={css.actions ?? ''}>
        <Button
          variant="primary"
          class={css.primary}
          disabled={state.status === 'saving'}
          onclick={() => { void acknowledge() }}
        >
          {t('welcomeContinue')}
        </Button>
      </div>
    </OnboardingModal>
  )
}
