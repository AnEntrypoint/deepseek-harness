/**
 * The card that declares a provider pi-ai does not ship — an OpenAI-compatible
 * gateway, a self-hosted server, or a provider newer than the installed
 * catalog.
 *
 * This is a create, not an edit, which is why it is its own card rather than
 * the provider editor with extra fields: the route id is being *chosen* here,
 * and the settings address does not exist until it is. One `settings.mutate`
 * sets the whole profile at `providers.<route>`; the key travels separately
 * through `credentials.set` under the reference the profile records, exactly as
 * an existing provider's key does.
 *
 * The three fields a hand-declared route cannot default — endpoint, protocol,
 * and at least one model — are required here rather than at load, so the
 * failure names the field while the user is still looking at it.
 *
 * There is deliberately no reasoning-effort control, here or on the editor
 * card: effort is a per-MODEL capability, and the models under one provider
 * disagree about it, so a provider-scoped control can only be set to a value
 * some of them reject. The composer's model picker offers each model its own
 * levels instead.
 *
 * Converted from a React hooks component to a webjsx custom element: every
 * useState becomes an instance field, and re-render is an explicit
 * applyDiff(this, vdom) call (Toast.tsx's pattern). The one-time-captured
 * `openedAt` (`useState(() => props.revision)`) becomes a field set only in
 * `connectedCallback`, mirroring the hook's mount-only capture.
 */

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import type { IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { apiKeyFailure } from './apiKey.ts'
import { EditorFooter } from './EditorFooter.tsx'
import { validateDeepSeekModels } from './DeepSeekModelsEditor.tsx'
import { ModelListEditor } from './ModelListEditor.tsx'
import type { ModelDraft } from './ModelListEditor.tsx'
import { deriveKeyRef, messageOf } from './store.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.css.ts'

/** The settings namespace a hand-declared provider is written into. */
const NS = 'llm-pi-ai'

/**
 * A route id usable as a settings key AND as the stem of a credential name.
 * The leading letter is the second half of that: `deriveKeyRef` uppercases the
 * id and replaces every non-alphanumeric run with `_`, and a credential
 * reference is a POSIX shell identifier, which cannot start with a digit. A
 * digit-leading id passes every check this card makes and then fails at the
 * credential seam with a raw regular expression the user cannot act on.
 */
const ROUTE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/

/** Props of {@link CustomProviderCard}. */
export interface CustomProviderCardProps {
  /** Route ids already declared, so the card refuses to shadow one. */
  taken: readonly string[]
  /** Wire protocols the adapter can serve, in the order it reports them. */
  protocols: readonly string[]
  /**
   * Revision of the `llm-pi-ai` user section this card opened at, sent with
   * the create so a route another tab declared meanwhile is a refusal rather
   * than a silent overwrite of its whole profile.
   */
  revision: number
  /** Wire faces for the write and for interrogating the endpoint. */
  api: Pick<IApiClient, 'settings' | 'credentials' | 'llm'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable writes (read-only settings provider). */
  readOnly: boolean
  /** Close the card; `changed` reports whether a provider was created. */
  onClose: (changed: boolean) => void
}

const DEFAULT_PROPS: CustomProviderCardProps = {
  taken: [],
  protocols: [],
  revision: 0,
  api: {} as Pick<IApiClient, 'settings' | 'credentials' | 'llm'>,
  t: key => key,
  readOnly: false,
  onClose: () => {},
}

/** The custom-provider creation card, as a webjsx custom element. */
export class DshCustomProviderCard extends HTMLElement {
  #props: CustomProviderCardProps = DEFAULT_PROPS
  // Captured on connect, like the original hook's lazy useState initializer:
  // the write must be judged against the section this card was drafted over,
  // not whatever it grew into meanwhile.
  #openedAt = 0
  #route = ''
  #displayName = ''
  #baseURL = ''
  #protocol = ''
  #keyDraft = ''
  #models: readonly ModelDraft[] = []
  #busy = false
  #failure: string | undefined = undefined
  /**
   * The profile write landed. Only the key write can still be outstanding, so
   * the fields that describe the provider are settled and the retry path is
   * the credential alone.
   */
  #committed = false

  setProps(props: CustomProviderCardProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#openedAt = this.#props.revision
    this.#protocol = this.#props.protocols[0] ?? ''
    this.#render()
  }

  /** Perform the create, returning a failure message or undefined. */
  async #createOnce(): Promise<string | undefined> {
    const { api } = this.#props
    const keyRef = deriveKeyRef(this.#route)
    const keyValue = this.#keyDraft.trim()
    const storesKey = keyValue.length > 0
    if (!this.#committed) {
      const profile = {
        ...this.#displayName.length === 0 ? {} : { displayName: this.#displayName },
        // The profile names the conventional reference only when this card is
        // about to store a key, matching the editor: a route declared with the
        // key left blank keeps its provider-native auth path (a credential
        // chain, ADC) instead of resolving a reference nothing ever sets.
        ...storesKey ? { apiKeyEnv: keyRef } : {},
        api: this.#protocol,
        baseURL: this.#baseURL,
        models: this.#models.map(model => ({ ...model })),
      }
      const response = await api.settings.mutate({
        ns: NS,
        ops: [{ op: 'set', path: ['providers', this.#route], value: profile }],
        // `taken` is a snapshot too, so the id check alone cannot see a route
        // declared after this card opened; the revision makes that race a
        // `settings-conflict` instead of a write over the other profile.
        expectedRevision: this.#openedAt,
      })
      if (!response.result.ok) return response.result.error.message
      // The provider now exists. A retry after the key write below fails must
      // not re-run this mutate: the revision it holds is the one this write
      // just superseded, so the Host would answer `settings-conflict` and the
      // key could never be stored from this card at all.
      this.#committed = true
    }
    if (storesKey) {
      const stored = await api.credentials.set({ ref: keyRef, value: keyValue })
      // The profile landed; saying the key did not is the only honest report,
      // and the retry above now goes straight back to this write.
      if (!stored.result.ok) return stored.result.error.message
    }
    return undefined
  }

  async #create(): Promise<void> {
    this.#busy = true
    this.#failure = undefined
    this.#render()
    try {
      const outcome = await this.#createOnce()
      if (outcome !== undefined) {
        this.#failure = outcome
        return
      }
      this.#props.onClose(true)
    } catch (error) {
      // A transport failure rejects rather than answering; without this the
      // card would stay busy with nothing shown.
      this.#failure = messageOf(error)
    } finally {
      this.#busy = false
      this.#render()
    }
  }

  #render(): void {
    const props = this.#props
    const t = props.t
    const disabled = props.readOnly || this.#busy
    /** Everything but the key stops being editable once the provider exists. */
    const profileDisabled = disabled || this.#committed

    const routeInvalid = this.#route.length > 0 && !ROUTE_PATTERN.test(this.#route)
    const routeTaken = props.taken.includes(this.#route)
    // Rows are checked by the same per-row validator the editor cards use, so a
    // bad row is named by its position here too. Capacities have route-level
    // fallbacks; what a route cannot default is at least one model.
    const modelFailure = validateDeepSeekModels(this.#models)
    const keyFailure = apiKeyFailure(this.#keyDraft)
    // The typed key with paste whitespace removed. A blank field yields an empty
    // string, which the create path reads as "no key supplied" — a route may
    // legitimately authenticate through the provider's own ambient discovery.
    const keyValue = this.#keyDraft.trim()
    const ready = this.#route.length > 0 && !routeInvalid && !routeTaken
      && this.#baseURL.length > 0 && this.#models.length > 0 && modelFailure === undefined
      && keyFailure === undefined
    // The one blocked gate worth a line under the form. A satisfied card says
    // nothing at all rather than printing an empty paragraph.
    const hint = this.#failure !== undefined || ready
      // The key field prints its own failure directly beneath itself, so a card
      // blocked only by the key stays silent here rather than answering with the
      // next unmet gate — which is satisfied, and reads as a second, false fault.
      || keyFailure !== undefined
      // Same for the route id, and it must be tested rather than assumed: the
      // fallback arm below reads "no models yet", so an unmet route gate would
      // fall through to it and contradict the filled-in list right above.
      || this.#route.length === 0 || routeInvalid || routeTaken
      ? undefined
      : this.#baseURL.length === 0
        ? t('customNeedsBaseUrl')
        : modelFailure !== undefined
          ? `${t('model')} ${String(modelFailure.index + 1)}: ${t(modelFailure.key)}`
          : t('customNeedsModels')

    const vdom = (
      <div class={styles['editor'] ?? ''}>
        <div class={styles['editorHeader'] ?? ''}>
          <span class={styles['editorTitle'] ?? ''}>{t('customTitle')}</span>
        </div>
        <div class={styles['field'] ?? ''}>
          <span class={styles['fieldLabel'] ?? ''}>{t('customRoute')}</span>
          <input
            class={styles['input'] ?? ''}
            type="text"
            value={this.#route}
            placeholder="acme-gateway"
            aria-label={t('customRoute')}
            disabled={profileDisabled}
            onchange={(event: Event) => { this.#route = (event.target as HTMLInputElement).value; this.#render() }}
          />
        </div>
        {/* A rejected id reads as a fault, not as guidance — the same split the
            key field below already makes between its failure and its hint. */}
        {routeInvalid || routeTaken
          ? <p class={styles['error'] ?? ''}>{t(routeInvalid ? 'customRouteInvalid' : 'customRouteTaken')}</p>
          : <p class={styles['advancedHint'] ?? ''}>{t('customRouteHint')}</p>}
        <div class={styles['field'] ?? ''}>
          <span class={styles['fieldLabel'] ?? ''}>{t('customDisplayName')}</span>
          <input
            class={styles['input'] ?? ''}
            type="text"
            value={this.#displayName}
            placeholder={this.#route.length === 0 ? t('customDisplayName') : this.#route}
            aria-label={t('customDisplayName')}
            disabled={profileDisabled}
            onchange={(event: Event) => { this.#displayName = (event.target as HTMLInputElement).value; this.#render() }}
          />
        </div>
        <div class={styles['field'] ?? ''}>
          <span class={styles['fieldLabel'] ?? ''}>{t('baseUrl')}</span>
          <input
            class={styles['input'] ?? ''}
            type="text"
            value={this.#baseURL}
            placeholder="https://gateway.example/v1"
            aria-label={t('baseUrl')}
            disabled={profileDisabled}
            onchange={(event: Event) => { this.#baseURL = (event.target as HTMLInputElement).value; this.#render() }}
          />
        </div>
        <div class={styles['field'] ?? ''}>
          <span class={styles['fieldLabel'] ?? ''}>{t('customApi')}</span>
          <select
            class={`${styles['input'] ?? ''} ${styles['selectInput'] ?? ''}`}
            value={this.#protocol}
            aria-label={t('customApi')}
            disabled={profileDisabled}
            onchange={(event: Event) => { this.#protocol = (event.target as HTMLSelectElement).value; this.#render() }}
          >
            {props.protocols.map(choice => <option key={choice} value={choice}>{choice}</option>)}
          </select>
        </div>
        <div class={styles['field'] ?? ''}>
          <span class={styles['fieldLabel'] ?? ''}>{t('keyInput')}</span>
          <input
            class={styles['input'] ?? ''}
            type="password"
            autocomplete="off"
            value={this.#keyDraft}
            placeholder={t('keyPlaceholder')}
            aria-label={t('keyInput')}
            disabled={disabled}
            onchange={(event: Event) => { this.#keyDraft = (event.target as HTMLInputElement).value; this.#render() }}
          />
          {/* A create card has no stored key to keep, so the blank case says
              what a blank field means here instead: this route may authenticate
              through the provider's own ambient discovery or OAuth. */}
          {keyFailure === undefined
            ? null
            : <p class={styles['error'] ?? ''}>{t(keyFailure === 'keyBlank' ? 'keyBlankNew' : keyFailure)}</p>}
        </div>
        <ModelListEditor
          models={this.#models}
          onChange={(next) => { this.#models = next; this.#render() }}
          probe={{
            settingsNs: NS,
            baseURL: this.#baseURL,
            api: this.#protocol,
            ...keyValue.length === 0 ? {} : { apiKey: keyValue },
          }}
          probeBlocked={keyFailure === 'keyBlank' ? 'keyBlankNew' : keyFailure}
          api={props.api}
          t={t}
          disabled={profileDisabled}
        />
        {this.#failure !== undefined ? <p class={styles['error'] ?? ''}>{this.#failure}</p> : null}
        {/* Only the gates with something to say render; the route-id gate has its
            own field-level hint, so its blocked state would print an empty line. */}
        {hint === undefined ? null : <p class={styles['advancedHint'] ?? ''}>{hint}</p>}
        <EditorFooter
          t={t}
          busy={this.#busy}
          submitDisabled={disabled || !ready}
          submitLabel="create"
          submitBusyLabel="creating"
          onCancel={() => { props.onClose(this.#committed) }}
          onSubmit={() => { void this.#create() }}
        />
      </div>
    ) as unknown as VNode
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-custom-provider-card') === undefined) {
  customElements.define('dsh-custom-provider-card', DshCustomProviderCard)
}

/**
 * Create (if needed) or update a CustomProviderCard element in place.
 * @param el - an existing element to update, or null to create one.
 * @param props - see {@link CustomProviderCardProps}.
 * @returns the element; keep it and pass it back in to update.
 */
export function renderCustomProviderCard(
  el: DshCustomProviderCard | null,
  props: CustomProviderCardProps,
): DshCustomProviderCard {
  const target = el ?? document.createElement('dsh-custom-provider-card') as DshCustomProviderCard
  target.setProps(props)
  return target
}

/**
 * Render the custom-provider creation card.
 * @param props - existing routes, protocol choices, wire faces, and copy.
 * @returns the creation card, cast for JSX use (Modal.tsx's pattern).
 */
export function CustomProviderCard(props: CustomProviderCardProps): JSX.Element {
  return renderCustomProviderCard(null, props) as unknown as JSX.Element
}
