// Hero chrome for the blank-draft phase of ConversationRoot: fish headline,
// glow backdrop, and the workspace row. Pure presentation — the resident
// composer is NOT rendered here (it keeps its own stable tree position in
// ConversationRoot so the textarea survives the hero → composer flip); CSS
// positions it over this shell's glow area during the hero phase.

import type { VNode } from 'webjsx'
import {
  FishLogo, IconChevronDownOutline14, IconFolderClose16, IconFolderOpen16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { workspaceTitleOf } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConversationSlotProps } from '../contract/slots.ts'
import css from './HeroShell.module.css'

/** The owner's locale seat type, passed to hero chrome as a plain prop. */
type HeroTranslate = ConversationSlotProps['t']

/**
 * Basename label for the workspace chip (the shared derivation);
 * separator-only paths echo the raw cwd.
 * @param cwd - workspace directory path (non-empty).
 * @returns chip label.
 */
export function workspaceLabel(cwd: string): string {
  const base = workspaceTitleOf(cwd)
  return base !== '' ? base : cwd
}

/**
 * The workspace chip (folder + label + chevron), always interactive: before
 * the first message the workspace stays switchable — picking another one
 * moves the New Session flow to that workspace's blank session. Without a
 * label the chip renders its placeholder state: closed folder + the
 * "Choose workspace" call to action.
 * @param props.label - chip label (see {@link workspaceLabel}); omitted → placeholder.
 * @param props.menuOpen - menu expansion echo.
 * @param props.onClick - menu toggle.
 * @returns the chip button element.
 */
export function WorkspaceChip({ buttonRef, label, menuOpen = false, onClick, t }: {
  buttonRef?: { current: HTMLButtonElement | null }
  label?: string | undefined
  menuOpen?: boolean
  onClick?: (() => void) | null
  t: HeroTranslate
}): JSX.Element {
  return (
    <button
      ref={buttonRef}
      type="button"
      class={css.workspace ?? ''}
      aria-label={t('hero.chooseWorkspace')}
      aria-haspopup="menu"
      aria-expanded={menuOpen}
      onclick={onClick ?? null}
    >
      {label === undefined
        ? <IconFolderClose16 className={css.folder} size={16} />
        : <IconFolderOpen16 className={css.folder} size={16} />}
      <span class={css.workspaceLabel ?? ''}>{label ?? t('hero.chooseWorkspace')}</span>
      <IconChevronDownOutline14 className={css.chevron} size={12} />
    </button>
  )
}


/** Hero chrome props. The workspace row rides the InputBar accessory hole, not here. */
export interface HeroShellProps {
  /** The owner's locale seat, passed down as a plain prop. */
  t: HeroTranslate
  /** Authorized renderer for the hero brand-mark slot. */
  renderSlot: ConversationSlotProps['renderSlot']
  /** Overlay content after the stack (modals). */
  children?: VNode | VNode[] | string | null
}

/**
 * Render the hero chrome (headline only; no glow, no composer, no workspace
 * row — the glow is the owner's {@link HeroGlow}).
 * @param props - see {@link HeroShellProps}.
 * @returns the centered hero element tree.
 */
export function HeroShell({ t, renderSlot, children }: HeroShellProps): JSX.Element {
  return (
    <div class={css.root ?? ''}>
      <div class={css.stack ?? ''}>
        <div class={css.headline ?? ''}>
          {/* figma 34:10412: fish 34×25 leading the headline, gap 10. */}
          <span class={css.fishHitbox ?? ''}>
            {renderSlot('conversation.hero.brand.mark', { size: 34, className: css.fish }, {
              fallback: <FishLogo size={34} className={css.fish} /> as unknown as JSX.Element,
            })}
          </span>
          <span class={css.headlineText ?? ''}>{t('hero.headline')}</span>
          <span class={css.previewBadge ?? ''}>{t('hero.preview')}</span>
        </div>
        <div class={css.body ?? ''}>
          {/* The resident composer (ConversationRoot's root-owned scrollport;
              the workspace row rides the stack above the card) is CSS-centered
              in that scroll body during hero — see
              ConversationRoot.module.css [data-phase='hero']. */}
        </div>
      </div>
      {children}
    </div>
  )
}
