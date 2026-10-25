import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { ApiError } from '../auth/api.ts'
import { useAuth, useRecheckSession } from '../auth/session.ts'
import type { ConnectionStatus } from '../terminal/connection.ts'
import { MAX_RECONNECT_ATTEMPTS, reconnectDelay } from '../terminal/reconnect.ts'
import { type Insert, Terminal } from '../terminal/Terminal.tsx'
import {
  endReasonMessage,
  fetchLab,
  type Lab,
  type LabMission,
  statusLabel,
  wasReplaced,
} from './api.ts'
import { ConfirmReplace } from './ConfirmReplace.tsx'
import { HISTORY_NOTICE_ID, HistoryNotice, HistoryPanel } from './HistoryPanel.tsx'
import styles from './LabPage.module.css'
import {
  labKeys,
  type Replacement,
  useCreateLab,
  useCurrentLab,
  useEndLab,
  useLab,
  useReplaceLab,
} from './queries.ts'
import { ValidationPanel } from './ValidationPanel.tsx'

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
  // One mount per lab: the page of the lab that replaces this one starts afresh, and
  // leaving this one closes its terminal.
  return <LabView key={labId} labId={labId} />
}

function LabView({ labId }: { labId: string }) {
  const lab = useLab(labId)
  // Held here, above the lab's state: the lab ends while it is being replaced, and the
  // page keeps following the request instead of showing the ended lab.
  const replace = useReplaceLab()
  const navigate = useNavigate()
  const recheckSession = useRecheckSession()
  const unauthorized = lab.error?.status === 401

  function startReplacement(replacement: Replacement) {
    replace.mutate(replacement, {
      onSuccess: (created) => navigate(`/labs/${created.id}`, { replace: true }),
    })
  }

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
  if (replace.isPending && replace.variables) return <Replacing replacement={replace.variables} />
  const failure = replace.error
  const current = lab.data
  if (current.status === 'ready') {
    return (
      <ReadyLab
        lab={current}
        onReplace={startReplacement}
        replaceError={failure}
        // After a failure the lab is read again before another reset can be asked for.
        checking={failure !== null && lab.isFetching}
      />
    )
  }
  if (current.status === 'provisioning') {
    return <Message text="Preparando o laboratório…" mission={current.mission} />
  }
  if (failure || wasReplaced(current.end_reason)) {
    const missionSlug = replace.variables?.missionSlug ?? current.mission?.slug ?? null
    return (
      <AfterReplacement
        lab={current}
        error={failure}
        missionSlug={missionSlug}
        onRetry={() => missionSlug && startReplacement({ lab: current, missionSlug })}
      />
    )
  }
  return <EndedLab lab={current} />
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

function ReadyLab({
  lab,
  onReplace,
  replaceError,
  checking,
}: {
  lab: Lab
  onReplace: (replacement: Replacement) => void
  replaceError: ApiError | null
  checking: boolean
}) {
  const client = useQueryClient()
  const recheckSession = useRecheckSession()
  const end = useEndLab()
  const [confirming, setConfirming] = useState(false)
  const [status, setStatus] = useState<ConnectionStatus>({ state: 'connecting' })
  const [session, setSession] = useState(0)
  const [closeRequested, setCloseRequested] = useState(false)
  const [retry, setRetry] = useState<Retry | null>(null)
  // Automatic attempts since the last successful connection.
  const attempts = useRef(0)
  // Set by the terminal while it is mounted; the history panel inserts commands with it.
  const insertRef = useRef<Insert | null>(null)

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

      <HistoryNotice />
      <div className={styles.workspace}>
        <section className={styles.terminal} aria-describedby={HISTORY_NOTICE_ID}>
          <Terminal
            labId={lab.id}
            session={session}
            closeRequested={closeRequested}
            onStatus={onStatus}
            insertRef={insertRef}
          />
        </section>
        <HistoryPanel labId={lab.id} live insertRef={insertRef} />
      </div>
      {lab.mission && <ValidationPanel labId={lab.id} mission={lab.mission} />}
      {confirming && lab.mission && (
        <ConfirmReplace
          title="Reiniciar o laboratório?"
          confirmLabel="Descartar e reiniciar"
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false)
            if (lab.mission) onReplace({ lab, missionSlug: lab.mission.slug })
          }}
        >
          Os arquivos, os processos e todo o estado temporário deste laboratório serão
          descartados. Um laboratório novo será criado para a mesma missão, na versão atual
          dela.
        </ConfirmReplace>
      )}
      <footer className={styles.actions}>
        <span className={styles.expiry}>
          Encerra automaticamente às {formatTime(lab.expires_at)}.
        </span>
        {end.error && (
          <span className={styles.error} role="alert">
            {end.error.message}
          </span>
        )}
        {replaceError && (
          <span className={styles.error} role="alert">
            {checking ? 'Verificando o estado do laboratório…' : replaceError.message}
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
        {lab.mission && (
          <button
            type="button"
            disabled={confirming || checking || end.isPending}
            onClick={() => setConfirming(true)}
          >
            Reiniciar laboratório
          </button>
        )}
        <button type="button" disabled={end.isPending} onClick={() => end.mutate(lab.id)}>
          {end.isPending ? 'Encerrando…' : 'Encerrar laboratório'}
        </button>
      </footer>
    </main>
  )
}

// While a reset or a mission switch runs. The terminal is gone: the lab is being
// discarded.
function Replacing({ replacement }: { replacement: Replacement }) {
  const reset = replacement.lab.mission?.slug === replacement.missionSlug
  return (
    <main className={styles.ended}>
      <h1 className={styles.title}>
        <Link to="/">Linux Lab</Link>
      </h1>
      <MissionLine mission={replacement.lab.mission} />
      <p role="status">{reset ? 'Reiniciando o laboratório…' : 'Trocando de missão…'}</p>
      <p className={styles.muted}>
        O laboratório anterior está sendo encerrado e um novo está sendo preparado. Isso pode
        levar até dois minutos.
      </p>
    </main>
  )
}

// Failures that leave the outcome of the request unknown: the connection was lost, or
// something between the client and the API failed, possibly after the lab ended.
const KNOWN_FAILURES = new Set([
  'lab_capacity_reached',
  'previous_lab_not_removed',
  'lab_start_failed',
])

function replacementFailure(error: ApiError): string {
  if (error.status === 0 || (error.status >= 500 && !KNOWN_FAILURES.has(error.code))) {
    return 'Não foi possível confirmar o resultado. O estado abaixo foi consultado de novo.'
  }
  return error.message
}

// The lab is no longer ready after a replacement: one made elsewhere (another tab), or
// one that failed here. What to offer comes from the user's current lab, read again from
// the API: open it, retry while this lab's removal is pending, or start a new lab.
// Replacing this lab again never creates a second new lab, so once its new lab failed a
// retry would only be refused; a new lab is started with POST /api/labs instead, and
// only once the API reports no active lab.
function AfterReplacement({
  lab,
  error,
  missionSlug,
  onRetry,
}: {
  lab: Lab
  error: ApiError | null
  missionSlug: string | null
  onRetry: () => void
}) {
  const current = useCurrentLab()
  const create = useCreateLab()
  const navigate = useNavigate()
  const active = current.data
  const reason = lab.end_reason ? endReasonMessage[lab.end_reason] : null

  return (
    <main className={styles.ended}>
      <h1 className={styles.title}>
        <Link to="/">Linux Lab</Link>
      </h1>
      <MissionLine mission={lab.mission} />
      <p role="status">
        Laboratório: <strong data-lab-status={lab.status}>{statusLabel[lab.status]}</strong>
      </p>
      {reason && <p>{reason}</p>}
      {error && (
        <p className={styles.error} role="alert">
          {replacementFailure(error)}
        </p>
      )}
      {current.isPending ? (
        <p className={styles.muted}>Verificando o seu laboratório atual…</p>
      ) : current.isError ? (
        <p className={styles.error} role="alert">
          {current.error.message}
        </p>
      ) : active && active.id !== lab.id ? (
        <>
          <p>{activeLabel[active.status] ?? 'Você tem um laboratório ativo.'}</p>
          <Link to={`/labs/${active.id}`}>Abrir laboratório atual</Link>
        </>
      ) : active ? (
        <>
          <p>A remoção deste laboratório ainda não terminou.</p>
          {error && missionSlug && (
            <button className={styles.primary} type="button" onClick={onRetry}>
              Tentar novamente
            </button>
          )}
        </>
      ) : (
        missionSlug && (
          <>
            <p>Você não tem um laboratório ativo.</p>
            <button
              className={styles.primary}
              type="button"
              disabled={create.isPending}
              onClick={() =>
                create.mutate(missionSlug, {
                  onSuccess: (created) => navigate(`/labs/${created.id}`, { replace: true }),
                })
              }
            >
              {create.isPending ? 'Preparando…' : 'Iniciar novo laboratório'}
            </button>
          </>
        )
      )}
      {create.error && (
        <p className={styles.error} role="alert">
          {create.error.message}
        </p>
      )}
      <HistoryPanel labId={lab.id} live={false} />
      <Link to="/">Voltar ao início</Link>
    </main>
  )
}

const activeLabel: Partial<Record<Lab['status'], string>> = {
  ready: 'Seu laboratório atual está pronto.',
  provisioning: 'Seu laboratório atual está sendo preparado.',
  terminating: 'Seu laboratório atual está sendo encerrado.',
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
      <HistoryPanel labId={lab.id} live={false} />
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
