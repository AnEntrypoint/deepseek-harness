import { MessageText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GoalCommandInputData } from './goal-command-input.ts'
import css from './GoalCommandInputView.css.ts'

type GoalCommandInputViewProps =
  PropsRuntime<'conversation.chat.node', 'command-input'>
  & PropsLocale<'goal'>

/** Right-aligned `/goal` input bubble without ordinary message actions. */
export function GoalCommandInputView({
  node, t,
}: GoalCommandInputViewProps): JSX.Element {
  const data: GoalCommandInputData = node.data
  return (
    <div
      class={css.row ?? ''}
      data-command-input=""
      role="group"
      aria-label={t('commandInput.aria')}
    >
      <div class={css.stack ?? ''}>
        <div class={css.bubble ?? ''}>
          <MessageText text={data.text} />
        </div>
      </div>
    </div>
  )
}
