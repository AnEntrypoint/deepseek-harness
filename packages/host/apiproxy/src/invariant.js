/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-host-apiproxy`.
 * @module @deepseek-ai/dsh-host-apiproxy/invariant
 */

/* jscpd:ignore-start */
const PACKAGE_NAME = '@deepseek-ai/dsh-host-apiproxy'

export const name = 'host-apiproxy-invariant'
export const inject = ['invariants']

/**
 * No runtime invariant: this package is the wire contract layer plus the
 * host-side gateway over services owned elsewhere — it emits no cordis events
 * of its own; the session/agent event streams it projects are asserted by
 * their owning packages' companions. rpcId round-trip and schema acceptance
 * are enforced at the carrier boundary and exercised by the
 * protocol-isomorphism suite.
 */
const install = () => {}

export const apply = ctx =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
