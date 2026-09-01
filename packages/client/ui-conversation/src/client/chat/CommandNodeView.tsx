import type { PropsRenderSlots } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  ChatNodeViewProps, CommandRowOwnerProps,
} from '../contract/slots.ts'
import { CompactionCommandCard } from './CompactionCommandCard.tsx'
import { GenericCommandCard } from './GenericCommandCard.tsx'
import css from './ChatView.css.ts'

type CommandNodeViewProps = ChatNodeViewProps<'command'> & PropsRenderSlots<'conversation.chat.commandview'>

/** Ordinary command lifecycle renderer with command-name keyed specialization. */
export function CommandNodeView({ node, renderSlot, t }: CommandNodeViewProps): JSX.Element {
  const command = node.data
  const owner: CommandRowOwnerProps = { node: command }
  return (
    <div class={css.callRow ?? ''}>
      {renderSlot('conversation.chat.commandview', owner, {
        entryKey: command.name ?? '',
        fallback: GenericCommandCard({ ...owner, t }) as unknown as JSX.Element,
      })}
    </div>
  )
}

/** One integrated `/compact` command and compaction transaction renderer. */
export function ManualCompactionNodeView({
  node, t,
}: ChatNodeViewProps<'manual-compaction'>): JSX.Element {
  const data = node.data
  return (
    <div class={css.callRow ?? ''}>
      {CompactionCommandCard({
        node: data.command,
        ...data.compaction === null ? {} : { compaction: data.compaction },
        t,
      })}
    </div>
  )
}
