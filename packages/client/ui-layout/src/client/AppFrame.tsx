/**
 * Three-column shell frame, registered into the built-in 'root' slot (the web
 * shell renders only 'root'). Owns the grid tracks (sidebar | center |
 * details), the drag handles (pointer capture + rAF throttle), the concession
 * chain (columns.ts), and the child-slot render decisions: the sidebar slot
 * renders HERE with live parameters from the concession solve, and the
 * session-aware occupants render in fixed column positions; strict entries
 * gate themselves on current-session availability while session-maybe
 * entries retain identity. Pure component: everything arrives
 * through the three framework shares — zero cordis or framework imports,
 * zero self-made hooks.
 *
 * Converted from a React hooks component to webjsx custom elements:
 * AppFrame's useState/useRef/useEffect/useLayoutEffect become instance
 * fields plus connectedCallback/disconnectedCallback with an explicit
 * ResizeObserver teardown; the drag handle's per-gesture pointer-capture
 * state becomes its own DshDragHandle custom element (dragging/origin/
 * latest/frame as instance fields, rAF-throttled pointer events unchanged).
 */
import { applyDiff } from 'webjsx'
import type { VNode } from 'webjsx'
import type { PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { computeColumns, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT } from './columns.ts'
import type { createLayoutStore } from './stores.ts'
import css from './AppFrame.css.ts'

/** Full composed props: runtime share + child-slot render share + store share. */
export type AppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'details' | 'shell.overlay'>
  & PropsStore<ReturnType<typeof createLayoutStore>>

/** Cast a renderSlot() ReactNode result into a webjsx-embeddable child (matches ui-conversation's DshConversationRoot). */
function asChild(node: unknown): VNode {
  return node as unknown as VNode
}

/** Drag handle props: one resize gesture over a column edge. */
export interface DragHandleProps {
  side: 'sidebar' | 'details'
  left: number
  onStart: () => void
  onDrag: (dx: number) => void
  onEnd: () => void
}

/**
 * One drag handle custom element: pointer capture, rAF-throttled dx reports
 * against the drag-start origin. `side` keys the hover-reveal CSS to the
 * owning column.
 */
export class DshDragHandle extends HTMLElement {
  #props: DragHandleProps | null = null
  #dragging = false
  #origin = 0
  #latest = 0
  #frame: number | null = null

  setProps(props: DragHandleProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.addEventListener('pointerdown', this.#onPointerDown)
    this.addEventListener('pointermove', this.#onPointerMove)
    this.addEventListener('pointerup', this.#onPointerUp)
    this.#render()
  }

  disconnectedCallback(): void {
    this.removeEventListener('pointerdown', this.#onPointerDown)
    this.removeEventListener('pointermove', this.#onPointerMove)
    this.removeEventListener('pointerup', this.#onPointerUp)
    if (this.#frame !== null) { cancelAnimationFrame(this.#frame); this.#frame = null }
  }

  #onPointerDown = (e: PointerEvent): void => {
    const props = this.#props
    if (props === null) return
    e.preventDefault()
    this.setPointerCapture(e.pointerId)
    this.#origin = e.clientX
    this.#latest = e.clientX
    props.onStart()
    this.#dragging = true
    this.#render()
  }

  #onPointerMove = (e: PointerEvent): void => {
    const props = this.#props
    if (props === null || !this.hasPointerCapture(e.pointerId)) return
    this.#latest = e.clientX
    this.#frame ??= requestAnimationFrame(() => {
      this.#frame = null
      props.onDrag(this.#latest - this.#origin)
    })
  }

  #onPointerUp = (e: PointerEvent): void => {
    const props = this.#props
    if (props === null || !this.hasPointerCapture(e.pointerId)) return
    this.releasePointerCapture(e.pointerId)
    if (this.#frame !== null) { cancelAnimationFrame(this.#frame); this.#frame = null }
    props.onDrag(this.#latest - this.#origin)
    this.#dragging = false
    this.#render()
    props.onEnd()
  }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const vdom = (
      <div
        class={css.handle ?? ''}
        style={`left: ${props.left}px`}
        data-side={props.side}
        data-dragging={this.#dragging ? 'true' : null}
      />
    )
    applyDiff(this, vdom)
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-drag-handle') === undefined) {
  customElements.define('dsh-drag-handle', DshDragHandle)
}

/**
 * Create or update a drag handle element in place.
 * @param el - a previously created element, or null to create one.
 * @param props - the current drag props.
 * @returns the handle element.
 */
function renderDragHandle(el: DshDragHandle | null, props: DragHandleProps): DshDragHandle {
  const target = el ?? document.createElement('dsh-drag-handle') as DshDragHandle
  target.setProps(props)
  return target
}

/** The three-column frame custom element (see module doc). */
export class DshAppFrame extends HTMLElement {
  #props: AppFrameProps | null = null
  #frameEl: HTMLDivElement | null = null
  #resizeObserver: ResizeObserver | null = null
  #resizeRaf: number | null = null
  #viewport = typeof window === 'undefined' ? 0 : window.innerWidth
  #lastSession: string | undefined = undefined
  #dragging = false
  #sidebarBase = 0
  #detailsBase = 0
  #sidebarHandle: DshDragHandle | null = null
  #detailsHandle: DshDragHandle | null = null
  #cols = { sidebar: 0, details: 0 }

  setProps(props: AppFrameProps): void {
    this.#props = props
    this.#render()
  }

  connectedCallback(): void {
    this.#render()
  }

  disconnectedCallback(): void {
    this.#resizeObserver?.disconnect()
    this.#resizeObserver = null
    if (this.#resizeRaf !== null) { cancelAnimationFrame(this.#resizeRaf); this.#resizeRaf = null }
  }

  #bindResizeObserver(frame: HTMLDivElement): void {
    if (this.#frameEl === frame) return
    this.#resizeObserver?.disconnect()
    this.#frameEl = frame
    const observer = new ResizeObserver(() => {
      this.#resizeRaf ??= requestAnimationFrame(() => {
        this.#resizeRaf = null
        const width = frame.getBoundingClientRect().width
        if (width > 0 && width !== this.#viewport) {
          this.#viewport = width
          this.#render()
        }
      })
    })
    observer.observe(frame)
    this.#resizeObserver = observer
  }

  #onDragEnd = (): void => { this.#dragging = false; this.#render() }
  #onSidebarStart = (): void => { this.#sidebarBase = this.#cols.sidebar; this.#dragging = true; this.#render() }
  #onDetailsStart = (): void => { this.#detailsBase = this.#cols.details; this.#dragging = true; this.#render() }
  #onSidebarDrag = (dx: number): void => { this.#props?.actions.setSidebar(this.#sidebarBase + dx) }
  #onDetailsDrag = (dx: number): void => { this.#props?.actions.setDetails(this.#detailsBase - dx) }

  #render(): void {
    const props = this.#props
    if (props === null) return
    const { useStore, useSessions, actions, renderSlot } = props

    const panels = useStore(s => s)
    const detailsSession = useSessions((s) => {
      const current = s.current
      return current !== undefined && s.byId[current]?.blank === false ? current : undefined
    })

    if (detailsSession !== undefined) {
      if (this.#lastSession !== undefined && this.#lastSession !== detailsSession) {
        actions.closeDetails()
      }
      this.#lastSession = detailsSession
    }

    const narrow = this.#viewport < SIDEBAR_AUTO_COLLAPSE
    actions.setNarrow(narrow)
    const sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0
    const sidebarPreference = sidebarCollapsed
      ? 0
      : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar
    const cols = computeColumns(this.#viewport, sidebarPreference, detailsSession === undefined ? 0 : panels.details)
    this.#cols = cols

    const vdom = (
      <div
        class={css.frame ?? ''}
        style={`grid-template-columns: ${cols.sidebar}px minmax(0, 1fr) ${cols.details}px`}
        data-sidebar-collapsed={sidebarCollapsed ? 'true' : null}
        data-details-collapsed={cols.details === 0 ? 'true' : null}
        data-dragging={this.#dragging ? 'true' : null}
      >
        <div class={css.sidebarCol ?? ''} data-sidebar-col>
          {/* Render-site slot call with live concession output: a closed
              sidebar keeps the mounted slot at the compact-rail width, and the
              component sees its rendered state as owner params decided here
              (collapsed follows the resolved rail, so a derived auto-collapse
              renders the rail UI too). */}
          {asChild(renderSlot('sidebar', {
            collapsed: sidebarCollapsed,
            width: cols.sidebar,
          }))}
        </div>
        {/* Both column occupants stay at fixed tree positions from first
            paint — no loading gate: a bare status line reads worse than
            the shell's own pending rendering. The conversation
            is session-maybe; the strict details entry naturally renders
            empty while no session is current. */}
        <div class={css.centerCol ?? ''}>{asChild(renderSlot('conversation', {}))}</div>
        <div class={css.detailsCol ?? ''}>{asChild(renderSlot('details', {}))}</div>
        <div class={css.overlayLayer ?? ''} data-shell-overlay>
          {asChild(renderSlot('shell.overlay', {}))}
        </div>
        <span data-sidebar-handle-slot="" />
        <span data-details-handle-slot="" />
      </div>
    )
    applyDiff(this, vdom)

    const frame = this.querySelector<HTMLDivElement>('[data-sidebar-col]')?.parentElement as HTMLDivElement | null ?? null
    if (frame !== null) this.#bindResizeObserver(frame)

    // The collapsed rail is fixed-width: no resize handle while closed.
    const sidebarSlot = this.querySelector<HTMLElement>('[data-sidebar-handle-slot]')
    if (!sidebarCollapsed) {
      this.#sidebarHandle = renderDragHandle(this.#sidebarHandle, {
        side: 'sidebar', left: cols.sidebar, onStart: this.#onSidebarStart, onDrag: this.#onSidebarDrag, onEnd: this.#onDragEnd,
      })
      sidebarSlot?.replaceWith(this.#sidebarHandle)
    } else {
      this.#sidebarHandle = null
      sidebarSlot?.replaceWith(document.createComment('sidebar-handle-hidden'))
    }

    const detailsSlot = this.querySelector<HTMLElement>('[data-details-handle-slot]')
    if (cols.details > 0) {
      this.#detailsHandle = renderDragHandle(this.#detailsHandle, {
        side: 'details', left: this.#viewport - cols.details, onStart: this.#onDetailsStart, onDrag: this.#onDetailsDrag, onEnd: this.#onDragEnd,
      })
      detailsSlot?.replaceWith(this.#detailsHandle)
    } else {
      this.#detailsHandle = null
      detailsSlot?.replaceWith(document.createComment('details-handle-hidden'))
    }
  }
}

if (typeof customElements !== 'undefined' && customElements.get('dsh-app-frame') === undefined) {
  customElements.define('dsh-app-frame', DshAppFrame)
}

/**
 * Render the three-column frame.
 * @param props - composed slot props (runtime + child-slot render + store shares).
 * @returns the frame element.
 */
export function AppFrame(props: AppFrameProps): VNode {
  const el = document.createElement('dsh-app-frame') as DshAppFrame
  el.setProps(props)
  return el as unknown as VNode
}
