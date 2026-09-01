import type { VNode } from 'webjsx'
import clsx from 'clsx'
import { IconChevronDownOutline14 } from './icons/index.tsx'
import css from './DisclosureRow.css.ts'

/** Shared 24px disclosure chrome for compact flow rows. */
export interface DisclosureRowProps {
  icon: VNode | string | null
  title: string
  open: boolean
  expandable: boolean
  onToggle: () => void
  /** Makes the complete title row the disclosure target. */
  expandOnRowClick?: boolean | undefined
  /** Replaces the collapsed icon with a chevron while the row is hovered. */
  previewChevron?: boolean | undefined
  /** Keeps `collapsedContent` inline while open. */
  keepContentWhenOpen?: boolean | undefined
  collapsedContent?: VNode | VNode[] | string | null
  children?: VNode | VNode[] | string | null
  className?: string | undefined
  rowClassName?: string | undefined
  leadingClassName?: string | undefined
  chevronClassName?: string | undefined
  titleClassName?: string | undefined
}

/**
 * Render one disclosure header and its controlled expanded content.
 * @param props - Visual content, controlled state, and interaction policy.
 * @returns the disclosure row.
 */
export function DisclosureRow({
  icon,
  title,
  open,
  expandable,
  onToggle,
  expandOnRowClick = false,
  previewChevron = expandable,
  keepContentWhenOpen = false,
  collapsedContent,
  children,
  className,
  rowClassName,
  leadingClassName,
  chevronClassName,
  titleClassName,
}: DisclosureRowProps): JSX.Element {
  const rowExpands = expandable && expandOnRowClick
  const toggleFromLeading = (event: MouseEvent) => {
    event.stopPropagation()
    onToggle()
  }
  const toggleFromKeyboard = (event: KeyboardEvent) => {
    if (!rowExpands || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onToggle()
  }
  const collapsedLeading = previewChevron
    ? [
      <span class={css.iconIdle ?? ''}>{icon}</span>,
      <IconChevronDownOutline14 className={clsx(chevronClassName, css.chevronHover)} />,
    ]
    : icon
  const leading = open
    ? <IconChevronDownOutline14 className={chevronClassName} />
    : collapsedLeading

  return (
    <div class={clsx(css.root, className)} data-open={open || undefined}>
      <div
        class={clsx(css.row, rowClassName)}
        data-disclosure-row=""
        data-expandable={rowExpands || undefined}
        role={rowExpands ? 'button' : null}
        tabindex={rowExpands ? 0 : undefined}
        aria-expanded={rowExpands ? open : undefined}
        onclick={rowExpands ? onToggle : null}
        onkeydown={rowExpands ? toggleFromKeyboard : null}
      >
        {expandable && !rowExpands ? (
          <button
            type="button"
            class={clsx(css.leading, leadingClassName)}
            aria-expanded={open}
            onclick={toggleFromLeading}
          >
            {leading}
          </button>
        ) : (
          <span class={clsx(css.leading, leadingClassName)}>
            {leading}
          </span>
        )}
        <span class={clsx(css.title, titleClassName)}>{title}</span>
        {(keepContentWhenOpen || !open) && collapsedContent}
      </div>
      {open && children}
    </div>
  )
}
