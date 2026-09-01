/**
 * Controlled risk acknowledgement dialog shared by product surfaces that
 * must gate a sensitive action behind an explicit checkbox.
 *
 * Converted from a React function component to a webjsx custom element
 * wrapping `renderModal`: the one-shot `Modal(...)` helper always creates
 * and appends a brand-new `dsh-modal` to `document.body`, so calling it
 * fresh from a plain function component on every parent re-render (the
 * shape every one of this file's callers uses — a class field like
 * `#confirmingFullAccess` flips and `#render()` fires again) orphaned a new
 * modal on every state change instead of updating one in place: stale
 * modals (some still mid-open) piled up in the DOM and could swallow clicks
 * meant for the current one. Holding the `dsh-modal` across renders via
 * `renderModal(this.#modal, ...)` (Modal.tsx's own pattern, mirrored here)
 * fixes that at the source for every caller at once.
 */
import { renderModal } from './Modal.tsx'
import type { DshModal } from './Modal.tsx'
import { Button } from './Button.tsx'
import { IconWarningOutline16 } from './icons/index.tsx'
import css from './RiskConfirmation.css.ts'

export interface RiskConfirmationProps {
  open: boolean
  title: string
  description: string
  acknowledgeLabel: string
  cancelLabel: string
  confirmLabel: string
  acknowledged: boolean
  disabled?: boolean
  onAcknowledgedChange: (acknowledged: boolean) => void
  onCancel: () => void
  onConfirm: () => void
}

/**
 * Update (or create) the underlying `dsh-modal` for one risk confirmation.
 * @param el - the modal returned by a prior call, or null to create one.
 * @param props - see {@link RiskConfirmationProps}.
 * @returns the `dsh-modal` element; hold it and pass it back in on the next render.
 */
export function renderRiskConfirmation(el: DshModal | null, {
  open,
  title,
  description,
  acknowledgeLabel,
  cancelLabel,
  confirmLabel,
  acknowledged,
  disabled = false,
  onAcknowledgedChange,
  onCancel,
  onConfirm,
}: RiskConfirmationProps): DshModal {
  return renderModal(el, {
    open,
    onClose: onCancel,
    title,
    className: css.confirmation ?? '',
    contentClassName: css.confirmationContent ?? '',
    footer: [
      <Button variant="outline" class={css.modalAction} onclick={onCancel}>
        {cancelLabel}
      </Button>,
      <Button
        variant="primary"
        class={css.confirmAction}
        disabled={disabled || !acknowledged}
        onclick={onConfirm}
      >
        {confirmLabel}
      </Button>,
    ],
    children: (
      <>
        <div class={css.warning ?? ''}>
          <IconWarningOutline16 size={18} className={css.warningIcon} />
          <p>{description}</p>
        </div>
        <label class={css.acknowledgement ?? ''}>
          <input
            type="checkbox"
            checked={acknowledged}
            disabled={disabled}
            autofocus
            onchange={(event: Event) => { onAcknowledgedChange((event.currentTarget as HTMLInputElement).checked) }}
          />
          <span>{acknowledgeLabel}</span>
        </label>
      </>
    ),
  })
}

/**
 * One-shot creation/update helper preserving the original function-component
 * call shape for a caller that has not yet been converted to hold the
 * element itself. Prefer `renderRiskConfirmation(el, props)` in any owner
 * that re-renders more than once (holds the element across renders instead
 * of recreating it every call) — this wrapper cannot do that on the
 * caller's behalf since it has no owner-scoped place to keep `el`.
 */
export function RiskConfirmation(props: RiskConfirmationProps): JSX.Element {
  return renderRiskConfirmation(null, props) as unknown as JSX.Element
}
