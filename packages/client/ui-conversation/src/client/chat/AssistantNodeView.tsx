import type { ChatNodeViewProps, TurnTailOwnerProps } from '../contract/slots.ts'
import { AssistantMarkdown } from './AssistantMarkdown.tsx'

/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
export function AssistantNodeView({
  node, useTurnData, openFile, renderMessageImages, fileMentions, t,
}: ChatNodeViewProps<'assistant-step'>): JSX.Element | null {
  const data = node.data
  const turn = node.location.kind === 'turn' || node.location.kind === 'step'
    ? node.location.turn
    : undefined
  const tail = useTurnData('turn-tail')
  const owner: TurnTailOwnerProps | undefined = turn?.status !== 'closed' || data.finalNode === undefined
    ? undefined
    : tail?.closing?.finalNode.seq !== data.finalNode.seq
      ? undefined
      : { turn, seq: data.finalNode.seq, openFile }
  const mentions = owner === undefined ? undefined : fileMentions(owner)
  return (
    <AssistantMarkdown
      blocks={data.blocks}
      streaming={data.status === 'running'}
      interrupted={data.status === 'interrupted'}
      renderMessageImages={renderMessageImages}
      mentions={mentions}
      t={t}
    />
  )
}
