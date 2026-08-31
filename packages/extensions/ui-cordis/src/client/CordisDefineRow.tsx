/** Read-only `cordis_define` card with Host and Client source tabs.
 *
 * Converted from a React hooks component (useState/useId) to a plain webjsx
 * function component: this card has no lifecycle needs (no effects, no
 * external subscriptions beyond the injected hooks already re-invoked on
 * every parent re-render), so local `expanded`/`selectedSource` state is
 * hoisted into module-scope WeakMap-keyed state per callId instead of a
 * custom element — matching the "stateless-looking, state-carrying" plain
 * function idiom used elsewhere for simple per-key toggles. useId becomes a
 * stable id derived from callId.
 */

import {
  CodeBlock, DisclosureRow, IconCodeOutline16, IconInspectOutline12, StateDot,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { VNode } from 'webjsx'
import { applyDiff } from 'webjsx'
import type { InjectFace, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { cordisDefineCard, type CordisToolState } from './card-model.ts'
import type { CordisCardFace } from './slots.ts'
import { cordisVisibleStatus, type CordisVisibleStatus } from './status.ts'
import type { CordisKey } from './locales.ts'
import css from './CordisDefineRow.module.css'

/** Full card props composed by the keyed Tool slot. */
export type CordisDefineRowProps = ToolCallViewProps & InjectFace<CordisCardFace> & PropsLocale<'cordis'>

type CardReading = CordisVisibleStatus | 'removed'
type SourceTab = 'client' | 'host'

const READING_LABELS = {
  idle: 'status.idle',
  'client-pending': 'status.clientPending',
  running: 'status.running',
  removed: 'status.removed',
} as const satisfies Record<CardReading, CordisKey>

function stateStatus(state: CordisToolState): CordisKey | null {
  switch (state) {
    case 'running': return 'a11y.defining'
    case 'error': return 'a11y.failed'
    case 'stopped': return 'a11y.stopped'
    default: return null
  }
}

function leadingFor(state: CordisToolState): VNode {
  switch (state) {
    case 'error': return <StateDot state="error" /> as unknown as VNode
    case 'stopped': return <StateDot state="warning" /> as unknown as VNode
    default: return <IconCodeOutline16 size={14} /> as unknown as VNode
  }
}

/** Per-card local UI state (expanded / active source tab), keyed by `callId`. */
interface CardState {
  expanded: boolean
  selectedSource: SourceTab | null
}
const cardStates = new Map<string, CardState>()

function stateFor(callId: string): CardState {
  let state = cardStates.get(callId)
  if (state === undefined) {
    state = { expanded: false, selectedSource: null }
    cardStates.set(callId, state)
  }
  return state
}

/** Read-only `cordis_define` card, as a webjsx custom element (per-instance re-render on toggle). */
export class DshCordisDefineRow extends HTMLElement {
  #props: CordisDefineRowProps | null = null

  setProps(props: CordisDefineRowProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  #render(): void {
    const props = this.#props
    if (props === null) { applyDiff(this, <span style="display:none" />); return }
    const { callId, block, inspect, useInventory, useLoaded, t } = props
    const card = cordisDefineCard(block)
    const inventory = useInventory(snapshot => snapshot)
    const loaded = useLoaded(snapshot => snapshot)
    const defaultSource: SourceTab = card.clientCode !== null ? 'client' : 'host'
    const local = stateFor(callId)
    const sourcePanelId = `cordis-define-${callId}`

    const row = card.pluginId === null
      ? undefined
      : inventory.rows.find(candidate => candidate.pluginId === card.pluginId)
    const reading: CardReading = card.pluginId !== null && inventory.removed.has(card.pluginId)
      ? 'removed'
      : row !== undefined && card.packageId !== null
        ? cordisVisibleStatus(row, card.packageId, loaded)
        : 'idle'
    const name = card.name ?? callId
    const expandable = card.hostCode !== null || card.clientCode !== null || card.output !== null
    const open = local.expanded && expandable
    const a11yState = stateStatus(card.state)
    const hasSource = card.clientCode !== null || card.hostCode !== null
    const selectedSource = local.selectedSource ?? defaultSource
    const activeSource: SourceTab = selectedSource === 'client' && card.clientCode !== null
      ? 'client'
      : selectedSource === 'host' && card.hostCode !== null
        ? 'host'
        : card.clientCode !== null ? 'client' : 'host'
    const activeCode = activeSource === 'client' ? card.clientCode : card.hostCode

    const vdom = (
      <div
        class={css.card ?? ''}
        data-tool="cordis_define"
        data-state={card.state}
        data-terminal={reading === 'removed' || undefined}
        data-cordis-plugin-id={card.pluginId ?? undefined}
        data-cordis-package-id={card.packageId ?? undefined}
        data-cordis-status={reading}
      >
        {a11yState !== null && <span class={css.visuallyHidden ?? ''}>{t(a11yState)}</span>}
        <DisclosureRow
          rowClassName={css.row}
          titleClassName={css.title}
          chevronClassName={css.chevron}
          icon={leadingFor(card.state)}
          title={t('row.defineTitle')}
          open={open}
          expandable={expandable}
          expandOnRowClick
          keepContentWhenOpen
          onToggle={() => { local.expanded = !local.expanded; this.#render() }}
          collapsedContent={(
            <>
              <span class={css.separator ?? ''} aria-hidden />
              <span class={card.errorSummary === null ? (css.name ?? '') : (css.errorSummary ?? '')}>
                {card.errorSummary ?? name}
              </span>
              {card.errorSummary === null && (
                <span class={css.purpose ?? ''}>{card.purpose ?? t('purpose.missing')}</span>
              )}
              {card.pluginId !== null && (
                <span class={css.readout ?? ''}>
                  <span class={css.statusLabel ?? ''}>{t(READING_LABELS[reading])}</span>
                </span>
              )}
            </>
          )}
        >
          <div class={css.bodyWrap ?? ''}>
            {hasSource && activeCode !== null && (
              <section class={css.sourceCard ?? ''}>
                <div class={css.sourceTabs ?? ''} role="tablist" aria-label={t('body.source')}>
                  {(['client', 'host'] as const).map((source) => {
                    const available = source === 'client' ? card.clientCode !== null : card.hostCode !== null
                    return (
                      <button
                        key={source}
                        id={`${sourcePanelId}-${source}`}
                        type="button"
                        role="tab"
                        aria-controls={sourcePanelId}
                        aria-selected={activeSource === source}
                        class={activeSource === source ? `${css.sourceTab ?? ''} ${css.sourceTabActive ?? ''}` : (css.sourceTab ?? '')}
                        disabled={!available}
                        onclick={() => { local.selectedSource = source; this.#render() }}
                      >
                        {t(source === 'client' ? 'body.clientCode' : 'body.hostCode')}
                      </button>
                    )
                  })}
                </div>
                <div
                  id={sourcePanelId}
                  class={css.sourcePanel ?? ''}
                  role="tabpanel"
                  aria-labelledby={`${sourcePanelId}-${activeSource}`}
                >
                  <CodeBlock
                    code={activeCode}
                    lang="javascript"
                    copyLabel={t('body.copy')}
                    copiedLabel={t('body.copied')}
                    class={css.sourceCode}
                  />
                </div>
              </section>
            )}
            {card.output !== null && (
              <section class={css.codeSection ?? ''}>
                <div class={css.sectionLabel ?? ''}>{t('body.output')}</div>
                <pre class={css.output ?? ''} data-error={card.state === 'error' || undefined}>{card.output}</pre>
              </section>
            )}
            {card.pluginId !== null && <div class={css.panelHint ?? ''}>{t('panel.hint')}</div>}
            {inspect !== undefined && (
              <button type="button" class={css.inspectButton ?? ''} onclick={inspect}>
                <IconInspectOutline12 />
                Inspect
              </button>
            )}
          </div>
        </DisclosureRow>
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-cordis-define-row') === undefined) {
  customElements.define('dsh-cordis-define-row', DshCordisDefineRow)
}
