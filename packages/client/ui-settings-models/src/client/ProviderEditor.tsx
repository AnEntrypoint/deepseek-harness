/**
 * One provider's editor card, hand-written per adapter family: the primary
 * field is a single write-only **API key** input (the page never asks for an
 * environment-variable name — a typed key stores through `credentials.set`
 * under the profile's reference, deriving `<ROUTE>_API_KEY` when the profile
 * has none. The pi-ai profile records that derivation as `apiKeyEnv` only when
 * a key is entered; a blank key materializes a reference-free profile for
 * provider-native authentication);
 * the collapsed 自定义设置 area carries the per-family extras (`baseURL` for
 * both families, DeepSeek's id/name/context-window model catalog, and the
 * display name and wire protocol of a pi-ai route the adapter does not ship —
 * the two fields the create card asked that route for, editable here for the
 * same reason).
 * Reasoning effort is deliberately absent: it is a per-MODEL capability, and
 * the models under one provider disagree about it, so a provider-scoped
 * control can only be set to a value some of them reject. The composer's
 * model picker offers each model its own levels; `settings.yaml` keeps the
 * profile field for a deployment that knows its route. Everything else stays
 * owned by `settings.yaml`. Profile edits land as minimal `settings.mutate`
 * path ops against the stored section — the card names only the fields it can
 * see instead of rebuilding the whole subtree from a partial descriptor.
 *
 * Converted from a React hooks component to a webjsx custom element: every
 * useState becomes an instance field, the credential-describe useEffect
 * becomes connectedCallback/disconnectedCallback (the `stale` guard becomes
 * an epoch counter), and useMemo becomes a plain recompute cached behind a
 * last-inputs identity check. Re-render is an explicit applyDiff(this, vdom)
 * call (Toast.tsx's pattern).
 */

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import type { CredentialView, IApiClient, SettingsNamespaceView, SettingsPathOpView } from '@deepseek-ai/dsh-api-remotes/client'
import type { SchemaNode } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DeepSeekModelsEditor, modelDrafts, validateDeepSeekModels,
} from './DeepSeekModelsEditor.tsx'
import { apiKeyFailure } from './apiKey.ts'
import { EditorFooter } from './EditorFooter.tsx'
import { ModelListEditor } from './ModelListEditor.tsx'
import { deriveKeyRef, messageOf, protocolChoices } from './store.ts'
import type { SettingsSchemaOperations } from './schema-operations.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Per-adapter-family curated field sets (unknown namespaces get the hint alone). */
type EditorLayout = 'deepseek' | 'pi-ai' | 'unknown'

/** The public DeepSeek endpoint shown as the deepseek base-URL placeholder. */
const DEEPSEEK_PUBLIC_BASE_URL = 'https://api.deepseek.com'

/** Props of {@link ProviderEditor}. */
export interface ProviderEditorProps {
  /** Provider route id. */
  provider: string
  /** Display name for the card title. */
  displayName: string
  /** Hide the title row (the add card renders its own provider select). */
  hideTitle?: boolean
  /**
   * Whether the adapter reports this route as hand-declared — absent from its
   * installed catalog. Such a route carries its own wire protocol, chosen when
   * it was created and editable here for the same reason; a catalog route's
   * models each carry theirs, so a route-level protocol there could only
   * override every one of them and the card does not offer it.
   */
  declared?: boolean
  /** The owning namespace view (schema, layers, secrets). */
  namespace: SettingsNamespaceView
  /** Settings-owned synchronous schema and immutable path operations. */
  schema: SettingsSchemaOperations
  /** Path from the section root to this provider's profile. */
  settingsPath: readonly string[]
  /** Wire faces for writes and for interrogating a provider endpoint. */
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable writes (read-only settings provider). */
  readOnly: boolean
  /** Render only the credential field and actions, without provider settings. */
  credentialOnly?: boolean
  /** Require a newly entered credential before this editor can submit. */
  credentialRequired?: boolean
  /** Give the credential field initial focus when this editor mounts. */
  autoFocusCredential?: boolean
  /** Override the dismiss action copy. */
  cancelLabel?: keyof typeof en
  /** Override the idle commit action copy. */
  submitLabel?: keyof typeof en
  /** Override the in-flight commit action copy. */
  submitBusyLabel?: keyof typeof en
  /** Close the editor; `changed` reports whether an Apply committed. */
  onClose: (changed: boolean) => void
}

/** A user-section subtree as a plain draft object (absent → empty). */
function draftAt(
  schema: SettingsSchemaOperations,
  namespace: SettingsNamespaceView,
  path: readonly string[],
): Record<string, unknown> {
  const subtree = schema.getPath(namespace.user, path)
  if (typeof subtree !== 'object' || subtree === null || Array.isArray(subtree)) return {}
  return structuredClone(subtree) as Record<string, unknown>
}

/**
 * The minimal path ops carrying `after` over `before`, both as the card sees
 * them. Only keys the card observed are named; fields absent from both sides
 * produce no op, which is why edits are path-addressed rather than a rebuilt
 * section.
 * @param base - path of the edited subtree inside the user section.
 * @param before - the subtree as loaded, or undefined when it is new.
 * @param after - the subtree as edited.
 * @returns ordered set/unset ops; empty when nothing changed.
 */
export function pathOps(
  base: readonly string[],
  before: unknown,
  after: Record<string, unknown>,
): SettingsPathOpView[] {
  const previous = typeof before === 'object' && before !== null && !Array.isArray(before)
    ? before as Record<string, unknown>
    : {}
  const ops: SettingsPathOpView[] = []
  for (const [key, value] of Object.entries(after)) {
    if (JSON.stringify(previous[key]) === JSON.stringify(value)) continue
    ops.push({ op: 'set', path: [...base, key], value })
  }
  for (const key of Object.keys(previous)) {
    if (!(key in after)) ops.push({ op: 'unset', path: [...base, key] })
  }
  return ops
}

/** The editor layout the owning namespace selects. */
function layoutOf(ns: string): EditorLayout {
  if (ns === 'llm-deepseek') return 'deepseek'
  if (ns === 'llm-pi-ai') return 'pi-ai'
  return 'unknown'
}

/** The credential reference this profile resolves keys through. */
function refFor(
  schema: SettingsSchemaOperations,
  namespace: SettingsNamespaceView,
  path: readonly string[],
  provider: string,
): string {
  const profile = schema.getPath(namespace.value, path)
  const named = typeof profile === 'object' && profile !== null
    ? (profile as { apiKeyEnv?: unknown }).apiKeyEnv
    : undefined
  return typeof named === 'string' && named.length > 0 ? named : deriveKeyRef(provider)
}

const DEFAULT_PROPS: ProviderEditorProps = {
  provider: '',
  displayName: '',
  namespace: {} as SettingsNamespaceView,
  schema: {} as SettingsSchemaOperations,
  settingsPath: [],
  api: {} as Pick<IApiClient, 'settings' | 'credentials' | 'llm'>,
  t: key => key,
  readOnly: false,
  onClose: () => {},
}

/** One provider's editing card, as a webjsx custom element. */
export class DshProviderEditor extends HTMLElement {
  #props: ProviderEditorProps = DEFAULT_PROPS
  #draft: Record<string, unknown> = {}
  #keyDraft = ''
  #keyState: CredentialView | undefined = undefined
  #busy = false
  #failure: string | undefined = undefined
  // A settings success advances both retry baselines immediately. Keeping the
  // derived fields in the draft prevents a pushed namespace refresh from
  // turning them into deletions when the following credential write is retried.
  #committedOriginal: unknown = undefined
  #expectedRevision = 0
  #credentialEpoch = 0
  #lastNamespaceSchema: unknown = undefined
  #root: SchemaNode | undefined = undefined

  setProps(props: ProviderEditorProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    const { schema, namespace, settingsPath } = this.#props
    this.#draft = draftAt(schema, namespace, settingsPath)
    this.#committedOriginal = schema.getPath(namespace.user, settingsPath)
    this.#expectedRevision = namespace.revision
    this.#loadKeyState()
    this.#render()
  }

  disconnectedCallback(): void {
    this.#credentialEpoch += 1
  }

  #loadKeyState(): void {
    const { api, schema, namespace, settingsPath, provider } = this.#props
    const keyRef = refFor(schema, namespace, settingsPath, provider)
    const epoch = ++this.#credentialEpoch
    this.#keyState = undefined
    // The key state is a placeholder hint, not a precondition for editing:
    // neither a business rejection nor a transport failure may reach the
    // browser as an unhandled rejection, so the card simply renders without
    // the "already configured" hint.
    void api.credentials.describe({ refs: [keyRef] }).then(
      (response) => {
        if (epoch !== this.#credentialEpoch || !response.result.ok) return
        this.#keyState = response.result.value.credentials[keyRef]
        this.#render()
      },
      () => undefined,
    )
  }

  #stringAt(source: unknown, key: string): string | undefined {
    const value = this.#props.schema.getPath(source, [key])
    return typeof value === 'string' && value.trim().length > 0 ? value : undefined
  }

  #setField(key: string, next: string | undefined): void {
    const { schema } = this.#props
    // A value of nothing but whitespace is cleared, not stored: `stringAt`
    // already reports it as absent, so the field would otherwise render empty
    // while the draft still carried the spaces into `settings.yaml`, where
    // both adapters would accept that non-empty string as a real value.
    const value = next === undefined || next.trim().length === 0 ? undefined : next
    this.#draft = value === undefined
      ? schema.deletePath(this.#draft, [key])
      : schema.setPath(this.#draft, [key], value)
  }

  /**
   * The write for this card, or a failure message. Every edit travels as
   * path ops against the STORED section: the draft comes from the redacted
   * descriptor, so a wholesale replace rebuilt from it could delete fields
   * outside the card. Ops name only the fields this card can see.
   */
  async #applyOnce(): Promise<string | undefined> {
    const { schema, namespace, settingsPath, api, provider, t } = this.#props
    const ns = namespace.ns
    const layout = layoutOf(namespace.ns)
    const keyRef = refFor(schema, namespace, settingsPath, provider)
    const fallback = schema.getPath(namespace.value, settingsPath)
    const keyValue = this.#keyDraft.trim()
    // A pi-ai profile names the conventional reference only when this page is
    // about to store a key. Otherwise the provider keeps its native auth path.
    const next = layout === 'pi-ai' && this.#stringAt(this.#draft, 'apiKeyEnv') === undefined
      && this.#stringAt(fallback, 'apiKeyEnv') === undefined && keyValue.length > 0
      ? schema.setPath(this.#draft, ['apiKeyEnv'], keyRef)
      : this.#draft
    const root = this.#root ?? schema.rehydrate(namespace.schema)
    const node = schema.nodeAtPath(root, settingsPath)
    if (this.#props.credentialOnly !== true) {
      // The same checker gates the submit button, so a card cannot reach this
      // with a bad row; it stays because the schema check below would refuse
      // the write with a message naming a path instead of the row, and because
      // nothing but this function decides what is written.
      const failure = validateDeepSeekModels(schema.getPath(next, ['models']))
      /* v8 ignore next 3 -- unreachable from the card: the same failure disables submit */
      if (failure !== undefined) {
        return `${t('model')} ${String(failure.index + 1)}: ${t(failure.key)}`
      }
    }
    /* v8 ignore next -- apply is only reachable from the rendered card, which required a resolved node */
    if (this.#props.credentialOnly !== true && node !== undefined && settingsPath.length === 0) {
      const sectionError = schema.validate(node, next)
      if (sectionError !== undefined) return sectionError
    }
    const materializesNativeProfile = layout === 'pi-ai'
      && fallback === undefined
      && this.#committedOriginal === undefined
      && Object.keys(next).length === 0
    const ops: SettingsPathOpView[] = this.#props.credentialOnly === true
      ? []
      : materializesNativeProfile
        ? [{ op: 'set', path: [...settingsPath], value: {} }]
        : pathOps(settingsPath, this.#committedOriginal, next)
    if (ops.length > 0) {
      const response = await api.settings.mutate({ ns, ops, expectedRevision: this.#expectedRevision })
      if (!response.result.ok) {
        return response.result.error.code === 'settings-conflict'
          ? t('conflict')
          : response.result.error.message
      }
      this.#committedOriginal = schema.getPath(response.result.value.user, settingsPath)
      this.#expectedRevision = response.result.value.revision
      this.#draft = next
    }
    if (keyValue.length > 0) {
      const stored = await api.credentials.set({ ref: keyRef, value: keyValue })
      if (!stored.result.ok) return stored.result.error.message
    }
    this.#keyDraft = ''
    return undefined
  }

  async #apply(): Promise<void> {
    this.#busy = true
    this.#failure = undefined
    this.#render()
    try {
      const failure = await this.#applyOnce()
      if (failure !== undefined) {
        this.#failure = failure
        return
      }
      this.#props.onClose(true)
    } catch (error) {
      // A transport failure (disconnect, a request the host refuses) rejects
      // rather than answering; without this the card would stay busy forever
      // with no error shown.
      this.#failure = messageOf(error)
    } finally {
      this.#busy = false
      this.#render()
    }
  }

  /**
   * The catalog beneath the user layer: what the composition entry pinned, or
   * else the schema default that `resolve` would supply. The effective value
   * cannot answer this — it still carries the stored override until the unset
   * is applied, so reading it would echo that override straight back the
   * moment reset drops it, leaving the rows unchanged until a reload.
   */
  #inheritedModels(): unknown {
    const { schema, namespace, settingsPath } = this.#props
    const pinned = schema.getPath(namespace.base, [...settingsPath, 'models'])
    const root = this.#root ?? schema.rehydrate(namespace.schema)
    return pinned ?? (schema.nodeAtPath(root, [...settingsPath, 'models']) as
      { meta: { default: unknown } } | undefined)?.meta.default
  }

  /**
   * The curated fields of one known adapter family. The family arrives
   * narrowed so the per-family branches below are total: an unknown namespace
   * renders the hint instead and never reaches this body.
   */
  #curatedFields(family: 'deepseek' | 'pi-ai'): VNode {
    const props = this.#props
    const { schema, namespace, settingsPath, t } = props
    const disabled = props.readOnly || this.#busy
    const fallback = schema.getPath(namespace.value, settingsPath)
    const protocols = family === 'pi-ai' ? protocolChoices(namespace, schema) : []
    const probeApi = this.#stringAt(this.#draft, 'api') ?? this.#stringAt(fallback, 'api')
    const keyLocked = this.#keyState?.writable === false
    // What a hand-declared route names for itself and nothing else can supply.
    // A whole-section `llm-deepseek` profile is a composition fact with no
    // per-route identity for its schema to carry, hence the family test.
    const ownsIdentity = family === 'pi-ai' && props.declared === true
    const customModels = schema.getPath(this.#draft, ['models'])
    const modelsOverridden = schema.hasPath(this.#draft, ['models'])
    const models = modelDrafts(modelsOverridden ? customModels : this.#inheritedModels())
    const defaultContextWindow = schema.getPath(fallback, ['defaultContextWindow'])
    const defaultMaxTokens = schema.getPath(fallback, ['maxTokens'])
    const keyPlaceholder = keyLocked
      ? t('keyEnvLocked')
      : this.#keyState?.configured === true && props.credentialRequired !== true
        ? t('keyStored')
        : family === 'pi-ai' ? t('keyPlaceholderNative') : t('keyPlaceholder')
    const keyFailure = apiKeyFailure(this.#keyDraft)
    const keyValue = this.#keyDraft.trim()
    const credentialRequiredFailure = props.credentialRequired === true
      && this.#keyDraft.length > 0 && keyValue.length === 0
      ? 'keyRequired' as const
      : undefined
    const shownKeyFailure = credentialRequiredFailure ?? keyFailure
    const probeBaseURL = this.#stringAt(this.#draft, 'baseURL') ?? this.#stringAt(fallback, 'baseURL')
    const probe = {
      settingsNs: namespace.ns,
      // Naming the route lets an adapter that already describes it answer from
      // its own registry — better metadata, no network call, no endpoint needed.
      provider: props.provider,
      ...probeBaseURL === undefined ? {} : { baseURL: probeBaseURL },
      ...probeApi === undefined ? {} : { api: probeApi },
      ...keyValue.length === 0 ? {} : { apiKey: keyValue },
    }
    /** What both family editors take: the rows, whose layer owns them, and the two writes. */
    const catalogProps = {
      models,
      overridden: modelsOverridden,
      t,
      disabled,
      onChange: (next: Record<string, unknown>[]) => {
        this.#draft = schema.setPath(this.#draft, ['models'], next)
        this.#render()
      },
      onReset: () => {
        this.#draft = schema.deletePath(this.#draft, ['models'])
        this.#render()
      },
    }
    return (
      <>
        <div class={styles['field'] ?? ''}>
          <span class={styles['fieldLabel'] ?? ''}>{t('keyInput')}</span>
          <input
            class={styles['input'] ?? ''}
            type="password"
            autocomplete="off"
            value={this.#keyDraft}
            placeholder={keyPlaceholder}
            aria-label={t('keyInput')}
            aria-invalid={shownKeyFailure !== undefined}
            required={props.credentialRequired === true}
            autofocus={props.autoFocusCredential === true}
            disabled={disabled || keyLocked}
            onchange={(event: Event) => { this.#keyDraft = (event.target as HTMLInputElement).value; this.#render() }}
          />
          {shownKeyFailure === undefined ? null : <p class={styles['error'] ?? ''}>{t(shownKeyFailure)}</p>}
        </div>
        {props.credentialOnly === true ? null : <details class={styles['customized'] ?? ''}>
          <summary class={styles['customizedSummary'] ?? ''}>{t('customized')}</summary>
          <div class={styles['customizedBody'] ?? ''}>
            {/* The name and the protocol are the create card's two remaining
                profile fields; a route the adapter ships defaults both from
                its catalog entry and neither belongs on its card. */}
            {ownsIdentity
              ? (
                <div class={styles['field'] ?? ''}>
                  <span class={styles['fieldLabel'] ?? ''}>{t('customDisplayName')}</span>
                  <input
                    class={styles['input'] ?? ''}
                    type="text"
                    value={this.#stringAt(this.#draft, 'displayName') ?? ''}
                    // What this route is called the moment the field is
                    // cleared, which is the layer beneath the one this field
                    // edits: a `cordis.yml` may pin a name for a route the
                    // catalog does not ship, and only when nothing does is
                    // the answer the route id. Reading the effective value
                    // instead would echo the stored override back as the
                    // thing clearing restores.
                    placeholder={this.#stringAt(schema.getPath(namespace.base, settingsPath), 'displayName')
                      ?? props.provider}
                    aria-label={t('customDisplayName')}
                    disabled={disabled}
                    onchange={(event: Event) => { this.#setField('displayName', (event.target as HTMLInputElement).value); this.#render() }}
                  />
                </div>
              )
              : null}
            <div class={styles['field'] ?? ''}>
              <span class={styles['fieldLabel'] ?? ''}>{t('baseUrl')}</span>
              <input
                class={styles['input'] ?? ''}
                type="text"
                value={this.#stringAt(this.#draft, 'baseURL') ?? ''}
                placeholder={family === 'deepseek'
                  ? DEEPSEEK_PUBLIC_BASE_URL
                  : this.#stringAt(fallback, 'baseURL') ?? t('baseUrlDefault')}
                aria-label={t('baseUrl')}
                disabled={disabled}
                onchange={(event: Event) => {
                  const value = (event.target as HTMLInputElement).value
                  this.#setField('baseURL', value === '' ? undefined : value)
                  this.#render()
                }}
              />
            </div>
            {/* The protocol sits beside the endpoint it describes, as it does
                on the create card. */}
            {ownsIdentity
              ? (
                <div class={styles['field'] ?? ''}>
                  <span class={styles['fieldLabel'] ?? ''}>{t('customApi')}</span>
                  <select
                    class={`${styles['input'] ?? ''} ${styles['selectInput'] ?? ''}`}
                    value={probeApi ?? ''}
                    aria-label={t('customApi')}
                    disabled={disabled}
                    onchange={(event: Event) => { this.#setField('api', (event.target as HTMLSelectElement).value); this.#render() }}
                  >
                    {/* A profile naming no protocol — hand-written into
                        settings.yaml with no model to need one — selects
                        nothing rather than reading as if it had picked the
                        first choice. The option is named because a screen
                        reader announces it either way, and an empty one is
                        announced as a choice with no identity. */}
                    {probeApi === undefined ? <option value="">{t('customApiUnset')}</option> : null}
                    {protocols.map(choice => <option key={choice} value={choice}>{choice}</option>)}
                  </select>
                </div>
              )
              : null}
            {/* Both families edit the same rows through the same contract; only
                the extras differ — DeepSeek's inherited capacities, pi-ai's
                endpoint interrogation. */}
            {family === 'deepseek'
              ? (
                <DeepSeekModelsEditor
                  {...catalogProps}
                  defaultContextWindow={typeof defaultContextWindow === 'number'
                    ? defaultContextWindow
                    : undefined}
                  defaultMaxTokens={typeof defaultMaxTokens === 'number' ? defaultMaxTokens : undefined}
                />
              )
              : <ModelListEditor {...catalogProps} probe={probe} probeBlocked={keyFailure} api={props.api} />}
          </div>
        </details>}
      </>
    ) as unknown as VNode
  }

  #render(): void {
    const props = this.#props
    const { schema, namespace, settingsPath, t } = props
    if (this.#lastNamespaceSchema !== namespace.schema) {
      this.#lastNamespaceSchema = namespace.schema
      this.#root = schema.rehydrate(namespace.schema)
    }
    const root = this.#root ?? schema.rehydrate(namespace.schema)
    const node = schema.nodeAtPath(root, settingsPath)
    const layout = layoutOf(namespace.ns)
    const modelFailure = validateDeepSeekModels(schema.getPath(this.#draft, ['models']))

    if (node === undefined) {
      // A directory entry addressing a position its schema cannot resolve is a
      // host-side inconsistency; showing it beats a blank card.
      applyDiff(this, <p class={styles['error'] ?? ''}>{`${props.provider}: unresolvable settings path`}</p>)
      return
    }

    const disabled = props.readOnly || this.#busy
    const keyFailure = apiKeyFailure(this.#keyDraft)
    const keyValue = this.#keyDraft.trim()
    const credentialRequiredFailure = props.credentialRequired === true
      && this.#keyDraft.length > 0 && keyValue.length === 0
      ? 'keyRequired' as const
      : undefined
    const shownKeyFailure = credentialRequiredFailure ?? keyFailure

    const vdom = (
      <div class={props.credentialOnly === true ? styles['addBlock'] ?? '' : styles['editor'] ?? ''}>
        {props.hideTitle === true
          ? null
          : (
            <div class={styles['editorHeader'] ?? ''}>
              <span class={styles['editorTitle'] ?? ''}>{props.displayName}</span>
              {props.provider !== props.displayName
                ? <span class={styles['editorRoute'] ?? ''}>{props.provider}</span>
                : null}
            </div>
          )}
        {layout === 'unknown'
          ? <p class={styles['advancedHint'] ?? ''}>{`${t('advancedHint')} (${namespace.ns})`}</p>
          : this.#curatedFields(layout)}
        {this.#failure !== undefined ? <p class={styles['error'] ?? ''}>{this.#failure}</p> : null}
        {props.credentialOnly === true || modelFailure === undefined
          ? null
          : (
            <p class={styles['advancedHint'] ?? ''}>
              {`${t('model')} ${String(modelFailure.index + 1)}: ${t(modelFailure.key)}`}
            </p>
          )}
        <EditorFooter
          t={t}
          busy={this.#busy}
          submitDisabled={disabled || layout === 'unknown'
            || (props.credentialOnly !== true && modelFailure !== undefined)
            || shownKeyFailure !== undefined
            || (props.credentialRequired === true && keyValue.length === 0)}
          submitLabel={props.submitLabel ?? 'apply'}
          submitBusyLabel={props.submitBusyLabel ?? 'applying'}
          {...props.cancelLabel === undefined ? {} : { cancelLabel: props.cancelLabel }}
          onCancel={() => { props.onClose(false) }}
          onSubmit={() => { void this.#apply() }}
        />
      </div>
    ) as unknown as VNode
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-provider-editor') === undefined) {
  customElements.define('dsh-provider-editor', DshProviderEditor)
}

/**
 * Create (if needed) or update a ProviderEditor element in place.
 * @param el - an existing element to update, or null to create one.
 * @param props - see {@link ProviderEditorProps}.
 * @returns the element; keep it and pass it back in to update.
 */
export function renderProviderEditor(el: DshProviderEditor | null, props: ProviderEditorProps): DshProviderEditor {
  const target = el ?? document.createElement('dsh-provider-editor') as DshProviderEditor
  target.setProps(props)
  return target
}

/**
 * Render one provider's editing card.
 * @param props - the addressed profile plus wire faces and copy.
 * @returns the editor card, cast for JSX use (Modal.tsx's pattern).
 */
export function ProviderEditor(props: ProviderEditorProps): JSX.Element {
  return renderProviderEditor(null, props) as unknown as JSX.Element
}
