/**
 * Configurable Host plugins contributed to the shared Plugins section.
 *
 * The tab enumerates settings namespaces but never interprets one — a card
 * arrives through `settings.plugin.item` keyed by the namespace it edits, so a
 * plugin that ships a browser half owns its own card and this tab only decides
 * which keys to dispatch.
 */

import type { VNode } from 'webjsx'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from './slot-contract.ts'
import type { ConfigurablePluginsTabFace } from './tab-store.ts'
import css from './PluginsSettingsSection.module.css'

/** Cast a renderSlot() RenderOutput result into a webjsx-embeddable child. */
function asChild(node: unknown): VNode {
  return node as unknown as VNode
}

/** Props the renderer binds for the configurable tab. */
export type ConfigurablePluginsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.plugins'>
  & PropsRenderSlots<'settings.plugin.item'>
  & InjectFace<ConfigurablePluginsTabFace>

/**
 * Render cards registered by plugins that expose editable settings.
 * @param props - locale copy, slot rendering, and the namespaces to dispatch.
 * @returns the card list, or the empty line once the Host has answered.
 */
export function ConfigurablePluginsTab(props: ConfigurablePluginsTabProps): JSX.Element | null {
  const { t, renderSlot } = props
  const { loaded, namespaces } = props.useConfigurablePlugins(snapshot => snapshot)
  if (namespaces.length > 0) {
    return (
      <ul class={css.cards ?? ''}>
        {namespaces.map(ns =>
          // One dispatch per namespace, so the list identity is the namespace
          // rather than a position that shifts as cards arrive.
          asChild(renderSlot('settings.plugin.item', {}, { entryKey: ns })))}
      </ul>
    )
  }
  return loaded ? <p class={css.empty ?? ''}>{t('empty')}</p> : null
}
