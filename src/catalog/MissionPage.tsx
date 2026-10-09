import { useEffect } from 'react'
import { Link, Navigate, useParams } from 'react-router'
import { useAuth, useRecheckSession } from '../auth/session.ts'
import { difficultyLabel, type MissionDetail, minutesLabel } from './api.ts'
import { InlineMarkdown, Markdown } from './Markdown.tsx'
import styles from './MissionPage.module.css'
import { useMission } from './queries.ts'

// /missions/:slug. Shows a published mission as the catalog reports it. It does not
// start or change a lab: labs are tied to missions in a later increment.
export function MissionPage() {
  const { slug = '' } = useParams()
  const auth = useAuth()

  if (auth.status === 'anonymous') return <Navigate to="/login" replace />
  if (auth.status === 'loading') return <Message text="Carregando…" />
  if (auth.status === 'error') return <Message text={auth.message} alert retry={auth.retry} />
  return <MissionView slug={slug} />
}

function MissionView({ slug }: { slug: string }) {
  const mission = useMission(slug)
  const recheckSession = useRecheckSession()
  const unauthorized = mission.error?.status === 401

  useEffect(() => {
    if (unauthorized) recheckSession()
  }, [unauthorized, recheckSession])

  if (mission.isPending) return <Message text="Carregando a missão…" />
  if (mission.isError && mission.data === undefined) {
    if (mission.error.status === 404) return <Message text="Missão não encontrada." alert />
    return <Message text={mission.error.message} alert retry={() => void mission.refetch()} />
  }
  return <Mission mission={mission.data} />
}

function Mission({ mission }: { mission: MissionDetail }) {
  return (
    <main className={styles.page}>
      <nav className={styles.trail} aria-label="Navegação">
        <Link to="/">Linux Lab</Link> / <span>{mission.module.title}</span>
      </nav>
      <header className={styles.header}>
        <h1 className={styles.title}>{mission.title}</h1>
        <p className={styles.summary}>{mission.summary}</p>
        <p className={styles.meta}>
          {difficultyLabel(mission.difficulty)} · {minutesLabel(mission.estimated_minutes)}
          {mission.tags.length > 0 && <> · {mission.tags.join(', ')}</>}
        </p>
      </header>

      <article className={styles.briefing} aria-label="Enunciado">
        <Markdown text={mission.briefing} />
      </article>

      <section aria-labelledby="objectives-heading">
        <h2 id="objectives-heading" className={styles.heading}>
          Objetivos
        </h2>
        <ul className={styles.list}>
          {mission.objectives.map((objective, index) => (
            <li key={index}>
              <InlineMarkdown text={objective} />
            </li>
          ))}
        </ul>
        {mission.requires_answer && (
          <p className={styles.muted}>A missão é concluída com uma resposta enviada por você.</p>
        )}
      </section>

      {mission.hints.length > 0 && (
        <section aria-labelledby="hints-heading">
          <h2 id="hints-heading" className={styles.heading}>
            Dicas
          </h2>
          {mission.hints.map((hint, index) => (
            <details key={index} className={styles.hint}>
              <summary>Dica {index + 1}</summary>
              <p>
                <InlineMarkdown text={hint} />
              </p>
            </details>
          ))}
        </section>
      )}

      <Link to="/">Voltar ao início</Link>
    </main>
  )
}

function Message({ text, alert, retry }: { text: string; alert?: boolean; retry?: () => void }) {
  return (
    <main className={styles.page}>
      <h1 className={styles.title}>
        <Link to="/">Linux Lab</Link>
      </h1>
      <p className={alert ? styles.error : styles.muted} role={alert ? 'alert' : 'status'}>
        {text}
      </p>
      {retry && (
        <button className={styles.button} type="button" onClick={retry}>
          Tentar novamente
        </button>
      )}
      <Link to="/">Voltar ao início</Link>
    </main>
  )
}
