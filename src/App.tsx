import { useCallback, useState } from 'react'
import styles from './App.module.css'
import type { ConnectionStatus } from './terminal/connection.ts'
import { Terminal } from './terminal/Terminal.tsx'

const stateLabel: Record<ConnectionStatus['state'], string> = {
  connecting: 'Conectando',
  connected: 'Conectado',
  closed: 'Desconectado',
}

function labFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('lab')
}

export function App() {
  const [labId] = useState(labFromUrl)
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
        {labId && (
          <p className={styles.status} role="status">
            Estado: <span data-state={status.state}>{stateLabel[status.state]}</span>
            {status.reason && <span className={styles.reason}> — {status.reason}</span>}
          </p>
        )}
      </header>

      {labId ? (
        <>
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
        </>
      ) : (
        <p className={styles.empty}>
          Nenhum laboratório selecionado. Abra esta página com <code>?lab=</code> seguido do
          identificador do laboratório.
        </p>
      )}
    </main>
  )
}
