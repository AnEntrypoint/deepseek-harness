/** The General section: one column rendering feature-owned item contributions. */
import type { VNode } from 'webjsx'
import type { PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import css from './GeneralSection.css.ts'

/** Cast a renderSlot() RenderOutput result into a webjsx-embeddable child. */
function asChild(node: unknown): VNode {
  return node as unknown as VNode
}

/** Full component props: section owner share plus item render share. */
export type GeneralSectionComponentProps =
  PropsRuntime<'settings.section'> & PropsRenderSlots<'settings.general.item'>

/**
 * Render the General section content column.
 * @param props - composed slot props (contract/slots.ts).
 * @returns the section element tree.
 */
export function GeneralSection({ renderSlot }: GeneralSectionComponentProps): JSX.Element {
  return (
    <div class={css.section ?? ''}>
      {asChild(renderSlot('settings.general.item', {}))}
    </div>
  )
}
