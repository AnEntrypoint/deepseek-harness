import type { TypertClientRemote } from '@deepseek-ai/dsh-typert-protocol'

/** Typed Remote service augmented by generated direct namespaces. */
export type ClientRemote = TypertClientRemote

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Generated Remote namespaces selected by the Client assembly. */
    remote: ClientRemote
  }
}
