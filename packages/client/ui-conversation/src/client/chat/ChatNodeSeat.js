import { createElement as h } from 'webjsx'
import { JsonBlock } from '@freddie/freddie-client-ui-primitives'
import css from './ChatView.css.js'

/** Subscribe and dispatch one stable Context key without observing sibling Nodes. */
export function ChatNodeSeat({
  nodeKey, selectedCallId, cwd, openFile, inspectCall, forkAt,
  renderMessageImages, fileMentions, useSession, renderSlot, t,
}) {
  const node = useSession(snapshot => snapshot.chat.nodes.get(nodeKey))
  const routedNode = node
  const owner = node === undefined
    ? null
    : {
      selectedCallId,
      cwd,
      openFile,
      inspectCall,
      forkAt,
      renderMessageImages,
      fileMentions,
    }
  if (routedNode === undefined || owner === null) return null
  // Runtime dispatch owns the correlation: every Node's discriminant is the
  // keyed-slot entry passed alongside that same Node. TypeScript does not
  // distribute an object containing a union into a union of objects itself.
  const routedOwner = { ...owner, node: routedNode }
  return (
    h('div',
      {
        class: css.flowItem ?? '',
        'data-chat-anchor-key': routedNode.key,
        'data-chat-flow-key': routedNode.key,
        'data-chat-flow-kind': routedNode.kind,
      },
      renderSlot('conversation.chat.node', routedOwner, {
        entryKey: routedNode.kind,
        hookContext: nodeKey,
        fallback: (
          h(JsonBlock, {
            label: t('message.unknownSurface', { type: routedNode.kind }),
            payload: routedNode.data,
            truncatedLabel: total => t('json.truncated', { total }),
          })
        ),
      }),
    )
  )
}
