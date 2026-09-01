/**
 * The workspace/session browsing region filling the sidebar shell's
 * `sidebar.workspaces` hole: section header (title + view options + add
 * workspace), search, the grouped tree or flat list, and the workspace
 * dialogs. Wide state renders the full browser; rail state renders the two
 * region icons (search / add workspace) as 36px controls on the shell's shared
 * rail entry path, each requesting expansion through the owner share. Adding
 * is the header button's one action, so it raises the directory flow with no
 * menu in between; the flow and its error dialog live in WorkspacePicker
 * (same package — direct composition, no slot between them).
 *
 * Converted from a React hooks component tree to webjsx custom elements:
 * every nested component that held `useState`/`useRef`/`useEffect` identity
 * (ViewOptionsMenu, SessionTree, FlatList, SearchResults, and the top-level
 * WorkspaceBrowser itself) becomes its own `HTMLElement` subclass with
 * private fields replacing hook state, `setProps`/`connectedCallback`/
 * `disconnectedCallback` replacing mount/cleanup effects, and explicit
 * `applyDiff(this, vdom)` replacing implicit re-render. The framework's own
 * selector hooks (`useSessions`, `useWorkspaces`, `useStore`,
 * `useHostDescription`, `useDirectoryFlow`) are still called as plain
 * functions inside `#render()`, exactly as ConversationRoot.tsx (already
 * converted, ui-conversation) does — they are getSnapshot+subscribe sources
 * bound by the framework's render machinery, not React hooks, so no manual
 * subscribe/unsubscribe wiring is needed here.
 */
import { applyDiff } from 'webjsx'
import clsx from 'clsx'
import {
  Button, IconCloseFill14, IconPersonalizationOutline16,
  IconProjectAddOutline16, IconSearchOutline16, type DshMenu, renderMenu,
  type DshModal, renderModal, Tooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  SessionId, SessionListState, SessionSearchResultItem, WorkspaceId, WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { WorkspaceBrowserProps } from './contract/slots.ts'
import type { SessionNode, SessionOrderBy } from './tree.ts'
import { deriveFlat, deriveGroups, deriveSearchResults, UNGROUPED_KEY } from './tree.ts'
import {
  DshProjectRowItem, DshSessionNodeItem, SearchResultItem,
} from './rows/Rows.tsx'
import type { ProjectRowItemProps, SessionNodeItemProps } from './rows/Rows.tsx'

/** One-shot creation/update helper: `dsh-project-row-item` (Rows.tsx exports only the class). */
function ProjectRowItem(props: ProjectRowItemProps): JSX.Element {
  const el = document.createElement('dsh-project-row-item') as DshProjectRowItem
  el.setProps(props)
  return el as unknown as JSX.Element
}

/** One-shot creation/update helper: `dsh-session-node-item` (Rows.tsx exports only the class). */
function SessionNodeItem(props: SessionNodeItemProps): JSX.Element {
  const el = document.createElement('dsh-session-node-item') as DshSessionNodeItem
  el.setProps(props)
  return el as unknown as JSX.Element
}
import { FLAT_SESSION_ORDER_KEY } from './stores.ts'
import { WorkspacePickFlow } from './WorkspacePicker.tsx'
import css from './WorkspaceBrowser.css.ts'

/**
 * Column slide length (--ds-transition-duration-slow): rail-search focus waits it out —
 * focus() forces a synchronous layout and would jank the slide.
 */
const EXPAND_SLIDE_MS = 300
/** Pause between the latest keystroke and a Host content-search request. */
const SEARCH_DEBOUNCE_MS = 250
/** `session.search` wire bound, measured in JavaScript UTF-16 code units. */
const SEARCH_QUERY_MAX_CODE_UNITS = 500
/** Session rows visible per Workspace before the local overflow control. */
const COLLAPSED_SESSION_LIMIT = 5

/** Keep controlled input and RPC payload inside the session.search wire contract. */
function sanitizeSearchQuery(value: string): string {
  const withoutNul = value.replaceAll('\0', '')
  if (withoutNul.length <= SEARCH_QUERY_MAX_CODE_UNITS) return withoutNul
  let end = SEARCH_QUERY_MAX_CODE_UNITS
  const last = withoutNul.charCodeAt(end - 1)
  const next = withoutNul.charCodeAt(end)
  if (last >= 0xD800 && last <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end--
  return withoutNul.slice(0, end)
}

/** Immutable membership toggle for the local expand-all array. */
function toggled(list: readonly string[], key: string): string[] {
  return list.includes(key) ? list.filter(k => k !== key) : [...list, key]
}

/**
 * Accept the native drag at document level while a row drag is active: row
 * hover still owns the insertion marker, and releasing outside the list must
 * not be rendered as a rejected drop before dragend commits that last marker.
 * Bind/unbind pair used from `#syncNativeDragAcceptance` (was `useEffect`).
 */
function bindNativeDragAcceptance(): () => void {
  const acceptDrag = (event: DragEvent): void => {
    event.preventDefault()
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'move'
  }
  const acceptDrop = (event: DragEvent): void => { event.preventDefault() }
  document.addEventListener('dragover', acceptDrag)
  document.addEventListener('drop', acceptDrop)
  return () => {
    document.removeEventListener('dragover', acceptDrag)
    document.removeEventListener('drop', acceptDrop)
  }
}

/** Owns one drag-source's native-drag-acceptance bind/unbind pair, edge-triggered on the active flag. */
class NativeDragAcceptance {
  #unbind: (() => void) | null = null
  #active = false

  sync(active: boolean): void {
    if (active === this.#active) return
    this.#active = active
    this.#unbind?.()
    this.#unbind = active ? bindNativeDragAcceptance() : null
  }

  teardown(): void {
    this.#unbind?.()
    this.#unbind = null
  }
}

/** Reconcile a stored view order with the Workspace's current session account. */
function reconciledSessionOrder(sessionIds: readonly SessionId[], stored: readonly string[] | undefined): SessionId[] {
  if (stored === undefined) return [...sessionIds]
  const byId = new Map(sessionIds.map(id => [id as string, id]))
  const ordered: SessionId[] = []
  const included = new Set<string>()
  for (const key of stored) {
    const id = byId.get(key)
    if (id === undefined || included.has(key)) continue
    ordered.push(id)
    included.add(key)
  }
  for (const id of sessionIds) {
    if (included.has(id)) continue
    ordered.push(id)
  }
  return ordered
}

/** Newest update first with stable Session identity as the tie-break. */
function compareSessionRecency(a: SessionId, b: SessionId, byId: SessionListState['byId']): number {
  const aUpdatedAt = byId[a]?.updatedAt ?? Number.NEGATIVE_INFINITY
  const bUpdatedAt = byId[b]?.updatedAt ?? Number.NEGATIVE_INFINITY
  if (aUpdatedAt !== bUpdatedAt) return bUpdatedAt - aUpdatedAt
  return a < b ? -1 : 1
}

/** Reconcile one editable order account and apply its activity-promotion policy. */
function nextSessionOrderAccount({
  sessionIds, previousOrder, previousUpdatedAt, list, orderBy, sortByRecency,
}: {
  sessionIds: readonly SessionId[]
  previousOrder: readonly string[] | undefined
  previousUpdatedAt: Readonly<Record<string, number>>
  list: SessionListState
  orderBy: SessionOrderBy
  sortByRecency: boolean
}): { order: SessionId[]; updatedAt: Record<string, number>; changed: boolean } {
  let order = reconciledSessionOrder(sessionIds, previousOrder)
  if (sortByRecency) {
    order.sort((a, b) => compareSessionRecency(a, b, list.byId))
  } else if (orderBy === 'updated') {
    const promoted = sessionIds
      .filter((id) => {
        const session = list.byId[id]
        return session !== undefined
          && (previousUpdatedAt[id] === undefined || session.updatedAt > previousUpdatedAt[id])
      })
      .sort((a, b) => compareSessionRecency(a, b, list.byId))
    if (promoted.length > 0) {
      const promotedIds = new Set(promoted)
      order = [...promoted, ...order.filter(id => !promotedIds.has(id))]
    }
  }
  const updatedAt: Record<string, number> = {}
  for (const id of sessionIds) {
    const session = list.byId[id]
    if (session !== undefined) updatedAt[id] = session.updatedAt
  }
  const orderChanged = previousOrder === undefined
    || order.length !== previousOrder.length
    || order.some((id, index) => id !== previousOrder[index])
  const timestampsChanged = Object.keys(updatedAt).length !== Object.keys(previousUpdatedAt).length
    || Object.entries(updatedAt).some(([id, timestamp]) => previousUpdatedAt[id] !== timestamp)
  return { order, updatedAt, changed: orderChanged || timestampsChanged }
}

/** Own props of the {@link DshViewOptionsMenu} custom element. */
export interface ViewOptionsMenuProps {
  groupBy: 'workspace' | 'flat'
  orderBy: SessionOrderBy
  onGroupPick: (mode: 'workspace' | 'flat') => void
  onOrderPick: (mode: SessionOrderBy) => void
  t: WorkspaceBrowserProps['t']
}

/**
 * Grouping and ordering menu custom element; own open state so it resets
 * with the wide chrome. Converted from a React function component
 * (useState open) — open becomes an instance field, re-render is explicit.
 */
export class DshViewOptionsMenu extends HTMLElement {
  #props: ViewOptionsMenuProps | null = null
  #open = false
  #menu: DshMenu | null = null

  setProps(props: ViewOptionsMenuProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const { groupBy, orderBy, onGroupPick, onOrderPick, t } = props
    const open = this.#open
    this.#menu = renderMenu(this.#menu, {
      open,
      onClose: () => { this.#open = false; this.#render() },
      items: [
        { type: 'label' as const, id: 'group-by', text: t('groupBy.label') },
        { id: 'workspace', label: t('groupBy.workspace') },
        { id: 'flat', label: t('groupBy.flat') },
        { type: 'separator' as const, id: 'order-by-separator' },
        { type: 'label' as const, id: 'order-by', text: t('orderBy.label') },
        { id: 'manual', label: t('orderBy.manual') },
        { id: 'updated', label: t('orderBy.updated') },
      ],
      selectedIds: [groupBy, orderBy],
      onSelect: (id) => {
        if (id === 'workspace' || id === 'flat') onGroupPick(id)
        else if (id === 'manual' || id === 'updated') onOrderPick(id)
        this.#open = false
        this.#render()
      },
      align: 'end',
      dense: true,
      // Portal: the section header clips overflow, so an in-place list would
      // be cut off at the header's bounds.
      portal: true,
      anchor: (
        <Tooltip label={t('viewOptions.label')} side="bottom" delayMs={500}>
          <button
            type="button"
            class={clsx(css.iconButton, css.wide)}
            aria-label={t('viewOptions.label')}
            onclick={() => { this.#open = !this.#open; this.#render() }}
          >
            <IconPersonalizationOutline16 />
          </button>
        </Tooltip>
      ),
    })
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-view-options-menu') === undefined) {
  customElements.define('dsh-view-options-menu', DshViewOptionsMenu)
}

/** One-shot creation/update helper preserving the original function-component call shape. */
function ViewOptionsMenu(props: ViewOptionsMenuProps): JSX.Element {
  const el = document.createElement('dsh-view-options-menu') as DshViewOptionsMenu
  el.setProps(props)
  return el as unknown as JSX.Element
}

/** In-flight root-row drag: source identity plus the current insert marker. */
interface DragState {
  /** Workspace id, or {@link UNGROUPED_KEY} for the browser-local loose-session account. */
  accountKey: string
  sessionId: SessionNode['id']
  /** Row the marker sits on and which half (insert above/below it). */
  over: { id: SessionNode['id']; half: 'before' | 'after' } | null
}

/** In-flight Workspace-row drag: source identity plus the current marker. */
interface WorkspaceDragState {
  workspaceId: WorkspaceId
  over: { id: WorkspaceId; half: 'before' | 'after' } | null
}

/** Resolve an insertion side from the full rendered workspace group. */
function workspaceGroupHalf(e: { clientY: number; currentTarget: HTMLElement }): 'before' | 'after' {
  const rect = e.currentTarget.getBoundingClientRect()
  return e.clientY < rect.top + rect.height / 2 ? 'before' : 'after'
}

export type SessionTreeProps = Pick<
  WorkspaceBrowserProps,
  'useSessions' | 'startSession' | 'open' | 'forkSession'
  | 'insertWorkspaceBefore' | 'insertSessionBefore' | 't'
> & {
  /** Host account home for POSIX hover-path abbreviation. */
  home?: string | undefined
  workspaces: readonly WorkspaceView[]
  /** Explicit persisted zero-or-five-session state by Workspace group. */
  groupExpansion: Readonly<Record<string, boolean>>
  /** Persist one Workspace group's zero-or-five-session state. */
  setGroupExpanded: (key: string, expanded: boolean) => void
  /** Shared editable orders used by Workspace groups and the flat-list account. */
  sessionOrderByAccount: Readonly<Record<string, readonly string[]>>
  /** Last update timestamps observed for one-time recent-update promotions. */
  sessionUpdatedAtByAccount: Readonly<Record<string, Readonly<Record<string, number>>>>
  /** Replace one shared order and its observed timestamps. */
  syncSessionOrderAccount: (accountKey: string, order: string[], updatedAt: Record<string, number>) => void
  /** Apply a drag to one shared order. */
  setSessionOrder: (accountKey: string, order: string[]) => void
  /** Registry-global archive set (hidden rows). */
  archivedSessionIds: readonly SessionNode['id'][]
  /** Open the browser-owned rename dialog for a real Workspace group. */
  onRenameRequest: (workspaceId: WorkspaceId, currentTitle: string) => void
  /** Open the browser-owned delete-confirmation dialog for a real Workspace group. */
  onDeleteRequest: (workspaceId: WorkspaceId, currentTitle: string) => void
  /** Open the browser-owned session rename dialog. */
  onSessionRename: (sessionId: SessionNode['id'], currentTitle: string) => void
  /** Archive a session (row menu action; the row disappears on the state echo). */
  onSessionArchive: (sessionId: SessionNode['id']) => void
  /** Session order behavior: fixed after edits, or additionally promoted by user activity. */
  orderBy: SessionOrderBy
}

/**
 * The scrolling session tree custom element; disconnecting drops the native
 * drag-acceptance listeners and expand-all state. Converted from a React
 * function component: every `useState` becomes a private field, the
 * `useNativeDragAcceptance`/current-group/order-reconciliation `useEffect`s
 * become explicit sync steps at the top of `#render()` compared against
 * previous field values, and `useMemo` derivations become plain recomputes
 * (webjsx re-renders explicitly, so there is no per-frame cost concern to
 * offset).
 */
export class DshSessionTree extends HTMLElement {
  #props: SessionTreeProps | null = null
  #expandedSessionGroups: string[] = []
  #drag: DragState | null = null
  #sessionDropCommitted = false
  #workspaceDrag: WorkspaceDragState | null = null
  #workspaceDropCommitted = false
  #previousOrderBy: SessionOrderBy | null = null
  #nativeDrag = new NativeDragAcceptance()
  #promotedCurrentGroup: string | undefined = undefined

  setProps(props: SessionTreeProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  disconnectedCallback(): void {
    this.#nativeDrag.teardown()
  }

  /** Mirrors `useNativeDragAcceptance(active)`: bind/unbind on active-flag change. */
  #syncNativeDragAcceptance(active: boolean): void {
    this.#nativeDrag.sync(active)
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const {
      useSessions, startSession, open, forkSession, workspaces, archivedSessionIds,
      onRenameRequest, onDeleteRequest, onSessionRename, onSessionArchive,
      insertWorkspaceBefore, insertSessionBefore, orderBy,
      groupExpansion, setGroupExpanded,
      sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, home, t,
    } = props
    const list = useSessions(s => s)
    const current = list.current
    const drag = this.#drag
    const workspaceDrag = this.#workspaceDrag
    const nativeDragActive = drag !== null || workspaceDrag !== null
    this.#syncNativeDragAcceptance(nativeDragActive)

    const currentGroup = current === undefined
      ? undefined
      : (workspaces.find(w => w.sessionIds.includes(current))?.workspaceId as string | undefined)
        ?? UNGROUPED_KEY
    if (current !== undefined && currentGroup !== undefined && !Object.hasOwn(groupExpansion, currentGroup)
      && this.#promotedCurrentGroup !== currentGroup) {
      this.#promotedCurrentGroup = currentGroup
      setGroupExpanded(currentGroup, true)
    }
    if (current === undefined) this.#promotedCurrentGroup = undefined

    const expandedGroups = Object.entries(groupExpansion).filter(([, expanded]) => expanded).map(([key]) => key)
    const accounted = new Set(workspaces.flatMap(workspace => workspace.sessionIds))
    const ungroupedSessionIds = list.ids.filter(id => list.byId[id] !== undefined && !accounted.has(id))

    if (list.phase === 'ready') {
      const switchedToUpdated = this.#previousOrderBy !== null
        && this.#previousOrderBy !== 'updated' && orderBy === 'updated'
      this.#previousOrderBy = orderBy
      const accounts = [
        ...workspaces.map(workspace => ({
          key: workspace.workspaceId as string,
          sessionIds: workspace.sessionIds.filter((id: SessionId) => list.byId[id] !== undefined),
        })),
        { key: UNGROUPED_KEY, sessionIds: ungroupedSessionIds },
      ]
      for (const { key, sessionIds } of accounts) {
        const previousOrder = sessionOrderByAccount[key]
        const previousUpdatedAt = sessionUpdatedAtByAccount[key] ?? {}
        const next = nextSessionOrderAccount({
          sessionIds,
          previousOrder,
          previousUpdatedAt,
          list,
          orderBy,
          sortByRecency: orderBy === 'updated' && (previousOrder === undefined || switchedToUpdated),
        })
        if (next.changed) {
          syncSessionOrderAccount(key, next.order.map(id => id as string), next.updatedAt)
        }
      }
    }

    const orderedWorkspaces = workspaces.map((workspace) => {
      const stored = sessionOrderByAccount[workspace.workspaceId as string]
      const sessionIds = reconciledSessionOrder(workspace.sessionIds, stored)
      return { ...workspace, sessionIds }
    })
    const orderedUngroupedSessionIds = reconciledSessionOrder(ungroupedSessionIds, sessionOrderByAccount[UNGROUPED_KEY])
    const groups = deriveGroups(list, orderedWorkspaces, archivedSessionIds, {
      expandedGroups,
      ...(sessionOrderByAccount[UNGROUPED_KEY] === undefined
        ? {}
        : { ungroupedOrder: sessionOrderByAccount[UNGROUPED_KEY] }),
    })
    const now = Date.now()

    const commitSessionDrag = (activeDrag: DragState, over: NonNullable<DragState['over']>): void => {
      if (this.#sessionDropCommitted) return
      this.#sessionDropCommitted = true
      this.#drag = null
      const group = groups.find(candidate => candidate.key === activeDrag.accountKey)
      if (group === undefined) { this.#render(); return }
      const targetIndex = group.sessions.findIndex(session => session.id === over.id)
      if (targetIndex === -1) { this.#render(); return }
      const anchor = over.half === 'before' ? over.id : group.sessions[targetIndex + 1]?.id
      if (anchor === activeDrag.sessionId) { this.#render(); return }
      const sourceIndex = group.sessions.findIndex(session => session.id === activeDrag.sessionId)
      const anchorIndex = anchor === undefined
        ? group.sessions.length
        : group.sessions.findIndex(session => session.id === anchor)
      if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) { this.#render(); return }
      const accountSessionIds = activeDrag.accountKey === UNGROUPED_KEY
        ? orderedUngroupedSessionIds
        : orderedWorkspaces.find(workspace => workspace.workspaceId === activeDrag.accountKey)?.sessionIds
      if (accountSessionIds === undefined) { this.#render(); return }
      const nextOrder = accountSessionIds.filter((id: SessionId) => id !== activeDrag.sessionId)
      const insertAt = anchor === undefined ? nextOrder.length : nextOrder.indexOf(anchor)
      nextOrder.splice(insertAt === -1 ? nextOrder.length : insertAt, 0, activeDrag.sessionId)
      setSessionOrder(activeDrag.accountKey, nextOrder.map((id: SessionId) => id as string))
      if (orderBy !== 'updated' && activeDrag.accountKey !== UNGROUPED_KEY) {
        insertSessionBefore(activeDrag.accountKey as WorkspaceId, activeDrag.sessionId, anchor).catch((reason: unknown) => {
          console.warn('session reorder rejected:', reason)
        })
      }
      this.#render()
    }
    const commitWorkspaceDrag = (
      activeDrag: WorkspaceDragState,
      over: NonNullable<WorkspaceDragState['over']>,
    ): void => {
      if (this.#workspaceDropCommitted) return
      this.#workspaceDropCommitted = true
      this.#workspaceDrag = null
      const rowIndex = workspaces.findIndex(workspace => workspace.workspaceId === over.id)
      if (rowIndex === -1) { this.#render(); return }
      const anchor = over.half === 'before' ? over.id : workspaces[rowIndex + 1]?.workspaceId
      if (anchor === activeDrag.workspaceId) { this.#render(); return }
      const sourceIndex = workspaces.findIndex(workspace => workspace.workspaceId === activeDrag.workspaceId)
      const anchorIndex = anchor === undefined
        ? workspaces.length
        : workspaces.findIndex(workspace => workspace.workspaceId === anchor)
      if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) { this.#render(); return }
      insertWorkspaceBefore(activeDrag.workspaceId, anchor).catch((reason: unknown) => {
        console.warn('workspace reorder rejected:', reason)
      })
      this.#render()
    }
    const workspaceDropAtListStart = groups[0]?.workspaceId !== undefined
      && workspaceDrag?.over?.id === groups[0].workspaceId
      && workspaceDrag?.over?.half === 'before'

    const vdom = (
      <div class={clsx(css.treeBody, css.wide)}>
        {workspaceDropAtListStart && <span class={css.listTopDropIndicator ?? ''} aria-hidden="true" />}
        <div
          class={clsx(css.list, workspaceDropAtListStart && css.listTopDropActive)}
          role="tree"
          aria-label={t('section.sessions')}
        >
          {groups.length === 0 && (
            <div class={css.empty ?? ''}>{t('empty.none')}</div>
          )}
          {groups.map((group) => {
            const workspaceId = group.workspaceId
            const workspaceMarker = workspaceId !== undefined && workspaceDrag?.over?.id === workspaceId
              ? (workspaceDrag?.over?.half ?? null)
              : null
            const workspaceDragProps = workspaceId === undefined ? undefined : {
              start: () => {
                this.#workspaceDropCommitted = false
                this.#workspaceDrag = { workspaceId, over: null }
                this.#render()
              },
              end: () => {
                const wd = this.#workspaceDrag
                if (wd?.over !== null && wd?.over !== undefined) {
                  commitWorkspaceDrag(wd, wd.over)
                } else {
                  this.#workspaceDrag = null
                  this.#render()
                }
                this.#workspaceDropCommitted = false
              },
            }
            const hoverWorkspace = workspaceId === undefined
              ? undefined
              : (half: 'before' | 'after') => {
                if (this.#workspaceDrag === null) return
                this.#workspaceDrag = { ...this.#workspaceDrag, over: { id: workspaceId, half } }
                this.#render()
              }
            const dropWorkspace = workspaceId === undefined
              ? undefined
              : (half: 'before' | 'after') => {
                if (this.#workspaceDrag === null) return
                commitWorkspaceDrag(this.#workspaceDrag, { id: workspaceId, half })
              }
            return (
            // Group section: header row + expanded top-level session rows. The
            // inter-group breathing room is the section's own margin
            // (WorkspaceBrowser.module.css).
              <div
                key={group.key}
                class={clsx(
                  css.groupSection,
                  workspaceMarker === 'before' && css.workspaceDropBefore,
                  workspaceMarker === 'after' && css.workspaceDropAfter,
                )}
                ondragover={workspaceDrag === null || hoverWorkspace === undefined
                  ? null
                  : (e: DragEvent) => {
                    e.preventDefault()
                    if (e.dataTransfer !== null) e.dataTransfer.dropEffect = 'move'
                    hoverWorkspace(workspaceGroupHalf(e as unknown as { clientY: number; currentTarget: HTMLElement }))
                  }}
                ondrop={workspaceDrag === null || dropWorkspace === undefined
                  ? null
                  : (e: DragEvent) => {
                    e.preventDefault()
                    dropWorkspace(workspaceGroupHalf(e as unknown as { clientY: number; currentTarget: HTMLElement }))
                  }}
              >
                {ProjectRowItem({
                  group,
                  home,
                  t,
                  onToggle: () => {
                    if (group.expanded) {
                      this.#expandedSessionGroups = this.#expandedSessionGroups.filter(key => key !== group.key)
                    }
                    setGroupExpanded(group.key, !group.expanded)
                    this.#render()
                  },
                  onCreate: () => {
                    if (group.workspaceId !== undefined) {
                      setGroupExpanded(group.key, true)
                      startSession(group.workspaceId)
                      this.#render()
                    }
                  },
                  drag: workspaceDragProps,
                  actions: group.workspaceId === undefined
                    ? undefined
                    : {
                      rename: () => {
                        /* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */
                        if (group.workspaceId !== undefined) onRenameRequest(group.workspaceId, group.label)
                      },
                      delete: () => {
                        /* v8 ignore next -- narrowing guard: the actions object exists only for real-workspace groups. */
                        if (group.workspaceId !== undefined) onDeleteRequest(group.workspaceId, group.label)
                      },
                    },
                })}
                {(this.#expandedSessionGroups.includes(group.key)
                  ? group.sessions
                  : group.sessions.slice(0, COLLAPSED_SESSION_LIMIT)
                ).map((node) => {
                // Session drag never leaves its group. Ungrouped writes only the
                // browser-local account; real Workspaces may also write Host order.
                  const sameGroupDrag = drag !== null && drag.accountKey === group.key
                  const dragProps = {
                    start: () => {
                      this.#sessionDropCommitted = false
                      this.#drag = { accountKey: group.key, sessionId: node.id, over: null }
                      this.#render()
                    },
                    active: sameGroupDrag,
                    marker: sameGroupDrag && drag.over?.id === node.id ? drag.over.half : null,
                    hover: (half: 'before' | 'after') => {
                    /* v8 ignore next -- narrowing guard: Rows gates hover on `active`, which is false while the drag state is null. */
                      if (this.#drag === null) return
                      this.#drag = { ...this.#drag, over: { id: node.id, half } }
                      this.#render()
                    },
                    drop: (half: 'before' | 'after') => {
                    /* v8 ignore next -- narrowing guard: Rows gates drop on `active`, which is false while the drag state is null. */
                      if (this.#drag === null) return
                      commitSessionDrag(this.#drag, { id: node.id, half })
                    },
                    end: () => {
                      const d = this.#drag
                      if (d?.over !== null && d?.over !== undefined) commitSessionDrag(d, d.over)
                      else { this.#drag = null; this.#render() }
                      this.#sessionDropCommitted = false
                    },
                  }
                  return SessionNodeItem({
                    node,
                    currentId: current,
                    now,
                    onOpen: open,
                    onRename: onSessionRename,
                    onFork: forkSession,
                    onArchive: onSessionArchive,
                    drag: dragProps,
                    t,
                  })
                })}
                {group.sessions.length > COLLAPSED_SESSION_LIMIT && (
                  <button
                    type="button"
                    class={css.sessionOverflowButton ?? ''}
                    aria-expanded={String(this.#expandedSessionGroups.includes(group.key))}
                    onclick={() => { this.#expandedSessionGroups = toggled(this.#expandedSessionGroups, group.key); this.#render() }}
                  >
                    {this.#expandedSessionGroups.includes(group.key)
                      ? t('sessions.collapse')
                      : t('sessions.expand', { n: group.sessions.length - COLLAPSED_SESSION_LIMIT })}
                  </button>
                )}
              </div>
            )
          })}
        </div>
        <span class={css.fade ?? ''} />
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-session-tree') === undefined) {
  customElements.define('dsh-session-tree', DshSessionTree)
}

/** One-shot creation/update helper preserving the original function-component call shape. */
function SessionTree(props: SessionTreeProps): JSX.Element {
  const el = document.createElement('dsh-session-tree') as DshSessionTree
  el.setProps(props)
  return el as unknown as JSX.Element
}

export type FlatListProps = Pick<
  SessionTreeProps,
  | 'useSessions'
  | 'open'
  | 'forkSession'
  | 'onSessionRename'
  | 'onSessionArchive'
  | 'archivedSessionIds'
  | 'orderBy'
  | 'sessionOrderByAccount'
  | 'sessionUpdatedAtByAccount'
  | 'syncSessionOrderAccount'
  | 'setSessionOrder'
  | 't'
>

/**
 * The flat "In one list" body custom element: every session is one
 * draggable top-level row. Converted from a React function component —
 * `useState`/`useRef` become private fields, the order-reconciliation
 * `useEffect` becomes an explicit sync step in `#render()`.
 */
export class DshFlatList extends HTMLElement {
  #props: FlatListProps | null = null
  #drag: DragState | null = null
  #dropCommitted = false
  #previousOrderBy: SessionOrderBy | null = null
  #nativeDrag = new NativeDragAcceptance()

  setProps(props: FlatListProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  disconnectedCallback(): void {
    this.#nativeDrag.teardown()
  }

  #syncNativeDragAcceptance(active: boolean): void {
    this.#nativeDrag.sync(active)
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const {
      useSessions, open, forkSession, onSessionRename, onSessionArchive, archivedSessionIds,
      orderBy, sessionOrderByAccount, sessionUpdatedAtByAccount, syncSessionOrderAccount, setSessionOrder, t,
    } = props
    const list = useSessions(s => s)
    const baseRows = deriveFlat(list, archivedSessionIds)
    const sessionIds = baseRows.map(row => row.id)

    if (list.phase === 'ready') {
      const previousOrder = sessionOrderByAccount[FLAT_SESSION_ORDER_KEY]
      const previousUpdatedAt = sessionUpdatedAtByAccount[FLAT_SESSION_ORDER_KEY] ?? {}
      const switchedToUpdated = this.#previousOrderBy !== null
        && this.#previousOrderBy !== 'updated' && orderBy === 'updated'
      this.#previousOrderBy = orderBy
      const next = nextSessionOrderAccount({
        sessionIds,
        previousOrder,
        previousUpdatedAt,
        list,
        orderBy,
        sortByRecency: orderBy === 'updated' && (previousOrder === undefined || switchedToUpdated),
      })
      if (next.changed) {
        syncSessionOrderAccount(FLAT_SESSION_ORDER_KEY, next.order.map(id => id as string), next.updatedAt)
      }
    }

    const byId = new Map(baseRows.map(row => [row.id, row]))
    const rows = reconciledSessionOrder(sessionIds, sessionOrderByAccount[FLAT_SESSION_ORDER_KEY])
      .flatMap((id) => {
        const row = byId.get(id)
        return row === undefined ? [] : [row]
      })

    const drag = this.#drag
    this.#syncNativeDragAcceptance(drag !== null)

    const commitDrag = (activeDrag: DragState, over: NonNullable<DragState['over']>): void => {
      if (this.#dropCommitted) return
      this.#dropCommitted = true
      this.#drag = null
      const targetIndex = rows.findIndex(row => row.id === over.id)
      if (targetIndex === -1) { this.#render(); return }
      const anchor = over.half === 'before' ? over.id : rows[targetIndex + 1]?.id
      if (anchor === activeDrag.sessionId) { this.#render(); return }
      const sourceIndex = rows.findIndex(row => row.id === activeDrag.sessionId)
      const anchorIndex = anchor === undefined ? rows.length : rows.findIndex(row => row.id === anchor)
      if (sourceIndex !== -1 && (anchorIndex === sourceIndex || anchorIndex === sourceIndex + 1)) { this.#render(); return }
      const nextOrder = rows.map(row => row.id).filter(id => id !== activeDrag.sessionId)
      const insertAt = anchor === undefined ? nextOrder.length : nextOrder.indexOf(anchor)
      nextOrder.splice(insertAt === -1 ? nextOrder.length : insertAt, 0, activeDrag.sessionId)
      setSessionOrder(FLAT_SESSION_ORDER_KEY, nextOrder.map(id => id as string))
      this.#render()
    }
    const now = Date.now()

    const vdom = (
      <div class={clsx(css.treeBody, css.wide)}>
        <div class={clsx(css.list, css.flatList)} role="tree" aria-label={t('section.sessions')}>
          {rows.length === 0 && (
            <div class={css.empty ?? ''}>{t('empty.none')}</div>
          )}
          {rows.map((node) => {
            const active = drag !== null
            return SessionNodeItem({
              node,
              currentId: list.current,
              now,
              onOpen: open,
              onRename: onSessionRename,
              onFork: forkSession,
              onArchive: onSessionArchive,
              flat: true,
              drag: {
                start: () => {
                  this.#dropCommitted = false
                  this.#drag = { accountKey: FLAT_SESSION_ORDER_KEY, sessionId: node.id, over: null }
                  this.#render()
                },
                active,
                marker: active && drag.over?.id === node.id ? drag.over.half : null,
                hover: (half) => {
                  if (this.#drag === null) return
                  this.#drag = { ...this.#drag, over: { id: node.id, half } }
                  this.#render()
                },
                drop: (half) => {
                  if (this.#drag !== null) commitDrag(this.#drag, { id: node.id, half })
                },
                end: () => {
                  const d = this.#drag
                  if (d?.over !== null && d?.over !== undefined) commitDrag(d, d.over)
                  else { this.#drag = null; this.#render() }
                  this.#dropCommitted = false
                },
              },
              t,
            })
          })}
        </div>
        <span class={css.fade ?? ''} />
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-flat-list') === undefined) {
  customElements.define('dsh-flat-list', DshFlatList)
}

/** One-shot creation/update helper preserving the original function-component call shape. */
function FlatList(props: FlatListProps): JSX.Element {
  const el = document.createElement('dsh-flat-list') as DshFlatList
  el.setProps(props)
  return el as unknown as JSX.Element
}

interface RemoteSearchState {
  query: string
  status: 'idle' | 'loading' | 'ready' | 'error'
  items: readonly SessionSearchResultItem[]
  hasMore: boolean
}

export type SearchResultsProps = Pick<SessionTreeProps, 'useSessions' | 'open' | 't'> & {
  workspaces: readonly WorkspaceView[]
  archivedSessionIds: readonly SessionNode['id'][]
  query: string
  remote: RemoteSearchState
  resultLimit: number
}

/**
 * Flat search body custom element: local metadata matches plus the current
 * Host result page. No hook holds identity across renders here beyond prop
 * reads and a pure derivation, but it stays a custom element (rather than a
 * stateless function) so its call sites match the sibling tree/list bodies.
 */
export class DshSearchResults extends HTMLElement {
  #props: SearchResultsProps | null = null

  setProps(props: SearchResultsProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const { useSessions, open, workspaces, archivedSessionIds, query, remote, resultLimit, t } = props
    const list = useSessions(s => s)
    const currentRemote = remote.query === query
      ? remote
      : { query, status: 'loading' as const, items: [], hasMore: false }
    const results = deriveSearchResults(list, workspaces, query, archivedSessionIds, currentRemote, resultLimit)
    const pending = currentRemote.status === 'loading'
    const failed = currentRemote.status === 'error'

    const vdom = (
      <div class={clsx(css.treeBody, css.wide)}>
        <div class={css.list ?? ''}>
          <div class={css.searchTree ?? ''} role="tree" aria-label={t('search.results.aria')}>
            {results.items.map(result => (
              <SearchResultItem
                key={result.id}
                result={result}
                currentId={list.current}
                onOpen={open}
                t={t}
              />
            ))}
          </div>
          {pending && (
            <div class={css.searchStatus ?? ''} role="status">{t('search.pending')}</div>
          )}
          {failed && (
            <div class={css.searchWarning ?? ''} role="status">
              {t('search.unavailable')}
            </div>
          )}
          {!pending && results.items.length === 0 && (
            <div class={css.empty ?? ''}>{t('search.noMatches')}</div>
          )}
          {results.hasMore && (
            <div class={css.searchStatus ?? ''}>
              {t('search.hasMore', { n: resultLimit })}
            </div>
          )}
        </div>
        <span class={css.fade ?? ''} />
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-search-results') === undefined) {
  customElements.define('dsh-search-results', DshSearchResults)
}

/** One-shot creation/update helper preserving the original function-component call shape. */
function SearchResults(props: SearchResultsProps): JSX.Element {
  const el = document.createElement('dsh-search-results') as DshSearchResults
  el.setProps(props)
  return el as unknown as JSX.Element
}

/**
 * The browsing region custom element (registered `dsh-workspace-browser`).
 * Converted from the top-level `WorkspaceBrowser` React function component:
 * every `useState` becomes a private field, every `useRef` becomes a
 * private field holding the current DOM node (looked up after render where
 * a callback ref was used), and every `useEffect` becomes an explicit sync
 * step compared against previous field values, run at the top of
 * `#render()` or from `setProps`/`connectedCallback`/`disconnectedCallback`
 * as appropriate — mirroring Toast.tsx's/HoverCard.tsx's bind/unbind timer
 * field patterns.
 * @see WorkspaceBrowserProps for the field-by-field docs (unchanged from the React version).
 */
export class DshWorkspaceBrowser extends HTMLElement {
  #props: WorkspaceBrowserProps | null = null

  // Blank-session promotion (was a `useRef`).
  #promotedBlank: { sessionId: SessionId; accountKey: string } | undefined = undefined

  // Account-key retention sync edge-trigger (was a useEffect deps array: [workspacePhase, workspaces]).
  #retainedAccountKeys: string | null = null

  // Search (wide-only), was useState/useRef.
  #query = ''
  #searchExpanded = false
  #remoteSearch: RemoteSearchState = { query: '', status: 'idle', items: [], hasMore: false }
  #searchRoot: HTMLDivElement | null = null
  #searchInput: HTMLInputElement | null = null

  // Section-header + picker.
  #wsPickerOpen = false
  #wsPlusEl: HTMLButtonElement | null = null
  #composing = false

  // Rail search = expand + land in the search box.
  #searchOnExpand = false
  #expandFocusTimer: number | null = null
  #expandFocusArmedFor: { wide: boolean; searchOnExpand: boolean } | null = null

  // Outside-click dismissal.
  #outsideClickBound = false
  #onOutsideClick: ((event: MouseEvent) => void) | null = null

  // Search debounce (AbortController), was useEffect keyed on normalizedQuery.
  #searchQueryInFlight: string | null = null
  #searchAbort: AbortController | null = null
  #searchDebounceTimer: number | null = null

  // Rename dialog (workspace).
  #renameTarget: { workspaceId: WorkspaceId; currentTitle: string } | null = null
  #renameDraft = ''
  #renaming = false
  #renameError: string | null = null

  // Session rename dialog.
  #sessionRenameTarget: { sessionId: SessionNode['id']; currentTitle: string } | null = null
  #sessionRenameDraft = ''
  #sessionRenaming = false
  #sessionRenameError: string | null = null

  // Delete dialog.
  #deleteTarget: { workspaceId: WorkspaceId; title: string } | null = null
  #deleting = false

  // Self-mounting portal dialogs held across renders (see Modal.tsx doc).
  #renameModal: DshModal | null = null
  #sessionRenameModal: DshModal | null = null
  #deleteModal: DshModal | null = null
  #deleteCommittedId: WorkspaceId | null = null
  #deleteError: string | null = null

  // See DshConversationRoot's identical guard (ui-conversation package):
  // this element's one-shot creation helper calls setProps() synchronously
  // before insertion into the document; connectedCallback then fires again
  // right after. Rendering unconditionally in both places double-renders
  // the first mount around that detach/attach boundary, which has been
  // observed to desync webjsx's per-element diff cache from the live DOM.
  #renderedOnce = false

  setProps(props: WorkspaceBrowserProps): void {
    this.#props = props
    this.#render()
    this.#renderedOnce = true
  }

  connectedCallback(): void {
    if (this.#renderedOnce) this.#render()
  }

  disconnectedCallback(): void {
    this.#unbindOutsideClick()
    if (this.#expandFocusTimer !== null) { window.clearTimeout(this.#expandFocusTimer); this.#expandFocusTimer = null }
    if (this.#searchDebounceTimer !== null) { window.clearTimeout(this.#searchDebounceTimer); this.#searchDebounceTimer = null }
    this.#searchAbort?.abort()
    this.#searchAbort = null
  }

  #unbindOutsideClick(): void {
    if (this.#onOutsideClick !== null) {
      document.removeEventListener('click', this.#onOutsideClick)
      this.#onOutsideClick = null
    }
    this.#outsideClickBound = false
  }

  /** Rail search = expand + land in the search box (was a useEffect keyed on [wide, searchOnExpand]). */
  #syncExpandFocus(wide: boolean): void {
    const armed = wide && this.#searchOnExpand
    const wasArmed = this.#expandFocusArmedFor !== null
      && this.#expandFocusArmedFor.wide && this.#expandFocusArmedFor.searchOnExpand
    if (armed === wasArmed) return
    this.#expandFocusArmedFor = { wide, searchOnExpand: this.#searchOnExpand }
    if (this.#expandFocusTimer !== null) { window.clearTimeout(this.#expandFocusTimer); this.#expandFocusTimer = null }
    if (armed) {
      this.#expandFocusTimer = window.setTimeout(() => {
        this.#searchInput?.focus({ preventScroll: true })
        this.#searchOnExpand = false
        this.#expandFocusTimer = null
        this.#render()
      }, EXPAND_SLIDE_MS)
    }
  }

  /** Focus the search input once expanded (non-rail path), mirrors the second focus effect. */
  #syncSearchExpandedFocus(wide: boolean, searchExpanded: boolean): void {
    if (!wide || !searchExpanded || this.#searchOnExpand) return
    this.#searchInput?.focus({ preventScroll: true })
  }

  /**
   * Outside-click dismissal stays off while the rail gesture is in flight
   * (searchOnExpand): the rail click flips the shell wide and mounts this
   * listener during its own dispatch, then keeps bubbling to document with
   * the now-unmounted rail button as its target — outside searchRoot, so the
   * listener would dismiss the search that click just opened.
   */
  #syncOutsideClick(wide: boolean, searchExpanded: boolean, normalizedQuery: string): void {
    const shouldBind = wide && searchExpanded && !this.#searchOnExpand
    if (!shouldBind) { this.#unbindOutsideClick(); return }
    if (this.#outsideClickBound) return
    this.#unbindOutsideClick()
    const onClick = (event: MouseEvent): void => {
      if (!(event.target instanceof Node) || this.#searchRoot?.contains(event.target) === true) return
      this.#searchInput?.blur()
      const currentQuery = sanitizeSearchQuery(this.#query).trim()
      if (currentQuery !== '') return
      this.#searchExpanded = false
      this.#render()
    }
    this.#onOutsideClick = onClick
    this.#outsideClickBound = true
    document.addEventListener('click', onClick)
    void normalizedQuery
  }

  /** Search debounce/AbortController, was a useEffect keyed on normalizedQuery. */
  #syncSearchRequest(normalizedQuery: string, searchSessions: WorkspaceBrowserProps['searchSessions']): void {
    if (this.#searchQueryInFlight === normalizedQuery) return
    this.#searchQueryInFlight = normalizedQuery
    if (this.#searchDebounceTimer !== null) { window.clearTimeout(this.#searchDebounceTimer); this.#searchDebounceTimer = null }
    this.#searchAbort?.abort()
    this.#searchAbort = null
    if (normalizedQuery === '') {
      this.#remoteSearch = { query: '', status: 'idle', items: [], hasMore: false }
      return
    }
    this.#remoteSearch = { query: normalizedQuery, status: 'loading', items: [], hasMore: false }
    const controller = new AbortController()
    this.#searchAbort = controller
    this.#searchDebounceTimer = window.setTimeout(() => {
      this.#searchDebounceTimer = null
      const props = this.#props
      if (props === null) return
      searchSessions(normalizedQuery, controller.signal).then((result) => {
        if (controller.signal.aborted) return
        this.#remoteSearch = {
          query: normalizedQuery,
          status: 'ready',
          items: result.items,
          hasMore: result.hasMore,
        }
        this.#render()
      }).catch(() => {
        if (controller.signal.aborted) return
        this.#remoteSearch = { query: normalizedQuery, status: 'error', items: [], hasMore: false }
        this.#render()
      })
    }, SEARCH_DEBOUNCE_MS)
  }

  #onSessionRename = (sessionId: SessionNode['id'], currentTitle: string): void => {
    this.#sessionRenameTarget = { sessionId, currentTitle }
    this.#sessionRenameDraft = currentTitle
    this.#sessionRenameError = null
    this.#render()
  }

  #onSessionArchive = (sessionId: SessionNode['id']): void => {
    const props = this.#props
    if (props === null) return
    props.archiveSession(sessionId).catch((reason: unknown) => {
      console.warn('session archive rejected:', reason)
    })
  }

  #closeRename(): void {
    if (this.#renaming) return
    this.#renameTarget = null
    this.#renameError = null
    this.#render()
  }

  #confirmRename(): void {
    const props = this.#props
    const renameTarget = this.#renameTarget
    if (props === null || renameTarget === null) return
    const renameTrimmed = this.#renameDraft.trim()
    const workspaces = props.useWorkspaces(state => state.items)
    const renameDuplicate = renameTrimmed !== '' && renameTrimmed !== renameTarget.currentTitle
      && workspaces.some(w => w.title === renameTrimmed)
    const renameBlocked = this.#renaming || renameTrimmed === ''
      || renameTrimmed === renameTarget.currentTitle || renameDuplicate
    if (renameBlocked) return
    this.#renaming = true
    this.#renameError = null
    this.#render()
    props.renameWorkspace(renameTarget.workspaceId, renameTrimmed).then(() => {
      this.#renaming = false
      this.#renameTarget = null
      this.#render()
    }).catch((reason: unknown) => {
      this.#renaming = false
      this.#renameError = reason instanceof Error ? reason.message : String(reason)
      this.#render()
    })
  }

  #closeSessionRename(): void {
    if (this.#sessionRenaming) return
    this.#sessionRenameTarget = null
    this.#sessionRenameError = null
    this.#render()
  }

  #confirmSessionRename(): void {
    const props = this.#props
    const sessionRenameTarget = this.#sessionRenameTarget
    if (props === null || sessionRenameTarget === null) return
    const sessionRenameTrimmed = this.#sessionRenameDraft.trim()
    const sessionRenameBlocked = this.#sessionRenaming || sessionRenameTrimmed === ''
    if (sessionRenameBlocked) return
    this.#sessionRenaming = true
    this.#sessionRenameError = null
    this.#render()
    props.renameSession(sessionRenameTarget.sessionId, sessionRenameTrimmed).then(() => {
      this.#sessionRenaming = false
      this.#sessionRenameTarget = null
      this.#render()
    }).catch((reason: unknown) => {
      this.#sessionRenaming = false
      this.#sessionRenameError = reason instanceof Error ? reason.message : String(reason)
      this.#render()
    })
  }

  #closeDelete(): void {
    if (this.#deleting) return
    this.#deleteTarget = null
    this.#deleteError = null
    this.#render()
  }

  #confirmDelete(): void {
    const props = this.#props
    const deleteTarget = this.#deleteTarget
    /* v8 ignore next -- the Modal is absent without a target and its button is disabled while deleting. */
    if (props === null || this.#deleting || deleteTarget === null) return
    this.#deleting = true
    this.#deleteCommittedId = null
    this.#deleteError = null
    this.#render()
    props.deleteWorkspace(deleteTarget.workspaceId).then(() => {
      // Keep the confirmation pending until this component has rendered the
      // committed list projection without the deleted id. Closing earlier
      // exposes one stale frame to the next Create Workspace gesture.
      this.#deleteCommittedId = deleteTarget.workspaceId
      this.#render()
    }).catch((reason: unknown) => {
      this.#deleting = false
      this.#deleteError = reason instanceof Error ? reason.message : String(reason)
      this.#render()
    })
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const {
      wide,
      expandSidebar,
      useSessions,
      useWorkspaces,
      useStore,
      actions,
      startSession,
      open,
      forkSession,
      insertWorkspaceBefore,
      insertSessionBefore,
      createWorkspace,
      searchSessions,
      searchResultLimit,
      useDirectoryFlow,
      useHostDescription,
      renderSlot,
      t,
    } = props

    const home = useHostDescription(description => description?.home)
    const workspaces = useWorkspaces(state => state.items)
    const workspacePhase = useWorkspaces(state => state.phase)
    const archivedSessionIds = useWorkspaces(state => state.archivedSessionIds)
    // Live occupancy of this surface's directory-flow hole (the same source the
    // flow reads): a composition without a picking affordance can add nothing.
    const directoryFlowAvailable = useDirectoryFlow(occupied => occupied)
    const groupBy = useStore(s => s.groupBy)
    const orderBy = useStore(s => s.orderBy)
    const groupExpansion = useStore(s => s.groupExpansion)
    const sessionOrderByAccount = useStore(s => s.sessionOrderByAccount)
    const sessionUpdatedAtByAccount = useStore(s => s.sessionUpdatedAtByAccount)
    const currentBlankSessionId = useSessions((state) => {
      const current = state.current
      return current !== undefined && state.byId[current]?.blank === true ? current : undefined
    })
    const currentBlankAccount = currentBlankSessionId === undefined
      ? undefined
      : (workspaces.find(workspace => workspace.sessionIds.includes(currentBlankSessionId))
        ?.workspaceId as string | undefined) ?? UNGROUPED_KEY

    // Blank-session promotion sync (was a useEffect).
    if (currentBlankSessionId === undefined || currentBlankAccount === undefined) {
      this.#promotedBlank = undefined
    } else if (this.#promotedBlank === undefined
      || this.#promotedBlank.sessionId !== currentBlankSessionId
      || this.#promotedBlank.accountKey !== currentBlankAccount) {
      this.#promotedBlank = { sessionId: currentBlankSessionId, accountKey: currentBlankAccount }
      for (const accountKey of new Set([currentBlankAccount, FLAT_SESSION_ORDER_KEY])) {
        const previous = sessionOrderByAccount[accountKey] ?? []
        actions.setSessionOrder(accountKey, [
          currentBlankSessionId,
          ...previous.filter(id => id !== currentBlankSessionId),
        ])
      }
    }

    // Account-key retention sync (was a useEffect keyed on workspacePhase/workspaces).
    // retainAccountKeys always rebuilds fresh object references (even when
    // nothing is filtered out), so calling it unconditionally every render
    // produced a new store snapshot on every render, which resynchronously
    // re-rendered this subscriber — an infinite loop with no yield point,
    // hanging the tab. Edge-triggered on the actual key set, matching the
    // original effect's dependency array.
    if (workspacePhase === 'ready') {
      const accountKeys = [
        UNGROUPED_KEY,
        FLAT_SESSION_ORDER_KEY,
        ...workspaces.map(workspace => workspace.workspaceId as string),
      ]
      const accountKeysSignature = accountKeys.join('\0')
      if (this.#retainedAccountKeys !== accountKeysSignature) {
        this.#retainedAccountKeys = accountKeysSignature
        actions.retainAccountKeys(accountKeys)
      }
    }

    const query = this.#query
    const searchExpanded = this.#searchExpanded
    const normalizedQuery = sanitizeSearchQuery(query).trim()
    const remoteSearch = this.#remoteSearch
    const wsPickerOpen = this.#wsPickerOpen

    this.#syncExpandFocus(wide)
    this.#syncSearchExpandedFocus(wide, searchExpanded)
    this.#syncOutsideClick(wide, searchExpanded, normalizedQuery)
    this.#syncSearchRequest(normalizedQuery, searchSessions)

    // Rename dialog derived state.
    const renameTarget = this.#renameTarget
    const renameDraft = this.#renameDraft
    const renaming = this.#renaming
    const renameError = this.#renameError
    const renameTrimmed = renameDraft.trim()
    const renameDuplicate = renameTarget !== null && renameTrimmed !== '' && renameTrimmed !== renameTarget.currentTitle
      && workspaces.some(w => w.title === renameTrimmed)
    const renameBlocked = renaming || renameTrimmed === ''
      || renameTarget === null || renameTrimmed === renameTarget.currentTitle || renameDuplicate

    // Session rename dialog derived state.
    const sessionRenameTarget = this.#sessionRenameTarget
    const sessionRenameDraft = this.#sessionRenameDraft
    const sessionRenaming = this.#sessionRenaming
    const sessionRenameError = this.#sessionRenameError
    const sessionRenameTrimmed = sessionRenameDraft.trim()
    const sessionRenameBlocked = sessionRenaming || sessionRenameTrimmed === '' || sessionRenameTarget === null

    // Delete dialog sync (was a useEffect keyed on [deleteCommittedId, workspaces]).
    const deleteCommittedId = this.#deleteCommittedId
    if (deleteCommittedId !== null && !workspaces.some(workspace => workspace.workspaceId === deleteCommittedId)) {
      this.#deleting = false
      this.#deleteCommittedId = null
      this.#deleteTarget = null
    }
    const deleteTarget = this.#deleteTarget
    const deleting = this.#deleting
    const deleteError = this.#deleteError

    const vdom = (
      <div class={clsx(css.root, !wide && css.rail)}>
        <div class={css.sectionHeader ?? ''}>
          {wide && (
            <span class={clsx(css.sectionLabel, css.wide, searchExpanded && css.sectionLabelHidden)}>
              {groupBy === 'flat' ? t('section.sessions') : t('section.workspaces')}
            </span>
          )}
          {wide && (
            <div class={clsx(css.searchSlot, searchExpanded && css.searchSlotExpanded)}>
              <div
                ref={(el: Node | null) => { this.#searchRoot = el as HTMLDivElement | null }}
                class={clsx(css.search, searchExpanded && css.searchExpanded)}
                onclick={() => {
                  this.#wsPickerOpen = false
                  this.#searchExpanded = true
                  this.#render()
                  this.#searchInput?.focus()
                }}
              >
                <Tooltip label={t('search')} side="bottom" delayMs={500} disabled={searchExpanded}>
                  <button
                    type="button"
                    class={css.searchButton ?? ''}
                    aria-label={t('search.sessions.aria')}
                    aria-expanded={String(searchExpanded)}
                    onclick={() => {
                      this.#wsPickerOpen = false
                      this.#searchExpanded = true
                      this.#render()
                    }}
                  >
                    <IconSearchOutline16 size={searchExpanded ? 11 : 14} />
                  </button>
                </Tooltip>
                <input
                  ref={(el: Node | null) => { this.#searchInput = el as HTMLInputElement | null }}
                  class={css.searchInput ?? ''}
                  type="text"
                  placeholder={t('search.placeholder')}
                  maxLength={String(SEARCH_QUERY_MAX_CODE_UNITS)}
                  value={query}
                  tabIndex={String(searchExpanded ? 0 : -1)}
                  oninput={(e: Event) => { this.#query = sanitizeSearchQuery((e.target as HTMLInputElement).value); this.#render() }}
                  onkeydown={(e: KeyboardEvent) => {
                    if (e.key !== 'Escape') return
                    this.#query = ''
                    this.#searchExpanded = false
                    this.#render()
                  }}
                />
                {searchExpanded && (
                  <button
                    type="button"
                    class={css.clearButton ?? ''}
                    aria-label={t('search.clear')}
                    onclick={(e: MouseEvent) => {
                      e.stopPropagation()
                      this.#query = ''
                      this.#searchExpanded = false
                      this.#render()
                    }}
                  >
                    <IconCloseFill14 />
                  </button>
                )}
              </div>
            </div>
          )}
          <div class={clsx(css.headerActions, wide && searchExpanded && css.headerActionsHidden)}>
            {wide && ViewOptionsMenu({
              groupBy,
              orderBy,
              onGroupPick: (mode) => { actions.setGroupBy(mode) },
              onOrderPick: (mode) => { actions.setOrderBy(mode) },
              t,
            })}
            {/* Adding is the button's one action, so a composition with no
                picking affordance has nothing to offer here: the region hides the
                button rather than leaving a dead one in the header. */}
            {directoryFlowAvailable && (
              <Tooltip label={t('workspace.add')} side="bottom" delayMs={500}>
                <button
                  ref={(el: Node | null) => { this.#wsPlusEl = el as HTMLButtonElement | null }}
                  type="button"
                  class={css.iconButton ?? ''}
                  aria-label={t('workspace.add')}
                  onclick={() => {
                    this.#wsPickerOpen = !this.#wsPickerOpen
                    this.#render()
                  }}
                >
                  <IconProjectAddOutline16 size={wide ? 16 : 18} />
                </button>
              </Tooltip>
            )}
          </div>
          {/* Add flow + its error dialog (same package — direct composition). */}
          <WorkspacePickFlow
            t={t}
            open={wsPickerOpen}
            anchorRef={{ current: this.#wsPlusEl }}
            useWorkspaces={useWorkspaces}
            createWorkspace={createWorkspace}
            useDirectoryFlow={useDirectoryFlow}
            renderDirectoryFlow={owner => renderSlot('sidebar.workspaces.directoryFlow', owner) as unknown as JSX.Element}
            addOnly
            side="right"
            onPick={(workspaceId) => {
              this.#wsPickerOpen = false
              this.#render()
              startSession(workspaceId)
            }}
            onClose={() => { this.#wsPickerOpen = false; this.#render() }}
          />
        </div>

        {/* The collapsed rail keeps search as its own 36px control. */}
        {!wide && <div class={css.search ?? ''}>
          <Tooltip label={t('search')}>
            <button
              type="button"
              class={css.searchButton ?? ''}
              aria-label={t('search.sessions.aria')}
              onclick={() => {
                this.#searchExpanded = true
                this.#searchOnExpand = true
                this.#render()
                expandSidebar()
              }}
            >
              <IconSearchOutline16 size={18} />
            </button>
          </Tooltip>
        </div>}

        {/* Always-mounted seat keeps the region's flex slot while the list
            itself is wide-only. */}
        <div class={css.listArea ?? ''}>
          {wide && (normalizedQuery !== ''
            ? SearchResults({
              useSessions,
              open,
              workspaces,
              archivedSessionIds,
              query: normalizedQuery,
              remote: remoteSearch,
              resultLimit: searchResultLimit,
              t,
            })
            : groupBy === 'flat'
              ? FlatList({
                useSessions, open, forkSession,
                onSessionRename: this.#onSessionRename, onSessionArchive: this.#onSessionArchive,
                archivedSessionIds,
                orderBy,
                sessionOrderByAccount,
                sessionUpdatedAtByAccount,
                syncSessionOrderAccount: actions.syncSessionOrderAccount,
                setSessionOrder: actions.setSessionOrder,
                t,
              })
              : SessionTree({
                useSessions,
                onSessionRename: this.#onSessionRename,
                onSessionArchive: this.#onSessionArchive,
                forkSession,
                workspaces,
                groupExpansion,
                setGroupExpanded: actions.setGroupExpanded,
                sessionOrderByAccount,
                sessionUpdatedAtByAccount,
                syncSessionOrderAccount: actions.syncSessionOrderAccount,
                setSessionOrder: actions.setSessionOrder,
                archivedSessionIds,
                startSession,
                open,
                insertWorkspaceBefore,
                insertSessionBefore,
                orderBy,
                home,
                t,
                onRenameRequest: (workspaceId, currentTitle) => {
                  this.#renameTarget = { workspaceId, currentTitle }
                  this.#renameDraft = currentTitle
                  this.#renameError = null
                  this.#render()
                },
                onDeleteRequest: (workspaceId, title) => {
                  this.#deleteTarget = { workspaceId, title }
                  this.#deleteError = null
                  this.#render()
                },
              }))}
        </div>
      </div>
    )
    applyDiff(this, vdom)

    this.#renameModal = renderModal(this.#renameModal, {
      open: renameTarget !== null,
      onClose: () => { this.#closeRename() },
      closeLabel: t('close'),
      title: t('rename.workspace.title'),
      footer: [
        <Button variant="outline" disabled={renaming} onclick={() => { this.#closeRename() }}>{t('cancel')}</Button>,
        <Button variant="primary" disabled={renameBlocked} onclick={() => { this.#confirmRename() }}>{t('rename')}</Button>,
      ],
      children: [
        <input
          class={css.renameInput ?? ''}
          value={renameDraft}
          aria-label={t('field.workspaceName')}
          autofocus
          disabled={renaming}
          onfocus={(e: FocusEvent) => { (e.target as HTMLInputElement).select() }}
          oninput={(e: Event) => {
            this.#renameDraft = (e.target as HTMLInputElement).value
            this.#renameError = null
            this.#render()
          }}
          oncompositionstart={() => { this.#composing = true }}
          oncompositionend={() => { this.#composing = false }}
          onkeydown={(e: KeyboardEvent) => {
            if (e.key === 'Enter' && !this.#composing) {
              e.preventDefault()
              this.#confirmRename()
            }
          }}
        />,
        ...(renameDuplicate
          ? [<div class={css.renameError ?? ''} role="alert">{t('conflict.named', { name: renameTrimmed })}</div>]
          : []),
        ...(renameError !== null
          ? [<div class={css.renameError ?? ''} role="alert">{renameError}</div>]
          : []),
      ],
    })

    this.#sessionRenameModal = renderModal(this.#sessionRenameModal, {
      open: sessionRenameTarget !== null,
      onClose: () => { this.#closeSessionRename() },
      closeLabel: t('close'),
      title: t('rename.session.title'),
      footer: [
        <Button variant="outline" disabled={sessionRenaming} onclick={() => { this.#closeSessionRename() }}>{t('cancel')}</Button>,
        <Button variant="primary" disabled={sessionRenameBlocked} onclick={() => { this.#confirmSessionRename() }}>{t('rename')}</Button>,
      ],
      children: [
        <input
          class={css.renameInput ?? ''}
          value={sessionRenameDraft}
          aria-label={t('field.sessionName')}
          autofocus
          disabled={sessionRenaming}
          onfocus={(e: FocusEvent) => { (e.target as HTMLInputElement).select() }}
          oninput={(e: Event) => {
            this.#sessionRenameDraft = (e.target as HTMLInputElement).value
            this.#sessionRenameError = null
            this.#render()
          }}
          oncompositionstart={() => { this.#composing = true }}
          oncompositionend={() => { this.#composing = false }}
          onkeydown={(e: KeyboardEvent) => {
            if (e.key === 'Enter' && !this.#composing) {
              e.preventDefault()
              this.#confirmSessionRename()
            }
          }}
        />,
        ...(sessionRenameError !== null
          ? [<div class={css.renameError ?? ''} role="alert">{sessionRenameError}</div>]
          : []),
      ],
    })

    this.#deleteModal = renderModal(this.#deleteModal, {
      open: deleteTarget !== null,
      onClose: () => { this.#closeDelete() },
      closeLabel: t('close'),
      title: t('delete.workspace'),
      ...(deleteTarget === null
        ? {}
        : { description: t('delete.desc', { name: deleteTarget.title }) }),
      footer: [
        <Button variant="outline" disabled={deleting} onclick={() => { this.#closeDelete() }}>{t('cancel')}</Button>,
        <Button
          variant="outline"
          class={css.deleteAction ?? ''}
          disabled={deleting}
          onclick={() => { this.#confirmDelete() }}
        >
          {t('delete.workspace')}
        </Button>,
      ],
      children: [
        ...(deleting
          ? [<div class={css.deleteStatus ?? ''} role="status">{t('delete.pending')}</div>]
          : []),
        ...(deleteError !== null
          ? [<div class={css.renameError ?? ''} role="alert">{deleteError}</div>]
          : []),
      ],
    })
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-workspace-browser') === undefined) {
  customElements.define('dsh-workspace-browser', DshWorkspaceBrowser)
}

/**
 * Render the browsing region.
 * @param props - composed slot props (shell owner share + store + injected actions).
 * @returns the region element tree.
 */
export function WorkspaceBrowser(props: WorkspaceBrowserProps): JSX.Element {
  const el = document.createElement('dsh-workspace-browser') as DshWorkspaceBrowser
  el.setProps(props)
  return el as unknown as JSX.Element
}
