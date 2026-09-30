import { useCallback, useState } from 'react'
import type { ConnectionStatus } from '../terminal/connection.ts'
import { Terminal } from '../terminal/Terminal.tsx'
import styles from './LabPage.module.css'

const stateLabel: Record<ConnectionStatus['state'], string> = {
  connecting: 'Conectando',
  connected: 'Conectado',
  closed: 'Desconectado',
}

// Development terminal page, opened with /?lab=<lab id>. It needs no account:
// the API only serves the terminal with DEV_TERMINAL_ACCESS.
export function LabPage({ labId }: { labId: string }) {
  const [status, setStatus] = useState<ConnectionStatus>({ state: 'connecting' })
  const [session, setSession] = useState(0)
  const [closeRequested, setCloseRequested] = useState(false)

  const reconnect = useCallback(() => {
    setCloseRequested(false)
    setStatus({ state: 'connecting' })
    setSession((value) => value + 1)
  }, [])

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>Linux Lab</h1>
        <p className={styles.status} role="status">
          Estado: <span data-state={status.state}>{stateLabel[status.state]}</span>
          {status.reason && <span className={styles.reason}> — {status.reason}</span>}
        </p>
      </header>

      <section className={styles.workspace}>
        <Terminal
          labId={labId}
          session={session}
          closeRequested={closeRequested}
          onStatus={setStatus}
        />
      </section>
      <footer className={styles.actions}>
        <button type="button" disabled title="Disponível quando os laboratórios tiverem sessões">
          Reiniciar laboratório
        </button>
        {status.state === 'closed' ? (
          <button type="button" onClick={reconnect}>
            Reconectar
          </button>
        ) : (
          <button type="button" onClick={() => setCloseRequested(true)}>
            Encerrar
          </button>
        )}
      </footer>
    </main>
  )
}
