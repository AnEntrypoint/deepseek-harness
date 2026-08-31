/**
 * Browser UI renderer. It installs the slot renderer after its Cordis
 * dependencies activate and exposes the mount operation used by the web boot
 * kernel after the complete client roster settles.
 *
 * Converted from React: createRoot/hydrateRoot/flushSync become
 * `applyDiff(container, vnode)` — webjsx's whole mounting primitive.
 *
 * Verified against webjsx's own `applyDiff.js` source (not assumed): its
 * diff state (`getWebJSXProps(parent).children`) is undefined for a
 * container `applyDiff` has never touched, so the FIRST call against a
 * container always treats every incoming vnode as a `create` change and
 * removes any leftover original children afterward — it does not attempt to
 * adopt/reuse the boot kernel's existing `[data-dsh-boot]` markup node-for-
 * node the way React's `hydrateRoot` does. There is therefore no
 * "hydration" step to replicate: the former `BootHandoff` component (a
 * `useLayoutEffect`-timed swap from the kernel's boot HTML to the real tree)
 * is unnecessary because `applyDiff(container, vnode)` already performs
 * exactly that swap as an ordinary side effect of its first call — the boot
 * markup is simply the (empty, from webjsx's point of view) "old tree" the
 * first `applyDiff` replaces. The swap is not flicker-free at the DOM-node
 * level (nodes are recreated, not adopted), but the boot markup was static
 * kernel output with no client-side state to preserve, so this is a pure
 * simplification with no behavioral loss for this composition.
 */
import { applyDiff } from 'webjsx'
import type { Context } from '@deepseek-ai/cordis'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import { createSlotRenderer } from './scoped-slots.tsx'
import { buildRenderApp } from './app.tsx'

/** Selector hook over a session's conversation snapshot. */
export type UseSession<Snap extends object = object> = SnapshotSelectorHook<Snap>

export type {
  ChainRenderOpts, HostObservable, RenderOpts, SessionProvideInfo, SnapshotSelectorHook,
  SlotRenderer, SlotRendererHost, StoreInstanceLike,
} from '@deepseek-ai/dsh-client-ui-slots'
export type { SessionProviderProps } from './session-provider.tsx'

/** Mount operation exposed to the framework-free boot kernel. */
export interface UiRendererService {
  /**
   * Mount the assembled application into the supplied element.
   * @param container - Application mount point.
   * @returns Disposer that unmounts the application.
   */
  mount: (container: HTMLElement) => () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Mount face provided after the UI renderer activates. */
    uiRenderer: UiRendererService
  }
}

/** Services required before application assembly. */
export const inject = ['slots', 'sessions']

/**
 * Mount the application into `container`. The boot kernel's framework-free
 * `[data-dsh-boot]` markup (if present) needs no special handling: webjsx's
 * `applyDiff` diffs the new tree directly against whatever DOM is already
 * there, present or absent.
 */
function mountApp(container: HTMLElement, render: () => unknown): void {
  applyDiff(container, render() as never)
}

/**
 * Install the slot renderer and provide the application mount face.
 * @param ctx - Plugin context.
 */
export function apply(ctx: Context): void {
  ctx.slots.install(createSlotRenderer())
  ctx.reflect.provide('uiRenderer', {
    mount: (container: HTMLElement): (() => void) => {
      const { render, dispose } = buildRenderApp({ ctx })
      mountApp(container, render)
      return () => {
        dispose()
        applyDiff(container, [])
      }
    },
  })
}
