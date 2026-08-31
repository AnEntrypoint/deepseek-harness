/**
 * The preset picker both surfaces render: a menu of presets over a button
 * naming the current one.
 *
 * The settings row and the composer seat differ in where they sit, what they
 * call the current value, and when they refuse a pick — not in how the picker
 * itself behaves. Trust is the one thing the list always says: a locally
 * authored preset is exactly as privileged as the plugins it names, so the
 * label marks it rather than presenting every preset as shipped and vetted.
 */

import { IconChevronDownOutline14, renderMenu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DshMenu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { AgentPresetOption } from './settings-store.ts'
import { presetDisplayText, type AgentPresetSettingsKey } from './locales.ts'

/** What one surface passes to the shared picker. */
export interface PresetMenuProps {
  /** Presets to offer, in roster order. */
  options: readonly AgentPresetOption[]
  /** The preset the button names and the menu marks selected. */
  selectedId: string
  /** Text on the button; the surfaces word a pending roster differently. */
  label: string
  /** Active Web locale lookup. */
  t: (key: AgentPresetSettingsKey) => string
  /** Class for the trigger button, owned by the calling surface. */
  buttonClassName: string | undefined
  /** Class for the chevron, owned by the calling surface. */
  chevronClassName: string | undefined
  /** Whether the trigger refuses interaction. */
  disabled: boolean
  /** Whether the menu is open — the surface owns this so it can force it shut. */
  open: boolean
  /** Report the menu's next open state. */
  onOpenChange: (open: boolean) => void
  /** Called with the picked preset once the menu has closed. */
  onSelect: (id: string) => void
}

/**
 * Build or update the preset picker: a menu of presets over a button naming
 * the current one. Returns a real `dsh-menu` element (self-rendering, see
 * Menu.tsx) — the caller must attach it to the DOM directly (e.g. via
 * `replaceWith`/`appendChild`), never diff it in as a JSX child. Pass the
 * previously returned element back in as `el` to update it in place instead
 * of recreating it (preserves the menu's own internal state).
 * @param el - an existing menu element from a prior call, or null to create one.
 * @param props - the calling surface's copy, styling, and handlers.
 * @returns the menu-with-trigger element.
 */
export function renderPresetMenu(el: DshMenu | null, {
  options, selectedId, label, t, buttonClassName, chevronClassName,
  disabled, open, onOpenChange, onSelect,
}: PresetMenuProps): DshMenu {
  return renderMenu(el, {
    open,
    onClose: () => { onOpenChange(false) },
    items: options.map((option) => {
      const name = presetDisplayText(option, t).name
      return {
        id: option.id,
        // All preset surfaces resolve copy the same way; the id is addressing,
        // not a label, except where no display name exists.
        label: option.trust === 'user' ? `${name} · ${t('userTrust')}` : name,
      }
    }),
    selectedId,
    onSelect: (id) => {
      onOpenChange(false)
      onSelect(id)
    },
    align: 'end',
    portal: true,
    anchor: (
      <button
        type="button"
        class={buttonClassName ?? ''}
        aria-haspopup="menu"
        aria-expanded={String(open)}
        disabled={disabled}
        onclick={() => { onOpenChange(!open) }}
      >
        {label}
        <IconChevronDownOutline14 className={chevronClassName} />
      </button>
    ),
  })
}
