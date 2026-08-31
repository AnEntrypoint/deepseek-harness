/** Trajectory toolbar: timeline and ledger fold controls. */

import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { IconSearchOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { NS } from './locales.ts'
import css from './TrajectoryToolbar.module.css'

export interface TrajectoryToolbarProps {
  /** Whether timeline blocks use recorded durations instead of equal widths. */
  actualDuration: boolean
  /** Select recorded-duration or equal-width blocks. */
  onActualDurationChange: (actualDuration: boolean) => void
  /** Whether recorded timing retains idle gaps between operations. */
  actualTime: boolean
  /** Select complete wall-clock timing or idle-compressed timing. */
  onActualTimeChange: (actualTime: boolean) => void
  /** Whether every collapsible turn is currently folded. */
  allTurnsCollapsed: boolean
  /** Fold or expand every collapsible turn. */
  onToggleAllTurns: () => void
  /** Whether every collapsible assistant's tool calls are currently folded. */
  allAssistantsCollapsed: boolean
  /** Fold or expand tool calls under every collapsible assistant. */
  onToggleAllAssistants: () => void
  /** Current live ledger search query. */
  searchQuery: string
  /** Update the live ledger search query. */
  onSearchQueryChange: (query: string) => void
  /** Translate a toolbar dictionary key. */
  t: TranslateNS<typeof NS>
}

/**
 * Render the sticky trajectory toolbar.
 * @param props - rendered counts and whole-list fold state.
 * @returns the toolbar element.
 */
export function TrajectoryToolbar({
  actualDuration,
  onActualDurationChange,
  actualTime,
  onActualTimeChange,
  allTurnsCollapsed,
  onToggleAllTurns,
  allAssistantsCollapsed,
  onToggleAllAssistants,
  searchQuery,
  onSearchQueryChange,
  t,
}: TrajectoryToolbarProps): JSX.Element {
  return (
    <div class={css.root ?? ''} role="toolbar" aria-label={t('toolbar.aria')}>
      <div class={css.inner ?? ''}>
        <div class={css.actions ?? ''}>
          <button
            type="button"
            class={css.toggle ?? ''}
            aria-label={t('toolbar.useActualDuration')}
            aria-pressed={actualDuration}
            title={actualDuration ? t('toolbar.useEqualWidth') : t('toolbar.useActualDuration')}
            onclick={() => { onActualDurationChange(!actualDuration) }}
          >
            <svg
              class={css.toggleIcon ?? ''}
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="5.25" />
              <path d="M8 4.75V8l2.25 1.5" />
            </svg>
            {t('toolbar.duration')}
          </button>
          <button
            type="button"
            class={css.control ?? ''}
            role="switch"
            aria-checked={actualTime}
            hidden
            onclick={() => { onActualTimeChange(!actualTime) }}
          >
            <span>{t('toolbar.actualTime')}</span>
            <span class={css.controlTrack ?? ''} data-on={actualTime || undefined} aria-hidden="true">
              <span class={css.controlThumb ?? ''} />
            </span>
          </button>
          <button
            type="button"
            class={css.action ?? ''}
            aria-label={allTurnsCollapsed ? t('toolbar.expandTurns') : t('toolbar.collapseTurns')}
            aria-pressed={allTurnsCollapsed}
            title={allTurnsCollapsed ? t('toolbar.expandTurns') : t('toolbar.collapseTurns')}
            onclick={onToggleAllTurns}
          >
            <span class={css.actionIcon ?? ''} aria-hidden="true">
              {allTurnsCollapsed ? '⊞' : '⊟'}
            </span>
            {t('toolbar.turns')}
          </button>
          <button
            type="button"
            class={css.action ?? ''}
            aria-label={allAssistantsCollapsed ? t('toolbar.expandCalls') : t('toolbar.collapseCalls')}
            aria-pressed={allAssistantsCollapsed}
            title={allAssistantsCollapsed ? t('toolbar.expandCalls') : t('toolbar.collapseCalls')}
            onclick={onToggleAllAssistants}
          >
            <span class={css.actionIcon ?? ''} aria-hidden="true">
              {allAssistantsCollapsed ? '⊞' : '⊟'}
            </span>
            {t('toolbar.calls')}
          </button>
        </div>
        <div class={css.search ?? ''}>
          <IconSearchOutline16 size={11} className={css.searchIcon ?? ''} />
          <input
            type="search"
            class={css.searchInput ?? ''}
            aria-label={t('toolbar.search')}
            placeholder={t('toolbar.searchPlaceholder')}
            value={searchQuery}
            oninput={(event: Event) => { onSearchQueryChange((event.currentTarget as HTMLInputElement).value) }}
          />
        </div>
      </div>
    </div>
  )
}
