// cordis module augmentation has no JS equivalent -- kept as the sole .d.ts sidecar.
import type { WebServer } from './index.js'
import type { IndexInjection } from './injections.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    webServer: WebServer
  }
  interface Events {
    /**
     * Collect the structured index injection table. Emitted on every index
     * render and every worker boot-payload request; listeners push their
     * current rows, so a row's data is read fresh at emit time.
     */
    'webserver/index-inject'(table: IndexInjection[]): void
  }
}
