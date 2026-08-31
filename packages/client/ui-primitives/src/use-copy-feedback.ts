// The copy-to-clipboard-with-feedback controller shared by the block
// primitives (TerminalBlock, SearchBlock): write the given text, and on
// success flip a transient `copied` flag that the caller renders as a
// "复制成功" label for one second. A refused write leaves the flag untouched,
// so the control never claims a copy the host declined.
//
// Converted from a React hook (useState/useCallback) to a plain closure:
// create with `createCopyFeedback(getText, onChange)`, call `.onCopy()` from
// the click handler, read `.copied` for the current flag, and call `.stop()`
// in `disconnectedCallback` to clear any pending timeout.

import { writeClipboard } from './clipboard.ts'

/** How long the `copied` flag stays true after a successful write, in ms. */
const COPIED_FEEDBACK_MS = 1000

/** Controller returned by {@link createCopyFeedback}. */
export interface CopyFeedbackController {
  /** True for {@link COPIED_FEEDBACK_MS} after a successful write; render the success label off it. */
  readonly copied: boolean
  /** Copy the current text (from `getText`); no-op while `copied` is still true, silent on a refused write. */
  onCopy: () => void
  /** Clear any pending reset timeout. Idempotent. Call in `disconnectedCallback`. */
  stop: () => void
}

/**
 * Create a controller that copies text to the clipboard with one-second
 * success feedback.
 * @param getText - returns the text to write on copy, read fresh on each call
 *   so the owner can update its text prop without recreating the controller.
 * @param onChange - called with the new `copied` value whenever it changes.
 * @returns a controller exposing `copied`, `onCopy`, and `stop`.
 */
export function createCopyFeedback(getText: () => string, onChange: (copied: boolean) => void): CopyFeedbackController {
  let copied = false
  let resetTimer: ReturnType<typeof window.setTimeout> | null = null

  const setCopied = (next: boolean): void => {
    copied = next
    onChange(copied)
  }

  return {
    get copied() { return copied },
    onCopy(): void {
      if (copied) return
      void writeClipboard(getText()).then((ok) => {
        if (!ok) return
        setCopied(true)
        resetTimer = window.setTimeout(() => {
          resetTimer = null
          setCopied(false)
        }, COPIED_FEEDBACK_MS)
      })
    },
    stop(): void {
      if (resetTimer !== null) {
        window.clearTimeout(resetTimer)
        resetTimer = null
      }
    },
  }
}
