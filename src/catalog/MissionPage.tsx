import { useEffect, useState } from 'react'
import { Link, Navigate, useNavigate, useParams } from 'react-router'
import { useAuth, useRecheckSession } from '../auth/session.ts'
import type { Lab } from '../lab/api.ts'
import { ConfirmReplace } from '../lab/ConfirmReplace.tsx'
import { useCreateLab, useCurrentLab, useReplaceLab } from '../lab/queries.ts'
import { difficultyLabel, type MissionDetail, minutesLabel } from './api.ts'
import { Completion } from './Completion.tsx'
import { InlineMarkdown, Markdown } from './Markdown.tsx'
import styles from './MissionPage.module.css'
import { useMission } from './queries.ts'

// /missions/:slug. Shows a mission as the catalog reports it (at the version of the
// user's lab for it, if there is one) and starts a lab for it. The terminal itself is
// on the lab's page.
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
        {/* Compared with the catalog's version, not with an older lab's. */}
        {mission.progress.status === 'completed' && (
          <p>
            <Completion progress={mission.progress} currentVersion={mission.current_version} />
          </p>
        )}
      </header>

      <MissionLab slug={mission.slug} />

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

// The user's lab as it relates to this mission: start one, open the one being used for
// this mission, or switch to this mission from another mission's lab. The API decides;
// a refused start or switch shows its message, and the current lab, read again, shows
// what is possible next.
function MissionLab({ slug }: { slug: string }) {
  const current = useCurrentLab()
  const create = useCreateLab()
  const replace = useReplaceLab()
  const navigate = useNavigate()
  const lab = current.data

  function switchHere(from: Lab) {
    replace.mutate(
      { lab: from, missionSlug: slug },
      { onSuccess: (created) => navigate(`/labs/${created.id}`) },
    )
  }
  // A removal that did not finish can be asked for again; it resumes the switch.
  const pendingRemoval =
    replace.error?.code === 'previous_lab_not_removed' ? replace.variables?.lab.id : undefined

  return (
    <section className={styles.lab} aria-labelledby="lab-heading">
      <h2 id="lab-heading" className={styles.heading}>
        Laboratório
      </h2>
      {create.isPending ? (
        <>
          <button className={styles.button} type="button" disabled>
            Preparando…
          </button>
          <p className={styles.muted} role="status">
            O ambiente da missão está sendo preparado. Isso pode levar até um minuto.
          </p>
        </>
      ) : replace.isPending ? (
        <>
          <button className={styles.button} type="button" disabled>
            Trocando de missão…
          </button>
          <p className={styles.muted} role="status">
            O laboratório anterior está sendo encerrado e o desta missão está sendo preparado.
            Isso pode levar até dois minutos.
          </p>
        </>
      ) : (
        <>
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
            <button
              className={styles.button}
              type="button"
              onClick={() =>
                create.mutate(slug, { onSuccess: (created) => navigate(`/labs/${created.id}`) })
              }
            >
              Iniciar laboratório
            </button>
          )}
          {lab && (
            <ActiveLab
              lab={lab}
              slug={slug}
              onSwitch={() => switchHere(lab)}
              onRetry={lab.id === pendingRemoval ? () => switchHere(lab) : undefined}
            />
          )}
          {create.error && (
            <p className={styles.error} role="alert">
              {create.error.message}
            </p>
          )}
          {replace.error && (
            <p className={styles.error} role="alert">
              {replace.error.message}
            </p>
          )}
        </>
      )}
    </section>
  )
}

function ActiveLab({
  lab,
  slug,
  onSwitch,
  onRetry,
}: {
  lab: Lab
  slug: string
  onSwitch: () => void
  onRetry?: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  if (lab.status === 'terminating') {
    return (
      <>
        <p className={styles.muted} role="status">
          O laboratório anterior está sendo encerrado. Aguarde para iniciar outro.
        </p>
        {onRetry && (
          <button className={styles.button} type="button" onClick={onRetry}>
            Tentar novamente
          </button>
        )}
      </>
    )
  }
  if (lab.mission?.slug === slug) {
    return (
      <>
        <p className={styles.muted} role="status">
          {lab.status === 'ready'
            ? 'Seu laboratório desta missão está pronto.'
            : 'Preparando o laboratório…'}
        </p>
        <Link to={`/labs/${lab.id}`}>Abrir laboratório</Link>
      </>
    )
  }
  const other = lab.mission ? ` da missão “${lab.mission.title}”` : ''
  return (
    <>
      <p className={styles.muted} role="status">
        Você já tem um laboratório ativo{other}.
        {lab.status === 'provisioning' && ' Ele ainda está sendo preparado.'}
      </p>
      <Link to={`/labs/${lab.id}`}>Abrir laboratório atual</Link>
      {lab.status === 'ready' &&
        (confirming ? (
          <ConfirmReplace
            title="Trocar de missão?"
            confirmLabel="Descartar e trocar"
            onCancel={() => setConfirming(false)}
            onConfirm={() => {
              setConfirming(false)
              onSwitch()
            }}
          >
            O laboratório{other} será encerrado: os arquivos, os processos e todo o estado
            temporário dele serão descartados. Um laboratório novo será criado para esta missão.
          </ConfirmReplace>
        ) : (
          <button className={styles.button} type="button" onClick={() => setConfirming(true)}>
            Trocar para esta missão
          </button>
        ))}
    </>
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
