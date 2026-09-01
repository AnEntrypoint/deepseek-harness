// MessageText is the literal-text primitive for user and steering content; assistant output uses MarkdownText.

import css from './MessageText.css.ts'

export function MessageText({ text }: { text: string }): JSX.Element {
  return <div class={css.text ?? ''}>{text}</div>
}
