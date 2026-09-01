/**
 * Models settings section: the provider rows joined from the configurable
 * directory, settings namespaces, and credential states, with one editor
 * card at a time. Rows expose only confirmed API-key state through accessible
 * solid configured or missing dots. A whole-section provider without a
 * configured key renders as its open setup card instead of a row, but only in
 * the first-run posture — no provider on the page can serve requests yet — and
 * only until the user closes that card; the add flow is a card carrying the
 * dormant-provider select. Each card kind owns its own open state, so closing
 * one never discards a draft in another. Every mutation writes through the
 * wire, while a provider removal first requires confirmation; the page
 * re-renders from pushed invalidations or the post-apply reload.
 *
 * Converted from a React hooks component to a webjsx custom element: every
 * useState becomes an instance field, and re-render is an explicit
 * applyDiff(this, vdom) call (Toast.tsx's pattern). `ModelsSection` itself
 * stays a plain function (its only job was reading injected props and
 * choosing null-vs-render, no state of its own); the stateful body (the old
 * `Loaded` component) becomes the `DshModelsSectionLoaded` custom element.
 */

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, IconPlusOutline16, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import { CustomProviderCard } from './CustomProviderCard.tsx'
import { deriveKeyRef, messageOf, protocolChoices, providerUsable } from './store.ts'
import type { ModelsSettingsStore, ProviderRow } from './store.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import { ProviderEditor, type ProviderEditorProps } from './ProviderEditor.tsx'
import type { en } from './locales.ts'
import styles from './ModelsSection.css.ts'

/** Injected dependencies of {@link ModelsSection} (slot `inject`). */
export interface ModelsSectionInjected {
  /** The page store (loaded on mount, refreshed on pushed invalidations). */
  controller: ModelsSettingsStore
  hooks: {
    /** Page snapshot bound by the UI renderer as useSnapshot. */
    snapshot: ModelsSettingsStore['store']
  }
  /** Wire faces the editor writes through. */
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
  /** Settings schema and immutable path callbacks. */
  schema: SettingsSchemaOperations
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Props delivered by the slot outlet: the inject face spread flat (the
 * renderer erases the share boundary at the render call).
 */
export type ModelsSectionProps = Partial<InjectFace<ModelsSectionInjected>>

type ModelsSectionFace = InjectFace<ModelsSectionInjected>

/** Provider identity shared by row actions and confirmation copy. */
export interface ProviderIdentity {
  /** Stable provider route id. */
  provider: string
  /** Human-facing provider name. */
  displayName: string
}

/** One existing row or dormant directory entry addressed by an editor action. */
interface EditorTarget extends ProviderIdentity {
  settingsNs: string
  settingsPath: readonly string[]
  /** Writable credential identified under this page's conventional reference. */
  credentialRef?: string
  /** The adapter reports this route as one it does not ship (see {@link ProviderEditorProps.declared}). */
  declared?: boolean
}

/** Values that vary around the shared provider-editor rendering. */
interface ProviderEditorRenderProps extends Pick<
  ProviderEditorProps,
  'namespace' | 'schema' | 'api' | 't' | 'readOnly' | 'onClose'
> {
  target: EditorTarget
}

/** Render an editor for either the setup posture or an expanded provider row. */
function renderProviderEditorCard({ target, ...props }: ProviderEditorRenderProps): VNode {
  return (
    <ProviderEditor
      provider={target.provider}
      displayName={target.displayName}
      settingsPath={target.settingsPath}
      {...target.declared === true ? { declared: true } : {}}
      {...props}
    />
  ) as unknown as VNode
}

/**
 * Remove one user-added provider and its page-managed credential. Credential
 * removal comes first so a second-step failure leaves the provider row visible
 * and the whole operation safely retryable; both unsets are idempotent.
 * The settings removal names the profile rather than rebuilding its whole
 * namespace from a partial view.
 * @param api - settings and credential wire faces.
 * @param controller - the page store to refresh.
 * @param target - the provider's settings address and optional managed credential.
 * @returns the failure message, or undefined once the write and reload landed.
 */
export async function removeProviderProfile(
  api: Pick<IApiClient, 'settings' | 'credentials'>,
  controller: ModelsSettingsStore,
  target: { settingsNs: string; settingsPath: readonly string[]; credentialRef?: string },
): Promise<string | undefined> {
  try {
    if (target.credentialRef !== undefined) {
      const credential = await api.credentials.unset({ ref: target.credentialRef })
      if (!credential.result.ok) return credential.result.error.message
    }
    const response = await api.settings.mutate({
      ns: target.settingsNs,
      ops: [{ op: 'unset', path: [...target.settingsPath] }],
    })
    if (!response.result.ok) return response.result.error.message
  } catch (error) {
    // The transport rejected rather than answering; the caller must be able
    // to retry the idempotent operation instead of the row silently staying.
    return messageOf(error)
  }
  await controller.load()
  return undefined
}

/**
 * Whether a whole-section provider still needs its first key: an unconfigured
 * credential opens the setup card instead of showing a row. This is the
 * first-run posture alone — a user who can already reach some provider gets an
 * ordinary row with the missing-key dot, since nothing here is blocking them.
 * @param row - the joined provider row.
 * @param anyUsable - whether any joined row can already serve requests.
 * @returns whether to render the setup card.
 */
export function needsSetup(row: ProviderRow, anyUsable: boolean): boolean {
  if (anyUsable) return false
  if (row.entry.settingsPath.length > 0) return false
  return row.credential?.configured !== true
}

function targetOf(row: ProviderRow): EditorTarget {
  const managedRef = deriveKeyRef(row.entry.provider)
  const credentialRef = row.apiKeyEnv === managedRef
    && row.credential?.configured === true
    && row.credential.writable
    ? managedRef
    : undefined
  return {
    provider: row.entry.provider,
    displayName: row.entry.displayName,
    settingsNs: row.entry.settingsNs,
    settingsPath: row.entry.settingsPath,
    ...credentialRef === undefined ? {} : { credentialRef },
    // Absent is not "shipped": an adapter that answers nothing leaves the
    // route-level fields only a declared route owns off the card, exactly as
    // it leaves the custom tag off the row.
    ...row.entry.declared === true ? { declared: true } : {},
  }
}

/** Stable visible and accessible identity for one provider target. */
export function providerTargetLabel(target: ProviderIdentity): string {
  return target.provider === target.displayName
    ? target.provider
    : `${target.displayName} (${target.provider})`
}

/** Replace the one provider placeholder in localized destructive-action copy. */
export function providerCopy(template: string, target: ProviderIdentity): string {
  return template.replace('{provider}', () => providerTargetLabel(target))
}

/**
 * Render the Models section content column.
 * @param props - slot-delivered injected dependencies.
 * @returns the section, or null while the shell has not injected yet.
 */
export function ModelsSection(props: ModelsSectionProps): JSX.Element | null {
  const { controller, useSnapshot, api, schema, t } = props
  if (
    controller === undefined || useSnapshot === undefined || api === undefined
    || schema === undefined || t === undefined
  ) return null
  return renderModelsSectionLoaded(null, { controller, useSnapshot, api, schema, t }) as unknown as JSX.Element
}

const DEFAULT_LOADED_PROPS = {} as ModelsSectionFace

/** The stateful body of the Models section, as a webjsx custom element. */
export class DshModelsSectionLoaded extends HTMLElement {
  #injected: ModelsSectionFace = DEFAULT_LOADED_PROPS
  #editing: EditorTarget | undefined = undefined
  #adding = false
  #deleteTarget: EditorTarget | undefined = undefined
  #deleting = false
  #deleteFailure: string | undefined = undefined
  #savedTarget: ProviderIdentity | undefined = undefined
  #declaring = false
  #dismissedSetup: ReadonlySet<string> = new Set()

  setProps(injected: ModelsSectionFace): void {
    this.#injected = injected
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  #announceSaved(target: ProviderIdentity): void {
    // Announced only once the refreshed directory is in the snapshot the
    // notice reads its name from: an apply can rename the route, and the
    // target captured when the card opened still carries the old name.
    void this.#injected.controller.load().then(() => { this.#savedTarget = target; this.#render() })
  }

  #closeEditor(changed: boolean, target: ProviderIdentity): void {
    this.#editing = undefined
    this.#adding = false
    this.#declaring = false
    if (changed) this.#announceSaved(target)
    this.#render()
  }

  /**
   * Close a setup card, which owns none of the state above: the row-editor,
   * add, and declare cards each own one of those, so clearing them here would
   * discard a draft the user opened beside this card. Dismissal is this card's
   * own — the provider falls back to an ordinary row for the rest of the
   * session, and reopens through Edit.
   */
  #closeSetup(changed: boolean, target: ProviderIdentity): void {
    this.#dismissedSetup = new Set([...this.#dismissedSetup, target.provider])
    if (changed) this.#announceSaved(target)
    this.#render()
  }

  #closeDelete(): void {
    if (this.#deleting) return
    this.#deleteTarget = undefined
    this.#deleteFailure = undefined
    this.#render()
  }

  #confirmDelete(): void {
    const { api, controller } = this.#injected
    /* v8 ignore next -- the action only renders with a target and is disabled while a deletion is pending */
    if (this.#deleteTarget === undefined || this.#deleting) return
    this.#deleting = true
    this.#deleteFailure = undefined
    this.#render()
    void removeProviderProfile(api, controller, this.#deleteTarget)
      .then((failure) => {
        if (failure !== undefined) {
          this.#deleteFailure = failure
          return
        }
        this.#deleteTarget = undefined
      })
      .finally(() => { this.#deleting = false; this.#render() })
  }

  #render(): void {
    const injected = this.#injected
    const { controller, api, schema, t } = injected
    const state = injected.useSnapshot(snapshot => snapshot)

    if (state.status === 'idle') void controller.load()
    if (state.status === 'error') {
      /* v8 ignore next -- an error status always carries text; the fallback satisfies the nullable type */
      const errorText = state.error ?? ''
      applyDiff(this, (
        <div class={styles['section'] ?? ''}>
          <p class={styles['error'] ?? ''}>{`${t('loadFailed')}: ${errorText}`}</p>
          <button type="button" class={styles['secondaryButton'] ?? ''} onclick={() => { void controller.load() }}>
            {t('retry')}
          </button>
        </div>
      ) as unknown as VNode)
      return
    }

    // The saved provider as the directory currently names it. The route id is
    // what the apply cannot change, so it is what the notice is keyed by; a row
    // the same apply removed keeps the captured identity, since nothing newer
    // exists to name it with.
    const savedRow = this.#savedTarget === undefined
      ? undefined
      : state.rows.find(row => row.entry.provider === this.#savedTarget?.provider)
    const savedIdentity = savedRow === undefined
      ? this.#savedTarget
      : { provider: savedRow.entry.provider, displayName: savedRow.entry.displayName }

    // One fact decides both first-run postures on this page and the onboarding
    // step: whether the user already has a provider to talk to.
    const anyUsable = state.rows.some(providerUsable)
    const configured = state.rows.filter(row => row.configured)
    const addable = state.rows.filter(row => !row.configured && row.entry.settingsNs !== '')
    const addTarget = this.#adding ? this.#editing : undefined
    const addNamespace = addTarget === undefined ? undefined : state.namespaces.get(addTarget.settingsNs)
    // Hand-declared routes live in the pi-ai namespace, which is also the only
    // one whose schema names the protocols one may speak; without it mounted
    // there is nothing to declare and the entry point stays disabled.
    const protocols = protocolChoices(state.namespaces.get('llm-pi-ai'), schema)

    const vdom = (
      <div class={styles['section'] ?? ''}>
        <h2 class={styles['title'] ?? ''}>{t('title')}</h2>
        <p class={styles['intro'] ?? ''}>{t('intro')}</p>
        {!state.writable && state.status === 'ready' ? <p class={styles['notice'] ?? ''}>{t('readOnly')}</p> : null}
        {savedIdentity === undefined
          ? null
          : (
            <p class={styles['savedNotice'] ?? ''} role="status" aria-live="polite">
              {providerCopy(t('savedProvider'), savedIdentity)}
            </p>
          )}
        <ul class={styles['rows'] ?? ''}>
          {configured.map((row) => {
            const target = targetOf(row)
            const namespace = state.namespaces.get(target.settingsNs)
            /* v8 ignore next -- the join marks a row configured only when its namespace resolved */
            if (namespace === undefined) return null
            if (needsSetup(row, anyUsable) && !this.#dismissedSetup.has(row.entry.provider)) {
              // First-run posture: the provider exists but has no key — the
              // setup card IS its presence on the page, until the user closes it.
              return (
                <li key={row.entry.provider} class={styles['setupCard'] ?? ''}>
                  {renderProviderEditorCard({
                    target,
                    namespace,
                    schema,
                    api,
                    t,
                    readOnly: !state.writable,
                    onClose: (changed) => { this.#closeSetup(changed, target) },
                  })}
                </li>
              )
            }
            const open = !this.#adding && this.#editing?.provider === row.entry.provider
            const credentialConfigured = row.credential?.configured === true
            const credentialMissing = !credentialConfigured
              && row.apiKeyEnv !== undefined
              && row.credential?.configured === false
            return (
              <li key={row.entry.provider} class={styles['rowCard'] ?? ''}>
                <div class={styles['rowHead'] ?? ''}>
                  <span class={styles['rowIdentity'] ?? ''}>
                    <span class={styles['rowName'] ?? ''}>{row.entry.displayName}</span>
                    {/* Only the adapter can tell a hand-declared route from a
                        shipped one it also has a stored profile for, so the tag
                        follows its answer and stays off when it gives none. */}
                    {row.entry.declared === true
                      ? <span class={styles['rowTag'] ?? ''}>{t('customTag')}</span>
                      : null}
                    {credentialConfigured
                      ? (
                        <span
                          class={`${styles['credentialDot'] ?? ''} ${styles['credentialDotConfigured'] ?? ''}`}
                          role="img"
                          aria-label={t('credentialConfigured')}
                          title={t('credentialConfigured')}
                        />
                      )
                      : credentialMissing
                        ? (
                          <span
                            class={`${styles['credentialDot'] ?? ''} ${styles['credentialDotMissing'] ?? ''}`}
                            role="img"
                            aria-label={t('credentialMissing')}
                            title={t('credentialMissing')}
                          />
                        )
                        : null}
                  </span>
                  <span class={styles['rowActions'] ?? ''}>
                    <button
                      type="button"
                      class={styles['secondaryButton'] ?? ''}
                      aria-label={providerCopy(t('editProvider'), target)}
                      onclick={() => {
                        this.#savedTarget = undefined
                        // One card at a time: leaving `declaring` set would show
                        // the create card beside this editor, and closing either
                        // one discards the other's draft.
                        this.#declaring = false
                        this.#adding = false
                        this.#editing = open ? undefined : target
                        this.#render()
                      }}
                    >
                      {t('edit')}
                    </button>
                    {row.removable
                      ? (
                        <button
                          type="button"
                          class={styles['dangerButton'] ?? ''}
                          aria-label={providerCopy(t('removeProvider'), target)}
                          disabled={!state.writable}
                          onclick={() => {
                            this.#savedTarget = undefined
                            this.#deleteFailure = undefined
                            this.#deleteTarget = target
                            this.#render()
                          }}
                        >
                          {t('remove')}
                        </button>
                      )
                      : null}
                  </span>
                </div>
                {open
                  ? renderProviderEditorCard({
                    target,
                    namespace,
                    schema,
                    api,
                    t,
                    readOnly: !state.writable,
                    onClose: (changed) => { this.#closeEditor(changed, target) },
                  })
                  : null}
              </li>
            )
          })}
        </ul>
        <div class={styles['addBlock'] ?? ''}>
          {addTarget !== undefined && addNamespace !== undefined
            ? (
              <div class={styles['addCard'] ?? ''}>
                <div class={styles['field'] ?? ''}>
                  <span class={styles['fieldLabel'] ?? ''}>{t('provider')}</span>
                  <select
                    class={`${styles['input'] ?? ''} ${styles['selectInput'] ?? ''}`}
                    value={addTarget.provider}
                    aria-label={t('provider')}
                    onchange={(event: Event) => {
                      const value = (event.target as HTMLSelectElement).value
                      const row = addable.find(candidate => candidate.entry.provider === value)
                      /* v8 ignore next -- the select only lists addable rows */
                      if (row === undefined) return
                      this.#editing = targetOf(row)
                      this.#render()
                    }}
                  >
                    {addable.map(row => (
                      <option key={row.entry.provider} value={row.entry.provider}>{row.entry.displayName}</option>
                    ))}
                  </select>
                </div>
                <ProviderEditor
                  key={addTarget.provider}
                  provider={addTarget.provider}
                  displayName={addTarget.displayName}
                  hideTitle
                  namespace={addNamespace}
                  schema={schema}
                  settingsPath={addTarget.settingsPath}
                  api={api}
                  t={t}
                  readOnly={!state.writable}
                  onClose={(changed) => { this.#closeEditor(changed, addTarget) }}
                />
              </div>
            )
            : this.#declaring
              ? (
                <div class={styles['addCard'] ?? ''}>
                  <CustomProviderCard
                    taken={state.rows.map(row => row.entry.provider)}
                    protocols={protocols}
                    /* v8 ignore next -- the card only opens from a button disabled without this namespace */
                    revision={state.namespaces.get('llm-pi-ai')?.revision ?? 0}
                    api={api}
                    t={t}
                    readOnly={!state.writable}
                    onClose={(changed) => {
                      this.#declaring = false
                      if (changed) void controller.load()
                      this.#render()
                    }}
                  />
                </div>
              )
              : (
                // One row for the two ways to gain a provider: adopt one the
                // adapter already knows, or declare one it does not. Side by side
                // and equal-width so they read as siblings and line up with the
                // rows above, rather than two pills of different lengths.
                <div class={styles['addActions'] ?? ''}>
                  <button
                    type="button"
                    class={styles['addButton'] ?? ''}
                    disabled={addable.length === 0 || !state.writable}
                    onclick={() => {
                      const first = addable[0]
                      /* v8 ignore next -- the button is disabled while nothing is addable */
                      if (first === undefined) return
                      this.#savedTarget = undefined
                      this.#declaring = false
                      this.#adding = true
                      this.#editing = targetOf(first)
                      this.#render()
                    }}
                  >
                    {/* Same glyph as the composer's attach button. */}
                    <IconPlusOutline16 size={14} />
                    {t('add')}
                  </button>
                  <button
                    type="button"
                    class={styles['addButton'] ?? ''}
                    disabled={protocols.length === 0 || !state.writable}
                    onclick={() => {
                      this.#savedTarget = undefined
                      this.#adding = false
                      this.#editing = undefined
                      this.#declaring = true
                      this.#render()
                    }}
                  >
                    <IconPlusOutline16 size={14} />
                    {t('customAdd')}
                  </button>
                </div>
              )}
        </div>
        <Modal
          open={this.#deleteTarget !== undefined}
          onClose={() => { this.#closeDelete() }}
          title={this.#deleteTarget === undefined ? '' : providerCopy(t('deleteTitle'), this.#deleteTarget)}
          closeLabel={t('close')}
          description={this.#deleteTarget === undefined
            ? ''
            : providerCopy(
              this.#deleteTarget.credentialRef === undefined
                ? t('deleteDescription')
                : t('deleteDescriptionWithCredential'),
              this.#deleteTarget,
            )}
          className={styles['deleteDialog'] as string}
          footer={(
            [
              <Button variant="outline" autoFocus disabled={this.#deleting} onclick={() => { this.#closeDelete() }}>
                {t('cancel')}
              </Button>,
              <Button
                variant="outline"
                class={styles['deleteConfirm']}
                disabled={this.#deleting}
                onclick={() => { this.#confirmDelete() }}
              >
                {this.#deleteTarget === undefined
                  ? ''
                  : providerCopy(this.#deleting ? t('deleting') : t('deleteConfirm'), this.#deleteTarget)}
              </Button>,
            ] as unknown as VNode
          )}
        >
          {this.#deleteFailure === undefined ? null : <p class={styles['error'] ?? ''}>{this.#deleteFailure}</p>}
        </Modal>
      </div>
    ) as unknown as VNode
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-models-section-loaded') === undefined) {
  customElements.define('dsh-models-section-loaded', DshModelsSectionLoaded)
}

/**
 * Create (if needed) or update the Models-section stateful body in place.
 * @param el - an existing element to update, or null to create one.
 * @param injected - the slot-delivered injected dependencies.
 * @returns the element; keep it and pass it back in to update.
 */
export function renderModelsSectionLoaded(
  el: DshModelsSectionLoaded | null,
  injected: ModelsSectionFace,
): DshModelsSectionLoaded {
  const target = el ?? document.createElement('dsh-models-section-loaded') as DshModelsSectionLoaded
  target.setProps(injected)
  return target
}
