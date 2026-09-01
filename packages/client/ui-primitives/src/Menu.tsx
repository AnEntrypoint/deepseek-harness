// Menu: minimal controlled dropdown (group-by pickers, project selectors).
// Default: pure CSS positioning relative to the anchor wrapper — no popper.
// Opt-in `portal` renders the list into document.body, fixed-positioned from
// the anchor rect, for anchors inside overflow-clipping containers (sidebar).
// The owner controls `open`; outside-click closing uses one document listener
// active only while open. Submenus open on hover/focus inside the same root.
// Entries also cover non-interactive `label` headings and `danger` rows.
// Lists keep 12px clearance to the viewport's top/bottom edges and scroll
// internally past that; submenu-bearing menus are exempt (see .scrollable).
//
// Converted from a React hooks component to a webjsx custom element:
// openSubmenuId/fixedPos become instance fields, the placement/outside-click/
// grace-cancel effects become connectedCallback/disconnectedCallback plus
// createDismissOnOutsidePointer, and re-render is an explicit
// applyDiff(this, vdom) call (Toast.tsx's pattern). Portal mode appends the
// list element to document.body directly (createPortal's webjsx equivalent).

import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import clsx from 'clsx'
import { IconCheckOutline16 } from './icons/index.tsx'
import css from './Menu.css.ts'

/** Selectable row (optionally with a nested submenu). */
export interface MenuItem {
  id: string
  label: VNode | string
  disabled?: boolean
  /** Leading icon (figma .Menu_cell gap 8). */
  icon?: VNode | string
  /** Destructive row: error-colored text/icon and danger hover fill. */
  danger?: boolean
  /** Nested card opened to the right on hover/focus. */
  submenu?: readonly MenuItem[]
}

/** Hairline between item groups (not selectable). */
export interface MenuSeparator {
  type: 'separator'
  id: string
}

/** Non-interactive heading row above a group of items. */
export interface MenuLabel {
  type: 'label'
  id: string
  text: string
}

/** One primary-menu entry: a row, a separator, or a heading label. */
export type MenuEntry = MenuItem | MenuSeparator | MenuLabel

function isSeparator(entry: MenuEntry): entry is MenuSeparator {
  return 'type' in entry && entry.type === 'separator'
}

function isLabel(entry: MenuEntry): entry is MenuLabel {
  return 'type' in entry && entry.type === 'label'
}

/** Safe distance kept between the list and the viewport edge. */
const MARGIN = 12

export interface MenuProps {
  open: boolean
  anchor: VNode | string
  items: readonly MenuEntry[]
  footer?: readonly MenuEntry[]
  selectedId?: string | undefined
  selectedIds?: readonly string[] | undefined
  onSelect: (id: string) => void
  onClose: () => void
  align?: 'start' | 'end'
  side?: 'bottom' | 'top' | 'right'
  portal?: boolean
  closeOnPointerLeave?: boolean
  dense?: boolean
  compact?: boolean
  getAnchorRect?: () => DOMRect | null
  className?: string
}

const DEFAULT_PROPS: MenuProps = {
  open: false,
  anchor: '',
  items: [],
  onSelect: () => {},
  onClose: () => {},
}

/**
 * Anchored dropdown menu custom element.
 * @see MenuProps for the field-by-field docs (unchanged from the React version).
 */
export class DshMenu extends HTMLElement {
  #props: MenuProps = DEFAULT_PROPS
  #openSubmenuId: string | null = null
  #fixedPos: { left: number; top: number } | null = null
  #placeHandler: (() => void) | null = null
  #outsideHandler: ((e: PointerEvent) => void) | null = null
  #keyHandler: ((e: KeyboardEvent) => void) | null = null
  #graceTimer: ReturnType<typeof setTimeout> | null = null
  #portalList: HTMLDivElement | null = null

  /** Set/replace props and re-render; call after creating or updating the element. */
  setProps(props: MenuProps): void {
    const prevOpen = this.#props.open
    this.#props = props
    if (!props.open) this.#openSubmenuId = null
    this.#syncOpenState(prevOpen, props.open)
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  disconnectedCallback(): void {
    this.#unbindPlacement()
    this.#unbindOutsideClose()
    this.#cancelGrace()
    this.#portalList?.remove()
    this.#portalList = null
  }

  #syncOpenState(prevOpen: boolean, open: boolean): void {
    if (open === prevOpen) return
    if (open) {
      this.#bindPlacement()
      this.#bindOutsideClose()
    } else {
      this.#unbindPlacement()
      this.#unbindOutsideClose()
      this.#cancelGrace()
    }
  }

  #bindPlacement(): void {
    this.#unbindPlacement()
    if (!this.#props.portal) return
    const place = (): void => {
      const { getAnchorRect, align = 'start', side = 'bottom' } = this.#props
      let r: DOMRect | null
      if (getAnchorRect !== undefined) {
        r = getAnchorRect()
      } else {
        const wrapper = this.querySelector<HTMLElement>('[data-menu-root]')
        r = wrapper?.getBoundingClientRect() ?? null
      }
      if (r === null) return
      const vw = window.innerWidth
      const vh = window.innerHeight
      const listEl = this.#portalList
      const lw = listEl?.offsetWidth ?? 0
      const lh = listEl?.offsetHeight ?? 0

      let x: number
      let y: number
      if (side === 'right') {
        x = r.right + 4
        y = r.top
      } else if (align === 'start') {
        x = r.left
        y = side === 'bottom' ? r.bottom + 4 : r.top - lh - 4
      } else {
        x = r.right - lw
        y = side === 'bottom' ? r.bottom + 4 : r.top - lh - 4
      }

      if (lw > 0) x = Math.min(Math.max(x, MARGIN), vw - lw - MARGIN)
      if (lh > 0) y = Math.min(Math.max(y, MARGIN), vh - lh - MARGIN)

      this.#fixedPos = { left: x, top: y }
      this.#render()
    }
    this.#placeHandler = place
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
  }

  #unbindPlacement(): void {
    if (this.#placeHandler === null) return
    window.removeEventListener('scroll', this.#placeHandler, true)
    window.removeEventListener('resize', this.#placeHandler)
    this.#placeHandler = null
    this.#fixedPos = null
  }

  #bindOutsideClose(): void {
    this.#unbindOutsideClose()
    const onPointerDown = (e: PointerEvent): void => {
      if (!(e.target instanceof Node)) return
      const wrapper = this.querySelector<HTMLElement>('[data-menu-root]')
      if (wrapper?.contains(e.target) === true) return
      if (this.#portalList?.contains(e.target) === true) return
      this.#props.onClose()
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') this.#props.onClose()
    }
    this.#outsideHandler = onPointerDown
    this.#keyHandler = onKeyDown
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
  }

  #unbindOutsideClose(): void {
    if (this.#outsideHandler !== null) {
      document.removeEventListener('pointerdown', this.#outsideHandler)
      this.#outsideHandler = null
    }
    if (this.#keyHandler !== null) {
      document.removeEventListener('keydown', this.#keyHandler)
      this.#keyHandler = null
    }
  }

  #cancelGrace(): void {
    if (this.#graceTimer !== null) {
      clearTimeout(this.#graceTimer)
      this.#graceTimer = null
    }
  }

  #armGrace(): void {
    this.#cancelGrace()
    this.#graceTimer = setTimeout(() => {
      this.#graceTimer = null
      this.#props.onClose()
    }, 200)
  }

  #renderEntry(entry: MenuEntry): VNode {
    const { compact = false, selectedId, selectedIds, onSelect } = this.#props
    if (isSeparator(entry)) {
      return <div key={entry.id} class={css.separator ?? ''} role="separator" />
    }
    if (isLabel(entry)) {
      return <div key={entry.id} class={css.label ?? ''} role="presentation">{entry.text}</div>
    }
    const hasSub = entry.submenu !== undefined && entry.submenu.length > 0
    const subOpen = hasSub && this.#openSubmenuId === entry.id
    const selected = entry.id === selectedId || selectedIds?.includes(entry.id) === true
    return (
      <div
        key={entry.id}
        class={css.itemWrap ?? ''}
        onmouseenter={() => { this.#openSubmenuId = hasSub ? entry.id : null; this.#render() }}
        onmouseleave={() => { this.#openSubmenuId = null; this.#render() }}
      >
        <button
          type="button"
          role="menuitem"
          class={clsx(css.item, selected && css.selected, entry.danger === true && css.danger)}
          disabled={entry.disabled ?? false}
          aria-haspopup={hasSub ? 'menu' : undefined}
          aria-expanded={hasSub ? subOpen : undefined}
          onfocus={() => { this.#openSubmenuId = hasSub ? entry.id : null; this.#render() }}
          onclick={() => {
            if (hasSub) {
              this.#openSubmenuId = entry.id
              this.#render()
              return
            }
            onSelect(entry.id)
          }}
        >
          {entry.icon !== undefined && <span class={css.itemIcon ?? ''}>{entry.icon}</span>}
          <span class={css.itemLabel ?? ''}>{entry.label}</span>
          {selected && <IconCheckOutline16 className={css.check} />}
        </button>
        {subOpen && entry.submenu !== undefined && (
          <div class={clsx(css.submenu, compact && css.compactList)} role="menu">
            {entry.submenu.map(sub => (
              <button
                key={sub.id}
                type="button"
                role="menuitem"
                class={css.item ?? ''}
                disabled={sub.disabled ?? false}
                onclick={() => { onSelect(sub.id) }}
              >
                {sub.icon !== undefined && <span class={css.itemIcon ?? ''}>{sub.icon}</span>}
                <span class={css.itemLabel ?? ''}>{sub.label}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    )
  }

  #buildList(): VNode | null {
    const { open, items, footer, dense = false, compact = false, portal = false, side = 'bottom', align = 'start' } = this.#props
    if (!open) return null
    const scrollable = !items.some(entry =>
      !isSeparator(entry) && !isLabel(entry) && entry.submenu !== undefined && entry.submenu.length > 0)
    return (
      <div
        class={clsx(css.list, dense && css.denseList, compact && css.compactList, scrollable && css.scrollable, portal && css.portal, side === 'top' && !portal && css.sideTop, align === 'end' && !portal && css.alignEnd)}
        style={portal
          ? (this.#fixedPos === null
            ? 'visibility: hidden; left: 0; top: 0'
            : `left: ${this.#fixedPos.left}px; top: ${this.#fixedPos.top}px`)
          : ''}
        role="menu"
        onclick={(e: Event) => { e.stopPropagation() }}
      >
        <div class={css.viewport ?? ''} role="presentation">
          {items.map(entry => this.#renderEntry(entry))}
        </div>
        {footer !== undefined && footer.length > 0 && (
          <div class={css.footer ?? ''} role="presentation">
            {footer.map(entry => this.#renderEntry(entry))}
          </div>
        )}
      </div>
    )
  }

  #render(): void {
    const { anchor, className, closeOnPointerLeave = false, open, portal = false } = this.#props
    const list = this.#buildList()

    if (portal) {
      if (open && list !== null) {
        if (this.#portalList === null) {
          this.#portalList = document.createElement('div')
          document.body.appendChild(this.#portalList)
        }
        applyDiff(this.#portalList, list)
      } else {
        this.#portalList?.remove()
        this.#portalList = null
      }
    } else {
      this.#portalList?.remove()
      this.#portalList = null
    }

    const vdom = (
      <span
        data-menu-root
        class={clsx(css.root, className)}
        onpointerenter={closeOnPointerLeave ? () => { this.#cancelGrace() } : null}
        onpointerleave={closeOnPointerLeave ? () => { if (this.#props.open) this.#armGrace() } : null}
      >
        {anchor}
        {!portal && list}
      </span>
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-menu') === undefined) {
  customElements.define('dsh-menu', DshMenu)
}

/**
 * Create (if needed) or update a Menu element in place.
 * @param el - an existing `dsh-menu` element (from a prior call) to update, or null to create one.
 * @param props - see {@link MenuProps}.
 * @returns the `dsh-menu` element; keep it and pass it back in to update.
 */
export function renderMenu(el: DshMenu | null, props: MenuProps): DshMenu {
  const target = el ?? document.createElement('dsh-menu') as DshMenu
  target.setProps(props)
  return target
}

/** One-shot creation helper preserving the original function-component call shape. */
export function Menu(props: MenuProps): JSX.Element {
  return renderMenu(null, props) as unknown as JSX.Element
}
