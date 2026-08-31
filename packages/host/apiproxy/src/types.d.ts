// cordis/dsh module augmentation has no JS equivalent -- kept as the sole .d.ts sidecar.
import type { ApiProxy } from './api/index.ts'
import type { SessionListMetadata } from './api/sessions.ts'
import type { RpcId } from './api/rpc.ts'
import type { ImageAttachmentLimits } from '@deepseek-ai/dsh-attachment'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The host-side ApiProxy implementation (the transport-agnostic gateway face). */
    apiProxy: ApiProxy
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    sessionListMetadata: SessionListMetadata
    imageLimits: null
  }
  interface SessionProjectionMap {
    /**
     * Session-list hints persisted by the projection cache. `blank: false`
     * is monotonic and may suppress a cold-log probe; `blank: true` is only a
     * checkpoint-prefix fact and must not hide a cold Session without direct
     * verification. `lastPromptAt` is the latest human-authored prompt time.
     */
    sessionListMetadata: SessionListMetadata
    /**
     * The deployment's image-intake limits: the attachments service's config
     * as this proxy enforces it at prompt admission, constant per host boot.
     * Clients pre-check count and bytes at intake and show the limits in
     * upload affordances. Key absence means no attachment service is
     * composed -- clients skip the pre-check and let the host answer.
     */
    imageLimits: ImageAttachmentLimits
  }
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /**
     * The prompt's rpcId is passed through MessageSource into the `user/message` event
     * (the client uses it to reconcile the optimistically
     * echoed provisional message with the event stream). kind stays `'user'` -- the model face
     * carries no transport vocabulary; rpcId and the optional Host-validated browser zone are
     * durable JSON fields passed back to the client with the event.
     */
    'user-rpc': { kind: 'user'; rpcId: RpcId; clientTimeZone?: string }
  }
}
