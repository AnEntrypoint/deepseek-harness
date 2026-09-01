/** Frame-wide dynamic Plugin inventory, approvals, versions, and lifecycle actions.
 *
 * Converted from a React hooks component to a webjsx custom element: every
 * useState becomes a private instance field, useLayoutEffect/useEffect become
 * connectedCallback/disconnectedCallback-managed listeners driven from
 * #setOpen/#render, useDismissOnOutsidePointer becomes
 * createDismissOnOutsidePointer (JobListAction.tsx's pattern), and re-render
 * is an explicit applyDiff(this, vdom) call instead of implicit re-render on
 * setState. className -> class, camelCase event handlers -> lowercase, and
 * the inline `style={anchor}` object becomes a CSS string.
 */

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import {
  IconCheckOutline16, IconCloseOutline16, IconCordisPluginOutline14, IconPlayOutline16,
  IconStopFill16, IconTrashOutline16, Tooltip, createDismissOnOutsidePointer,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { CordisRunActivity } from '@deepseek-ai/dsh-cordis-client-runner/client'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { CordisInventoryRow } from './dynamic-port.ts'
import type { CordisPanelFace } from './slots.ts'
import type { CordisKey } from './locales.ts'
import type {
  ApprovalRequestId, CordisDynamicPackageId, CordisDynamicPluginId,
} from './events.ts'
import { cordisVisibleStatus, packageOf, type CordisVisibleStatus } from './status.ts'
import css from './CordisPanel.css.ts'

/** Full panel props composed by the sidebar footer-action slot. */
export type CordisPanelProps =
  PropsRuntime<'sidebar.footer.action'> & InjectFace<CordisPanelFace> & PropsLocale<'cordis'>

type PanelStatus = CordisVisibleStatus | 'awaiting-approval' | 'failed'

const STATUS_LABELS = {
  idle: 'status.idle',
  'awaiting-approval': 'status.awaitingApproval',
  'client-pending': 'status.clientPending',
  running: 'status.running',
  failed: 'status.failed',
} as const satisfies Record<PanelStatus, CordisKey>

const RENDER_FAILURE_LABELS = {
  abdicated: 'render.failedAbdicated',
  held: 'render.failedHeld',
} as const satisfies Record<'abdicated' | 'held', CordisKey>

interface RowView {
  readonly pluginId: CordisDynamicPluginId
  readonly agentId: SessionId
  readonly listed?: CordisInventoryRow
  readonly activity?: CordisRunActivity
}

function selectedPackageIdOf(
  { pluginId, listed, activity }: RowView,
  selected: Readonly<Record<string, CordisDynamicPackageId>>,
): CordisDynamicPackageId | undefined {
  const selectedPackageId = selected[pluginId]
  if (selectedPackageId !== undefined
    && listed?.packages.some(pkg => pkg.packageId === selectedPackageId)) return selectedPackageId
  return listed?.nextPackageId
    ?? listed?.currentPackageId
    ?? listed?.packages.at(-1)?.packageId
    ?? activity?.packageId
}

function visiblePanelStatus(
  view: RowView,
  selectedPackageId: CordisDynamicPackageId | undefined,
  loaded: Parameters<typeof cordisVisibleStatus>[2],
): PanelStatus {
  const { listed, activity } = view
  const latest = listed?.latestRun
  if (activity?.phase === 'awaiting-approval' || latest?.status === 'awaiting-approval') {
    return 'awaiting-approval'
  }
  if (latest?.status === 'failed' && latest.packageId === selectedPackageId) return 'failed'
  if (listed?.activeRun === undefined) return 'idle'
  return cordisVisibleStatus(listed, listed.activeRun.packageId, loaded)
}

function blockingFirst(rows: readonly RowView[]): readonly RowView[] {
  return [
    ...rows.filter(row => row.activity?.phase === 'awaiting-approval'),
    ...rows.filter(row => row.activity?.phase !== 'awaiting-approval'),
  ]
}

function RowAction({ label, children, ...props }: {
  label: string
  children: VNode | VNode[]
} & Record<string, unknown>): JSX.Element {
  return (
    <Tooltip label={label} side="bottom" delayMs={500}>
      <button type="button" class={css.actionButton ?? ''} aria-label={label} {...props}>
        {children}
      </button>
    </Tooltip>
  )
}

function DoubleCheckIcon(): JSX.Element {
  return (
    <span class={css.doubleCheck ?? ''} aria-hidden>
      <IconCheckOutline16 size={12} />
      <IconCheckOutline16 size={12} />
    </span>
  )
}

/** Frame-wide dynamic Plugin inventory panel, as a webjsx custom element. */
export class DshCordisPanel extends HTMLElement {
  #props: CordisPanelProps | null = null
  #open = false
  #selected: Record<string, CordisDynamicPackageId> = {}
  #pending: ReadonlySet<CordisDynamicPluginId> = new Set()
  #actionErrors: ReadonlyMap<CordisDynamicPluginId, string> = new Map()
  #visibleRequests: Set<ApprovalRequestId> = new Set()
  #anchor: { left: number; bottom: number } | undefined
  #resizeHandler: (() => void) | null = null
  #dismiss = createDismissOnOutsidePointer({ root: this, onDismiss: () => { this.#setOpen(false) } })

  /** Set/replace props and re-render; call after creating or updating the element. */
  setProps(props: CordisPanelProps): void {
    const first = this.#props === null
    this.#props = props
    this.#syncActiveRuns()
    this.#render()
    if (first) props.onRefresh()
  }

  connectedCallback(): void {
    this.#render()
  }

  disconnectedCallback(): void {
    this.#dismiss.stop()
    this.#unbindResize()
  }

  #setOpen(open: boolean): void {
    if (this.#open === open) return
    this.#open = open
    if (open) {
      this.#dismiss.start()
      this.#bindResize()
      this.#props?.onRefresh()
    } else {
      this.#dismiss.stop()
      this.#unbindResize()
    }
    this.#render()
  }

  #placeAnchor(): void {
    const rect = this.getBoundingClientRect()
    this.#anchor = { left: rect.left, bottom: window.innerHeight - rect.top + 8 }
  }

  #bindResize(): void {
    this.#unbindResize()
    this.#placeAnchor()
    const place = (): void => {
      this.#placeAnchor()
      this.#render()
    }
    this.#resizeHandler = place
    window.addEventListener('resize', place)
  }

  #unbindResize(): void {
    if (this.#resizeHandler === null) return
    window.removeEventListener('resize', this.#resizeHandler)
    this.#resizeHandler = null
  }

  /** Auto-open the panel when a new approval request appears. */
  #syncActiveRuns(): void {
    const props = this.#props
    if (props === null) return
    const activeRuns = props.useActiveRuns(snapshot => snapshot)
    const now = new Set<ApprovalRequestId>()
    for (const activity of activeRuns.values()) {
      if (activity.phase === 'awaiting-approval') now.add(activity.requestId)
    }
    const discovered = [...now].some(requestId => !this.#visibleRequests.has(requestId))
    this.#visibleRequests = now
    if (discovered) this.#setOpen(true)
  }

  #runAction(pluginId: CordisDynamicPluginId, action: () => Promise<void | { ok: boolean; message?: string }>): void {
    if (this.#pending.has(pluginId)) return
    this.#pending = new Set(this.#pending).add(pluginId)
    const clearedErrors = new Map(this.#actionErrors)
    clearedErrors.delete(pluginId)
    this.#actionErrors = clearedErrors
    this.#render()
    void (async () => {
      try {
        const result = await action()
        if (result !== undefined && !result.ok) {
          this.#actionErrors = new Map(this.#actionErrors).set(pluginId, result.message ?? 'operation failed')
        }
      } catch (error) {
        this.#actionErrors = new Map(this.#actionErrors).set(
          pluginId,
          error instanceof Error ? error.message : String(error),
        )
      } finally {
        const next = new Set(this.#pending)
        next.delete(pluginId)
        this.#pending = next
        this.#props?.onRefresh()
        this.#render()
      }
    })()
  }

  #renderRow(view: RowView): VNode {
    const props = this.#props
    if (props === null) return <></> as unknown as VNode
    const { t, useLoaded, onApprove, onDecline, onRun, onStop, onRemove } = props
    const loaded = useLoaded(snapshot => snapshot)
    const { pluginId, listed, activity } = view
    const selectedPackageId = selectedPackageIdOf(view, this.#selected)
    const selectedPackage = listed !== undefined && selectedPackageId !== undefined
      ? packageOf(listed, selectedPackageId)
      : undefined
    const activePackage = listed?.activeRun === undefined
      ? undefined
      : packageOf(listed, listed.activeRun.packageId)
    const name = selectedPackage?.name
      ?? (activity?.phase === 'awaiting-approval' ? activity.name : pluginId)
    const purpose = selectedPackage?.purpose
      ?? (activity?.phase === 'awaiting-approval' ? activity.purpose : '')
    const latest = listed?.latestRun
    const awaiting = activity?.phase === 'awaiting-approval'
      ? activity.requestId
      : latest?.status === 'awaiting-approval' ? latest.approvalRequestId : undefined
    const status = visiblePanelStatus(view, selectedPackageId, loaded)
    const busy = this.#pending.has(pluginId) || activity?.phase === 'orchestrating'
    const failure = props.useRunErrors(snapshot => snapshot).get(pluginId)
    const hostFailure = latest?.status === 'failed' ? latest.error : undefined
    const renderFailure = props.useRenderFailures(snapshot => snapshot).get(pluginId)
    const actionError = this.#actionErrors.get(pluginId)
    const nextPackageId = listed?.nextPackageId !== undefined
      && listed.nextPackageId !== listed.currentPackageId ? listed.nextPackageId : undefined
    const currentPackageId = listed?.currentPackageId
    const runMode = listed?.currentPackageId !== undefined
      && selectedPackageId !== listed.currentPackageId ? 'update' as const : 'run' as const

    return (
      <li
        key={pluginId}
        class={css.row ?? ''}
        data-cordis-row={pluginId}
        data-cordis-status={status}
        data-cordis-awaiting={awaiting !== undefined || undefined}
      >
        <div class={css.rowHead ?? ''}>
          <span class={css.rowId ?? ''}>{pluginId}</span>
          <span class={css.rowName ?? ''}>{name}</span>
          <span class={css.rowStatus ?? ''}>{t(STATUS_LABELS[status])}</span>
        </div>
        {listed !== undefined && listed.packages.length > 1 && selectedPackageId !== undefined && (
          <label class={css.versionPicker ?? ''}>
            <span>{t('panel.version')}</span>
            <select
              value={selectedPackageId}
              disabled={busy}
              onchange={(event: Event) => {
                const value = (event.target as HTMLSelectElement).value as CordisDynamicPackageId
                this.#selected = { ...this.#selected, [pluginId]: value }
                this.#render()
              }}
            >
              {listed.packages.map(pkg => (
                <option key={pkg.packageId} value={pkg.packageId}>{`${pkg.name} · ${pkg.packageId}`}</option>
              ))}
            </select>
          </label>
        )}
        <div class={css.rowDetail ?? ''}>
          <span class={css.rowPurpose ?? ''}>{purpose}</span>
          <div class={css.rowActions ?? ''}>
            {awaiting !== undefined && (
              <>
                <RowAction
                  label={t('action.approveOnce')}
                  data-cordis-approve={awaiting}
                  disabled={busy}
                  onclick={() => { this.#runAction(pluginId, async () => {
                    await onApprove(awaiting, false)
                    this.#setOpen(false)
                  }) }}
                >
                  <IconCheckOutline16 size={14} />
                </RowAction>
                <RowAction
                  label={t('action.approvePlugin')}
                  data-cordis-approve-plugin={awaiting}
                  disabled={busy}
                  onclick={() => { this.#runAction(pluginId, async () => {
                    await onApprove(awaiting, true)
                    this.#setOpen(false)
                  }) }}
                >
                  <DoubleCheckIcon />
                </RowAction>
                <RowAction
                  label={t('action.decline')}
                  data-cordis-decline={awaiting}
                  disabled={busy}
                  onclick={() => { this.#runAction(pluginId, async () => {
                    await onDecline(awaiting)
                    this.#setOpen(false)
                  }) }}
                >
                  <IconCloseOutline16 size={14} />
                </RowAction>
              </>
            )}
            {awaiting === undefined && listed !== undefined
              && selectedPackageId !== undefined && listed.activeRun === undefined && (
              <RowAction
                label={t('action.run')}
                data-cordis-switch="run"
                disabled={busy}
                onclick={() => { this.#runAction(pluginId, () => onRun({
                  agentId: listed.agentId,
                  pluginId,
                  packageId: selectedPackageId,
                  mode: runMode,
                  hasClientHalf: selectedPackage?.hasClientHalf === true,
                })) }}
              >
                <IconPlayOutline16 size={14} />
              </RowAction>
            )}
            {awaiting === undefined && listed !== undefined && listed.activeRun !== undefined
              && selectedPackageId !== listed.activeRun.packageId && selectedPackage !== undefined && (
              <RowAction
                label={t('action.run')}
                data-cordis-switch="run"
                disabled={busy}
                onclick={() => { this.#runAction(pluginId, () => onRun({
                  agentId: listed.agentId,
                  pluginId,
                  packageId: selectedPackage.packageId,
                  mode: runMode,
                  hasClientHalf: selectedPackage.hasClientHalf,
                })) }}
              >
                <IconPlayOutline16 size={14} />
              </RowAction>
            )}
            {awaiting === undefined && listed !== undefined && listed.activeRun !== undefined && status === 'client-pending'
              && activePackage !== undefined && selectedPackageId === listed.activeRun.packageId && (
              <RowAction
                label={t('action.run')}
                data-cordis-switch="run"
                disabled={busy}
                onclick={() => { this.#runAction(pluginId, () => onRun({
                  agentId: listed.agentId,
                  pluginId,
                  packageId: activePackage.packageId,
                  mode: 'run',
                  hasClientHalf: true,
                })) }}
              >
                <IconPlayOutline16 size={14} />
              </RowAction>
            )}
            {awaiting === undefined && listed !== undefined && listed.activeRun !== undefined && (
              <RowAction
                label={t('action.stop')}
                data-cordis-switch="stop"
                disabled={busy}
                onclick={() => { this.#runAction(pluginId, () => onStop(listed.agentId, pluginId)) }}
              >
                <IconStopFill16 size={14} />
              </RowAction>
            )}
            {awaiting === undefined && listed !== undefined && (
              <RowAction
                label={t('action.remove')}
                data-cordis-remove={pluginId}
                disabled={busy}
                onclick={() => { this.#runAction(pluginId, () => onRemove(listed.agentId, pluginId)) }}
              >
                <IconTrashOutline16 size={14} />
              </RowAction>
            )}
          </div>
        </div>
        {awaiting === undefined && nextPackageId !== undefined && listed !== undefined && (
          <div class={css.transition ?? ''}>
            <span>{currentPackageId === undefined ? '' : t('panel.current', { packageId: currentPackageId })}</span>
            <span>{t('panel.next', { packageId: nextPackageId })}</span>
            <div class={css.transitionActions ?? ''}>
              <button
                type="button"
                disabled={busy}
                onclick={() => { this.#runAction(pluginId, () => onRun({
                  agentId: listed.agentId,
                  pluginId,
                  packageId: nextPackageId,
                  mode: currentPackageId === undefined ? 'run' : 'update',
                  hasClientHalf: packageOf(listed, nextPackageId)?.hasClientHalf === true,
                })) }}
              >{t('action.retry')}</button>
              {currentPackageId !== undefined && (
                <button
                  type="button"
                  disabled={busy}
                  onclick={() => { this.#runAction(pluginId, () => onRun({
                    agentId: listed.agentId,
                    pluginId,
                    packageId: currentPackageId,
                    mode: 'run',
                    hasClientHalf: packageOf(listed, currentPackageId)?.hasClientHalf === true,
                  })) }}
                >{t('action.rollback')}</button>
              )}
            </div>
          </div>
        )}
        {failure !== undefined && (
          <div class={css.rowError ?? ''} role="alert">{`${failure.message} (${failure.reason})`}</div>
        )}
        {failure === undefined && hostFailure !== undefined && (
          <div class={css.rowError ?? ''} role="alert">{`${hostFailure.message} (${hostFailure.phase})`}</div>
        )}
        {actionError !== undefined && <div class={css.rowError ?? ''} role="alert">{actionError}</div>}
        {renderFailure !== undefined && (
          <div
            class={css.rowError ?? ''}
            role="alert"
            data-cordis-render-failure={renderFailure.slot}
            data-cordis-render-abdicated={renderFailure.abdicated || undefined}
          >
            {`${t(RENDER_FAILURE_LABELS[renderFailure.abdicated ? 'abdicated' : 'held'], {
              slot: renderFailure.slot,
            })} ${renderFailure.message}`}
          </div>
        )}
        {activePackage !== undefined && activePackage.packageId !== selectedPackageId && (
          <span class={css.activeVersion ?? ''}>{`${t('status.running')}: ${activePackage.name} · ${activePackage.packageId}`}</span>
        )}
      </li>
    ) as unknown as VNode
  }

  #render(): void {
    const props = this.#props
    if (props === null) { applyDiff(this, <span style="display:none" />); return }
    const { wide, useSessions, useInventory, useActiveRuns, useLoaded, t } = props

    const inventory = useInventory(snapshot => snapshot)
    const activeRuns = useActiveRuns(snapshot => snapshot)
    const loaded = useLoaded(snapshot => snapshot)
    const current = useSessions(state => state.current)

    const byPlugin = new Map<CordisDynamicPluginId, RowView>()
    for (const listed of inventory.rows) {
      const activity = activeRuns.get(listed.pluginId)
      byPlugin.set(listed.pluginId, {
        pluginId: listed.pluginId,
        agentId: activity?.agentId ?? listed.agentId,
        listed,
        ...activity === undefined ? {} : { activity },
      })
    }
    for (const [pluginId, activity] of activeRuns) {
      if (byPlugin.has(pluginId)) continue
      byPlugin.set(pluginId, { pluginId, agentId: activity.agentId, activity })
    }
    const all = [...byPlugin.values()]
    const mine = blockingFirst(all.filter(row => current !== undefined && row.agentId === current))
    const theirs = blockingFirst(all.filter(row => current === undefined || row.agentId !== current))
    const approvals = [...activeRuns.values()].filter(activity => activity.phase === 'awaiting-approval').length
    const running = all.filter(view => visiblePanelStatus(
      view,
      selectedPackageIdOf(view, this.#selected),
      loaded,
    ) === 'running').length

    if (all.length === 0) { applyDiff(this, <span style="display:none" />); return }

    const open = this.#open
    const anchor = this.#anchor

    const vdom = (
      <div class={wide ? (css.layer ?? '') : `${css.layer ?? ''} ${css.rail ?? ''}`}>
        {open && anchor !== undefined && (
          <section
            class={css.panel ?? ''}
            style={`left: ${anchor.left}px; bottom: ${anchor.bottom}px`}
            data-cordis-panel
            aria-label={t('panel.title')}
          >
            <header class={css.header ?? ''}>
              <span class={css.title ?? ''}>{t('panel.title')}</span>
            </header>
            <div class={css.body ?? ''}>
              {inventory.error !== undefined && (
                <p class={css.readError ?? ''} role="alert">{t('panel.readFailed', { message: inventory.error })}</p>
              )}
              {!inventory.read && inventory.error === undefined && <p class={css.note ?? ''}>{t('panel.loading')}</p>}
              {inventory.read && all.length === 0 && <p class={css.note ?? ''}>{t('panel.empty')}</p>}
              {mine.length > 0 && (
                <section>
                  <h3 class={css.group ?? ''}>{t('panel.group.current')}</h3>
                  <ul class={css.rows ?? ''}>{mine.map(view => this.#renderRow(view))}</ul>
                </section>
              )}
              {theirs.length > 0 && (
                <section>
                  <h3 class={css.group ?? ''}>{t('panel.group.others')}</h3>
                  <ul class={css.rows ?? ''}>{theirs.map(view => this.#renderRow(view))}</ul>
                </section>
              )}
            </div>
          </section>
        )}
        <div class={css.footerButtons ?? ''}>
          <button
            type="button"
            class={css.badge ?? ''}
            data-cordis-badge={all.length}
            data-cordis-approval-badge={approvals}
            data-active={approvals > 0 || undefined}
            aria-label={t('panel.plugins.aria')}
            aria-expanded={open}
            onclick={() => { this.#setOpen(!open) }}
          >
            <IconCordisPluginOutline14 size={wide ? 16 : 18} />
            {wide && (
              <>
                <span class={css.badgeLabel ?? ''}>{t('panel.trigger')}</span>
                <span class={css.badgeCount ?? ''}>{t('panel.runningCount', { count: running })}</span>
              </>
            )}
          </button>
        </div>
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-cordis-panel') === undefined) {
  customElements.define('dsh-cordis-panel', DshCordisPanel)
}
