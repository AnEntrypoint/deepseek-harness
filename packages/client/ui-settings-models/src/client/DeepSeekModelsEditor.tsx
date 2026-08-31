/**
 * Curated editor for the direct DeepSeek adapter's advisory model catalog.
 * The settings layer replaces `models` as one array, so the parent supplies
 * the effective inherited rows until the first edit materializes a user
 * override; reset removes that override instead of copying defaults into it.
 *
 * Converted from a React hooks component to a webjsx custom element: the two
 * useState buffers (editing/expanded) become instance fields, and re-render
 * is an explicit applyDiff(this, vdom) call (Toast.tsx's pattern).
 */

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import {
  IconChevronDownOutline14, IconChevronRightOutline14, IconPlusOutline16, IconTrashOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** One catalog entry kept structurally open so hidden or future fields survive an edit. */
export type DeepSeekModelDraft = Record<string, unknown>

/** The catalog fields this editor writes. */
type CatalogField = 'id' | 'name' | 'contextWindow' | 'maxTokens'

/** The two token counts edited as K/M-suffixed text behind a row's disclosure. */
type CapacityField = 'contextWindow' | 'maxTokens'

/** Row index encoded in an editing-buffer key. */
function rowOf(key: string): number {
  return Number(key.slice(0, key.indexOf(':')))
}

/** Accepted capacity spellings: a decimal count with an optional K/M suffix. */
const CAPACITY_PATTERN = /^(\d+(?:\.\d+)?)([km])?$/i

/** Decimal suffix scales — `1M` is 1000K, matching how model capacities are quoted. */
const CAPACITY_SCALE = { k: 1_000, m: 1_000_000 } as const

/**
 * Read a typed capacity, so a user can write `256K` or `1M` instead of counting
 * zeroes. The stored value stays a plain token count.
 * @param text - raw field text.
 * @returns the count; `undefined` when blank (inherit), `NaN` when unreadable
 * (rejected by {@link validateDeepSeekModels} before any write).
 */
export function parseCapacity(text: string): number | undefined {
  const trimmed = text.trim()
  if (trimmed.length === 0) return undefined
  const match = CAPACITY_PATTERN.exec(trimmed)
  if (match === null) return Number.NaN
  const suffix = match[2]?.toLowerCase()
  const scale = suffix === 'k' || suffix === 'm' ? CAPACITY_SCALE[suffix] : 1
  const scaled = Number(match[1]) * scale
  // A decimal multiple is exact in intent but not in binary floating point
  // (2.3 * 1e6 lands a few ULPs high), so an integral intent snaps back.
  const rounded = Math.round(scaled)
  return Math.abs(scaled - rounded) < 1e-6 ? rounded : scaled
}

/**
 * Spell a stored count back in the shortest form that survives a round trip
 * through {@link parseCapacity}; a count that is not a whole number of
 * thousands stays written out.
 * @param value - stored capacity.
 * @returns the field text.
 */
export function formatCapacity(value: number): string {
  if (!Number.isInteger(value) || value <= 0) return String(value)
  if (value % CAPACITY_SCALE.m === 0) return `${String(value / CAPACITY_SCALE.m)}M`
  if (value % CAPACITY_SCALE.k === 0) return `${String(value / CAPACITY_SCALE.k)}K`
  return String(value)
}

/** A localized validation failure for one user-owned model array. */
export interface DeepSeekModelsValidationFailure {
  /** Zero-based model position. */
  index: number
  /** Message key owned by the Models settings section. */
  key: 'modelIdRequired' | 'modelIdDuplicate' | 'modelNameInvalid' | 'modelContextInvalid'
  | 'modelMaxTokensInvalid'
}

/** Convert a schema-validated catalog value into records without dropping hidden fields. */
export function modelDrafts(value: unknown): DeepSeekModelDraft[] {
  if (!Array.isArray(value)) return []
  return value.map(entry =>
    typeof entry === 'object' && entry !== null && !Array.isArray(entry)
      ? entry as DeepSeekModelDraft
      : {})
}

/**
 * Validate adapter constraints that the serialized schema cannot express.
 * @param value - user-owned `models` value, or undefined while inherited.
 * @returns the first invalid row, or undefined when the adapter will accept it.
 */
export function validateDeepSeekModels(value: unknown): DeepSeekModelsValidationFailure | undefined {
  if (value === undefined) return undefined
  const models = modelDrafts(value)
  const seen = new Set<string>()
  for (const [index, model] of models.entries()) {
    // Compared trimmed: surrounding whitespace is a paste artifact the adapter
    // would never match, and an untrimmed compare lets `model ` slip past the
    // duplicate check against its own twin.
    const id = model['id']
    const trimmed = typeof id === 'string' ? id.trim() : undefined
    if (trimmed === undefined || trimmed.length === 0) return { index, key: 'modelIdRequired' }
    if (seen.has(trimmed)) return { index, key: 'modelIdDuplicate' }
    seen.add(trimmed)
    const name = model['name']
    if (name !== undefined && (typeof name !== 'string' || name.length === 0)) {
      return { index, key: 'modelNameInvalid' }
    }
    const contextWindow = model['contextWindow']
    if (contextWindow !== undefined
      && (typeof contextWindow !== 'number' || !Number.isInteger(contextWindow) || contextWindow <= 0)) {
      return { index, key: 'modelContextInvalid' }
    }
    const maxTokens = model['maxTokens']
    if (maxTokens !== undefined
      && (typeof maxTokens !== 'number' || !Number.isInteger(maxTokens) || maxTokens <= 0)) {
      return { index, key: 'modelMaxTokensInvalid' }
    }
  }
  return undefined
}

/** Props of {@link DeepSeekModelsEditor}. */
export interface DeepSeekModelsEditorProps {
  /** Effective rows: inherited until the parent materializes an override. */
  models: readonly DeepSeekModelDraft[]
  /** Whether the user layer currently owns the whole array. */
  overridden: boolean
  /** Fallback context capacity used when a row omits its exact value. */
  defaultContextWindow: number | undefined
  /** Fallback output cap used when a row omits its exact value. */
  defaultMaxTokens: number | undefined
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable every mutation. */
  disabled: boolean
  /** Replace the user-owned array after one visible edit. */
  onChange: (models: DeepSeekModelDraft[]) => void
  /** Remove the user-owned array and return to inheritance. */
  onReset: () => void
}

const DEFAULT_PROPS: DeepSeekModelsEditorProps = {
  models: [],
  overridden: false,
  defaultContextWindow: undefined,
  defaultMaxTokens: undefined,
  t: key => key,
  disabled: false,
  onChange: () => {},
  onReset: () => {},
}

/**
 * The direct DeepSeek adapter's model catalog editor: id and display name on
 * each row, capacities behind the row's own disclosure. Custom element —
 * `editing`/`expanded` were `useState` buffers, now instance fields.
 */
export class DshDeepSeekModelsEditor extends HTMLElement {
  #props: DeepSeekModelsEditorProps = DEFAULT_PROPS
  // Keys carry the row index, so the two operations that move indexes maintain
  // them: `remove` re-keys around the dropped row, and reset clears them all
  // because the rows they annotated are gone.
  #editing = new Map<string, string>()
  #expanded = new Set<number>()

  /** Set/replace props and re-render; call after creating or updating the element. */
  setProps(props: DeepSeekModelsEditorProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  #update(index: number, key: CatalogField, value: unknown): void {
    const next = this.#props.models.map((model, at) => {
      const copy = { ...model }
      if (at !== index) return copy
      if (value === undefined) Reflect.deleteProperty(copy, key)
      else copy[key] = value
      return copy
    })
    this.#props.onChange(next)
  }

  #remove(index: number): void {
    const nextEditing = new Map<string, string>()
    for (const [key, text] of this.#editing) {
      const at = rowOf(key)
      if (at === index) continue
      // Only the row number moves; the field half of the key is untouched.
      nextEditing.set(at > index ? key.replace(/^\d+/, String(at - 1)) : key, text)
    }
    this.#editing = nextEditing
    const nextExpanded = new Set<number>()
    for (const at of this.#expanded) {
      if (at === index) continue
      nextExpanded.add(at > index ? at - 1 : at)
    }
    this.#expanded = nextExpanded
    this.#props.onChange(this.#props.models.filter((_model, at) => at !== index).map(model => ({ ...model })))
  }

  #reset(): void {
    this.#editing = new Map()
    this.#expanded = new Set()
    this.#props.onReset()
  }

  #toggle(index: number): void {
    const next = new Set(this.#expanded)
    if (!next.delete(index)) next.add(index)
    this.#expanded = next
    this.#render()
  }

  /** The field's text: its live keystrokes, else the stored count spelled short. */
  #capacityText(model: DeepSeekModelDraft, index: number, field: CapacityField): string {
    const typed = this.#editing.get(`${String(index)}:${field}`)
    if (typed !== undefined) return typed
    const value = model[field]
    return typeof value === 'number' ? formatCapacity(value) : ''
  }

  #settleCapacity(index: number, field: CapacityField): void {
    const key = `${String(index)}:${field}`
    const typed = this.#editing.get(key)
    if (typed === undefined) return
    // Unreadable text stays on screen: the save-time rejection names a row the
    // user can still see and correct.
    const parsed = parseCapacity(typed)
    if (parsed !== undefined && Number.isNaN(parsed)) return
    const next = new Map(this.#editing)
    next.delete(key)
    this.#editing = next
  }

  /** One capacity field of one row, rendered inside the row's disclosure. */
  #capacityField(
    model: DeepSeekModelDraft,
    index: number,
    field: CapacityField,
    fallback: number | undefined,
  ): VNode {
    const props = this.#props
    return (
      <label class={styles['modelField'] ?? ''}>
        <span class={styles['modelFieldLabel'] ?? ''}>{props.t(field === 'contextWindow' ? 'contextWindow' : 'maxTokens')}</span>
        <input
          class={styles['input'] ?? ''}
          type="text"
          inputmode="numeric"
          value={this.#capacityText(model, index, field)}
          placeholder={fallback === undefined
            ? props.t(field === 'contextWindow' ? 'contextWindowPlaceholder' : 'maxTokensPlaceholder')
            : formatCapacity(fallback)}
          aria-label={`${props.t(field === 'contextWindow' ? 'contextWindow' : 'maxTokens')} ${String(index + 1)}`}
          disabled={props.disabled}
          onchange={(event: Event) => {
            const text = (event.target as HTMLInputElement).value
            this.#editing = new Map(this.#editing).set(`${String(index)}:${field}`, text)
            this.#update(index, field, parseCapacity(text))
            this.#render()
          }}
          onblur={() => { this.#settleCapacity(index, field); this.#render() }}
        />
      </label>
    )
  }

  #render(): void {
    const props = this.#props
    const vdom = (
      <section class={styles['modelCatalog'] ?? ''} aria-label={props.t('models')}>
        <div class={styles['modelListHead'] ?? ''}>
          <div class={styles['modelCatalogHeading'] ?? ''}>
            <span class={styles['modelCatalogTitle'] ?? ''}>{props.t('models')}</span>
            <span class={styles['modelCatalogMeta'] ?? ''}>
              {props.overridden ? props.t('modelsCustomized') : props.t('modelsInherited')}
            </span>
          </div>
          {props.overridden
            ? (
              <button
                type="button"
                class={styles['linkButton'] ?? ''}
                disabled={props.disabled}
                onclick={() => { this.#reset(); this.#render() }}
              >
                {props.t('resetModels')}
              </button>
            )
            : null}
        </div>
        {props.models.length === 0
          ? <p class={styles['modelEmpty'] ?? ''}>{props.t('modelsEmpty')}</p>
          : (
            <div class={styles['modelList'] ?? ''}>
              {props.models.map((model, index) => (
                <div class={styles['modelEntry'] ?? ''} key={index}>
                  <div class={styles['modelRow'] ?? ''}>
                    <input
                      class={styles['input'] ?? ''}
                      type="text"
                      value={typeof model['id'] === 'string' ? model['id'] : ''}
                      placeholder={props.t('modelId')}
                      aria-label={`${props.t('modelId')} ${String(index + 1)}`}
                      disabled={props.disabled}
                      onchange={(event: Event) => { this.#update(index, 'id', (event.target as HTMLInputElement).value) }}
                      onblur={(event: Event) => {
                        // Settle a pasted id rather than trimming per keystroke,
                        // which would stop the user typing an interior space.
                        const value = (event.target as HTMLInputElement).value
                        const trimmed = value.trim()
                        if (trimmed !== value) this.#update(index, 'id', trimmed)
                      }}
                    />
                    <input
                      class={styles['input'] ?? ''}
                      type="text"
                      value={typeof model['name'] === 'string' ? model['name'] : ''}
                      placeholder={props.t('modelName')}
                      aria-label={`${props.t('modelName')} ${String(index + 1)}`}
                      disabled={props.disabled}
                      onchange={(event: Event) => {
                        const value = (event.target as HTMLInputElement).value
                        this.#update(index, 'name', value === '' ? undefined : value)
                      }}
                    />
                    <button
                      type="button"
                      class={styles['iconButton'] ?? ''}
                      aria-label={`${props.t('modelAdvanced')} ${String(index + 1)}`}
                      aria-expanded={this.#expanded.has(index)}
                      title={props.t('modelAdvanced')}
                      onclick={() => { this.#toggle(index) }}
                    >
                      {this.#expanded.has(index) ? <IconChevronDownOutline14 /> : <IconChevronRightOutline14 />}
                    </button>
                    <button
                      type="button"
                      class={`${styles['iconButton'] ?? ''} ${styles['iconButtonDanger'] ?? ''}`}
                      aria-label={`${props.t('removeModel')} ${String(index + 1)}`}
                      title={props.t('removeModel')}
                      disabled={props.disabled}
                      onclick={() => { this.#remove(index); this.#render() }}
                    >
                      <IconTrashOutline16 size={14} />
                    </button>
                  </div>
                  {this.#expanded.has(index)
                    ? (
                      <div class={styles['modelAdvanced'] ?? ''}>
                        {this.#capacityField(model, index, 'contextWindow', props.defaultContextWindow)}
                        {this.#capacityField(model, index, 'maxTokens', props.defaultMaxTokens)}
                      </div>
                    )
                    : null}
                </div>
              ))}
            </div>
          )}
        <button
          type="button"
          class={styles['addModelButton'] ?? ''}
          disabled={props.disabled}
          onclick={() => { props.onChange([...props.models.map(model => ({ ...model })), { id: '' }]) }}
        >
          <IconPlusOutline16 size={14} />
          {props.t('addModel')}
        </button>
      </section>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-deepseek-models-editor') === undefined) {
  customElements.define('dsh-deepseek-models-editor', DshDeepSeekModelsEditor)
}

/**
 * Create (if needed) or update a DeepSeekModelsEditor element in place.
 * @param el - an existing element to update, or null to create one.
 * @param props - see {@link DeepSeekModelsEditorProps}.
 * @returns the element; keep it and pass it back in to update.
 */
export function renderDeepSeekModelsEditor(
  el: DshDeepSeekModelsEditor | null,
  props: DeepSeekModelsEditorProps,
): DshDeepSeekModelsEditor {
  const target = el ?? document.createElement('dsh-deepseek-models-editor') as DshDeepSeekModelsEditor
  target.setProps(props)
  return target
}

/**
 * Render the direct DeepSeek adapter's model catalog.
 * @param props - effective rows plus the array-level override actions.
 * @returns the catalog editor, cast for JSX use (Modal.tsx's pattern).
 */
export function DeepSeekModelsEditor(props: DeepSeekModelsEditorProps): JSX.Element {
  return renderDeepSeekModelsEditor(null, props) as unknown as JSX.Element
}
