import type { ObservableSnapshot, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { Button, type ModalProps } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionLogDownloadState } from './controller.ts'
import { NS } from './locales.ts'

/** Browser operations and state injected into the Session Header contribution. */
export interface SessionLogDownloadDialogInjected {
  hooks: { sessionLogDownload: ObservableSnapshot<SessionLogDownloadState> }
  request: (sessionId: SessionId) => Promise<void>
  dismiss: (sessionId: SessionId) => void
}

export type SessionLogDownloadDialogProps =
  PropsRuntime<'conversation.session.header.utilities'>
  & PropsLocale<typeof NS>
  & InjectFace<SessionLogDownloadDialogInjected>

/**
 * Compute the shared result modal's props from the Session Header
 * contribution's own props. Split out from JSX so the owner (HeaderAction's
 * custom element) can hold and update one `dsh-modal` instance across
 * renders via `renderModal(el, props)`, instead of a bare `<Modal>` call
 * creating a fresh instance every render.
 * @param props - Session runtime, bound controller state, actions, and localized copy.
 * @returns the modal's props.
 */
export function dialogProps({
  sessionId, useSessionLogDownload, dismiss, t,
}: SessionLogDownloadDialogProps): ModalProps {
  const entry = useSessionLogDownload(state => state.bySession[String(sessionId)])

  const status = entry?.status
  const open = entry?.open === true
  const error = status === 'error' ? entry?.error || t('dialog.commandFailed') : null
  const title = status === 'downloading'
    ? t('dialog.preparingTitle')
    : status === 'success' ? t('dialog.successTitle') : t('dialog.errorTitle')
  const description = status === 'downloading'
    ? t('dialog.preparingDescription')
    : status === 'success' ? t('dialog.successDescription') : error ?? t('dialog.commandFailed')

  return {
    open,
    onClose: () => { dismiss(sessionId) },
    title,
    description,
    closeLabel: t('dialog.close'),
    footer: <Button variant="primary" onclick={() => { dismiss(sessionId) }}>{t('dialog.close')}</Button>,
  }
}
