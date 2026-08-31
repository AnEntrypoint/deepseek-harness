/**
 * Workspace pick/add flow. WorkspacePickFlow is the reusable core (menu +
 * path error dialog) consumed directly by WorkspaceBrowser (same package) and
 * wrapped by WorkspacePicker for the conversation empty-state slot
 * registration. Directory picking itself lives in the composed flow package's
 * slot occupant (see the contract module doc): this core only opens the flow,
 * adopts the picked path, and owns the error surface. Adding a workspace has
 * exactly one route — pick a host directory, new or existing — because the
 * occupant's own create-folder affordance already covers creating one.
 */
import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import {
  Button, IconFolderClose16, IconPlusOutline16, Menu, Modal, type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  WorkspaceId, WorkspaceListState, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { DirectoryFlowOwnerProps, WorkspacePickerProps } from './contract/slots.ts'
import css from './WorkspacePicker.module.css'

const ADD_WORKSPACE = '::add-workspace'

/** Core flow props: the owner supplies popover control and pick semantics. */
export interface WorkspacePickFlowProps {
  /** The standard locale seat, forwarded by whichever slot entry hosts the flow. */
  t: WorkspacePickerProps['t']
  /** Popover visibility (anchor button toggle state, owner-local). */
  open: boolean
  /** The anchor button element — the popover's placement anchor. */
  anchorRef?: { current: HTMLElement | null } | undefined
  /** Selector hook over the workspace list (framework standard hook). */
  useWorkspaces: <S>(selector: (state: WorkspaceListState) => S) => S
  /** Adopt a picked host directory as a real Workspace. */
  createWorkspace: (input: { path: string }) => Promise<WorkspaceView>
  /** Bound occupancy selector hook for this surface's directory-flow hole (empty leaves the surface with no add action). */
  useDirectoryFlow: SnapshotSelectorHook<boolean>
  /** Render this surface's directory-flow hole with the owner conversation (the entry's narrowed renderSlot). */
  renderDirectoryFlow: (owner: DirectoryFlowOwnerProps) => VNode | null
  /** A real Workspace was picked or created. */
  onPick: (workspaceId: WorkspaceId) => void
  /** Close the popover (outside click / Escape / post-pick). */
  onClose: () => void
  /** Only offer the add action, hide existing workspaces. */
  addOnly?: boolean
  /** Menu opening direction relative to the anchor. */
  side?: 'bottom' | 'top' | 'right'
  /** Currently active workspace (trailing check in the picker list). */
  selectedId?: WorkspaceId | undefined
}

/**
 * Pick menu plus the adoption error dialog, as a webjsx custom element.
 * Converted from a React hooks component: every useState becomes a private
 * field, useCallback identities are irrelevant (no memoized child tree to
 * preserve), and the two useEffect bodies become explicit comparisons inside
 * `#render()` — the framework's standard selector hooks (`useWorkspaces`,
 * `useDirectoryFlow`) are called directly from `#render()`, matching
 * ui-conversation's DshChatView established convention for webjsx elements
 * consuming the standard-kit hooks.
 */
export class DshWorkspacePickFlow extends HTMLElement {
  #props: WorkspacePickFlowProps | null = null
  #errorOpen = false
  #modalError: string | null = null
  #flowOpen = false
  #pickingFolder = false
  /** Edge-trigger latch for the addIsTheOnlyEntry auto-open (was a useEffect deps array). */
  #autoOpenArmedFor: { open: boolean; addIsTheOnlyEntry: boolean; flowBusy: boolean } | null = null

  setProps(props: WorkspacePickFlowProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  #getAnchorRect = (): DOMRect | null => this.#props?.anchorRef?.current?.getBoundingClientRect() ?? null

  #closeModal(): void {
    this.#errorOpen = false
    this.#modalError = null
    this.#render()
  }

  /** Adopt a picked directory; failures land in the folder-error dialog (Choose again reopens the flow). */
  #adoptDirectory(path: string): Promise<void> {
    const props = this.#props
    if (props === null) return Promise.resolve()
    return props.createWorkspace({ path }).then((workspace) => {
      this.#flowOpen = false
      this.#render()
      props.onPick(workspace.workspaceId)
    }).catch((reason: unknown) => {
      this.#modalError = reason instanceof Error ? reason.message : String(reason)
      this.#flowOpen = false
      this.#errorOpen = true
      this.#render()
    })
  }

  #openDirectoryFlow(): void {
    const props = this.#props
    if (props === null) return
    props.onClose()
    this.#errorOpen = false
    this.#modalError = null
    this.#flowOpen = true
    this.#render()
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const {
      t, open, useWorkspaces, useDirectoryFlow, renderDirectoryFlow, onPick, onClose,
      addOnly = false, side = 'bottom', selectedId,
    } = props

    const workspaceSnapshot = useWorkspaces(state => state)
    const workspaces = workspaceSnapshot.items
    const flowOpen = this.#flowOpen
    const pickingFolder = this.#pickingFolder
    // One picking interaction at a time: while the flow is open (native chooser
    // pending, browse dialog up) or its pick is being adopted, every other
    // menu action stays disabled — a late outcome must not race a concurrent
    // selection or adoption.
    const flowBusy = flowOpen || pickingFolder

    // The occupied hole gates the picking affordance: with no composed flow the
    // entry simply is not there (the seam's documented no-flow default). The
    // framework-bound hook keeps occupancy live: flow plugins activate (and
    // HMR-reload) independently of this menu's renders.
    const flowAvailable = useDirectoryFlow(occupied => occupied)
    // An occupant that unloads mid-interaction leaves nobody to cancel: an
    // open flow over an already empty hole (Choose again after the occupant
    // unloaded with the error dialog up) — that transition must snap back
    // too, not just occupancy loss. Deferred to a microtask so it lands after
    // this synchronous render finishes (mirrors the original effect running
    // after commit).
    if (flowOpen && !flowAvailable) {
      this.#flowOpen = false
      queueMicrotask(() => { this.#render() })
    }
    const addEntries: MenuEntry[] = flowAvailable
      ? [{ id: ADD_WORKSPACE, label: t('menu.addWorkspace'), icon: <IconPlusOutline16 size={16} />, disabled: flowBusy }]
      : []
    // With workspaces listed, the add action pins below the scroll region
    // (divider + always visible); otherwise it IS the menu.
    const pinAdd = !addOnly && workspaces.length > 0
    const items: MenuEntry[] = pinAdd
      ? workspaces.map(workspace => ({
        id: workspace.workspaceId,
        label: workspace.title,
        icon: <IconFolderClose16 size={16} />,
        disabled: flowBusy,
      }))
      : addEntries
    // Nothing listed and nothing to add with (a composition that mounts this
    // package without any directory-picker): an empty popover would claim a
    // choice that does not exist, so the anchor gesture shows nothing at all.
    const menuIsEmpty = items.length === 0

    // A menu exists to disambiguate between targets. With no workspaces listed
    // and the add action the only entry left, the anchor gesture IS that action:
    // a one-row popover would cost a click and offer nothing to choose between.
    // The owner's open request is consumed the same way selecting the entry
    // would consume it (close the popover, raise the flow). An empty list is
    // only final once the baseline lands — until then the menu stays up with its
    // loading status instead of jumping into a flow the arriving list would have
    // made unnecessary; the add-only surface lists nothing and never waits.
    const listSettled = addOnly || workspaceSnapshot.phase === 'ready'
    const addIsTheOnlyEntry = !pinAdd && listSettled && addEntries.length === 1
    // `flowBusy` gates this exactly as it disables the equivalent menu entry: a
    // pick still being adopted owns the surface until it settles. Edge-triggered
    // on [open, addIsTheOnlyEntry, flowBusy] (mirrors the original useEffect's
    // deps array): re-checking the same held-true condition on every render
    // (rather than only on a value transition) re-armed this open on each
    // render the popover's own onClose synchronously caused while unwound —
    // an infinite microtask loop with no yield point, hanging the tab.
    const autoOpenKey = { open, addIsTheOnlyEntry, flowBusy }
    const autoOpenChanged = this.#autoOpenArmedFor === null
      || this.#autoOpenArmedFor.open !== autoOpenKey.open
      || this.#autoOpenArmedFor.addIsTheOnlyEntry !== autoOpenKey.addIsTheOnlyEntry
      || this.#autoOpenArmedFor.flowBusy !== autoOpenKey.flowBusy
    if (autoOpenChanged) {
      this.#autoOpenArmedFor = autoOpenKey
      if (open && addIsTheOnlyEntry && !flowBusy) {
        queueMicrotask(() => { this.#openDirectoryFlow() })
      }
    }

    /** Owner side of the flow conversation: adopt keeps the flow open (busy) until the Host answers. */
    const flowOwner: DirectoryFlowOwnerProps = {
      open: flowOpen,
      busy: pickingFolder,
      onPicked: (path) => {
        this.#pickingFolder = true
        this.#render()
        void this.#adoptDirectory(path).finally(() => { this.#pickingFolder = false; this.#render() })
      },
      onCancel: () => { this.#flowOpen = false; this.#render() },
      onError: (message) => {
        this.#flowOpen = false
        this.#modalError = message
        this.#errorOpen = true
        this.#render()
      },
    }

    const handleSelect = (id: string): void => {
      if (id === ADD_WORKSPACE) {
        this.#openDirectoryFlow()
        return
      }
      onPick(id as WorkspaceId)
    }

    const directoryFlowNode = renderDirectoryFlow(flowOwner)
    const statusNode = open && !addIsTheOnlyEntry && !menuIsEmpty && workspaceSnapshot.phase === 'pending'
      ? <div class={css.menuStatus ?? ''} role="status">{t('picker.loading')}</div>
      : null
    const vdom: VNode[] = [
      <Menu
        open={open && !addIsTheOnlyEntry && !menuIsEmpty}
        anchor=""
        items={items}
        {...pinAdd ? { footer: addEntries } : {}}
        selectedId={selectedId}
        onSelect={handleSelect}
        onClose={onClose}
        side={side}
        portal
        getAnchorRect={this.#getAnchorRect}
      />,
      ...(statusNode === null ? [] : [statusNode]),
      ...(directoryFlowNode === null ? [] : [directoryFlowNode]),
      <Modal
        open={this.#errorOpen}
        onClose={() => { this.#closeModal() }}
        closeLabel={t('close')}
        title={t('folderError.title')}
        footer={[
          <Button variant="outline" class={css.modalAction ?? ''} onclick={() => { this.#closeModal() }}>{t('cancel')}</Button>,
          /* Retrying needs an occupant to serve the flow; without one the
           * button would open a flow nobody can answer or cancel. */
          <Button variant="primary" class={css.modalAction ?? ''} disabled={!flowAvailable} onclick={() => { this.#openDirectoryFlow() }}>{t('folderError.retry')}</Button>,
        ]}
      >
        <div class={css.modalError ?? ''} role="alert">{this.#modalError}</div>
      </Modal>,
    ]
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-workspace-pick-flow') === undefined) {
  customElements.define('dsh-workspace-pick-flow', DshWorkspacePickFlow)
}

/**
 * Create (if needed) or update a WorkspacePickFlow element in place.
 * @param el - an existing `dsh-workspace-pick-flow` element to update, or null to create one.
 * @param props - see {@link WorkspacePickFlowProps}.
 * @returns the `dsh-workspace-pick-flow` element; keep it and pass it back in to update.
 */
export function renderWorkspacePickFlow(el: DshWorkspacePickFlow | null, props: WorkspacePickFlowProps): DshWorkspacePickFlow {
  const target = el ?? document.createElement('dsh-workspace-pick-flow') as DshWorkspacePickFlow
  target.setProps(props)
  return target
}

/** One-shot creation helper preserving the original function-component call shape. */
export function WorkspacePickFlow(props: WorkspacePickFlowProps): JSX.Element {
  return renderWorkspacePickFlow(null, props) as unknown as JSX.Element
}

/**
 * The conversation empty-state registration: adapts the owner share to the
 * core flow (all state and semantics live in the flow / the owner). Converted
 * to a webjsx custom element wrapping {@link DshWorkspacePickFlow}, since it
 * only reads props and creates no local state — a thin bridge, same shape as
 * ui-primitives' one-shot creation helpers.
 */
export class DshWorkspacePicker extends HTMLElement {
  #props: WorkspacePickerProps | null = null

  setProps(props: WorkspacePickerProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const {
      open, anchorRef, useWorkspaces, selectedId, onPick, onClose, createWorkspace, useDirectoryFlow, renderSlot, t,
    } = props
    const vdom = (
      <DshWorkspacePickFlowElement
        t={t}
        open={open}
        anchorRef={anchorRef}
        useWorkspaces={useWorkspaces}
        createWorkspace={createWorkspace}
        useDirectoryFlow={useDirectoryFlow}
        renderDirectoryFlow={owner => renderSlot('conversation.hero.workspace.directoryFlow', owner) as VNode | null}
        selectedId={selectedId}
        onPick={onPick}
        onClose={onClose}
      />
    )
    applyDiff(this, vdom)
  }
}

/** JSX-callable alias so `#render()` above can use the tag as a plain component call. */
function DshWorkspacePickFlowElement(props: WorkspacePickFlowProps): JSX.Element {
  return renderWorkspacePickFlow(null, props) as unknown as JSX.Element
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-workspace-picker') === undefined) {
  customElements.define('dsh-workspace-picker', DshWorkspacePicker)
}

/**
 * Create (if needed) or update a WorkspacePicker element in place.
 * @param el - an existing `dsh-workspace-picker` element to update, or null to create one.
 * @param props - see {@link WorkspacePickerProps}.
 * @returns the `dsh-workspace-picker` element; keep it and pass it back in to update.
 */
export function renderWorkspacePicker(el: DshWorkspacePicker | null, props: WorkspacePickerProps): DshWorkspacePicker {
  const target = el ?? document.createElement('dsh-workspace-picker') as DshWorkspacePicker
  target.setProps(props)
  return target
}

/** One-shot creation helper preserving the original function-component call shape. */
export function WorkspacePicker(props: WorkspacePickerProps): JSX.Element {
  return renderWorkspacePicker(null, props) as unknown as JSX.Element
}
