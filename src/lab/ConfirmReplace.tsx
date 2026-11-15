import { type ReactNode, useEffect, useId, useRef, useState } from 'react'
import styles from './ConfirmReplace.module.css'

// Whether a confirmation is open, and the button that opens it. Cancelling gives the
// focus back to that button once it is shown (and enabled) again; confirming does not,
// since the page moves on to the request.
export function useConfirmation() {
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const refocus = useRef(false)

  useEffect(() => {
    if (open || !refocus.current) return
    refocus.current = false
    opener.current?.focus()
  }, [open])

  return {
    open,
    opener,
    show: () => setOpen(true),
    cancel: () => {
      refocus.current = true
      setOpen(false)
    },
    close: () => setOpen(false),
  }
}

// Asks before a reset or a mission switch discards the lab. Nothing is sent to the API
// until the user confirms; cancelling leaves the lab as it is. Cancelar comes first and
// has the focus, so Enter right after opening, or the first Tab stop, keeps the lab.
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
        <button type="button" onClick={onCancel} autoFocus>
          Cancelar
        </button>
        <button className={styles.danger} type="button" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </section>
  )
}
