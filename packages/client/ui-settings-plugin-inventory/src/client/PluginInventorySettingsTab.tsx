// Read-only Host plugin inventory registered into Web Settings.
//
// Converted from a React function component (useState/useEffect/useMemo/
// useId) to a webjsx custom element: instance fields replace state,
// connectedCallback/disconnectedCallback replace effect mount/cleanup, and a
// module-level counter replaces useId (stable per element instance).

import { applyDiff } from 'webjsx'
import type { PluginInventorySnapshot } from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconChevronDownOutline14,
  IconSearchOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { PluginInventoryLocaleKey } from './locales.ts'
import css from './PluginInventorySettingsTab.module.css'

/** Registration-side Remote face used by the section. */
export interface PluginInventorySettingsTabInjected {
  /** Read a current Host inventory snapshot. */
  list: () => Promise<PluginInventorySnapshot>
}

type PluginInventoryEntry = PluginInventorySnapshot['entries'][number]
type PluginFiberPhase = PluginInventoryEntry['fiberPhase']

/** Full component props assembled by the Settings slot renderer. */
export type PluginInventorySettingsTabProps =
  PropsRuntime<'settings.plugins.tab'>
  & PropsLocale<'settings.pluginInventory'>
  & InjectFace<PluginInventorySettingsTabInjected>

type ViewState =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly snapshot: PluginInventorySnapshot }

const PHASE_KEYS = {
  pending: 'pending',
  loading: 'loadingPhase',
  active: 'active',
  failed: 'failed',
  unloading: 'unloading',
} satisfies Record<Exclude<PluginFiberPhase, null>, PluginInventoryLocaleKey>

/** Localized accessible label for one root Fiber phase. */
function phaseLabel(
  phase: PluginFiberPhase,
  t: PluginInventorySettingsTabProps['t'],
): string {
  return phase === null ? t('unobserved') : t(PHASE_KEYS[phase])
}

/** Compact a module specifier without guessing whether its Loader id was generated. */
function moduleShortName(moduleName: string): string {
  const unscoped = moduleName.startsWith('@') ? moduleName.slice(moduleName.indexOf('/') + 1) : moduleName
  return unscoped
    .replace(/^cordis:/, '')
    .replace(/^cordis-plugin-/, '')
    .replace(/^dsh-(?:host-|client-)?/, '')
}

/** Whether an inventory row matches the local catalog query. */
function matches(entry: PluginInventoryEntry, normalizedQuery: string): boolean {
  if (normalizedQuery.length === 0) return true
  return [entry.moduleName, entry.entryId]
    .some(value => value.toLocaleLowerCase().includes(normalizedQuery))
}

let nextCatalogId = 0

/**
 * Read-only Loader inventory tab custom element. Registered as
 * `dsh-plugin-inventory-settings-tab` via `webjsxSlot` at the slot's register
 * call site (see index.ts).
 */
export class DshPluginInventorySettingsTab extends HTMLElement {
  #props: PluginInventorySettingsTabProps | null = null
  #catalogId = `plugin-inventory-${nextCatalogId++}`
  #query = ''
  #expanded: PluginInventoryEntry['entryId'] | null = null
  #state: ViewState = { status: 'loading' }
  #request = 0
  #fetchToken = 0

  /** Set/replace props and re-render; called by the slot renderer's webjsx bridge. */
  setProps(props: PluginInventorySettingsTabProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#load()
    this.#render()
  }

  disconnectedCallback(): void {
    // Invalidate any in-flight load so a late resolution after unmount is a no-op.
    this.#fetchToken += 1
  }

  #load(): void {
    const props = this.#props
    if (props === null) return
    const token = ++this.#fetchToken
    void Promise.resolve().then(() => props.list()).then(
      (snapshot) => {
        if (token !== this.#fetchToken) return
        this.#state = { status: 'ready', snapshot }
        this.#syncExpanded()
        this.#render()
      },
      () => {
        if (token !== this.#fetchToken) return
        this.#state = { status: 'error' }
        this.#render()
      },
    )
  }

  #syncExpanded(): void {
    if (this.#state.status !== 'ready' || this.#expanded === null) return
    const normalizedQuery = this.#query.trim().toLocaleLowerCase()
    const filtered = this.#state.snapshot.entries.filter(entry => matches(entry, normalizedQuery))
    if (!filtered.some(entry => entry.entryId === this.#expanded)) this.#expanded = null
  }

  #retry = (): void => {
    this.#state = { status: 'loading' }
    this.#request += 1
    this.#load()
    this.#render()
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const { t } = props
    const state = this.#state
    const normalizedQuery = this.#query.trim().toLocaleLowerCase()
    const filteredEntries = state.status === 'ready'
      ? state.snapshot.entries.filter(entry => matches(entry, normalizedQuery))
      : []

    const vdom = (
      <div class={css.section ?? ''} aria-busy={String(state.status === 'loading')}>
        {state.status === 'loading' ? <p class={css.status ?? ''}>{t('loading')}</p> : null}
        {state.status === 'error' ? (
          <div class={css.failure ?? ''}>
            <p role="alert">{t('error')}</p>
            <button type="button" onclick={this.#retry}>{t('retry')}</button>
          </div>
        ) : null}
        {state.status === 'ready' ? (
          <div class={css.catalog ?? ''}>
            <label class={css.search ?? ''}>
              <IconSearchOutline16 />
              <span class={css.visuallyHidden ?? ''}>{t('search')}</span>
              <input
                type="search"
                value={this.#query}
                placeholder={t('search')}
                aria-label={t('search')}
                oninput={(event: Event) => {
                  this.#query = (event.currentTarget as HTMLInputElement).value
                  this.#render()
                }}
              />
            </label>
            <div class={css.catalogHeading ?? ''}>
              <h3>{t('catalog')}</h3>
              <span data-plugin-count={String(filteredEntries.length)}>{filteredEntries.length}</span>
            </div>
            {state.snapshot.entries.length === 0 ? <p class={css.status ?? ''}>{t('empty')}</p> : null}
            {state.snapshot.entries.length > 0 && filteredEntries.length === 0
              ? <p class={css.status ?? ''}>{t('emptySearch')}</p>
              : null}
            {filteredEntries.length > 0 ? (
              <ul class={css.cards ?? ''}>
                {filteredEntries.map((entry) => {
                  const status = phaseLabel(entry.fiberPhase, t)
                  const title = moduleShortName(entry.moduleName)
                  const configuration = t(entry.enabled ? 'enabledTag' : 'disabledTag')
                  const open = this.#expanded === entry.entryId
                  const detailId = `${this.#catalogId}-details-${encodeURIComponent(entry.entryId)}`
                  return (
                    <li
                      class={css.card ?? ''}
                      data-plugin-entry={entry.entryId}
                      data-open={open ? 'true' : null}
                    >
                      <button
                        class={css.cardContent ?? ''}
                        type="button"
                        aria-expanded={String(open)}
                        aria-controls={detailId}
                        aria-label={entry.enabled ? `${title}, ${status}, ${configuration}` : `${title}, ${configuration}`}
                        onclick={() => {
                          this.#expanded = this.#expanded === entry.entryId ? null : entry.entryId
                          this.#render()
                        }}
                      >
                        <strong class={css.cardTitle ?? ''} title={entry.moduleName}>{title}</strong>
                        <span class={css.cardTrailing ?? ''}>
                          {entry.enabled ? (
                            <span
                              class={css.statusDot ?? ''}
                              data-phase={entry.fiberPhase ?? 'unobserved'}
                              role="img"
                              aria-label={status}
                              title={status}
                            />
                          ) : null}
                          <span class={css.configTag ?? ''} data-enabled={entry.enabled ? 'true' : 'false'}>
                            {configuration}
                          </span>
                          <IconChevronDownOutline14 className={css.chevron} size={12} />
                        </span>
                      </button>
                      {open ? (
                        <div class={css.cardDetails ?? ''} id={detailId}>
                          <code class={css.entryValue ?? ''} data-loader-entry>{entry.entryId}</code>
                          <dl class={css.details ?? ''}>
                            <div>
                              <dt>{t('configuration')}</dt>
                              <dd>{configuration}</dd>
                            </div>
                            {entry.enabled ? (
                              <div>
                                <dt>{t('cordis')}</dt>
                                <dd>{status}</dd>
                              </div>
                            ) : null}
                          </dl>
                        </div>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-plugin-inventory-settings-tab') === undefined) {
  customElements.define('dsh-plugin-inventory-settings-tab', DshPluginInventorySettingsTab)
}
