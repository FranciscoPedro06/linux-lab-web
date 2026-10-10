import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { ApiError } from '../auth/api.ts'
import { useAuth, useRecheckSession } from '../auth/session.ts'
import type { ConnectionStatus } from '../terminal/connection.ts'
import { MAX_RECONNECT_ATTEMPTS, reconnectDelay } from '../terminal/reconnect.ts'
import { Terminal } from '../terminal/Terminal.tsx'
import { endReasonMessage, fetchLab, type Lab, type LabMission, statusLabel } from './api.ts'
import styles from './LabPage.module.css'
import { labKeys, useCreateLab, useEndLab, useLab } from './queries.ts'

const stateLabel: Record<ConnectionStatus['state'], string> = {
  connecting: 'Conectando',
  connected: 'Conectado',
  closed: 'Desconectado',
}

// /labs/:labId. Everything shown comes from the API: the page renders the lab's
// state and opens the terminal only while the API reports the lab as ready.
export function LabPage() {
  const { labId = '' } = useParams()
  const auth = useAuth()

  if (auth.status === 'anonymous') return <Navigate to="/login" replace />
  if (auth.status === 'loading') return <Message text="Carregando…" />
  if (auth.status === 'error') return <Message text={auth.message} alert retry={auth.retry} />
  return <LabView labId={labId} />
}

function LabView({ labId }: { labId: string }) {
  const lab = useLab(labId)
  const recheckSession = useRecheckSession()
  const unauthorized = lab.error?.status === 401

  useEffect(() => {
    if (unauthorized) recheckSession()
  }, [unauthorized, recheckSession])

  if (lab.isPending) return <Message text="Carregando o laboratório…" />
  // A failed refresh keeps showing the lab as last reported; only a lab never
  // loaded shows the error.
  if (lab.isError && lab.data === undefined) {
    if (lab.error.status === 404) return <Message text="Laboratório não encontrado." alert />
    return <Message text={lab.error.message} alert retry={() => void lab.refetch()} />
  }
  if (lab.data.status === 'ready') return <ReadyLab lab={lab.data} />
  if (lab.data.status === 'provisioning') {
    return <Message text="Preparando o laboratório…" mission={lab.data.mission} />
  }
  return <EndedLab lab={lab.data} />
}

// The mission version the lab was created for, as the API reports it.
function MissionLine({ mission }: { mission: LabMission | null }) {
  if (!mission) return null
  return (
    <p className={styles.mission}>
      Missão: <Link to={`/missions/${mission.slug}`}>{mission.title}</Link> · versão{' '}
      {mission.version}
    </p>
  )
}

type Retry = { attempt: number; delay: number }

function ReadyLab({ lab }: { lab: Lab }) {
  const client = useQueryClient()
  const recheckSession = useRecheckSession()
  const end = useEndLab()
  const [status, setStatus] = useState<ConnectionStatus>({ state: 'connecting' })
  const [session, setSession] = useState(0)
  const [closeRequested, setCloseRequested] = useState(false)
  const [retry, setRetry] = useState<Retry | null>(null)
  // Automatic attempts since the last successful connection.
  const attempts = useRef(0)

  const refreshLab = useCallback(
    () => void client.invalidateQueries({ queryKey: labKeys.one(lab.id) }),
    [client, lab.id],
  )

  const scheduleRetry = useCallback((code: number | undefined) => {
    const delay = reconnectDelay(code, attempts.current)
    if (delay === null) {
      setRetry(null)
      return
    }
    attempts.current += 1
    setRetry({ attempt: attempts.current, delay })
  }, [])

  const reconnect = useCallback(() => {
    setRetry(null)
    setCloseRequested(false)
    setStatus({ state: 'connecting' })
    setSession((value) => value + 1)
  }, [])

  const reconnectByHand = useCallback(() => {
    attempts.current = 0
    reconnect()
  }, [reconnect])

  const onStatus = useCallback(
    (next: ConnectionStatus) => {
      setStatus(next)
      if (next.state === 'connected') attempts.current = 0
      if (next.state !== 'closed') return
      if (next.code === 4401) recheckSession()
      else if (next.code === 4404 || next.code === 4410) refreshLab()
      else scheduleRetry(next.code)
    },
    [recheckSession, refreshLab, scheduleRetry],
  )

  // Before reconnecting, ask the API whether the lab is still ready.
  useEffect(() => {
    if (!retry) return
    let cancelled = false
    const timer = setTimeout(() => {
      client
        .fetchQuery({ queryKey: labKeys.one(lab.id), queryFn: () => fetchLab(lab.id), staleTime: 0 })
        .then((current) => {
          if (cancelled) return
          if (current.status === 'ready') reconnect()
          else setRetry(null)
        })
        .catch((error: unknown) => {
          if (cancelled) return
          if (error instanceof ApiError && error.status === 401) {
            setRetry(null)
            recheckSession()
          } else if (error instanceof ApiError && error.status === 404) {
            setRetry(null)
          } else {
            // The API is unreachable too; that counts as a failed attempt.
            scheduleRetry(1006)
          }
        })
    }, retry.delay)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [retry, client, lab.id, reconnect, recheckSession, scheduleRetry])

  const closed = status.state === 'closed'
  const gaveUp = closed && !retry && reconnectDelay(status.code, 0) !== null

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>
          <Link to="/">Linux Lab</Link>
        </h1>
        <MissionLine mission={lab.mission} />
        <p className={styles.status} role="status">
          Estado: <span data-state={status.state}>{stateLabel[status.state]}</span>
          {status.reason && <span className={styles.reason}> — {status.reason}</span>}
          {retry && (
            <span className={styles.reason}>
              {' '}
              Reconectando em {Math.round(retry.delay / 1000)} s (tentativa {retry.attempt} de{' '}
              {MAX_RECONNECT_ATTEMPTS})…
            </span>
          )}
          {gaveUp && <span className={styles.reason}> Não foi possível reconectar.</span>}
        </p>
      </header>

      <section className={styles.workspace}>
        <Terminal
          labId={lab.id}
          session={session}
          closeRequested={closeRequested}
          onStatus={onStatus}
        />
      </section>
      <footer className={styles.actions}>
        <span className={styles.expiry}>
          Encerra automaticamente às {formatTime(lab.expires_at)}.
        </span>
        {end.error && (
          <span className={styles.error} role="alert">
            {end.error.message}
          </span>
        )}
        {closed && !retry ? (
          <button type="button" onClick={reconnectByHand}>
            Reconectar
          </button>
        ) : (
          <button
            type="button"
            onClick={() => {
              setRetry(null)
              setCloseRequested(true)
            }}
          >
            Desconectar
          </button>
        )}
        <button type="button" disabled={end.isPending} onClick={() => end.mutate(lab.id)}>
          {end.isPending ? 'Encerrando…' : 'Encerrar laboratório'}
        </button>
      </footer>
    </main>
  )
}

// A new lab is for the same mission, at its current version. Once this lab is no
// longer active the API allows it; a lab with no mission has nothing to restart.
function EndedLab({ lab }: { lab: Lab }) {
  const create = useCreateLab()
  const navigate = useNavigate()
  const reason = lab.end_reason ? endReasonMessage[lab.end_reason] : null
  const mission = lab.mission

  return (
    <main className={styles.ended}>
      <h1 className={styles.title}>
        <Link to="/">Linux Lab</Link>
      </h1>
      <MissionLine mission={mission} />
      <p role="status">
        Laboratório: <strong data-lab-status={lab.status}>{statusLabel[lab.status]}</strong>
      </p>
      {reason && (
        <p className={lab.end_reason === 'oom' ? styles.error : undefined} role="alert">
          {reason}
        </p>
      )}
      {lab.status !== 'terminating' && mission && (
        <button
          className={styles.primary}
          type="button"
          disabled={create.isPending}
          onClick={() =>
            create.mutate(mission.slug, {
              onSuccess: (created) => navigate(`/labs/${created.id}`, { replace: true }),
            })
          }
        >
          {create.isPending ? 'Preparando…' : 'Iniciar novo laboratório'}
        </button>
      )}
      {create.error && (
        <p className={styles.error} role="alert">
          {create.error.message}
        </p>
      )}
      <Link to="/">Voltar ao início</Link>
    </main>
  )
}

function Message({
  text,
  alert,
  retry,
  mission = null,
}: {
  text: string
  alert?: boolean
  retry?: () => void
  mission?: LabMission | null
}) {
  return (
    <main className={styles.ended}>
      <h1 className={styles.title}>
        <Link to="/">Linux Lab</Link>
      </h1>
      <MissionLine mission={mission} />
      <p className={alert ? styles.error : styles.muted} role={alert ? 'alert' : 'status'}>
        {text}
      </p>
      {retry && (
        <button className={styles.primary} type="button" onClick={retry}>
          Tentar novamente
        </button>
      )}
      <Link to="/">Voltar ao início</Link>
    </main>
  )
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
