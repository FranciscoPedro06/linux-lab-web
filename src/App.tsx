import { useEffect, useState } from 'react'
import styles from './App.module.css'

type ApiStatus = 'checking' | 'ok' | 'unavailable'

const statusLabel: Record<ApiStatus, string> = {
  checking: 'verificando',
  ok: 'disponível',
  unavailable: 'indisponível',
}

export function App() {
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking')

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/health', { signal: controller.signal })
      .then((response) => setApiStatus(response.ok ? 'ok' : 'unavailable'))
      .catch(() => {
        if (!controller.signal.aborted) setApiStatus('unavailable')
      })
    return () => controller.abort()
  }, [])

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Linux Lab</h1>
      <p className={styles.lead}>Aprenda Linux resolvendo problemas em um terminal real.</p>
      <p className={styles.status}>
        API: <span data-status={apiStatus}>{statusLabel[apiStatus]}</span>
      </p>
    </main>
  )
}
