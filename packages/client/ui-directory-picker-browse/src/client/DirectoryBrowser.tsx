/**
 * The in-app workspace-directory browser (figma Harness 813-23126 family): a
 * 680×500 dialog (clamped to short/narrow viewports — the Miller row scrolls
 * sideways, the columns scroll down) whose header carries the title, the selection-path
 * breadcrumb, and a click-to-edit path zone; below it a Miller view — one
 * full-width level until a row is selected, then two columns splitting the
 * row evenly (256px floor; level | selected folder's children) around a
 * hairline divider. Navigations land selection-anchored and quiet: the
 * previous view keeps rendering while a crumb jump or a submitted path is
 * scanned, then target and parent legs land as one two-pane frame (a slow
 * parent leg falls back to landing the target alone and upgrading in
 * place), so stepping back keeps two panes away from the display root and
 * navigation never flashes an intermediate frame. Selecting in the
 * right column shifts the view one level deeper. "New folder" opens a nested
 * create dialog targeting the selected folder (or the level itself) and
 * selects the created folder. Open adopts the selected folder, falling back
 * to the listed level. Pure consumer of the injected browse calls — the
 * owning flow decides what "Open" means and owns the workspace-creation
 * error surface. Hidden entries are host-flagged and hidden by default; the
 * footer's fixed-label "Show hidden files" toggle (aria-pressed, check when
 * on) reveals them (client-side only). The path editor announces itself with
 * a pencil glyph and a bar-wide hover-lit outline, opens seeded with a
 * trailing separator, and keeps the panes under the draft: the final segment
 * prefix-filters the LAST pane while that pane's level is the one the draft's
 * directory part names (a dot-led prefix also reveals the hidden entries it
 * names, and a prefix nobody matches releases the filter), while any other
 * directory part is scanned after a short debounce and lands like any other
 * navigation — selection-anchored and two-pane away from the display root,
 * both legs waited out so one keystroke moves the view once. The pane arity
 * holds throughout: the last pane is the level the path names and the one
 * beside it is its parent, so typing deeper descends and erasing segments
 * walks back up, moving the Miller view without leaving the editor. Panes the
 * draft walked to stay put when the editor closes (cancellation included):
 * the crumbs name where the walk ended, and Open's fallback target follows
 * them.
 *
 * Converted from a React hooks component to a webjsx custom element: every
 * useState becomes a private field, every ref becomes a private field, every
 * useEffect/useCallback becomes plain instance methods invoked from
 * connectedCallback/disconnectedCallback or directly from event handlers, and
 * re-render is an explicit applyDiff(this, vdom) call (Toast.tsx's pattern)
 * instead of implicit re-render on setState. The nested nulls-vs-nothing
 * scheduling logic (supersession sequence numbers, the slow-scan silence
 * window, the draft-preview debounce) is preserved verbatim as plain fields
 * and timers.
 */
import { applyDiff } from 'webjsx'
import clsx from 'clsx'
import {
  Button, IconCheckOutline16, IconChevronRightOutline14, IconEditOutline16, IconFolderClose16, IconFolderOpen16,
  IconPlusOutline16, renderModal, type DshModal,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DirectoryEntry, DirectoryListing } from '@deepseek-ai/dsh-client-runtime/client'
import { DirectoryBrowseError } from '@deepseek-ai/dsh-client-runtime/client'
import type { Translate } from '@deepseek-ai/dsh-client-locale/client'
import css from './DirectoryBrowser.module.css'

/** Owner-supplied browser props: browse calls, pick semantics, and copy. */
export interface DirectoryBrowserProps {
  /** Dialog visibility (owner-local; closed unmounts nothing but resets on reopen). */
  open: boolean
  /** List one directory level (absent path = the Host home directory); the signal aborts a superseded scan on the wire. */
  listDirectory: (path?: string, signal?: AbortSignal) => Promise<DirectoryListing>
  /** Create one child directory under an existing parent. */
  createDirectory: (path: string, name: string) => Promise<string>
  /** The operator confirmed a directory (the selection, else the listed level). */
  onOpen: (path: string) => void
  /** Close without picking (mask, Escape, Cancel). */
  onClose: () => void
  /** The owner's confirm is in flight: Open disables, the view freezes. */
  busy: boolean
  /** Localized copy. */
  t: Translate
}

/** Failure text: the Host business message when typed, else the throw's text. */
function failureText(error: unknown): string {
  if (error instanceof DirectoryBrowseError) return error.rpcError.message
  return error instanceof Error ? error.message : String(error)
}

/**
 * How long a scan may stay visually silent before the floating "Loading…"
 * pill appears. The stale view keeps rendering while a scan is in flight, so
 * a listing that settles inside this window swaps the panes with no
 * intermediate frame at all; only a genuinely slow host (a network mount, a
 * cold disk) surfaces the indicator.
 */
const SLOW_SCAN_DELAY_MS = 300

/**
 * How long a navigation landing waits for its parent leg before committing
 * the target alone. Inside the window both legs land as ONE two-pane frame —
 * no single-pane flash between them; past it the target commits single-pane
 * at once (an Enter-submitted navigation is never held hostage by a stalled
 * parent) and the late parent leg upgrades the landing in place.
 */
const PARENT_LEG_WAIT_MS = 200

/**
 * How long a typed draft rests before the panes follow it to a directory no
 * pane lists. The window absorbs the keystrokes that walk through
 * intermediate directory parts (every character of `/usr/lo` past the
 * separator would otherwise be its own scan) while staying short enough that
 * a pause reads as "the list moved with me".
 */
const DRAFT_PREVIEW_DEBOUNCE_MS = 250

/**
 * Breadcrumb rows for display: inside the home subtree the chain starts at a
 * localized Home crumb; outside it the full ancestry shows, the root labeled
 * by its own path.
 */
function displayCrumbs(listing: DirectoryListing, homeLabel: string): DirectoryEntry[] {
  const homeIndex = listing.crumbs.findIndex((crumb: DirectoryEntry) => crumb.path === listing.home)
  if (homeIndex === -1) return listing.crumbs
  const tail = listing.crumbs.slice(homeIndex + 1)
  return [{ name: homeLabel, path: listing.home, hidden: false }, ...tail]
}

/**
 * The listing's platform separator, inferred from the home path the host
 * stamped — never from typed text or entry paths, where a backslash is a
 * legal POSIX name character. Still a heuristic at the last step: a POSIX
 * home directory whose own name contains a backslash would misread.
 * TODO: replace with a host-stamped `separator` field on the wire
 * DirectoryListing so the platform fact travels verbatim (the trade-off is
 * recorded in the directory-picker capability seam Agent Note).
 */
function separatorOf(listing: DirectoryListing): '\\' | '/' {
  return listing.home.includes('\\') ? '\\' : '/'
}

/** The listed level as a directory part: its own path, separator-terminated (the root already is). */
function levelDirectory(listing: DirectoryListing): string {
  const sep = separatorOf(listing)
  return listing.path.endsWith(sep) ? listing.path : `${listing.path}${sep}`
}

/** The directory text a draft-following scan last sent, with the level path the host answered it with. */
interface ScannedDirectory {
  /** The draft's directory part, verbatim as it went to the host. */
  readonly directory: string
  /** `path` of the listing that came back. */
  readonly landed: string
}

/**
 * The draft's directory part — everything through its last separator — or
 * null while no separator has been typed at all (nothing addresses a
 * directory yet). The platform comes from `listing`: on Windows a forward
 * slash separates too (the host's `resolve` accepts either), while on POSIX a
 * backslash is a legal name character and never separates.
 */
function draftDirectory(listing: DirectoryListing, draft: string): string | null {
  const cut = separatorOf(listing) === '\\'
    ? Math.max(draft.lastIndexOf('\\'), draft.lastIndexOf('/'))
    : draft.lastIndexOf('/')
  return cut === -1 ? null : draft.slice(0, cut + 1)
}

/**
 * How the draft reads against one level: the directory part it names, and —
 * when `listing` is the level that directory part addresses — the final
 * segment that prefix-filters it while the user types (case-insensitively,
 * downstream). A level answers a directory part when its own path is that
 * part, or when it is the level that very text just produced (`scanned`): the
 * host resolves what it is given, so `..` segments and Windows forward
 * slashes reach a level whose path spells the request differently.
 * @param listing - the level to read the draft against.
 * @param draft - the current path draft.
 * @param scanned - the last draft-following scan's directory and landing.
 * @returns the draft's directory part (null with no separator typed) and its
 * filtering tail (null when this level does not answer that directory).
 */
function readDraft(
  listing: DirectoryListing,
  draft: string,
  scanned: ScannedDirectory | null,
): { directory: string | null; tail: string | null } {
  const directory = draftDirectory(listing, draft)
  if (directory === null) return { directory: null, tail: null }
  const answers = directory === levelDirectory(listing)
    || (scanned !== null && scanned.directory === directory && scanned.landed === listing.path)
  return { directory, tail: answers ? draft.slice(directory.length) : null }
}

/**
 * The rows one column renders. The selection is exempt from every filter: it
 * anchors the two-pane view (crumbs and the child pane point at it), so
 * neither the hidden filter after a dot-reveal pick nor a prefix miss may
 * orphan it. A prefix narrows the level only while some row it would actually
 * show matches — a tail nobody matches is a name being spelled, not a demand
 * for an empty pane, so the level shows whole and its hidden rows return to
 * obeying the toggle. Counting only displayable rows is what keeps that true:
 * were a hidden row ever to match a prefix that does not reveal it (today
 * `hidden` means dot-prefixed, so it cannot), the level would narrow to
 * nothing.
 */
function visibleEntries(
  entries: readonly DirectoryEntry[],
  selectedPath: string | null,
  showHidden: boolean,
  filterPrefix: string | null,
): readonly DirectoryEntry[] {
  const needle = filterPrefix === null ? '' : filterPrefix.toLowerCase()
  // A dot-led prefix names hidden entries explicitly, so matching ones
  // surface even while the toggle keeps the rest hidden.
  const displayable = (entry: DirectoryEntry): boolean => showHidden || !entry.hidden || needle.startsWith('.')
  const matches = (entry: DirectoryEntry): boolean => displayable(entry) && entry.name.toLowerCase().startsWith(needle)
  const narrowing = needle !== '' && entries.some(matches)
  return entries.filter((entry) => {
    if (entry.path === selectedPath) return true
    if (narrowing) return matches(entry)
    return showHidden || !entry.hidden
  })
}

/** One column of folder rows (the Miller view renders one or two of these). */
function LevelColumn({ entries, selectedPath, busy, onPick, showHidden, filterPrefix, pathEditing }: {
  entries: readonly DirectoryEntry[]
  selectedPath: string | null
  busy: boolean
  onPick: (entry: DirectoryEntry) => void
  showHidden: boolean
  filterPrefix: string | null
  pathEditing: boolean
}): JSX.Element {
  const visible = visibleEntries(entries, selectedPath, showHidden, filterPrefix)
  return (
    <div class={css.column ?? ''} role="list">
      {visible.map((entry) => {
        const selected = entry.path === selectedPath
        return (
          // The wrapper carries the list semantics; the row keeps its NATIVE
          // button role so assistive technology exposes an actionable control.
          <span role="listitem" class={css.rowSeat ?? ''}>
            <button
              type="button"
              aria-current={selected ? 'true' : null}
              class={clsx(css.row, selected && css.rowSelected)}
              disabled={busy}
              // While the path editor is open, keep focus in it: a focus
              // steal on mousedown would blur the editor and (in engines
              // where the blur lands before our guards) drop this click.
              // Outside editing, rows keep native focus behavior.
              onmousedown={pathEditing ? (event: MouseEvent) => { event.preventDefault() } : null}
              // Editing-time focus parking happens after commit (the
              // DirectoryBrowser refocus effect): a right-pane pick replaces
              // this very column, so focusing the clicked node here would
              // still fall to body.
              onclick={() => { onPick(entry) }}
            >
              {selected
                ? <IconFolderOpen16 size={16} className={css.rowIconSelected} />
                : <IconFolderClose16 size={16} className={css.rowIcon} />}
              <span class={css.rowName ?? ''}>{entry.name}</span>
              <IconChevronRightOutline14 size={12} className={css.rowChevron} />
            </button>
          </span>
        )
      })}
    </div>
  )
}

/**
 * The directory-browser dialog custom element (see module doc). setProps
 * updates `open`/`busy`/`onOpen`/`onClose`/`t`/the browse calls without
 * disturbing in-flight Miller-view state; the open/close edge itself is
 * detected in #render by comparing against the previously rendered `open`.
 */
export class DshDirectoryBrowser extends HTMLElement {
  #props: DirectoryBrowserProps | null = null
  #wasOpen = false

  // Miller state: the listed level, the selected row in it, and the selected
  // folder's own listing (the right column; null while nothing is selected).
  #parent: DirectoryListing | null = null
  #selected: DirectoryEntry | null = null
  #child: DirectoryListing | null = null
  #loading = false
  // Derived from `loading` and `scanWindow` by the slow-scan timer below:
  // true only once the current listing call has been in flight for
  // SLOW_SCAN_DELAY_MS, so fast listings never render the indicator at all.
  #slowScan = false
  #slowScanTimer: ReturnType<typeof window.setTimeout> | null = null
  #error: string | null = null
  // Path-edit state: null = breadcrumb mode; a string = the draft being typed.
  #pathDraft: string | null = null
  // Show-hidden toggle state (pure client-side filter, reset on each open).
  #showHidden = false
  // Create-folder state: null = closed; a string = the nested dialog's draft.
  #folderDraft: string | null = null
  #creatingFolder = false
  #createError: string | null = null
  #requestSeq = 0
  // The in-flight listing's controller: superseding intent aborts the wire
  // request too — the Host stops scanning — instead of only discarding the
  // eventual result while the scan keeps consuming host resources.
  #scanController: AbortController | null = null
  // Bumped on every open/close edge: settlements from a previous open (a
  // pending creation included) must never mutate a reopened dialog.
  #openGeneration = 0
  #composing = false
  // What the last draft-following scan asked for and what came back.
  #scanned: ScannedDirectory | null = null
  // IME confirmation (Enter selecting a candidate) must not submit the
  // navigate's own commit while a submitted navigation is bounded.
  #previewSuspended = false
  #draftDebounceTimer: ReturnType<typeof window.setTimeout> | null = null

  // Editor-close focus parking, consumed after each render: a pick parks on
  // the selection's row, Enter and an input-focused Escape park on the crumb
  // edit zone that replaces the input. Pointer-out cancels never set (or
  // clear) these — yanking focus back from wherever the user clicked would be
  // worse than the fall.
  #refocusPick = false
  #refocusEditZone = false
  #refocusPathInput = false

  // Persistent dsh-modal elements (self-mounted to document.body by
  // renderModal): held across renders and updated via setProps rather than
  // recreated, so the dialog's own DOM subtree survives every #render() call.
  #outerModal: DshModal | null = null
  #createModal: DshModal | null = null

  /** Set/replace props and re-render; call after creating or updating the element. */
  setProps(props: DirectoryBrowserProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  disconnectedCallback(): void {
    // HMR/unmount invalidation: a completion from a disposed flow must not
    // update state or issue follow-up requests from a dead component.
    this.#requestSeq += 1
    this.#openGeneration += 1
    this.#scanController?.abort()
    this.#stopSlowScanTimer()
    this.#stopDraftDebounce()
    this.#outerModal?.remove()
    this.#outerModal = null
    this.#createModal?.remove()
    this.#createModal = null
  }

  #stopSlowScanTimer(): void {
    if (this.#slowScanTimer !== null) { window.clearTimeout(this.#slowScanTimer); this.#slowScanTimer = null }
  }

  #stopDraftDebounce(): void {
    if (this.#draftDebounceTimer !== null) { window.clearTimeout(this.#draftDebounceTimer); this.#draftDebounceTimer = null }
  }

  /** Newer intent wins: invalidate the pending listing's settlement AND abort its wire request. */
  #supersede(): number {
    this.#scanController?.abort()
    this.#scanController = null
    this.#requestSeq += 1
    return this.#requestSeq
  }

  /** Hide any prior indicator and start a fresh silence window for one listing call. */
  #restartSlowScanWindow(): void {
    this.#slowScan = false
    this.#stopSlowScanTimer()
    this.#slowScanTimer = window.setTimeout(() => {
      this.#slowScan = true
      this.#render()
    }, SLOW_SCAN_DELAY_MS)
  }

  /** Launch one listing under a fresh controller so a later supersession can abort it. */
  #launchListing(path: string | undefined): { seq: number; scan: Promise<DirectoryListing> } {
    const seq = this.#supersede()
    const controller = new AbortController()
    this.#scanController = controller
    this.#restartSlowScanWindow()
    const listDirectory = this.#props?.listDirectory
    /* v8 ignore next -- narrowing guard: launchListing only runs while the element has props. */
    if (listDirectory === undefined) return { seq, scan: Promise.reject(new Error('directory browser: not initialized')) }
    return { seq, scan: listDirectory(path, controller.signal) }
  }

  /**
   * Launch a follow-up listing under the CURRENT supersession seq: a newer
   * intent aborts it like the leg it continues, and it supersedes nothing.
   */
  #continueScan(path: string): Promise<DirectoryListing> {
    const controller = new AbortController()
    this.#scanController = controller
    this.#restartSlowScanWindow()
    const listDirectory = this.#props?.listDirectory
    /* v8 ignore next -- narrowing guard: continueScan only runs mid-landing, which requires props. */
    if (listDirectory === undefined) return Promise.reject(new Error('directory browser: not initialized'))
    return listDirectory(path, controller.signal)
  }

  /**
   * Replace the whole view with a freshly scanned level. Away from the
   * display root — the same collapse the crumb header renders, so crumbs and
   * pane shape never disagree — the landing is two-pane: the target's ACTUAL
   * parent-level entry re-selected (left pane = parent, right pane = the
   * target), so a crumb jump reads as stepping back one pane. Both legs land
   * as one frame when the parent leg settles within
   * {@link PARENT_LEG_WAIT_MS}; past that bound (or at the display root) the
   * target commits alone — single wide level, loading ends — and a late
   * parent leg still upgrades the landing in place. A failed parent leg, or a
   * truncated parent window that lacks the target, leaves the single-pane
   * landing — the upgrade must never orphan the selection it exists to
   * anchor. Until whichever commit comes first, the previous view keeps
   * rendering: a landing swaps the panes, it never blanks them.
   *
   * Two callers, one landing shape. A submitted path (Enter, a crumb) closes
   * the editor on arrival, announces its failure, and takes the wait bound —
   * it is answering a gesture, so it may not hang on a stalled parent. The
   * editor's own draft-following scan keeps all three to itself: it is
   * speculative, nothing waits on it, and the stale view keeps rendering, so
   * it waits for BOTH legs rather than flashing a single pane it would then
   * upgrade — one keystroke must move the view once. A failure leaves the
   * last readable panes standing and says nothing, while an arrival clears
   * the stale message and re-parks focus the swap dropped.
   * @param path - the level to list; absent lists the Host home directory.
   * @param options - `closeEditor` retires the path draft on arrival and
   * bounds the wait for the parent leg; `announce` surfaces a failure as the
   * dialog's alert.
   */
  #land(path: string | undefined, options: { closeEditor: boolean; announce: boolean }): void {
    const { seq, scan } = this.#launchListing(path)
    this.#loading = true
    if (options.announce) this.#error = null
    this.#render()
    // What every landing does once its panes are committed, whichever shape
    // committed them.
    const settle = (): void => {
      this.#loading = false
      if (options.closeEditor) {
        this.#pathDraft = null
        return
      }
      this.#error = null
      this.#refocusPathInput = true
    }
    scan.then((target) => {
      if (seq !== this.#requestSeq) return
      // The level the panes will present as current answers this exact
      // directory text, however the host respelled it (`..`, a Windows
      // forward slash): the tail filters, and the same text asks for no
      // second scan.
      if (!options.closeEditor && path !== undefined) this.#scanned = { directory: path, landed: target.path }
      // The single-pane landing; `landed` makes it first-commit-only, while
      // the two-pane commit below may still upgrade an already-landed view.
      let landed = false
      const landSingle = (): void => {
        if (landed || seq !== this.#requestSeq) return
        landed = true
        this.#parent = target
        this.#selected = null
        this.#child = null
        settle()
        this.#render()
      }
      // Arity is label-independent: only the collapsed chain's depth decides.
      if (displayCrumbs(target, '').length < 2) { landSingle(); return }
      const parentCrumb = target.crumbs.at(-2)
      /* v8 ignore next -- narrowing: a two-deep display chain implies a parent crumb (root-to-target inclusive). */
      if (parentCrumb === undefined) { landSingle(); return }
      this.#continueScan(parentCrumb.path).then((parentLevel) => {
        if (seq !== this.#requestSeq) return
        // Windows resolves a typed path preserving its case; anchor on the
        // parent level's actual entry so selection comparisons hold.
        const sep = separatorOf(parentLevel)
        const fold = (value: string): string => (sep === '\\' ? value.toLowerCase() : value)
        const match = parentLevel.entries.find((entry: DirectoryEntry) => fold(entry.path) === fold(target.path))
        if (match === undefined) { landSingle(); return }
        landed = true
        this.#parent = parentLevel
        this.#selected = match
        this.#child = target
        // Idempotent on a late upgrade of a timed-out landing: reopening the
        // editor or starting a newer scan supersedes this seq, so reaching
        // here means the settlement is still this landing's own.
        settle()
        this.#render()
      }, () => {
        // The parent-leg failure (its abort included) never surfaces: the
        // target listed fine, and nobody asked to see the parent level.
        landSingle()
      })
      // Only a submitted navigation is bounded: the walk waits both legs out
      // (see the contract above), and a keystroke aborts it if the operator
      // moves on first.
      if (options.closeEditor) window.setTimeout(landSingle, PARENT_LEG_WAIT_MS)
    }, (reason: unknown) => {
      if (seq !== this.#requestSeq) return
      this.#loading = false
      if (options.announce) this.#error = failureText(reason)
      this.#render()
    })
  }

  /** Commit a submitted path (Enter, a crumb, the initial home listing): the editor closes, failures surface. */
  #navigate(path?: string): void {
    this.#land(path, { closeEditor: true, announce: true })
  }

  /**
   * Select a row of the listed level and preview its children on the right.
   * Deliberately NOT one-frame like navigate(): a pick's first duty is the
   * immediate selected state on the clicked row, and the pane split IS that
   * feedback (aria-current pill, crumbs following the selection) — holding
   * it back for the child listing would make clicks feel dropped. The quiet
   * rule governs whole-view replacement, where nothing acknowledges the
   * click but the swap itself.
   */
  #select(entry: DirectoryEntry): void {
    const { seq, scan } = this.#launchListing(entry.path)
    // A pick while the path editor is open adopts the (filtered) row and
    // closes the editor — the draft served its purpose. Focus re-parks on
    // the selection after commit (see the refocus effect below).
    if (this.#pathDraft !== null) this.#refocusPick = true
    this.#pathDraft = null
    this.#selected = entry
    this.#child = null
    this.#loading = true
    this.#error = null
    this.#render()
    scan.then((next) => {
      if (seq !== this.#requestSeq) return
      this.#child = next
      this.#loading = false
      this.#render()
    }, (reason: unknown) => {
      if (seq !== this.#requestSeq) return
      this.#loading = false
      this.#error = failureText(reason)
      // An unreadable selection cannot be the committing target while the
      // breadcrumb still names the level: fall back to the single pane.
      this.#selected = null
      // Clearing the selection can unmount the very row the pick parked
      // focus on (a dot-revealed hidden row re-hides); the refocus effect
      // re-parks on the edit zone only if focus actually fell to body.
      this.#refocusEditZone = true
      this.#render()
    })
  }

  /**
   * Walk the panes to the directory the draft addresses, WITHOUT closing the
   * editor. The landing is an ordinary one — selection-anchored and two-pane
   * away from the display root — so typing a path moves the Miller view
   * exactly as a crumb jump does, and the draft's final segment
   * prefix-filters the arrival from the next render on.
   */
  #previewDraftLevel(directory: string): void {
    this.#land(directory, { closeEditor: false, announce: false })
  }

  /** Abandon path editing (Escape or clicking away) and restore the crumb view. */
  #cancelPathEdit(): void {
    // Cancel also withdraws a navigation the editor already launched: its
    // late success must not jump to the cancelled path, so the pending
    // request is superseded and the view leaves the loading state.
    this.#supersede()
    this.#loading = false
    this.#pathDraft = null
    this.#error = null
    // Editing may have superseded the selection's preview request; a
    // selection with no preview would render a half-empty two-pane view, so
    // cancel falls back to the single-pane level.
    if (this.#child === null) this.#selected = null
    // With no level listed yet (the editor superseded the initial home
    // listing), plain cancellation would leave a permanently blank picker:
    // restart the home listing.
    if (this.#parent === null) { this.#navigate(); return }
    this.#render()
  }

  /** A right-column pick advances the view one level: child becomes the level. */
  #advance(entry: DirectoryEntry): void {
    /* v8 ignore next -- narrowing guard: the right column only renders with a child listing. */
    if (this.#child === null) return
    this.#parent = this.#child
    this.#select(entry)
  }

  #confirmCreate(): void {
    /* v8 ignore next -- reentry fence: the nested dialog only renders with a target and disables while creating. */
    const targetPath = this.#selected?.path ?? this.#parent?.path ?? null
    if (targetPath === null || this.#folderDraft === null || this.#creatingFolder) return
    // Trim only rejects an all-whitespace draft; the Host gets the original
    // spelling — the backend accepts any non-blank single segment verbatim,
    // and trimming here would create (and select) a different sibling.
    const name = this.#folderDraft
    if (name.trim() === '') return
    const createDirectory = this.#props?.createDirectory
    /* v8 ignore next -- narrowing guard: confirmCreate only runs while the element has props. */
    if (createDirectory === undefined) return
    this.#creatingFolder = true
    this.#createError = null
    this.#render()
    const generation = this.#openGeneration
    createDirectory(targetPath, name).then((createdPath) => {
      // A settlement from a closed (possibly reopened) flow must not touch
      // the fresh dialog or issue a relist against the stale target.
      if (generation !== this.#openGeneration) return
      this.#creatingFolder = false
      this.#folderDraft = null
      // Land like a right-column pick (figma 802:57446 → 813:23278 flow): the
      // create target becomes the listed level and the new folder its selection.
      const { seq, scan } = this.#launchListing(targetPath)
      this.#loading = true
      // Symmetric with navigate/select: a launched scan clears the stale
      // failure text (and keeps the floating indicator's corner the only
      // occupant of the content's right edge while it shows).
      this.#error = null
      this.#render()
      scan.then((level) => {
        /* v8 ignore next -- same fence as navigate/select; the modal blocks superseding input */
        if (seq !== this.#requestSeq) return
        this.#parent = level
        this.#loading = false
        this.#select({ name, path: createdPath, hidden: false })
      }, (reason: unknown) => {
        /* v8 ignore next -- same fence as navigate/select; the modal blocks superseding input */
        if (seq !== this.#requestSeq) return
        this.#loading = false
        this.#error = failureText(reason)
        this.#render()
      })
    }, (reason: unknown) => {
      if (generation !== this.#openGeneration) return
      this.#creatingFolder = false
      this.#createError = failureText(reason)
      this.#render()
    })
  }

  /** Every open starts fresh at the Host home directory; closing invalidates any in-flight response. */
  #onOpenEdge(open: boolean): void {
    this.#openGeneration += 1
    if (open) {
      this.#parent = null
      this.#selected = null
      this.#child = null
      this.#creatingFolder = false
      this.#showHidden = false
      this.#navigate()
      return
    }
    this.#supersede()
    // Closing mid-scan leaves nothing to load: without this edge the
    // slow-scan timer keeps arming while hidden and the reopened dialog
    // would show the indicator on its first frame instead of waiting out a
    // fresh silence window (reopen's navigate() produces no loading edge).
    this.#loading = false
    this.#error = null
    this.#pathDraft = null
    this.#folderDraft = null
    this.#createError = null
    // A close mid-flight (failed Enter, then Cancel) may leave refocus
    // flags armed; retire them so a later render cannot consume them.
    this.#refocusPick = false
    this.#refocusEditZone = false
  }

  /** Arm the draft-preview debounce for the current pathDraft (every keystroke replaces the pending timer). */
  #armDraftDebounce(): void {
    this.#stopDraftDebounce()
    if (this.#pathDraft === null) return
    this.#draftDebounceTimer = window.setTimeout(() => {
      if (this.#previewSuspended) return
      // The level the panes present as current: it alone may answer the
      // draft, so anything else it names is a level to walk to.
      const current = this.#child ?? this.#parent
      if (current === null || this.#pathDraft === null) return
      const { directory, tail } = readDraft(current, this.#pathDraft, this.#scanned)
      if (directory === null || tail !== null) return
      this.#previewDraftLevel(directory)
    }, DRAFT_PREVIEW_DEBOUNCE_MS)
  }

  #render(): void {
    const props = this.#props
    if (props === null) { applyDiff(this, <span style="display:none" />); return }
    const { open, onClose, busy, t } = props

    if (open !== this.#wasOpen) {
      this.#wasOpen = open
      this.#onOpenEdge(open)
    }

    if (!open) { applyDiff(this, <span style="display:none" />); return }

    const parent = this.#parent
    const selected = this.#selected
    const child = this.#child
    const loading = this.#loading
    const slowScan = this.#slowScan
    const error = this.#error
    const pathDraft = this.#pathDraft
    const showHidden = this.#showHidden
    const folderDraft = this.#folderDraft
    const creatingFolder = this.#creatingFolder
    const createError = this.#createError
    const twoPane = selected !== null
    // The nested create dialog owns the interaction while open: Modal has no
    // focus trap, so every parent control goes inert (Shift-Tab or AT must not
    // close, adopt, or retarget underneath the child).
    const parentInert = busy || folderDraft !== null
    // An uncommitted path draft makes targetPath stale relative to the header:
    // committing actions must not act on the previous selection/listing while
    // a different path is displayed.
    const draftPending = pathDraft !== null

    // The panes follow the draft: every keystroke re-arms the debounce below
    // (via #armDraftDebounce, called from the input's onchange), read here
    // only to decide the crumb-scope class bindings and typedPrefix.
    const crumbSource = child ?? parent
    // The draft's tail filters the level it names, which by the pane invariant
    // is the LAST pane — never a pane the draft has already walked away from.
    const typedPrefix = crumbSource === null || pathDraft === null
      ? null
      : readDraft(crumbSource, pathDraft, this.#scanned).tail
    const crumbs = crumbSource === null ? [] : displayCrumbs(crumbSource, t('browser.home'))

    /** The folder a create or Open acts on: the selection, else the listed level. */
    const targetPath = selected?.path ?? parent?.path ?? null
    const targetName = selected?.name
      ?? (parent === null ? '' : (displayCrumbs(parent, t('browser.home')).at(-1)?.name ?? parent.path))

    const compositionOn = (): void => { this.#composing = true }
    const compositionOff = (): void => { this.#composing = false }

    const outerBody = (
    /* Path-edit cancellation is observed at the card scope, not the
          * input: once Tab parks focus on a filtered row the input is off the
          * event path, yet Escape must still collapse the editor (not the
          * dialog) and a further focus move out of the card must still
          * cancel. display:contents keeps header/content/footer as direct
          * flex children of the Modal card. */
      <div
        class={css.editorScope ?? ''}
        onkeydown={(event: KeyboardEvent) => {
          if (event.key !== 'Escape' || this.#pathDraft === null) return
          // stopPropagation keeps the card-scope Escape from the Modal's
          // document listener.
          event.stopPropagation()
          // Escape while the input holds focus is about to unmount it; with
          // focus already parked on a row, that row survives the cancel and
          // keeps focus naturally. Assignment (not a conditional set) also
          // retires a stale flag a failed or still-upgrading Enter left.
          this.#refocusEditZone = document.activeElement === this.querySelector('[data-path-input]')
          this.#cancelPathEdit()
        }}
        // Focus leaving THIS dialog card while editing cancels like Escape.
        // Guarded non-cancel paths: window/tab focus loss (document no
        // longer focused); a focus move that stays inside the card (Tab
        // onto the filtered rows or the footer toggle); and pointer paths,
        // where rows and the toggle suppress focus steal on mousedown while
        // editing so their click lands first. Enter keeps focus in the
        // input while its navigation is in flight, so a submitted path is
        // never withdrawn here. Anchored to this card via closest, not any
        // [role="dialog"], so focus escaping into a sibling overlay cancels.
        onblur={(event: FocusEvent) => {
          if (this.#pathDraft === null) return
          if (!document.hasFocus()) return
          const target = event.currentTarget as HTMLElement
          const card = target.closest('[role="dialog"]')
          /* v8 ignore next -- narrowing guard: this scope always renders inside the Modal card. */
          if (card === null) return
          const related = event.relatedTarget
          if (related instanceof Node && card.contains(related)) return
          // The user moved focus out of the card themselves: cancel without
          // re-parking (a lingering Enter-failure flag must not yank focus
          // back either).
          this.#refocusEditZone = false
          this.#cancelPathEdit()
        }}
      >
        <div class={css.header ?? ''}>
          <h2 class={css.title ?? ''}>{t('browser.title')}</h2>
          <div class={css.crumbBar ?? ''}>
            {pathDraft === null
              ? [
                <span class={css.crumbTrail ?? ''} role="navigation" data-crumb-trail>
                  {crumbs.map((crumb, index) => (
                    <span class={css.crumbSeat ?? ''}>
                      {index > 0 && <IconChevronRightOutline14 size={12} className={css.crumbChevron} />}
                      <button
                        type="button"
                        class={css.crumb ?? ''}
                        disabled={parentInert}
                        onclick={() => { this.#navigate(crumb.path) }}
                      >
                        {crumb.name}
                      </button>
                    </span>
                  ))}
                </span>,
                /* The empty zone right of the crumbs is the path-edit
                     * affordance: the whole remainder of the bar clicks into
                     * the editor, and the pencil glyph parked at its right
                     * edge (with the same tooltip) is what says so — an
                     * invisible target the operator must guess at is the one
                     * way into typing a path. */
                <button
                  type="button"
                  class={css.crumbEditZone ?? ''}
                  aria-label={t('browser.editPath')}
                  title={t('browser.editPath')}
                  // Stays available with no listed level: when the home
                  // listing itself fails, typing an absolute path is the one
                  // remaining way forward.
                  disabled={parentInert}
                  data-edit-zone
                  onclick={() => {
                    // Opening the editor supersedes any pending listing: a
                    // settlement landing before the first keystroke would
                    // otherwise close the editor via navigate's draft reset.
                    this.#supersede()
                    this.#loading = false
                    this.#previewSuspended = false
                    // Seed with a trailing separator so typing immediately
                    // continues into child names (and prefix-filters below).
                    // No listed level means nothing to seed from (the editor
                    // is the recovery path for a failed home listing).
                    if (this.#parent === null) {
                      this.#pathDraft = ''
                      this.#render()
                      return
                    }
                    const base = this.#selected?.path ?? this.#parent.path
                    const sep = separatorOf(this.#parent)
                    this.#pathDraft = base.endsWith(sep) ? base : `${base}${sep}`
                    this.#render()
                  }}
                >
                  <IconEditOutline16 size={14} className={css.crumbEditGlyph} />
                </button>,
              ]
              : (
                <input
                  class={css.pathInput ?? ''}
                  value={pathDraft}
                  aria-label={t('browser.editPath')}
                  autofocus
                  data-path-input
                  disabled={parentInert}
                  oncompositionstart={compositionOn}
                  oncompositionend={compositionOff}
                  onchange={(event: Event) => {
                    // Editing the draft supersedes any in-flight navigation:
                    // its completion must neither clear the newer text nor
                    // repopulate the view with the older path.
                    this.#supersede()
                    this.#loading = false
                    // A fresh edit releases the submission hold: the panes
                    // may follow the new text wherever it points.
                    this.#previewSuspended = false
                    this.#pathDraft = (event.target as HTMLInputElement).value
                    this.#armDraftDebounce()
                    this.#render()
                  }}
                  // Escape and focus-leave cancellation live on the card-scope
                  // wrapper above (they must work after focus Tabs onto the
                  // rows); this handler owns only submission.
                  onkeydown={(event: KeyboardEvent) => {
                    if (event.key === 'Enter' && !this.#composing) {
                      event.preventDefault()
                      // Trim only detects a blank draft; the Host gets the
                      // original text — a real directory name may end in
                      // whitespace, and trimming would list its sibling.
                      if (this.#pathDraft !== null && this.#pathDraft.trim() !== '') {
                        // Success will unmount the still-focused input; park
                        // focus on the returning crumb edit zone (a failure
                        // keeps the editor, so the flag waits until close).
                        this.#refocusEditZone = true
                        // The submitted path owns the view now: a debounce
                        // timer still pending from these keystrokes would
                        // otherwise supersede this navigation and land the
                        // draft's parent directory instead.
                        this.#previewSuspended = true
                        this.#navigate(this.#pathDraft)
                      }
                    }
                  }}
                />
              )}
          </div>
        </div>
        <div class={css.content ?? ''}>
          <div class={css.millerRow ?? ''} data-miller-row>
            {parent !== null && (
              <LevelColumn
                entries={parent.entries}
                selectedPath={selected?.path ?? null}
                busy={parentInert}
                onPick={(entry) => { this.#select(entry) }}
                showHidden={showHidden}
                filterPrefix={child === null ? typedPrefix : null}
                pathEditing={draftPending}
              />
            )}
            {twoPane && <span class={css.divider ?? ''} />}
            {twoPane && child !== null && (
              <LevelColumn
                entries={child.entries}
                selectedPath={null}
                busy={parentInert}
                onPick={(entry) => { this.#advance(entry) }}
                showHidden={showHidden}
                filterPrefix={typedPrefix}
                pathEditing={draftPending}
              />
            )}
          </div>
          {loading && slowScan
              && <div class={clsx(css.status, css.loadingFloat)} role="status">{t('browser.loading')}</div>}
          {/* The backend bounds a level at its complete-result limit; say so
              * whenever a visible pane was cut instead of letting the tail of a
              * huge directory go silently missing. The note describes the panes
              * on screen, so an in-flight scan leaves it alone — hiding it while
              * the stale view still shows the cut level would shift the columns
              * on every navigation away from it. */}
          {(parent?.truncated === true || child?.truncated === true)
              && <div class={css.status ?? ''} role="status">{t('browser.truncated')}</div>}
          {error !== null && <div class={css.error ?? ''} role="alert">{error}</div>}
        </div>
        <div class={css.footerBar ?? ''}>
          <Button
            variant="outline"
            icon={<IconPlusOutline16 size={14} />}
            disabled={parent === null || loading || parentInert || draftPending}
            onclick={() => {
              this.#folderDraft = ''
              this.#createError = null
              this.#render()
            }}
          >
            {t('browser.newFolder')}
          </Button>
          <button
            type="button"
            class={clsx(css.showHiddenToggle, showHidden && css.showHiddenToggleActive)}
            aria-pressed={String(showHidden)}
            disabled={parentInert}
            // The toggle composes with the path editor (dot-led prefixes and
            // this filter interleave): while editing, don't steal focus, so
            // toggling never blur-cancels a draft mid-thought. Outside editing
            // it keeps native focus behavior.
            onmousedown={draftPending ? (event: MouseEvent) => { event.preventDefault() } : null}
            onclick={() => { this.#showHidden = !this.#showHidden; this.#render() }}
          >
            {t('browser.showHidden')}
            {/* Trailing check (Menu's selected vocabulary): the label never
                * shifts when the pressed state toggles. */}
            {showHidden && <IconCheckOutline16 size={14} />}
          </button>
          <span class={css.footerGap ?? ''} />
          <Button variant="outline" class={clsx(css.footerAction)} disabled={parentInert} onclick={onClose}>{t('browser.cancel')}</Button>
          <Button
            variant="primary"
            class={clsx(css.footerAction)}
            disabled={targetPath === null || loading || parentInert || draftPending}
            /* v8 ignore next -- narrowing guard: Open disables while no target exists. */
            onclick={() => { if (targetPath !== null) props.onOpen(targetPath) }}
          >
            {t('browser.open')}
          </Button>
        </div>
      </div>
    )
    /* Nested create dialog (figma 813:23278): names one folder inside the target. */
    const createBody = (
      <div class={css.createBody ?? ''}>
        <h3 class={css.createTitle ?? ''}>{t('browser.newFolder')}</h3>
        <p class={css.createIn ?? ''}>{t('browser.createIn', { name: targetName })}</p>
        <input
          class={css.createInput ?? ''}
          value={folderDraft ?? ''}
          aria-label={t('browser.folderName')}
          placeholder={t('browser.untitledFolder')}
          autofocus
          disabled={creatingFolder}
          oncompositionstart={compositionOn}
          oncompositionend={compositionOff}
          onchange={(event: Event) => { this.#folderDraft = (event.target as HTMLInputElement).value; this.#render() }}
          onkeydown={(event: KeyboardEvent) => {
            if (event.key === 'Enter' && !this.#composing) {
              event.preventDefault()
              this.#confirmCreate()
            }
            if (event.key === 'Escape') {
              event.stopPropagation()
              if (!this.#creatingFolder) { this.#folderDraft = null; this.#render() }
            }
          }}
        />
        {createError !== null && <div class={css.error ?? ''} role="alert">{createError}</div>}
        <div class={css.createActions ?? ''}>
          <Button variant="outline" disabled={creatingFolder} onclick={() => { this.#folderDraft = null; this.#render() }}>{t('browser.cancel')}</Button>
          <Button
            variant="primary"
            disabled={creatingFolder || folderDraft === null || folderDraft.trim() === ''}
            onclick={() => { this.#confirmCreate() }}
          >
            {t('browser.create')}
          </Button>
        </div>
      </div>
    )

    // Both dsh-modal elements self-mount to document.body (Toast/Modal's
    // pattern) and own their subtree; #render() never diffs into `this`
    // directly for this component. Held refs mean the same two elements get
    // updated in place across renders rather than recreated.
    this.#outerModal = renderModal(this.#outerModal, {
      open,
      onClose: () => { if (folderDraft === null && !busy) onClose() },
      title: t('browser.title'),
      className: clsx(css.dialog),
      headless: true,
      children: outerBody,
    })
    this.#createModal = renderModal(this.#createModal, {
      open: folderDraft !== null,
      onClose: () => { if (!creatingFolder) { this.#folderDraft = null; this.#render() } },
      title: t('browser.newFolder'),
      className: clsx(css.createDialog),
      headless: true,
      children: createBody,
    })
    applyDiff(this, <span style="display:none" />)

    const outerModal = this.#outerModal
    // Deep ancestry overflows the trail; keep its tail (the current directory
    // and the edit zone beside it) in view whenever the chain changes.
    const trail = outerModal.querySelector<HTMLElement>('[data-crumb-trail]')
    if (trail !== null) trail.scrollLeft = trail.scrollWidth
    // On viewports too narrow for both fixed panes the Miller row scrolls;
    // whenever a child preview lands, pin it into view the way the crumb tail
    // pins — otherwise descent is unreachable on a phone-width window.
    if (child !== null) {
      const row = outerModal.querySelector<HTMLElement>('[data-miller-row]')
      if (row !== null) row.scrollLeft = row.scrollWidth
    }
    // Every editor exit that would drop focus to body re-parks it after
    // commit, so keyboard traversal stays inside the dialog (the Modal has no
    // focus trap): a pick lands on the selection's row — aria-current in the
    // freshly rendered left pane, which survives even a right-pane advance
    // replacing the picked button's column — while Enter and an input-focused
    // Escape land on the crumb edit zone that replaces the input.
    if (this.#refocusPathInput) {
      this.#refocusPathInput = false
      // Only when the swap actually dropped focus to body: focus the operator
      // still holds (the input itself, a surviving row) stays theirs.
      if (document.activeElement === document.body) outerModal.querySelector<HTMLInputElement>('[data-path-input]')?.focus()
    }
    if (pathDraft === null) {
      if (this.#refocusPick) {
        this.#refocusPick = false
        this.#refocusEditZone = false
        const rowHost = outerModal.querySelector('[data-miller-row]')
        /* v8 ignore next -- narrowing guard: the miller row is mounted whenever a pick just committed. */
        if (rowHost !== null) {
          const row = rowHost.querySelector<HTMLButtonElement>('button[aria-current="true"]')
          /* v8 ignore next -- narrowing guard: the pick that set the flag just rendered its aria-current row. */
          row?.focus()
        }
      } else if (this.#refocusEditZone) {
        this.#refocusEditZone = false
        // Re-park only when the close actually dropped focus to body; focus
        // the user parked elsewhere (a surviving row) stays theirs.
        if (document.activeElement === document.body) {
          outerModal.querySelector<HTMLButtonElement>('[data-edit-zone]')?.focus()
        }
      }
    }
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-directory-browser') === undefined) {
  customElements.define('dsh-directory-browser', DshDirectoryBrowser)
}

/**
 * Convenience wrapper preserving the original function-component call shape:
 * creates (or reuses) the `dsh-directory-browser` element, sets props, and
 * returns it cast to `JSX.Element` for a `<DirectoryBrowser .../>` call site
 * (mirrors ui-primitives' `Modal`/`Toast` convenience-wrapper pattern). The
 * element self-mounts nowhere special — the flow occupant returns it as a
 * normal vdom child, unlike Toast/Modal's document.body attachment.
 */
export function DirectoryBrowser(props: DirectoryBrowserProps): JSX.Element {
  const el = document.createElement('dsh-directory-browser') as DshDirectoryBrowser
  el.setProps(props)
  return el as unknown as JSX.Element
}
