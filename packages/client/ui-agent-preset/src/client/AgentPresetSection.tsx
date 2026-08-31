/**
 * Agent-presets settings section: the roster as cards, a copy dialog as the
 * only way a preset is created, and a read-only viewer over the shipped
 * compositions.
 *
 * The browser edits no composition text — a shipped preset opens read-only to
 * be READ (it is the known-good composition a copy starts from), and a custom
 * preset is edited in its own files, which is what the location action leads
 * to. Deleting a preset leaves running sessions alone: a composition is
 * mounted once at session creation and nothing re-reads the file.
 *
 * Converted from a React hooks component to a webjsx custom element. The
 * `Modal`/`Tooltip` primitives are self-rendering custom elements, not plain
 * VNodes, so they are built once and retained (renderModal/renderTooltip),
 * then attached to the DOM directly rather than embedded in the `applyDiff`
 * vdom tree (Modal.tsx's and Tooltip.tsx's own doc: they are never diffed as
 * a child of the caller's own vdom).
 */

import { applyDiff } from 'webjsx'
import {
  Button, IconBrowseOutline16, IconCopyOutline16, IconFolderOpenOutline16, IconPlusOutline16, IconTrashOutline16,
  renderModal, renderTooltip,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { DshModal, DshTooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { draftBlocker, type AgentPresetSectionState } from './section-store.ts'
import { presetDisplayText, type AgentPresetSettingsKey } from './locales.ts'
import css from './AgentPresetSection.module.css'

/** Registration-side business face for the management section. */
export interface AgentPresetSectionInjected {
  hooks: {
    /** Page snapshot bound by the renderer as useAgentPresetSection. */
    agentPresetSection: SnapshotStore<AgentPresetSectionState>
  }
  /** Read the roster; called once when the section first renders. */
  load: () => Promise<void>
  /** Open one shipped preset's composition in the read-only viewer. */
  view: (id: string) => Promise<void>
  /** Close the read-only viewer. */
  closeView: () => void
  /** Open the copy dialog over one preset. */
  beginCopy: (from: string) => void
  /** Close the copy dialog, discarding the draft. */
  cancelCopy: () => void
  /** Name the preset the copy creates. */
  setCopyId: (id: string) => void
  /** Name the copy's display name. */
  setCopyName: (name: string) => void
  /** Submit the copy. */
  confirmCopy: () => Promise<void>
  /** Open one preset's directory, or reveal its path where there is no desktop. */
  openLocation: (id: string) => Promise<void>
  /**
   * Stage the self-referential preset and start a new session on it — the
   * guided way to author a preset, beside copying. Absent when the surface
   * is composed without the conversation flow to land the session in.
   */
  startCreatorDraft?: () => void
  /** Ask for delete confirmation, or dismiss it with null. */
  confirmDelete: (id: string | null) => void
  /** Delete the preset awaiting confirmation. */
  remove: () => Promise<void>
  /** Make one preset the default for sessions created later. */
  makeDefault: (id: string) => Promise<void>
}

/** Full component props. */
export type AgentPresetSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'settings.agentPreset'>
  & InjectFace<AgentPresetSectionInjected>

/** Locale lookup shape shared by the section and its sub-pieces. */
type Translate = (key: AgentPresetSettingsKey) => string

/** Agent-presets settings section, as a custom element. */
export class DshAgentPresetSection extends HTMLElement {
  #props: AgentPresetSectionProps | null = null
  #loaded = false
  #copyModal: DshModal | null = null
  #viewModal: DshModal | null = null
  #deleteModal: DshModal | null = null
  #descriptionTooltips = new Map<string, DshTooltip>()
  #descriptionTruncated = new Map<string, boolean>()
  #descriptionResizeObservers = new Map<string, ResizeObserver>()

  /** Set/replace props and re-render; the owning renderer calls this on every update. */
  setProps(props: AgentPresetSectionProps): void {
    this.#props = props
    if (!this.#loaded) {
      this.#loaded = true
      void props.load()
    }
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  disconnectedCallback(): void {
    for (const observer of this.#descriptionResizeObservers.values()) observer.disconnect()
    this.#descriptionResizeObservers.clear()
  }

  /**
   * Measure whether one card's clamped description is actually cut off, and
   * keep a ResizeObserver on it (the card width follows the settings pane,
   * which resizes with the window) — the webjsx replacement for the React
   * version's per-row `useLayoutEffect` + `useState`.
   * @param rowId - the preset row this description belongs to.
   * @param el - the measured description span, once mounted.
   */
  #trackDescription(rowId: string, el: HTMLSpanElement | null): void {
    if (el === null) return
    const measure = (): void => {
      const next = el.scrollHeight > el.clientHeight
      if (this.#descriptionTruncated.get(rowId) === next) return
      this.#descriptionTruncated.set(rowId, next)
      this.#render()
    }
    measure()
    if (this.#descriptionResizeObservers.has(rowId)) return
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    this.#descriptionResizeObservers.set(rowId, observer)
  }

  /**
   * Build (or update) the tooltip-wrapped description for one card, mounted
   * directly after its placeholder span (Tooltip is a self-rendering custom
   * element, not a plain VNode — see the module doc).
   * @param rowId - the preset row this description belongs to.
   * @param text - the description text, already localized.
   */
  #renderDescription(rowId: string, text: string): DshTooltip {
    const truncated = this.#descriptionTruncated.get(rowId) ?? false
    const existing = this.#descriptionTooltips.get(rowId) ?? null
    const tooltip = renderTooltip(existing, {
      // Capped near the card's own width: the default half-viewport bubble
      // would spill a description out of the settings dialog and across the
      // app behind it.
      label: text,
      side: 'bottom',
      delayMs: 400,
      disabled: !truncated,
      maxWidth: 360,
      children: (
        // The empty title stops the card body's native tooltip from climbing
        // to this span: a cut-off description answers with one bubble, not two.
        <span
          class={css.cardDesc ?? ''}
          title=""
          ref={(node) => { this.#trackDescription(rowId, node as HTMLSpanElement | null) }}
        >
          {text}
        </span>
      ),
    })
    this.#descriptionTooltips.set(rowId, tooltip)
    return tooltip
  }

  #renderCopyModal(state: AgentPresetSectionState, t: Translate): void {
    const props = this.#props
    if (props === null) return
    const draft = state.copy
    const blocker = draft === null ? undefined : draftBlocker(draft, state.rows)
    const message = draft === null ? null : draft.error ?? (blocker === undefined ? null : t(blocker))
    const source = draft === null ? undefined : state.rows.find(row => row.id === draft.from)
    const sourceTitle = source === undefined ? draft?.fromTitle : presetDisplayText(source, t).name

    this.#copyModal = renderModal(this.#copyModal, {
      open: draft !== null,
      onClose: () => { props.cancelCopy() },
      title: draft === null ? t('copyTitle') : `${t('copyTitle')} · ${t('copyOf')} ${sourceTitle}`,
      closeLabel: t('close'),
      description: t('copyIntro'),
      className: css.dialog ?? '',
      footer: [
        <Button
          variant="outline"
          disabled={draft?.saving === true}
          onclick={() => { props.cancelCopy() }}
        >
          {t('cancel')}
        </Button>,
        <Button
          disabled={draft === null || draft.saving || blocker !== undefined}
          onclick={() => { void props.confirmCopy() }}
        >
          {draft?.saving === true ? t('creating') : t('create')}
        </Button>,
      ],
      children: draft === null
        ? null
        : (
          <div class={css.dialogFields ?? ''}>
            <label class={css.field ?? ''}>
              <span class={css.fieldLabel ?? ''}>{t('presetId')}</span>
              <input
                class={css.input ?? ''}
                value={draft.id}
                autofocus
                spellcheck="false"
                placeholder={t('presetIdPlaceholder')}
                oninput={(event: Event) => { props.setCopyId((event.target as HTMLInputElement).value) }}
              />
            </label>
            <label class={css.field ?? ''}>
              <span class={css.fieldLabel ?? ''}>{t('displayName')}</span>
              <input
                class={css.input ?? ''}
                value={draft.name}
                spellcheck="false"
                placeholder={t('displayNamePlaceholder')}
                oninput={(event: Event) => { props.setCopyName((event.target as HTMLInputElement).value) }}
              />
            </label>
            {message === null ? null : <p class={css.error ?? ''} role="alert">{message}</p>}
          </div>
        ),
    })
  }

  #renderViewModal(state: AgentPresetSectionState, t: Translate): void {
    const props = this.#props
    if (props === null) return
    const viewedId = state.view?.id
    const viewedRow = viewedId === undefined ? undefined : state.rows.find(row => row.id === viewedId)
    const viewedTitle = state.view === null
      ? ''
      : viewedRow === undefined ? state.view.title : presetDisplayText(viewedRow, t).name

    this.#viewModal = renderModal(this.#viewModal, {
      open: state.view !== null,
      onClose: () => { props.closeView() },
      title: state.view === null ? '' : `${t('view')} · ${viewedTitle}`,
      closeLabel: t('close'),
      description: t('composition'),
      className: css.dialog ?? '',
      footer: (
        <Button variant="outline" autofocus onclick={() => { props.closeView() }}>
          {t('close')}
        </Button>
      ),
      children: state.view === null
        ? null
        : <pre class={css.viewerCode ?? ''}>{state.view.content}</pre>,
    })
  }

  #renderDeleteModal(state: AgentPresetSectionState, t: Translate): void {
    const props = this.#props
    if (props === null) return
    this.#deleteModal = renderModal(this.#deleteModal, {
      open: state.pendingDelete !== null,
      onClose: () => { props.confirmDelete(null) },
      title: t('deleteTitle'),
      closeLabel: t('close'),
      description: t('deleteDescription'),
      className: css.deleteDialog ?? '',
      footer: [
        <Button
          variant="outline"
          autofocus
          disabled={state.deleting}
          onclick={() => { props.confirmDelete(null) }}
        >
          {t('cancel')}
        </Button>,
        <Button
          variant="outline"
          class={css.deleteConfirm}
          disabled={state.deleting}
          onclick={() => { void props.remove() }}
        >
          {state.deleting ? t('deleting') : t('deleteConfirm')}
        </Button>,
      ],
    })
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const { useAgentPresetSection, t } = props
    const state = useAgentPresetSection(snapshot => snapshot)

    // A deployment that composes no presets has nothing to manage: every
    // session shares the host composition and the page would be an empty list.
    if (state.status === 'unavailable') {
      applyDiff(this, <span style="display:none" />)
      return
    }
    if (state.status === 'error') {
      /* v8 ignore next -- an error status always carries text; the fallback satisfies the nullable type */
      const detail = state.error ?? ''
      const vdom = (
        <div class={css.section ?? ''}>
          <p class={css.error ?? ''} role="alert">{`${t('error')} ${detail}`}</p>
          <button type="button" class={css.secondaryButton ?? ''} onclick={() => { void props.load() }}>
            {t('retry')}
          </button>
        </div>
      )
      applyDiff(this, vdom)
      return
    }

    /* The guided alternative to copying: the self-referential preset can
       read this very composition and author a new one in conversation.
       Offered only where that preset is actually on the roster and a
       session can be landed; without a writable root the draft could
       never be discovered, so the reason rides the disabled button. */
    const creatorButton = props.startCreatorDraft !== undefined && state.rows.some(row => row.id === 'cordis')
      ? (
        <button
          type="button"
          class={css.creatorButton ?? ''}
          disabled={!state.authorable}
          title={state.authorable ? '' : t('duplicateUnavailable')}
          onclick={() => {
            props.startCreatorDraft?.()
            props.close()
          }}
        >
          {/* Same glyph as the Models page's add affordances. */}
          <IconPlusOutline16 size={14} />
          {t('creatorDraft')}
        </button>
      )
      : null

    const seenRowIds = new Set<string>()

    const vdom = (
      <div class={css.section ?? ''}>
        <h2 class={css.title ?? ''}>{t('nav')}</h2>
        <p class={css.intro ?? ''}>{t('sectionIntro')}</p>
        {state.error === null ? null : <p class={css.error ?? ''} role="alert">{state.error}</p>}
        {([['system', t('builtInGroup')], ['user', t('customGroup')]] as const).map(([trust, heading]) => {
          const group = state.rows
            .filter(row => row.trust === trust)
            .map(row => ({ row, text: presetDisplayText(row, t) }))
          // The custom group is where a preset of one's own will appear, so it
          // stays on screen even while empty: heading plus the creator entry.
          const tail = trust === 'user' ? creatorButton : null
          if (group.length === 0 && tail === null) return null
          return (
            <section key={trust} class={css.group ?? ''}>
              <h3 class={css.groupHead ?? ''}>{heading}</h3>
              {group.length === 0 ? null : (
                <ul class={css.cards ?? ''}>
                  {group.map(({ row, text }) => {
                    seenRowIds.add(row.id)
                    return (
                      <li
                        key={row.id}
                        class={row.broken !== undefined
                          ? `${css.card} ${css.cardBroken}`
                          : row.isDefault ? `${css.card} ${css.cardActive}` : css.card}
                      >
                        {/* The card body IS the control: picking a preset is the
                          common act, so it should not hide behind a small button.
                          The action row sits outside it — nesting buttons is
                          invalid, and these act on the card rather than select it.
                          A broken preset cannot compose a session, so its body is
                          disabled and the card says why instead of offering it. */}
                        <button
                          type="button"
                          class={css.cardMain ?? ''}
                          aria-pressed={String(row.isDefault)}
                          disabled={row.isDefault || row.broken !== undefined}
                          // Without this the name is the whole card read aloud —
                          // title, badge, description, id.
                          aria-label={`${row.broken !== undefined ? t('brokenBadge') : row.isDefault ? t('inUse') : t('setDefault')}: ${text.name}`}
                          title={row.broken ?? (row.isDefault ? t('inUse') : t('setDefault'))}
                          onclick={() => { void props.makeDefault(row.id) }}
                        >
                          <span class={css.cardHead ?? ''}>
                            <span class={css.cardName ?? ''}>{text.name}</span>
                            {row.broken !== undefined
                              ? <span class={css.brokenBadge ?? ''}>{t('brokenBadge')}</span>
                              : null}
                            <span class={css.badge ?? ''}>
                              {row.trust === 'user' ? t('userTrust') : t('builtIn')}
                            </span>
                            {row.isDefault ? <span class={css.inUse ?? ''}>{t('inUse')}</span> : null}
                          </span>
                          <span data-desc-slot={row.id} />
                          {row.broken === undefined
                            ? null
                            : <span class={css.cardBrokenReason ?? ''} role="alert">{row.broken}</span>}
                          <code class={css.cardId ?? ''}>{row.id}</code>
                        </button>
                        <div class={css.cardFoot ?? ''}>
                          {/* Shipped presets are the compositions a copy starts
                            from, so READING one is the point; a custom preset is
                            edited in its files instead, which the location action
                            leads to. A broken shipped preset has no readable
                            composition to offer, so its viewer is withheld; a
                            broken custom one keeps the location action — the
                            files are where it gets fixed. */}
                          {row.trust === 'system'
                            ? row.broken === undefined
                              ? (
                                <button
                                  type="button"
                                  class={css.iconButton ?? ''}
                                  data-tip={t('view')}
                                  aria-label={`${t('view')}: ${text.name}`}
                                  onclick={() => { void props.view(row.id) }}
                                >
                                  <IconBrowseOutline16 />
                                </button>
                              )
                              : null
                            : (
                              <button
                                type="button"
                                class={css.iconButton ?? ''}
                                data-tip={state.hasDocument ? t('openLocation') : t('showLocation')}
                                aria-label={`${state.hasDocument ? t('openLocation') : t('showLocation')}: ${text.name}`}
                                onclick={() => { void props.openLocation(row.id) }}
                              >
                                <IconFolderOpenOutline16 />
                              </button>
                            )}
                          <button
                            type="button"
                            class={css.iconButton ?? ''}
                            disabled={!state.authorable || row.broken !== undefined}
                            data-tip={row.broken !== undefined
                              ? t('brokenNoCopy')
                              : state.authorable ? t('duplicate') : t('duplicateUnavailable')}
                            aria-label={`${t('duplicate')}: ${text.name}`}
                            onclick={() => { props.beginCopy(row.id) }}
                          >
                            <IconCopyOutline16 />
                          </button>
                          {row.trust === 'user'
                            ? (
                              <button
                                type="button"
                                class={`${css.iconButton} ${css.iconDanger}`}
                                data-tip={t('delete')}
                                aria-label={`${t('delete')}: ${text.name}`}
                                onclick={() => { props.confirmDelete(row.id) }}
                              >
                                <IconTrashOutline16 />
                              </button>
                            )
                            : null}
                        </div>
                        {state.revealedPaths[row.id] === undefined
                          ? null
                          : (
                            <p class={css.revealedPath ?? ''}>
                              <span class={css.revealedPathLabel ?? ''}>{t('revealedPathLabel')}</span>
                              <code>{state.revealedPaths[row.id]}</code>
                            </p>
                          )}
                      </li>
                    )
                  })}
                </ul>
              )}
              {tail}
            </section>
          )
        })}
        <span data-copy-modal-slot="" />
        <span data-view-modal-slot="" />
        <span data-delete-modal-slot="" />
      </div>
    )
    applyDiff(this, vdom)

    // Drop tooltip state for rows no longer on the roster.
    for (const rowId of Array.from(this.#descriptionTooltips.keys())) {
      if (seenRowIds.has(rowId)) continue
      this.#descriptionTooltips.delete(rowId)
      this.#descriptionTruncated.delete(rowId)
      this.#descriptionResizeObservers.get(rowId)?.disconnect()
      this.#descriptionResizeObservers.delete(rowId)
    }

    // Mount the tooltip-wrapped descriptions (self-rendering custom elements,
    // never diffed in as vdom children — see the module doc).
    for (const slot of Array.from(this.querySelectorAll<HTMLElement>('[data-desc-slot]'))) {
      const rowId = slot.getAttribute('data-desc-slot')
      if (rowId === null) continue
      const row = state.rows.find(candidate => candidate.id === rowId)
      if (row === undefined) continue
      const text = presetDisplayText(row, t).description ?? t('noDescription')
      slot.replaceWith(this.#renderDescription(rowId, text))
    }

    this.#renderCopyModal(state, t)
    this.#renderViewModal(state, t)
    this.#renderDeleteModal(state, t)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-agent-preset-section') === undefined) {
  customElements.define('dsh-agent-preset-section', DshAgentPresetSection)
}

/**
 * Render the Agent presets section content column.
 * @param props - composed slot props.
 * @returns the section element.
 */
export function AgentPresetSection(props: AgentPresetSectionProps): JSX.Element {
  const el = document.createElement('dsh-agent-preset-section') as DshAgentPresetSection
  el.setProps(props)
  return el as unknown as JSX.Element
}
