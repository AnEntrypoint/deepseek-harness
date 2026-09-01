/**
 * ModelSelect: the composer's named model seat (`conversation.input.model`).
 * Two-level selection per figma 496:26454's MenuDropdown: the root menu is
 * the Model / Effort row pair (label + current value + a right chevron),
 * each drilling into its own list — the provider-grouped model list over
 * the shared directory, and the effort levels. The trigger (313:14108's
 * ToggleButton) shows both: model name + effort in the caption tone.
 * Data and submission ride the SAME per-session ModelDirectory as the
 * /model popup; exact-model reasoning metadata and the selected effort come
 * from the Host rather than a client-owned vocabulary. A rejected selection
 * announces through the shared transient Toast anchored to the composer
 * card; the in-menu strip with Retry remains the catalog-load surface.
 *
 * Converted from a React hooks component to a webjsx custom element: every
 * useState/useRef becomes a private instance field, useSyncExternalStore
 * over `directory` becomes a direct store subscription bound in
 * connectedCallback, the outside-click useEffect becomes bind/unbind helpers
 * called from connectedCallback/disconnectedCallback, and re-render is an
 * explicit applyDiff(this, vdom) call (Toast.tsx's pattern).
 */
import { applyDiff } from 'webjsx'
import clsx from 'clsx'
import type { ModelReasoningEffort, ModelSelection } from '@deepseek-ai/dsh-api-remotes/client'
import {
  IconCheckOutline16, IconChevronDownOutline14, IconChevronRightOutline14,
  IconWarningOutline16, mountToast,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ModelSelectInjected } from './slots.ts'
import type { ModelDirectoryState } from './directory.ts'
import css from './ModelSelect.css.ts'

/** Which pane the dropdown shows: the two-row root or one drilled-in list. */
type Pane = 'root' | 'model' | 'effort'

/** One dynamic effort row; undefined means preserve the provider default. */
interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
  description?: string
}

/** Full component props. */
export type ModelSelectProps = ModelSelectInjected & { locked: boolean } & PropsLocale<'model'>

let nextId = 0

/** Render the composer model seat as a custom element. */
export class DshModelSelect extends HTMLElement {
  #props: ModelSelectProps | null = null
  #open = false
  #pane: Pane = 'root'
  #lastAction: 'load' | 'select' = 'load'
  #toast: { seq: number; text: string } | null = null
  #toastSeq = 0
  #toastEl: HTMLElement | null = null
  #rootEl: HTMLDivElement | null = null
  #triggerEl: HTMLButtonElement | null = null
  #itemEls: (HTMLButtonElement | null)[] = []
  #id = `dsh-model-select-${++nextId}`
  #unsubscribe: (() => void) | null = null
  #outsideHandler: ((event: MouseEvent) => void) | null = null
  #loadedOnce = false

  /** Set/replace props and re-render; call after creating or updating the element. */
  setProps(props: ModelSelectProps): void {
    const prevDirectory = this.#props?.directory
    this.#props = props
    if (prevDirectory !== props.directory) {
      this.#bindStore()
    }
    // Mount-time load resolves the trigger label; this fires once per
    // directory identity (mirrors the original's [available, load] effect).
    if (!this.#loadedOnce && props.available) {
      this.#loadedOnce = true
      props.load()
    }
    this.#render()
  }

  connectedCallback(): void {
    this.#bindStore()
    this.#render()
  }

  disconnectedCallback(): void {
    this.#unsubscribe?.()
    this.#unsubscribe = null
    this.#unbindOutsideClose()
    this.#toastEl?.remove()
    this.#toastEl = null
  }

  #bindStore(): void {
    this.#unsubscribe?.()
    this.#unsubscribe = null
    const directory = this.#props?.directory
    if (directory === undefined) return
    this.#unsubscribe = directory.subscribe(() => { this.#render() })
  }

  #bindOutsideClose(): void {
    this.#unbindOutsideClose()
    const closeOutside = (event: MouseEvent): void => {
      if (!this.#rootEl?.contains(event.target as Node)) {
        this.#open = false
        this.#render()
      }
    }
    this.#outsideHandler = closeOutside
    document.addEventListener('mousedown', closeOutside)
  }

  #unbindOutsideClose(): void {
    if (this.#outsideHandler === null) return
    document.removeEventListener('mousedown', this.#outsideHandler)
    this.#outsideHandler = null
  }

  #reload(): void {
    this.#lastAction = 'load'
    this.#props?.load()
  }

  #show(): void {
    this.#pane = 'root'
    this.#open = true
    this.#bindOutsideClose()
    this.#reload()
    this.#render()
  }

  #close(restoreFocus = false): void {
    this.#open = false
    this.#pane = 'root'
    this.#unbindOutsideClose()
    if (restoreFocus) queueMicrotask(() => { this.#triggerEl?.focus() })
    this.#render()
  }

  #moveFocus(offset: number): void {
    const items = this.#itemEls.filter(item => item !== null)
    if (items.length === 0) return
    const active = items.findIndex(item => item === document.activeElement)
    const next = (Math.max(active, 0) + offset + items.length) % items.length
    items[next]?.focus()
  }

  #onRootKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && this.#open) {
      event.preventDefault()
      // Escape backs out of a drilled pane first, then closes.
      if (this.#pane !== 'root') { this.#pane = 'root'; this.#render() } else this.#close(true)
      return
    }
    if (!this.#open) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      this.#moveFocus(event.key === 'ArrowDown' ? 1 : -1)
    }
  }

  #onBlur(event: FocusEvent): void {
    if (event.relatedTarget instanceof Node && this.#rootEl?.contains(event.relatedTarget)) return
    this.#close()
  }

  #settleSelection(state: ModelDirectoryState, accepted: boolean): void {
    if (accepted) {
      if (this.#rootEl !== null) this.#close(true)
      return
    }
    const message = state.error
    if (message !== null) {
      this.#toastSeq += 1
      const t = this.#props?.t
      this.#toast = { seq: this.#toastSeq, text: t !== undefined ? t('error.action', { message }) : message }
      this.#render()
    }
  }

  #choose(state: ModelDirectoryState, selection: ModelSelection): void {
    const props = this.#props
    if (props === null) return
    if (state.current?.provider === selection.provider && state.current.model === selection.model) {
      this.#close(true)
      return
    }
    this.#lastAction = 'select'
    void props.select(selection).then((accepted) => {
      this.#settleSelection(props.directory.getSnapshot(), accepted)
    })
  }

  #chooseEffort(state: ModelDirectoryState, effectiveEffort: string | undefined, effort: string | undefined): void {
    const props = this.#props
    if (props === null || state.current === null) return
    if (effectiveEffort === effort) {
      this.#close(true)
      return
    }
    const selection: ModelSelection = {
      provider: state.current.provider,
      model: state.current.model,
      ...effort === undefined ? {} : { reasoningEffort: effort },
    }
    this.#lastAction = 'select'
    void props.select(selection).then((accepted) => {
      this.#settleSelection(props.directory.getSnapshot(), accepted)
    })
  }

  #render(): void {
    const props = this.#props
    if (props === null) { applyDiff(this, []); return }
    const { locked, available, directory, t } = props
    if (!available) { applyDiff(this, []); return }
    const state = directory.getSnapshot()

    const choices = state.groups.flatMap(group =>
      group.models.map(model => ({
        group,
        model,
        selection: {
          provider: group.id,
          model: model.id,
          ...model.reasoning?.defaultEffort === undefined
            ? {}
            : { reasoningEffort: model.reasoning.defaultEffort },
        } satisfies ModelSelection,
      })))
    const selectedIndex = state.current === null
      ? -1
      : choices.findIndex(c => c.selection.provider === state.current?.provider && c.selection.model === state.current.model)
    const currentChoice = choices[selectedIndex]
    const reasoning = currentChoice?.model.reasoning
    const effectiveEffort = state.current?.reasoningEffort ?? reasoning?.defaultEffort
    const effortLabel = reasoning === undefined
      ? undefined
      : effectiveEffort === undefined
        ? t('effort.providerDefault')
        : reasoning.efforts.find(level => level.id === effectiveEffort)?.name ?? effectiveEffort
    const effortChoices: readonly EffortChoice[] = reasoning === undefined
      ? []
      : [
        ...reasoning.defaultEffort === undefined
          ? [{ key: 'provider-default', effort: undefined, label: t('effort.providerDefault') }]
          : [],
        ...reasoning.efforts.map((effort: ModelReasoningEffort) => ({
          key: `effort:${effort.id}`,
          effort: effort.id,
          label: effort.name,
          ...effort.description === undefined ? {} : { description: effort.description },
        })),
      ]
    const busy = state.status === 'selecting'

    const modelLabel = currentChoice?.model.name ?? t('trigger.fallback')
    const triggerLabel = effortLabel === undefined ? modelLabel : `${modelLabel} · ${effortLabel}`
    const triggerAria = currentChoice === undefined
      ? t('trigger.selectAria')
      : effortLabel === undefined
        ? t('trigger.aria', { model: modelLabel })
        : t('trigger.ariaEffort', { model: modelLabel, effort: effortLabel })
    this.#itemEls = []
    let itemIndex = 0
    const itemRef = () => {
      const at = itemIndex++
      return (node: Node | null) => { this.#itemEls[at] = node as HTMLButtonElement | null }
    }

    const open = this.#open
    const pane = this.#pane
    const id = this.#id

    const vdom = (
      <div
        class={css.root ?? ''}
        onkeydown={(event: KeyboardEvent) => { this.#onRootKeyDown(event) }}
        onblur={(event: FocusEvent) => { this.#onBlur(event) }}
        ref={(node: Node | null) => { this.#rootEl = node as HTMLDivElement | null }}
      >
        <button
          type="button"
          class={css.trigger ?? ''}
          aria-label={triggerAria}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? `${id}-menu` : undefined}
          title={triggerLabel}
          disabled={locked}
          ref={(node: Node | null) => { this.#triggerEl = node as HTMLButtonElement | null }}
          onclick={() => {
            if (open) this.#close()
            else this.#show()
          }}
        >
          <span class={css.triggerLabel ?? ''}>{modelLabel}</span>
          {effortLabel !== undefined && <span class={css.triggerEffort ?? ''}>{effortLabel}</span>}
          <IconChevronDownOutline14 className={clsx(css.chevron, open && css.chevronOpen)} />
        </button>

        {open && (
          <div
            id={`${id}-menu`}
            class={css.menu ?? ''}
            role="menu"
            aria-label={t('menu.aria')}
            aria-busy={state.status === 'loading' || busy}
          >
            {pane === 'root' && [
              <button ref={itemRef()} type="button" role="menuitem" class={css.cell ?? ''} onclick={() => { this.#pane = 'model'; this.#render() }}>
                <span class={css.cellLabel ?? ''}>{t('menu.model')}</span>
                <span class={css.cellValue ?? ''}>{modelLabel}</span>
                <IconChevronRightOutline14 className={css.cellChevron} />
              </button>,
              reasoning !== undefined && (
                <button ref={itemRef()} type="button" role="menuitem" class={css.cell ?? ''} onclick={() => { this.#pane = 'effort'; this.#render() }}>
                  <span class={css.cellLabel ?? ''}>{t('menu.effort')}</span>
                  <span class={css.cellValue ?? ''}>{effortLabel}</span>
                  <IconChevronRightOutline14 className={css.cellChevron} />
                </button>
              ),
            ]}

            {pane === 'model' && [
              state.status === 'loading' && (
                <div class={css.status ?? ''}>{t('status.loading')}</div>
              ),
              state.error !== null && this.#lastAction === 'load' && (
                <div class={css.error ?? ''}>
                  <span>{t('error.action', { message: state.error })}</span>
                  <button type="button" class={css.retry ?? ''} onclick={() => { this.#reload() }}>{t('retry')}</button>
                </div>
              ),
              ...state.failures.map(failure => (
                <div class={css.warning ?? ''} key={failure.id}>
                  <span>{t('warning.groupLoad', { name: failure.name, message: failure.message })}</span>
                  <button type="button" class={css.retry ?? ''} onclick={() => { this.#reload() }}>{t('retry')}</button>
                </div>
              )),
              <div class={clsx(css.groups, 'scrollable')}>
                {state.groups.map((group) => {
                  const headingId = `${id}-${group.id}`
                  return (
                    <section role="group" aria-labelledby={headingId} class={css.group ?? ''} key={group.id}>
                      <div class={css.groupTitle ?? ''} id={headingId}>{group.name}</div>
                      {group.models.map((model) => {
                        const selected = state.current?.provider === group.id && state.current.model === model.id
                        return (
                          <button
                            ref={itemRef()}
                            type="button"
                            role="menuitemradio"
                            aria-checked={selected}
                            class={clsx(css.option, selected && css.selected)}
                            key={model.id}
                            title={model.name}
                            disabled={busy}
                            onclick={() => { this.#choose(state, { provider: group.id, model: model.id }) }}
                          >
                            <span class={css.optionCopy ?? ''}>
                              <span class={css.modelName ?? ''}>{model.name}</span>
                              {model.description !== undefined && (
                                <span class={css.description ?? ''}>{model.description}</span>
                              )}
                            </span>
                            <span class={css.check ?? ''}>
                              {selected ? <IconCheckOutline16 /> : null}
                            </span>
                          </button>
                        )
                      })}
                    </section>
                  )
                })}
              </div>,
              state.status === 'ready' && choices.length === 0 && (
                <div class={css.empty ?? ''}>{t('empty.models')}</div>
              ),
            ]}

            {pane === 'effort' && [
              state.error !== null && this.#lastAction === 'load' && (
                <div class={css.error ?? ''}>
                  <span>{t('error.action', { message: state.error })}</span>
                  <button type="button" class={css.retry ?? ''} onclick={() => { this.#reload() }}>{t('action.reload')}</button>
                </div>
              ),
              effortChoices.length === 0
                ? <div class={css.empty ?? ''}>{t('empty.efforts')}</div>
                : effortChoices.map(level => (
                  <button
                    ref={itemRef()}
                    type="button"
                    role="menuitemradio"
                    aria-checked={effectiveEffort === level.effort}
                    class={clsx(css.option, effectiveEffort === level.effort && css.selected)}
                    key={level.key}
                    disabled={busy}
                    onclick={() => { this.#chooseEffort(state, effectiveEffort, level.effort) }}
                  >
                    <span class={css.optionCopy ?? ''}>
                      <span class={css.modelName ?? ''}>{level.label}</span>
                      {level.description !== undefined && (
                        <span class={css.description ?? ''}>{level.description}</span>
                      )}
                    </span>
                    <span class={css.check ?? ''}>
                      {effectiveEffort === level.effort ? <IconCheckOutline16 /> : null}
                    </span>
                  </button>
                )),
            ]}
          </div>
        )}
      </div>
    )
    applyDiff(this, vdom)
    this.#syncToast()
  }

  #syncToast(): void {
    if (this.#toast === null) {
      this.#toastEl?.remove()
      this.#toastEl = null
      return
    }
    this.#toastEl?.remove()
    this.#toastEl = mountToast({
      text: this.#toast.text,
      icon: <IconWarningOutline16 />,
      anchor: this.#rootEl?.closest<HTMLElement>('[data-composer-card]') ?? null,
      onDone: () => { this.#toast = null; this.#render() },
    })
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-model-select') === undefined) {
  customElements.define('dsh-model-select', DshModelSelect)
}

/** One-shot creation helper preserving the original function-component call shape. */
export function ModelSelect(props: ModelSelectProps): DshModelSelect {
  const el = document.createElement('dsh-model-select') as DshModelSelect
  el.setProps(props)
  return el
}
