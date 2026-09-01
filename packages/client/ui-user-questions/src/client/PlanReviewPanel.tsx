// PlanReviewPanel: the composer takeover for a question carrying the
// `plan-review` presentation intent. A plan under review is one decision over
// one body of markdown, so it takes the waiting-approval card shape — tinted
// strip, content, right-aligned action row — instead of the generic question
// flow's pager, numbered options, skip and custom-answer affordances, which
// read as a quiz the user is being graded on.
//
// The three actions are the whole decision surface: approve and decline answer
// the question with the option labels the asker offered (localised copy on the
// buttons, the asker's descriptions as their tooltips), while "discuss"
// dismisses the request so the composer returns and the user can simply say
// what they want. Dismissal is the generic flow's own cancel verb, promoted to
// a labelled button because in a two-outcome decision it is the third real
// answer, not an escape hatch.
//
// Converted from a React hooks component to a webjsx custom element: `busy`
// and `error` become instance fields, and re-render is an explicit
// applyDiff(this, vdom) call instead of implicit re-render on setState.

import { applyDiff } from 'webjsx'
import { Button, IconEditOutline16, MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PendingQuestion, PlanReview, QuestionComposerProps } from './contract/slots.ts'
import css from './PlanReviewPanel.css.ts'

/** The panel's own props: the question domain face, the narrowed review, and the locale seat. */
export type PlanReviewPanelProps =
  { pending: PendingQuestion; review: PlanReview } & Pick<QuestionComposerProps, 't'>

/**
 * Optional-prop spread for a decision button's tooltip: `title` is optional on
 * the DOM props, and exactOptionalPropertyTypes rejects an explicit undefined.
 *
 * @param description - the asker's option description, when it carries one.
 * @returns The `title` prop to spread, or nothing.
 */
function tooltip(description: string | undefined): { title?: string } {
  return description === undefined ? {} : { title: description }
}

/**
 * Plan-review decision card custom element: approve/decline/discuss over one
 * plan under review. One-shot latch shaped like the approval takeover's: the
 * panel leaves only when the host's resolved frame lands, so until then a
 * second click must not re-fire. A failed send (rejected receipt / transport)
 * re-arms it and shows why, since nothing else would tell the user the click
 * was lost.
 */
export class DshPlanReviewPanel extends HTMLElement {
  #props: PlanReviewPanelProps | null = null
  #busy = false
  #error: string | null = null

  /** Set/replace props and re-render; call after creating or updating the element. */
  setProps(props: PlanReviewPanelProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  #settle(send: () => Promise<void>): void {
    this.#busy = true
    this.#error = null
    this.#render()
    void send().catch((cause: unknown) => {
      this.#busy = false
      this.#error = cause instanceof Error ? cause.message : String(cause)
      this.#render()
    })
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const { pending, review, t } = props
    const decide = (label: string): void => {
      this.#settle(() => pending.answer({ answers: [{ id: review.id, selected: [label] }] }))
    }
    const decline = review.decline
    const busy = this.#busy
    const error = this.#error

    const vdom = (
      <div class={css.frame ?? ''} data-plan-review-key={pending.key}>
        <section class={css.card ?? ''} aria-label={review.question}>
          <div class={css.strip ?? ''}>
            <span class={css.dot ?? ''} />
            {t('plan.header')}
          </div>
          <div class={css.body ?? ''} data-plan-review-scroll>
            <MarkdownText text={review.plan} />
          </div>
          <div class={css.footer ?? ''}>
            <div class={css.feedback ?? ''} role="status">{error}</div>
            <div class={css.actions ?? ''}>
              <Button
                variant="ghost" class={css.discuss ?? ''} icon={<IconEditOutline16 size={14} />}
                disabled={busy} onclick={() => { this.#settle(() => pending.cancel()) }}
              >
                {t('plan.discuss')}
              </Button>
              {decline !== undefined && (
                <Button
                  variant="outline" {...tooltip(decline.description)}
                  disabled={busy} onclick={() => { decide(decline.label) }}
                >
                  {t('plan.decline')}
                </Button>
              )}
              <Button
                variant="primary" {...tooltip(review.approve.description)}
                disabled={busy} onclick={() => { decide(review.approve.label) }}
              >
                {t('plan.approve')}
              </Button>
            </div>
          </div>
        </section>
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-plan-review-panel') === undefined) {
  customElements.define('dsh-plan-review-panel', DshPlanReviewPanel)
}
