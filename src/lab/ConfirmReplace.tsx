import { type ReactNode, useId } from 'react'
import styles from './ConfirmReplace.module.css'

// Asks before a reset or a mission switch discards the lab. Nothing is sent to the API
// until the user confirms; cancelling leaves the lab as it is.
export function ConfirmReplace({
  title,
  confirmLabel,
  children,
  onConfirm,
  onCancel,
}: {
  title: string
  confirmLabel: string
  children: ReactNode
  onConfirm: () => void
  onCancel: () => void
}) {
  const titleId = useId()
  const descriptionId = useId()
  return (
    <section
      className={styles.confirm}
      role="alertdialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <h2 id={titleId} className={styles.title}>
        {title}
      </h2>
      <div id={descriptionId} className={styles.description}>
        <p>{children}</p>
        <p>
          Seu progresso permanece registrado: uma missão concluída continua concluída. Reiniciar
          ou trocar o laboratório não conclui nem desfaz nenhuma missão.
        </p>
      </div>
      <div className={styles.actions}>
        <button className={styles.danger} type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
        {/* Focused first: Enter right after opening keeps the lab. */}
        <button type="button" onClick={onCancel} autoFocus>
          Cancelar
        </button>
      </div>
    </section>
  )
}
