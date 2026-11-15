import { type ReactNode, useEffect, useState } from 'react'
import { Link, NavLink } from 'react-router'
import { useAuth } from './auth/session.ts'
import { isTransient, type Lab, type LabStatus } from './lab/api.ts'
import { useCurrentLab } from './lab/queries.ts'
import styles from './TopBar.module.css'

// The one-line bar at the top of every screen: `linuxlab` on the left, then the user's
// name, the page's own segments (`children`), and on the right the state of the user's
// lab. Each page renders it first, so it is hidden and mounted again with the page when
// the session changes (see auth/tabs.tsx).
//
// Only a signed-in user's bar reads the lab. A visitor's bar, and the bar while the
// session is being checked or could not be, sends no request of its own: useAuth shares
// the session check the page already makes.
//
// `lab` is a lab the page already holds. When it is active (the user has at most one
// active lab), the bar shows it and does not ask for the current lab; otherwise the bar
// reads the current lab from the cache the pages share (useCurrentLab). With `pending`,
// the page is still reading what it shows: the bar reads nothing yet, so it asks for the
// current lab together with the page that also needs it, in one request.
export function TopBar({
  lab,
  pending = false,
  children,
}: {
  lab?: Lab
  pending?: boolean
  children?: ReactNode
}) {
  const auth = useAuth()

  return (
    <header className={styles.bar}>
      <Link className={styles.brand} to="/">
        <span aria-hidden="true">linuxlab</span>
        <span className="visually-hidden">Linux Lab</span>
      </Link>
      {auth.status === 'authenticated' && <span className={styles.user}>{auth.user.display_name}</span>}
      {children && <div className={styles.page}>{children}</div>}
      {auth.status === 'anonymous' && <PublicLinks />}
      {auth.status === 'authenticated' &&
        (lab && isActive(lab.status) ? (
          <LabState lab={lab} />
        ) : pending ? (
          <Checking />
        ) : (
          <CurrentLabState />
        ))}
    </header>
  )
}

function PublicLinks() {
  return (
    <nav className={styles.end} aria-label="Conta">
      <NavLink to="/login">Entrar</NavLink>
      <NavLink to="/signup">Criar conta</NavLink>
    </nav>
  )
}

function isActive(status: LabStatus): boolean {
  return status === 'ready' || isTransient(status)
}

function Checking() {
  return <p className={`${styles.end} ${styles.dim}`}>verificando laboratório…</p>
}

function CurrentLabState() {
  const current = useCurrentLab()
  const lab = current.data

  if (current.isPending) return <Checking />
  // A failed refresh keeps showing the lab as last reported. The page says what failed;
  // the bar only says it does not know.
  if (lab === undefined) {
    return <p className={`${styles.end} ${styles.error}`}>estado do laboratório indisponível</p>
  }
  if (lab === null || !isActive(lab.status)) {
    return <p className={`${styles.end} ${styles.none}`}>sem laboratório ativo</p>
  }
  return <LabState lab={lab} />
}

const stateWord: Partial<Record<LabStatus, string>> = {
  provisioning: 'preparando',
  ready: 'pronto',
  terminating: 'encerrando',
}

// The lab's state as the API reports it, and for a lab being prepared or ready, how
// long ago the API created it.
function LabState({ lab }: { lab: Lab }) {
  return (
    <p className={styles.end}>
      <NavLink className={styles.lab} to={`/labs/${lab.id}`}>
        laboratório <span data-lab-state={lab.status}>{stateWord[lab.status]}</span>
        {lab.status !== 'terminating' && <Elapsed since={lab.created_at} />}
      </NavLink>
    </p>
  )
}

const MINUTE_MS = 60_000

function Elapsed({ since }: { since: string }) {
  const now = useNow(MINUTE_MS / 2)
  const start = Date.parse(since)
  if (Number.isNaN(start)) return null
  // The clock of this computer may be behind the API's.
  const minutes = Math.max(0, Math.floor((now - start) / MINUTE_MS))
  const text = minutes < 60 ? `${minutes}min` : `${Math.floor(minutes / 60)}h ${minutes % 60}min`
  return (
    <span className={styles.dim}>
      {' · '}
      <span className="visually-hidden">aberto há </span>
      <time dateTime={since}>{text}</time>
    </span>
  )
}

function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
