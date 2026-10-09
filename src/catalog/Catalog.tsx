import { useEffect } from 'react'
import { Link } from 'react-router'
import styles from '../auth/Auth.module.css'
import { useRecheckSession } from '../auth/session.ts'
import home from '../lab/LabPanel.module.css'
import { type CatalogModule, difficultyLabel, type MissionCard, minutesLabel } from './api.ts'
import catalog from './Catalog.module.css'
import { useModules } from './queries.ts'

// The published modules and their missions, on the signed-in home page.
export function Catalog() {
  const modules = useModules()
  const recheckSession = useRecheckSession()
  const unauthorized = modules.error?.status === 401

  useEffect(() => {
    if (unauthorized) recheckSession()
  }, [unauthorized, recheckSession])

  return (
    <section className={home.panel} aria-labelledby="catalog-heading">
      <h2 id="catalog-heading" className={styles.heading}>
        Missões
      </h2>
      {modules.isPending && (
        <p className={styles.muted} role="status">
          Carregando…
        </p>
      )}
      {modules.isError && (
        <>
          <p className={styles.error} role="alert">
            {modules.error.message}
          </p>
          <button className={styles.button} type="button" onClick={() => void modules.refetch()}>
            Tentar novamente
          </button>
        </>
      )}
      {modules.data?.length === 0 && (
        <p className={styles.muted}>Nenhuma missão publicada ainda.</p>
      )}
      {modules.data?.map((module) => (
        <Module key={module.slug} module={module} />
      ))}
    </section>
  )
}

function Module({ module }: { module: CatalogModule }) {
  const headingId = `module-${module.slug}`
  return (
    <section className={catalog.module} aria-labelledby={headingId}>
      <h3 id={headingId} className={catalog.moduleTitle}>
        {module.title}
      </h3>
      <p className={styles.muted}>{module.description}</p>
      <ol className={catalog.missions}>
        {module.missions.map((mission) => (
          <Mission key={mission.slug} mission={mission} />
        ))}
      </ol>
    </section>
  )
}

function Mission({ mission }: { mission: MissionCard }) {
  return (
    <li>
      <Link to={`/missions/${mission.slug}`}>{mission.title}</Link>
      <span className={catalog.summary}>{mission.summary}</span>
      <span className={catalog.meta}>
        {difficultyLabel(mission.difficulty)} · {minutesLabel(mission.estimated_minutes)}
      </span>
    </li>
  )
}
