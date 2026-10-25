import { type ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { type HistoryEntry, MAX_HISTORY_ENTRIES } from './api.ts'
import styles from './HistoryPanel.module.css'
import { useLabHistory } from './queries.ts'

// Entries shown at first, and added by each "show earlier" click.
const SHOWN_STEP = 200

export const HISTORY_NOTICE_ID = 'history-notice'

// Shown next to the terminal before it is used, and with the history of an ended lab.
export function HistoryNotice() {
  return (
    <p id={HISTORY_NOTICE_ID} className={styles.notice} role="note">
      Os comandos enviados ao Bash podem ser salvos no histórico deste laboratório, inclusive
      texto sensível e conteúdo de heredocs. O histórico permanece disponível depois que o
      laboratório termina e só pode ser consultado pelo proprietário. Para tentar excluir um
      comando do histórico, comece a linha com um espaço. Isso não é uma garantia absoluta de
      privacidade: não há remoção automática de senhas, tokens ou outros segredos.
    </p>
  )
}

// The lab's command history. While the lab is ready (`live`) it is read every few
// seconds; for an ended lab it is read only when the student asks. Commands are shown
// as text, never interpreted.
export function HistoryPanel({
  labId,
  live,
  actions,
}: {
  labId: string
  live: boolean
  // Buttons for one entry, e.g. copy and insert into the terminal.
  actions?: (entry: HistoryEntry) => ReactNode
}) {
  const [requested, setRequested] = useState(live)
  const history = useLabHistory(labId, { live, enabled: requested })
  const [shown, setShown] = useState(SHOWN_STEP)
  const list = useRef<HTMLOListElement>(null)
  // Whether the list was scrolled to its end before new entries arrived.
  const atEnd = useRef(true)
  const entries = history.data ?? []
  const visible = entries.slice(-shown)
  const hidden = entries.length - visible.length

  useLayoutEffect(() => {
    const element = list.current
    if (element && atEnd.current) element.scrollTop = element.scrollHeight
  }, [entries.length])

  let body: ReactNode
  if (!requested) {
    body = (
      <button
        type="button"
        onClick={() => {
          setRequested(true)
          void history.refetch()
        }}
      >
        Mostrar histórico de comandos
      </button>
    )
  } else if (history.isPending) {
    body = (
      <p className={styles.muted} role="status">
        Carregando o histórico…
      </p>
    )
  } else if (history.isError && history.data === undefined) {
    body = (
      <>
        <p className={styles.error} role="alert">
          {history.error.message}
        </p>
        <button type="button" onClick={() => void history.refetch()}>
          Tentar novamente
        </button>
      </>
    )
  } else if (entries.length === 0) {
    body = <p className={styles.muted}>Nenhum comando registrado neste laboratório.</p>
  } else {
    body = (
      <>
        {hidden > 0 && (
          <button type="button" onClick={() => setShown((value) => value + SHOWN_STEP)}>
            Mostrar comandos anteriores ({hidden})
          </button>
        )}
        <ol
          ref={list}
          className={styles.list}
          aria-label="Comandos registrados"
          onScroll={(event) => {
            const element = event.currentTarget
            atEnd.current =
              element.scrollHeight - element.scrollTop - element.clientHeight < 8
          }}
        >
          {visible.map((entry) => (
            <li key={entry.seq} className={styles.entry} data-seq={entry.seq}>
              <pre className={styles.command}>
                <code>{entry.command}</code>
              </pre>
              <div className={styles.meta}>
                <time dateTime={entry.recorded_at}>{formatTime(entry.recorded_at)}</time>
                {actions?.(entry)}
              </div>
            </li>
          ))}
        </ol>
      </>
    )
  }

  return (
    <section className={styles.panel} aria-labelledby="history-heading">
      <h2 id="history-heading" className={styles.heading}>
        Histórico de comandos
      </h2>
      {!live && <HistoryNotice />}
      {body}
      {history.isError && history.data !== undefined && (
        <p className={styles.error} role="alert">
          Não foi possível atualizar o histórico.{' '}
          <button className={styles.inline} type="button" onClick={() => void history.refetch()}>
            Tentar novamente
          </button>
        </p>
      )}
      {entries.length >= MAX_HISTORY_ENTRIES && (
        <p className={styles.muted} role="status">
          Este laboratório atingiu o limite de {MAX_HISTORY_ENTRIES} comandos no histórico; os
          próximos não serão registrados.
        </p>
      )}
    </section>
  )
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
