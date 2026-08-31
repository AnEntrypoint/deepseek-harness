// Converted from a React hooks component to a webjsx custom element. State
// that was useState/useRef becomes instance fields; explicit applyDiff(this,
// vdom) replaces implicit re-render on setState.

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import clsx from 'clsx'
import {
  Button, IconCheckOutline14, IconChevronDownOutline14, IconChevronLeftOutline14,
  IconChevronRightOutline14, IconChevronUpOutline14, IconCloseOutline16,
  IconEditOutline16, MarkdownText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  PendingQuestion, planReviewOf,
  type QuestionAnswer, type QuestionComposerProps,
} from './contract/slots.ts'
import { DshPlanReviewPanel } from './PlanReviewPanel.tsx'
import css from './QuestionComposer.module.css'

interface DraftAnswer {
  selected: string[]
  custom: string
  skipped: boolean
}

/**
 * Displayed feedback: validation feedback is stored as a dictionary KEY and
 * translated at render, so already-shown feedback follows a locale switch;
 * runtime failure messages (finished strings from the wire) pass through
 * verbatim.
 */
type Feedback = { key: 'error.incomplete' | 'error.unanswered' } | { text: string }

/**
 * Split the conventional recommendation suffix without changing the answer value.
 * @param label - Original option label returned if selected.
 * @returns Display label plus recommendation state.
 */
export function parseRecommendedLabel(label: string): { label: string; recommended: boolean } {
  const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i
  return suffix.test(label)
    ? { label: label.replace(suffix, ''), recommended: true }
    : { label, recommended: false }
}

/** Return whether a text-field key event belongs to an active IME composition. */
function isComposing(event: KeyboardEvent): boolean {
  // keyCode 229 is the legacy IME-composition signal engines emit without isComposing.
  // oxlint-disable-next-line typescript/no-deprecated
  return event.isComposing || event.keyCode === 229
}

/** The free-text answer field shared by both question shapes. */
interface AnswerFieldProps {
  /** Which shape the field takes: the custom row's inline column, or the optionless question's own framed block. */
  variant: 'inline' | 'block'
  /** Current draft text. */
  value: string
  /** Empty-field prompt. */
  placeholder: string
  /** Whether a submission in flight has frozen the field. */
  disabled: boolean
  /** Whether this field takes focus on mount. */
  autoFocus?: boolean
  /** Called when the field takes focus. */
  onFocus?: (() => void) | null
  /** Called with each edit of the draft. */
  onChange: (event: Event) => void
  /** Called with each key press, before the browser's own handling. */
  onKeyDown: (event: KeyboardEvent) => void
}

/**
 * Auto-growing free-text answer: a textarea, so a long answer soft-wraps and
 * Shift+Enter breaks a line, over a hidden mirror that owns the height.
 *
 * The mirror renders the draft plus a trailing newline in normal flow and so
 * sizes the grid row (counting rows by '\n' cannot see soft wraps); the
 * textarea shares that one cell and stretches to it, and `rows={1}` keeps the
 * control's own intrinsic height out of the row sizing so the mirror alone
 * decides. Past the mirror's cap the textarea scrolls itself — it is the only
 * scrollport in the stack, there being no second glyph layer to keep aligned.
 * Mirror and textarea MUST share font, line-height, padding and wrapping rules
 * or the two heights diverge.
 *
 * @param props - field shape, draft text, and the field's event handlers.
 * @returns The mirrored auto-growing field.
 */
function AnswerField(props: AnswerFieldProps): JSX.Element {
  return (
    <div class={clsx(css.field, props.variant === 'inline' ? css.customInline : css.customBlock)}>
      <div aria-hidden class={css.fieldMirror ?? ''}>{`${props.value}\n`}</div>
      <textarea
        autoFocus={props.autoFocus}
        class={css.fieldInput ?? ''}
        value={props.value}
        disabled={props.disabled}
        rows={1}
        placeholder={props.placeholder}
        onfocus={props.onFocus ?? null}
        onchange={props.onChange}
        onkeydown={props.onKeyDown}
      />
    </div>
  )
}

/**
 * Composer takeover boundary; the carrier key keys local drafts, so a
 * same-request replay (same key, new carrier object) preserves them.
 *
 * One takeover, two shapes: a request that declares a presentation intent this
 * package renders takes that shape (a plan review is one decision over one
 * plan, not a question set), and every other request takes the generic flow.
 * The routing lives here, at the one entry that owns the composer seat, so
 * neither shape can claim a request the other is already rendering.
 *
 * Converted to a webjsx custom element: the domain-face mint (previously
 * useMemo) rides the carrier's stable identity via a cached field, and the
 * routing decision re-renders the child custom element (either the generic
 * question flow or the plan-review panel) via setProps.
 */
export class DshQuestionComposer extends HTMLElement {
  #props: QuestionComposerProps | null = null
  #question: PendingQuestion | null = null
  #carrier: QuestionComposerProps['matched'] | null = null

  setProps(props: QuestionComposerProps): void {
    this.#props = props
    if (this.#carrier !== props.matched) {
      this.#carrier = props.matched
      this.#question = new PendingQuestion(props.matched)
    }
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  #render(): void {
    const props = this.#props
    const question = this.#question
    if (props === null || question === null) return
    const review = planReviewOf(question.questions)
    // The two shapes are custom elements this package itself registers, not
    // ordinary intrinsic HTML tags — created directly rather than through JSX
    // (webjsx's IntrinsicElements table covers built-in DOM tags only) and
    // reused across re-renders so setProps drives their own applyDiff.
    if (review === undefined) {
      let el = this.#childHost
      if (!(el instanceof DshQuestionFlow)) {
        el = document.createElement('dsh-question-flow') as DshQuestionFlow
        this.#childHost = el
        this.replaceChildren(el)
      }
      el.setProps({ pending: question, t: props.t })
    } else {
      let el = this.#childHost
      if (!(el instanceof DshPlanReviewPanel)) {
        el = document.createElement('dsh-plan-review-panel') as DshPlanReviewPanel
        this.#childHost = el
        this.replaceChildren(el)
      }
      el.setProps({ pending: question, review, t: props.t })
    }
  }

  #childHost: DshQuestionFlow | DshPlanReviewPanel | null = null
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-question-composer') === undefined) {
  customElements.define('dsh-question-composer', DshQuestionComposer)
}

/** Own props of the generic question-flow custom element. */
export type QuestionFlowProps = { pending: PendingQuestion } & Pick<QuestionComposerProps, 't'>

/**
 * The generic question flow custom element: pager, numbered options, skip and
 * custom-answer affordances over a request's whole question batch. Converted
 * from a React hooks component — every useState becomes an instance field,
 * useRef(Set) becomes a plain instance field, and re-render is explicit.
 */
export class DshQuestionFlow extends HTMLElement {
  #props: QuestionFlowProps | null = null
  #index = 0
  #drafts: DraftAnswer[] = []
  #busy: 'answer' | 'cancel' | null = null
  #error: Feedback | null = null
  #minimized = false
  #focusedQuestions = new Set<number>()

  setProps(props: QuestionFlowProps): void {
    const pendingChanged = this.#props === null || this.#props.pending !== props.pending
    this.#props = props
    if (pendingChanged) {
      this.#index = 0
      this.#drafts = props.pending.questions.map(() => ({ selected: [], custom: '', skipped: false }))
      this.#busy = null
      this.#error = null
      this.#minimized = false
      this.#focusedQuestions = new Set()
    }
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  #cancelFlow(pending: PendingQuestion): void {
    this.#busy = 'cancel'
    this.#error = null
    this.#render()
    void pending.cancel().catch((cause: unknown) => {
      this.#busy = null
      this.#error = { text: cause instanceof Error ? cause.message : String(cause) }
      this.#render()
    })
  }

  #updateDraft(update: (current: DraftAnswer) => DraftAnswer): void {
    // oxlint-disable-next-line typescript/no-non-null-assertion
    this.#drafts = this.#drafts.map((item, itemIndex) => itemIndex === this.#index ? update(item) : item)
    this.#error = null
  }

  #choose(label: string, question: QuestionFlowProps['pending']['questions'][number], questionsLength: number): void {
    this.#updateDraft((current) => {
      if (question.multiSelect === true) {
        const selected = current.selected.includes(label)
          ? current.selected.filter(item => item !== label)
          : [...current.selected, label]
        return { ...current, selected, skipped: false }
      }
      return { selected: [label], custom: '', skipped: false }
    })
    if (question.multiSelect !== true && this.#index < questionsLength - 1) {
      this.#index += 1
    }
    this.#render()
  }

  #answered(item: DraftAnswer): boolean {
    return item.selected.length > 0 || item.custom.trim() !== ''
  }

  #completed(item: DraftAnswer): boolean {
    return this.#answered(item) || item.skipped
  }

  #submitDrafts(values: DraftAnswer[]): void {
    const props = this.#props
    if (props === null) return
    const questions = props.pending.questions
    const missing = values.findIndex(item => !this.#completed(item))
    if (missing >= 0) {
      this.#index = missing
      this.#error = { key: 'error.incomplete' }
      this.#render()
      return
    }
    const answer: QuestionAnswer = {
      answers: questions.map((item, itemIndex) => {
        const value = values[itemIndex] as DraftAnswer
        if (value.skipped) return { id: item.id, selected: [] }
        const custom = value.custom.trim()
        return {
          id: item.id,
          selected: custom === '' || item.multiSelect === true ? value.selected : [],
          ...(custom === '' ? {} : { custom }),
        }
      }),
    }
    this.#busy = 'answer'
    this.#error = null
    this.#render()
    void props.pending.answer(answer).catch((cause: unknown) => {
      this.#busy = null
      this.#error = { text: cause instanceof Error ? cause.message : String(cause) }
      this.#render()
    })
  }

  #continueFlow(): void {
    const props = this.#props
    if (props === null) return
    const questions = props.pending.questions
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const draft = this.#drafts[this.#index]!
    if (!this.#answered(draft)) {
      this.#error = { key: 'error.unanswered' }
      this.#render()
      return
    }
    if (this.#index < questions.length - 1) {
      this.#index += 1
      this.#error = null
      this.#render()
      return
    }
    this.#submitDrafts(this.#drafts)
  }

  #skipQuestion(): void {
    const props = this.#props
    if (props === null) return
    const questions = props.pending.questions
    const nextDrafts = this.#drafts.map((item, itemIndex) => itemIndex === this.#index
      ? { selected: [], custom: '', skipped: true }
      : item)
    this.#drafts = nextDrafts
    this.#error = null
    if (this.#index < questions.length - 1) {
      this.#index += 1
      this.#render()
      return
    }
    this.#submitDrafts(nextDrafts)
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const { pending, t } = props
    const questions = pending.questions
    const index = this.#index
    const drafts = this.#drafts
    const busy = this.#busy
    const error = this.#error
    const minimized = this.#minimized
    // index stays in bounds (every index write clamps) and drafts mirrors questions 1:1.
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const question = questions[index]!
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const draft = drafts[index]!
    const hasOptions = (question.options?.length ?? 0) > 0

    const draftCustom = (event: Event): void => {
      const value = (event.target as HTMLTextAreaElement).value
      this.#updateDraft(current => ({
        ...current,
        selected: question.multiSelect === true ? current.selected : [],
        custom: value,
        skipped: false,
      }))
      this.#render()
    }

    const continueFromCustom = (event: KeyboardEvent): void => {
      if (event.key !== 'Enter' || event.shiftKey || isComposing(event)) return
      event.preventDefault()
      this.#continueFlow()
    }

    const optionButtons: VNode[] = (question.options ?? []).map((option, optionIndex) => {
      const selected = draft.selected.includes(option.label)
      const display = parseRecommendedLabel(option.label)
      return (
        <button
          type="button" key={`${option.label}-${String(optionIndex)}`}
          class={clsx(css.option, selected && question.multiSelect !== true && css.optionSelected)}
          role={question.multiSelect === true ? 'checkbox' : 'radio'}
          aria-checked={String(selected)}
          aria-label={display.label}
          disabled={busy !== null}
          onclick={() => { this.#choose(option.label, question, questions.length) }}
          onkeydown={(event: KeyboardEvent) => {
            if (event.key !== 'Enter' || !drafts.every(item => this.#completed(item))) return
            event.preventDefault()
            this.#submitDrafts(drafts)
          }}
        >
          {question.multiSelect === true
            ? (
              <span class={clsx(css.checkbox, selected && css.checkboxChecked)} aria-hidden="true">
                {selected && <IconCheckOutline14 size={12} />}
              </span>
            )
            : <span class={css.number ?? ''}>{optionIndex + 1}</span>}
          <span class={css.optionCopy ?? ''}>
            <span class={css.optionLine ?? ''}>
              <span class={css.optionLabel ?? ''}>{display.label}</span>
              {display.recommended && (
                <span class={css.badge ?? ''}>{t('option.recommended')}</span>
              )}
              {option.description !== undefined && (
                <span class={css.description ?? ''}>{option.description}</span>
              )}
            </span>
          </span>
        </button>
      )
    })

    const vdom = (
      <div class={css.frame ?? ''} data-question-key={pending.key}>
        <section
          class={clsx(css.card, minimized && css.cardMinimized)}
          aria-labelledby={`question-${pending.key}-${String(index)}`}
        >
          <header class={css.header ?? ''}>
            <div class={css.headingBlock ?? ''}>
              {question.header !== undefined && <div class={css.eyebrow ?? ''}>{question.header}</div>}
              <h2 class={css.title ?? ''} id={`question-${pending.key}-${String(index)}`}>
                {question.question}
              </h2>
            </div>
            <div class={css.headerActions ?? ''}>
              <button
                type="button" class={css.iconButton ?? ''}
                aria-label={t(minimized ? 'nav.maximize' : 'nav.minimize')}
                title={t(minimized ? 'nav.maximize' : 'nav.minimize')}
                aria-expanded={String(!minimized)}
                disabled={busy !== null}
                onclick={() => { this.#minimized = !this.#minimized; this.#render() }}
              >
                {minimized ? <IconChevronUpOutline14 /> : <IconChevronDownOutline14 />}
              </button>
              <button
                type="button" class={css.iconButton ?? ''} aria-label={t('nav.cancel')}
                title={t('nav.cancel')}
                disabled={busy !== null} onclick={() => { this.#cancelFlow(pending) }}
              >
                <IconCloseOutline16 />
              </button>
            </div>
          </header>

          {!minimized && [
            <div class={css.body ?? ''} data-question-scroll>
              {question.detail !== undefined && (
                <div class={css.detail ?? ''}><MarkdownText text={question.detail} /></div>
              )}
              <div class={css.options ?? ''} role={question.multiSelect === true ? 'group' : 'radiogroup'}>
                {optionButtons}

                {hasOptions
                  ? (
                    <div class={clsx(css.customRow, draft.custom !== '' && css.customRowActive)}>
                      {question.multiSelect === true
                        ? (
                          <span
                            class={clsx(css.checkbox, draft.custom !== '' && css.checkboxChecked)}
                            aria-hidden="true"
                          >
                            {draft.custom !== '' && <IconCheckOutline14 size={12} />}
                          </span>
                        )
                        : (
                          <span class={css.number ?? ''} aria-hidden="true">
                            <IconEditOutline16 size={12} />
                          </span>
                        )}
                      <AnswerField
                        variant="inline"
                        value={draft.custom}
                        disabled={busy !== null}
                        placeholder={t('custom.placeholder')}
                        onChange={draftCustom}
                        onKeyDown={continueFromCustom}
                      />
                    </div>
                  )
                  : (
                    <AnswerField
                      autoFocus={!this.#focusedQuestions.has(index)}
                      variant="block"
                      value={draft.custom}
                      disabled={busy !== null}
                      placeholder={t('custom.placeholder')}
                      onFocus={() => { this.#focusedQuestions.add(index) }}
                      onChange={draftCustom}
                      onKeyDown={continueFromCustom}
                    />
                  )}
              </div>
            </div>,

            <footer class={css.footer ?? ''}>
              <div class={css.pager ?? ''}>
                <button
                  type="button" class={css.iconButton ?? ''} aria-label={t('nav.prev')}
                  disabled={index === 0 || busy !== null}
                  onclick={() => { this.#index -= 1; this.#error = null; this.#render() }}
                >
                  <IconChevronLeftOutline14 />
                </button>
                <span class={css.progress ?? ''}>{index + 1} / {questions.length}</span>
                <button
                  type="button" class={css.iconButton ?? ''} aria-label={t('nav.next')}
                  disabled={index === questions.length - 1 || busy !== null}
                  onclick={() => { this.#index += 1; this.#error = null; this.#render() }}
                >
                  <IconChevronRightOutline14 />
                </button>
              </div>
              <div class={css.feedback ?? ''} role="status">
                {error === null ? null : 'key' in error ? t(error.key) : error.text}
              </div>
              <div class={css.footerActions ?? ''}>
                <Button variant="outline" disabled={busy !== null} onclick={() => { this.#skipQuestion() }}>
                  {t('action.skip')}
                </Button>
                <Button
                  variant="primary"
                  disabled={busy !== null || !this.#answered(draft)} onclick={() => { this.#continueFlow() }}
                >
                  {busy === 'answer'
                    ? t('submitting')
                    : index === questions.length - 1 ? t('submit') : t('action.next')}
                </Button>
              </div>
            </footer>,
          ]}
        </section>
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-question-flow') === undefined) {
  customElements.define('dsh-question-flow', DshQuestionFlow)
}
