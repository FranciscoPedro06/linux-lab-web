import { Link } from 'react-router'
import styles from './auth/Auth.module.css'
import { useAuth, useLogout } from './auth/session.ts'
import { Catalog } from './catalog/Catalog.tsx'
import { endReasonMessage, type Lab, statusLabel } from './lab/api.ts'
import home from './lab/LabPanel.module.css'
import { useCurrentLab, useEndLab, useRecentLabs } from './lab/queries.ts'

const RECENT_LABS = 5

export function HomePage() {
  const auth = useAuth()
  const logout = useLogout()

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Linux Lab</h1>
      {auth.status === 'loading' && (
        <p className={styles.muted} role="status">
          Carregando…
        </p>
      )}
      {auth.status === 'error' && (
        <>
          <p className={styles.error} role="alert">
            {auth.message}
          </p>
          <button className={styles.button} type="button" onClick={auth.retry}>
            Tentar novamente
          </button>
        </>
      )}
      {auth.status === 'anonymous' && (
        <>
          <p>Aprenda Linux resolvendo problemas em um terminal real.</p>
          <nav className={styles.links}>
            <Link to="/login">Entrar</Link>
            <Link to="/signup">Criar conta</Link>
          </nav>
        </>
      )}
      {auth.status === 'authenticated' && (
        <>
          <p>Olá, {auth.user.display_name}.</p>
          <CurrentLab />
          <Catalog />
          <RecentLabs />
          {logout.error && (
            <p className={styles.error} role="alert">
              {logout.error.message}
            </p>
          )}
          <button
            className={styles.button}
            type="button"
            disabled={logout.isPending}
            onClick={() => logout.mutate()}
          >
            {logout.isPending ? 'Saindo…' : 'Sair'}
          </button>
        </>
      )}
    </main>
  )
}

// Labs are started from a mission's page; this panel shows the active one.
function CurrentLab() {
  const current = useCurrentLab()
  const end = useEndLab()
  const lab = current.data
  const error = end.error

  return (
    <section className={home.panel} aria-labelledby="lab-heading">
      <h2 id="lab-heading" className={styles.heading}>
        Laboratório
      </h2>
      {current.isPending && (
        <p className={styles.muted} role="status">
          Carregando…
        </p>
      )}
      {current.isError && (
        <p className={styles.error} role="alert">
          {current.error.message}
        </p>
      )}
      {lab === null && (
        <>
          <p className={styles.muted}>Nenhum laboratório ativo.</p>
          <p className={styles.muted}>Escolha uma missão abaixo para iniciar um laboratório.</p>
        </>
      )}
      {lab?.mission && (
        <p>
          Missão: <Link to={`/missions/${lab.mission.slug}`}>{lab.mission.title}</Link>
        </p>
      )}
      {lab?.status === 'provisioning' && (
        <p className={styles.muted} role="status">
          Preparando o laboratório…
        </p>
      )}
      {lab?.status === 'ready' && (
        <>
          <p role="status">Pronto até {formatTime(lab.expires_at)}.</p>
          <div className={styles.links}>
            <Link to={`/labs/${lab.id}`}>Abrir terminal</Link>
            <button
              className={home.inline}
              type="button"
              disabled={end.isPending}
              onClick={() => end.mutate(lab.id)}
            >
              {end.isPending ? 'Encerrando…' : 'Encerrar laboratório'}
            </button>
          </div>
        </>
      )}
      {lab?.status === 'terminating' && (
        <p className={styles.muted} role="status">
          Encerrando o laboratório…
        </p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error.message}
        </p>
      )}
    </section>
  )
}

function RecentLabs() {
  const labs = useRecentLabs()
  const ended = (labs.data ?? []).filter((lab) => lab.status === 'terminated' || lab.status === 'failed')
  if (ended.length === 0) return null

  return (
    <section className={home.panel} aria-labelledby="recent-heading">
      <h2 id="recent-heading" className={styles.heading}>
        Laboratórios anteriores
      </h2>
      <ul className={home.list}>
        {ended.slice(0, RECENT_LABS).map((lab) => (
          <RecentLab key={lab.id} lab={lab} />
        ))}
      </ul>
    </section>
  )
}

function RecentLab({ lab }: { lab: Lab }) {
  return (
    <li>
      <span className={home.when}>{formatDateTime(lab.created_at)}</span>{' '}
      <span>{statusLabel[lab.status]}</span>
      {lab.mission && <span> · {lab.mission.title}</span>}
      {lab.end_reason && <span className={home.reason}>{endReasonMessage[lab.end_reason]}</span>}
    </li>
  )
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}
