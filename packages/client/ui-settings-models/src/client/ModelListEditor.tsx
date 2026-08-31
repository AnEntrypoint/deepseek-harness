/**
 * The model list of one pi-ai provider profile, plus the action that asks the
 * provider what it serves.
 *
 * The list is the profile's `models` array as the card holds it: an empty list
 * means "serve this route's built-in catalog", and any entry replaces that
 * catalog, so a row is only ever added deliberately. Fetching asks the endpoint
 * **the form currently shows** — including a key typed but not yet saved — so
 * adding a provider is one pass instead of save-then-return; the reply is
 * candidates the user picks from, never configuration written behind them.
 *
 * A provider that cannot be interrogated (an unreachable endpoint, a protocol
 * with no readable listing) is not a dead end: the failure is shown next to the
 * rows the user can still fill in by hand.
 *
 * Converted from a React hooks component to a webjsx custom element: every
 * useState becomes an instance field, and re-render is an explicit
 * applyDiff(this, vdom) call (Toast.tsx's pattern).
 */

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import type { DiscoveredModelView, IApiClient } from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { formatCapacity, parseCapacity } from './DeepSeekModelsEditor.tsx'
import type { DeepSeekModelDraft } from './DeepSeekModelsEditor.tsx'
import { messageOf } from './store.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/**
 * One configured model row. Structurally open, exactly like the DeepSeek
 * catalog editor's rows: a profile field this card does not edit — one a future
 * schema adds, or one hand-written in `settings.yaml` — has to survive being
 * edited here rather than being dropped by a rebuild.
 */
export type ModelDraft = DeepSeekModelDraft

/** A row's text field, or the empty string when unset or not a string. */
function textOf(model: ModelDraft, key: string): string {
  const value = model[key]
  return typeof value === 'string' ? value : ''
}

/** A row's numeric field, or `undefined` when unset or not a number. */
function numberOf(model: ModelDraft, key: string): number | undefined {
  const value = model[key]
  return typeof value === 'number' ? value : undefined
}

/** What an interrogation needs, taken from the live form. */
export interface ProbeTarget {
  /** Settings namespace whose adapter family answers. */
  settingsNs: string
  /**
   * Route being edited, when the card edits one. An adapter that already
   * describes it answers from its own registry, so such a card can ask without
   * an endpoint at all.
   */
  provider?: string
  /** Endpoint as the form currently shows it. */
  baseURL?: string
  /** Wire protocol the form names, when it names one. */
  api?: string
  /** Key typed into the form and not yet stored, when there is one. */
  apiKey?: string
}

/** Props of {@link ModelListEditor}. */
export interface ModelListEditorProps {
  /** The rows as currently drafted. */
  models: readonly ModelDraft[]
  /** Whether the user layer currently owns the whole array; absent on a create. */
  overridden?: boolean
  /** Replace the drafted rows. */
  onChange: (models: ModelDraft[]) => void
  /** Remove the user-owned array and return to inheritance; absent on a create. */
  onReset?: () => void
  /** Endpoint facts for the fetch action. */
  probe: ProbeTarget
  /**
   * Copy key naming why the fetch action is unavailable, or `undefined` when
   * it is. The card owns this because the key it would send is judged there:
   * asking with a key the form has already refused spends a round trip to be
   * told what the field already says.
   */
  probeBlocked?: keyof typeof en | undefined
  /** Wire face the fetch action calls. */
  api: Pick<IApiClient, 'llm'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable every control (read-only deployment or a pending write). */
  disabled: boolean
}

/** Disclosure chevron; rotates to point down while its row is open. */
function IconChevron({ open }: { open: boolean }): JSX.Element {
  return (
    <svg
      width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden
      style={open ? 'transform: rotate(90deg); transition: transform 120ms ease' : 'transition: transform 120ms ease'}
    >
      <path d="M6 3.5L10.5 8L6 12.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  )
}

/** Removal glyph for one model row. */
function IconTrash(): JSX.Element {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M2.5 4h11M6.5 4V2.5h3V4M4 4l.7 9a1 1 0 001 .9h4.6a1 1 0 001-.9L12 4M6.5 6.8v4.4M9.5 6.8v4.4"
        stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"
      />
    </svg>
  )
}

/** The two token counts edited as K/M-suffixed text behind a row's disclosure. */
type CapacityField = 'contextWindow' | 'maxTokens'

/**
 * What an empty capacity field is worth, shown as its placeholder so a row left
 * blank does not read as a model with no capacity at all.
 *
 * The magnitudes are the adapter's own route-level fallbacks (`llm-pi-ai`'s
 * `defaultContextWindow` and `defaultMaxTokens`), spelled the way a person
 * would say them. They are a hint, not a mirror: this page counts `K` as 1000,
 * so typing `256K` stores 256000 while leaving the field blank keeps the
 * adapter's 262144. A deployment that overrides those defaults is not
 * reflected here — nothing on this page can read them.
 */
const CAPACITY_HINT: Readonly<Record<CapacityField, string>> = {
  contextWindow: '256K',
  maxTokens: '32K',
}

/**
 * Spell a stored count for a field that may be unset. The spelling itself is
 * {@link formatCapacity}, shared with the DeepSeek catalog editor so both
 * surfaces read and write one K/M vocabulary.
 * @param value - stored capacity, or `undefined` for an unset field.
 * @returns the field text, empty when unset.
 */
function capacitySpelling(value: number | undefined): string {
  return value === undefined ? '' : formatCapacity(value)
}

/** Adopt a candidate, keeping whatever capacities the provider disclosed. */
function adopt(candidate: DiscoveredModelView): ModelDraft {
  return {
    id: candidate.id,
    ...candidate.name === undefined ? {} : { name: candidate.name },
    ...candidate.contextWindow === undefined ? {} : { contextWindow: candidate.contextWindow },
    ...candidate.maxTokens === undefined ? {} : { maxTokens: candidate.maxTokens },
  }
}

const DEFAULT_PROPS: ModelListEditorProps = {
  models: [],
  onChange: () => {},
  probe: { settingsNs: '' },
  api: {} as Pick<IApiClient, 'llm'>,
  t: key => key,
  disabled: false,
}

/** The model-list editor with its fetch action, as a custom element. */
export class DshModelListEditor extends HTMLElement {
  #props: ModelListEditorProps = DEFAULT_PROPS
  #busy = false
  #failure: string | undefined = undefined
  #candidates: readonly DiscoveredModelView[] | undefined = undefined
  #picked: ReadonlySet<string> = new Set()
  // Rows carry an id and a name; capacities are the exception, so they stay
  // folded until asked for rather than crowding every row with four inputs.
  #expanded: ReadonlySet<number> = new Set()
  // Capacities are edited as text, so a field's keystrokes are held here rather
  // than re-derived from the parsed count on every change — that would rewrite
  // `1000` to `1K` mid-word. Unreadable text is kept past blur so the refusal
  // names a row the user can still see, which is why this is one entry PER
  // FIELD: a single buffer would be displaced by editing any other field, and
  // the abandoned one would render its stored NaN as the literal `NaN`.
  #editing: ReadonlyMap<string, string> = new Map()

  setProps(props: ModelListEditorProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  /** Buffer key for one capacity field; the row half moves when rows do. */
  #bufferKey(index: number, field: CapacityField): string {
    return `${String(index)}:${field}`
  }

  #editCapacity(index: number, field: CapacityField, text: string): void {
    this.#editing = new Map(this.#editing).set(this.#bufferKey(index, field), text)
    this.#patch(index, { [field]: parseCapacity(text) })
  }

  /** What a capacity field shows: the buffer while typing, else the stored count. */
  #capacityText(model: ModelDraft, index: number, field: CapacityField): string {
    return this.#editing.get(this.#bufferKey(index, field)) ?? capacitySpelling(numberOf(model, field))
  }

  /** Drop one row's entries and shift the rows after it down, in one pass. */
  #reindexOnRemove(current: ReadonlyMap<string, string>, index: number): Map<string, string> {
    const next = new Map<string, string>()
    for (const [key, value] of current) {
      const at = Number(key.slice(0, key.indexOf(':')))
      if (at === index) continue
      // Only the row number moves; the field half of the key is untouched.
      next.set(at > index ? key.replace(/^\d+/, String(at - 1)) : key, value)
    }
    return next
  }

  #toggleExpanded(index: number): void {
    const next = new Set(this.#expanded)
    if (!next.delete(index)) next.add(index)
    this.#expanded = next
  }

  #patch(index: number, next: Record<string, string | number | undefined>): void {
    this.#props.onChange(this.#props.models.map((model, at) => {
      if (at !== index) return model
      // Rebuilt rather than spread over: an emptied optional field has to leave
      // the profile, not be stored as a value its schema would reject.
      const cleared = new Set(
        Object.entries(next).filter(([, value]) => value === undefined || value === '').map(([key]) => key),
      )
      return Object.fromEntries(
        Object.entries({ ...model, ...next }).filter(([key]) => !cleared.has(key)),
      )
    }))
  }

  async #fetchModels(): Promise<void> {
    const { probe, api, t, models } = this.#props
    this.#busy = true
    this.#failure = undefined
    this.#render()
    try {
      const response = await api.llm.discoverModels({
        settingsNs: probe.settingsNs,
        ...probe.provider === undefined ? {} : { provider: probe.provider },
        ...probe.baseURL === undefined || probe.baseURL.length === 0 ? {} : { baseURL: probe.baseURL },
        ...probe.api === undefined ? {} : { api: probe.api },
        ...probe.apiKey === undefined ? {} : { apiKey: probe.apiKey },
      })
      if (!response.result.ok) {
        this.#failure = response.result.error.message
        return
      }
      const found = response.result.value.models
      if (found.length === 0) {
        this.#failure = t('fetchEmpty')
        return
      }
      // Everything already configured starts unchecked, so adopting a
      // selection never silently rewrites a capacity the user corrected.
      const known = new Set(models.map(model => textOf(model, 'id')))
      this.#candidates = found
      this.#picked = new Set(found.filter((model: { id: string }) => !known.has(model.id)).map((model: { id: string }) => model.id))
    } catch (error) {
      // The transport rejected rather than answering; without this the button
      // would stay busy with nothing shown.
      this.#failure = messageOf(error)
    } finally {
      this.#busy = false
      this.#render()
    }
  }

  #closePicker(): void {
    this.#candidates = undefined
    this.#picked = new Set()
  }

  #adoptPicked(): void {
    const candidates = this.#candidates
    /* v8 ignore next -- the dialog only renders with candidates loaded */
    if (candidates === undefined) return
    const byId = new Map(this.#props.models.map(model => [textOf(model, 'id'), model]))
    for (const candidate of candidates) {
      if (!this.#picked.has(candidate.id)) continue
      // A row the user already tuned wins over the provider's own numbers.
      // Keyed by id, so a half-typed row whose id is still empty is not a
      // match and the candidate joins as its own row — correct, since a row
      // without an id is not yet a model and the create/apply gates refuse it.
      byId.set(candidate.id, byId.get(candidate.id) ?? adopt(candidate))
    }
    this.#props.onChange([...byId.values()])
    this.#closePicker()
  }

  #toggle(id: string): void {
    const next = new Set(this.#picked)
    if (!next.delete(id)) next.add(id)
    this.#picked = next
  }

  #render(): void {
    const props = this.#props
    const { models, onChange, probe, t, disabled } = props
    const activeCandidates = this.#candidates ?? []
    const allCandidatesPicked = activeCandidates.length > 0
      && activeCandidates.every(candidate => this.#picked.has(candidate.id))

    const toggleAllCandidates = (): void => {
      this.#picked = activeCandidates.every(candidate => this.#picked.has(candidate.id))
        ? new Set()
        : new Set(activeCandidates.map(candidate => candidate.id))
      this.#render()
    }

    // A route the adapter already describes answers without an endpoint; only a
    // draft with neither has nothing to ask about.
    const askable = probe.provider !== undefined || (probe.baseURL !== undefined && probe.baseURL.length > 0)
    const vdom = (
      <section class={styles['modelCatalog'] ?? ''} aria-label={t('models')}>
        <div class={styles['modelListHead'] ?? ''}>
          <div class={styles['modelCatalogHeading'] ?? ''}>
            <span class={styles['modelCatalogTitle'] ?? ''}>{t('models')}</span>
            {props.overridden === undefined
              ? null
              : (
                <span class={styles['modelCatalogMeta'] ?? ''}>
                  {props.overridden ? t('modelsCustomized') : t('modelsInherited')}
                </span>
              )}
          </div>
          {props.overridden === true && props.onReset !== undefined
            ? (
              <button
                type="button"
                class={styles['linkButton'] ?? ''}
                disabled={disabled}
                onclick={props.onReset}
              >
                {t('resetModels')}
              </button>
            )
            : null}
          <button
            type="button"
            class={styles['linkButton'] ?? ''}
            disabled={disabled || this.#busy || !askable || props.probeBlocked !== undefined}
            title={props.probeBlocked !== undefined
              ? t(props.probeBlocked)
              : askable ? undefined : t('fetchNeedsBaseUrl')}
            onclick={() => { void this.#fetchModels() }}
          >
            {this.#busy ? t('fetching') : t('fetchModels')}
          </button>
        </div>
        {models.length === 0 ? <p class={styles['modelEmpty'] ?? ''}>{t('modelsEmpty')}</p> : null}
        {models.map((model, index) => (
          <div key={index} class={styles['modelEntry'] ?? ''}>
            <div class={styles['modelRow'] ?? ''}>
              <input
                class={styles['input'] ?? ''}
                type="text"
                value={textOf(model, 'id')}
                placeholder={t('modelId')}
                aria-label={`${t('modelId')} ${index + 1}`}
                disabled={disabled}
                onchange={(event: Event) => { this.#patch(index, { id: (event.target as HTMLInputElement).value }); this.#render() }}
              />
              <input
                class={styles['input'] ?? ''}
                type="text"
                value={textOf(model, 'name')}
                placeholder={t('modelName')}
                aria-label={`${t('modelName')} ${index + 1}`}
                disabled={disabled}
                onchange={(event: Event) => {
                  const value = (event.target as HTMLInputElement).value
                  this.#patch(index, { name: value === '' ? undefined : value })
                  this.#render()
                }}
              />
              <button
                type="button"
                class={styles['iconButton'] ?? ''}
                aria-label={`${t('modelAdvanced')} ${index + 1}`}
                aria-expanded={this.#expanded.has(index)}
                title={t('modelAdvanced')}
                onclick={() => { this.#toggleExpanded(index); this.#render() }}
              >
                <IconChevron open={this.#expanded.has(index)} />
              </button>
              <button
                type="button"
                class={`${styles['iconButton'] ?? ''} ${styles['iconButtonDanger'] ?? ''}`}
                aria-label={`${t('removeModel')} ${index + 1}`}
                title={t('removeModel')}
                disabled={disabled}
                onclick={() => {
                  onChange(models.filter((_model, at) => at !== index))
                  // Both stores are keyed by position, so every row after this
                  // one shifts down and would otherwise inherit its neighbour's
                  // state — a different row's capacities popping open, or its
                  // half-typed text appearing in another row's field.
                  const nextExpanded = new Set<number>()
                  for (const at of this.#expanded) {
                    if (at < index) nextExpanded.add(at)
                    else if (at > index) nextExpanded.add(at - 1)
                  }
                  this.#expanded = nextExpanded
                  this.#editing = this.#reindexOnRemove(this.#editing, index)
                  this.#render()
                }}
              >
                <IconTrash />
              </button>
            </div>
            {this.#expanded.has(index)
              ? (
                <div class={styles['modelAdvanced'] ?? ''}>
                  <label class={styles['modelField'] ?? ''}>
                    <span class={styles['modelFieldLabel'] ?? ''}>{t('modelContextWindow')}</span>
                    <input
                      class={styles['input'] ?? ''}
                      type="text"
                      inputmode="numeric"
                      value={this.#capacityText(model, index, 'contextWindow')}
                      placeholder={CAPACITY_HINT.contextWindow}
                      aria-label={`${t('modelContextWindow')} ${index + 1}`}
                      disabled={disabled}
                      onchange={(event: Event) => {
                        this.#editCapacity(index, 'contextWindow', (event.target as HTMLInputElement).value)
                        this.#render()
                      }}
                    />
                  </label>
                  <label class={styles['modelField'] ?? ''}>
                    <span class={styles['modelFieldLabel'] ?? ''}>{t('modelMaxTokens')}</span>
                    <input
                      class={styles['input'] ?? ''}
                      type="text"
                      inputmode="numeric"
                      value={this.#capacityText(model, index, 'maxTokens')}
                      placeholder={CAPACITY_HINT.maxTokens}
                      aria-label={`${t('modelMaxTokens')} ${index + 1}`}
                      disabled={disabled}
                      onchange={(event: Event) => {
                        this.#editCapacity(index, 'maxTokens', (event.target as HTMLInputElement).value)
                        this.#render()
                      }}
                    />
                  </label>
                </div>
              )
              : null}
          </div>
        ))}
        <button
          type="button"
          class={styles['addModelButton'] ?? ''}
          disabled={disabled}
          onclick={() => { onChange([...models, { id: '' }]) }}
        >
          {t('addModel')}
        </button>
        {this.#failure !== undefined ? <p class={styles['error'] ?? ''}>{this.#failure}</p> : null}
        <Modal
          open={this.#candidates !== undefined}
          onClose={() => { this.#closePicker(); this.#render() }}
          title={t('fetchTitle')}
          closeLabel={t('close')}
          description={t('fetchDescription')}
          className={styles['fetchDialog'] as string}
          footer={(
            [
              <Button variant="outline" onclick={() => { this.#closePicker(); this.#render() }}>{t('cancel')}</Button>,
              <Button variant="outline" onclick={() => { this.#adoptPicked(); this.#render() }}>{t('fetchAdopt')}</Button>,
            ] as unknown as VNode
          )}
        >
          <div class={styles['candidateActions'] ?? ''}>
            <Button variant="ghost" size="sm" onclick={toggleAllCandidates}>
              {t(allCandidatesPicked ? 'fetchDeselectAll' : 'fetchSelectAll')}
            </Button>
          </div>
          <ul class={styles['candidateList'] ?? ''}>
            {(this.#candidates ?? []).map(candidate => (
              <li key={candidate.id} class={styles['candidate'] ?? ''}>
                <label class={styles['candidateLabel'] ?? ''}>
                  <input
                    type="checkbox"
                    checked={this.#picked.has(candidate.id)}
                    onchange={() => { this.#toggle(candidate.id); this.#render() }}
                  />
                  {/* The id alone: it is the string adoption writes, and the
                      capacities the endpoint reported are adopted with it and
                      editable in the row that appears. */}
                  <span class={styles['candidateId'] ?? ''}>{candidate.id}</span>
                </label>
              </li>
            ))}
          </ul>
        </Modal>
      </section>
    ) as unknown as VNode
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-model-list-editor') === undefined) {
  customElements.define('dsh-model-list-editor', DshModelListEditor)
}

/**
 * Create (if needed) or update a ModelListEditor element in place.
 * @param el - an existing element to update, or null to create one.
 * @param props - see {@link ModelListEditorProps}.
 * @returns the element; keep it and pass it back in to update.
 */
export function renderModelListEditor(el: DshModelListEditor | null, props: ModelListEditorProps): DshModelListEditor {
  const target = el ?? document.createElement('dsh-model-list-editor') as DshModelListEditor
  target.setProps(props)
  return target
}

/**
 * Render the model list with its fetch action.
 * @param props - the drafted rows, probe target, wire face, and copy.
 * @returns the model-list editor, cast for JSX use (Modal.tsx's pattern).
 */
export function ModelListEditor(props: ModelListEditorProps): JSX.Element {
  return renderModelListEditor(null, props) as unknown as JSX.Element
}
