/**
 * Package-owned invariant companion for `@freddie/freddie-hooks-codex`.
 * @module @freddie/freddie-hooks-codex/invariant
 */

/* jscpd:ignore-start */
const PACKAGE_NAME = '@freddie/freddie-hooks-codex'

/** Cordis companion plugin name. */
export const name = 'hooks-codex-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: this bridge publishes hook-protocol session events, whose companion owns
 * which invocation event each result cites.
 */
const install = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
