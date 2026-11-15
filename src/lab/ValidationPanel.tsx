import { type FormEvent, useState } from 'react'
import { useMission } from '../catalog/queries.ts'
import {
  answerBytes,
  type LabMission,
  MAX_ANSWER_BYTES,
  type ResultNode,
  type ValidationRun,
  type ValidationStatus,
} from './api.ts'
import { countCriteria, criteriaText } from './criteria.ts'
import styles from './ValidationPanel.module.css'
import { useValidateLab } from './queries.ts'

const statusLabel: Record<ValidationStatus, string> = {
  passed: 'Atendida',
  failed: 'Não atendida',
  error: 'Não verificada',
}

// Called with what a finished validation says, when it finishes. It returns true when the
// page announced it itself because this panel is hidden (the lab page on a phone): the
// panel then shows that result without a live region, so opening it later does not
// announce it again.
export type Announce = (text: string) => boolean

// Checks the lab's state when the student asks. The API decides the outcome from the
// mission version the lab was created for; nothing is validated automatically.
export function ValidationPanel({
  labId,
  mission,
  announce,
}: {
  labId: string
  mission: LabMission
  announce?: Announce
}) {
  const validate = useValidateLab(labId, mission.slug)
  // The mission detail, read at the lab's version, says whether an answer is expected.
  // While it loads, or if it cannot be read, the panel validates without one.
  const detail = useMission(mission.slug)
  const requiresAnswer = detail.data?.requires_answer === true
  const [answer, setAnswer] = useState('')
  const tooLong = answerBytes(answer) > MAX_ANSWER_BYTES
  // Whether the page announced the result shown, so the panel does not announce it.
  const [announcedElsewhere, setAnnouncedElsewhere] = useState(false)
  const live = !announcedElsewhere

  const run = () => {
    if (validate.isPending || tooLong) return
    // An empty field is no answer, which the API reports as such.
    validate.mutate(requiresAnswer && answer !== '' ? answer : undefined, {
      onSuccess: (result) => setAnnouncedElsewhere(announce?.(runAnnouncement(result)) ?? false),
      onError: (error) => setAnnouncedElsewhere(announce?.(`Erro: ${error.message}`) ?? false),
    })
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    run()
  }

  return (
    <section className={styles.panel} aria-labelledby="validation-heading">
      <h2 id="validation-heading" className={styles.heading}>
        Verificação
      </h2>
      <form className={styles.form} onSubmit={submit}>
        {requiresAnswer && (
          <label className={styles.answer}>
            Sua resposta
            <input
              type="text"
              value={answer}
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setAnswer(event.target.value)}
              aria-invalid={tooLong}
            />
          </label>
        )}
        <button
          type="submit"
          disabled={validate.isPending || tooLong}
          aria-busy={validate.isPending || undefined}
        >
          {validate.isPending ? 'Verificando…' : 'Verificar'}
        </button>
      </form>
      {tooLong && (
        <p className={styles.error} role="alert">
          A resposta pode ter no máximo {MAX_ANSWER_BYTES} bytes.
        </p>
      )}
      {validate.isPending && (
        <p className={styles.muted} role="status">
          Verificando o estado do laboratório…
        </p>
      )}
      {!validate.isPending && validate.error && (
        <div className={styles.outcome} role={live ? 'alert' : undefined}>
          <p className={styles.error}>{validate.error.message}</p>
          {validate.error.status === 0 && (
            <p className={styles.muted}>
              A verificação pode ter sido registrada antes de a conexão cair. Seu progresso é
              atualizado a partir do servidor.
            </p>
          )}
          {validate.error.code !== 'lab_not_ready' && validate.error.status !== 404 && (
            <button type="button" onClick={run}>
              Tentar novamente
            </button>
          )}
        </div>
      )}
      {!validate.isPending && validate.data && (
        <Outcome run={validate.data} retry={run} live={live} />
      )}
    </section>
  )
}

// How a run ended, in one sentence, before the count. A passed run is a new completion
// only when the API says this run recorded it; a completion recorded earlier stays
// whatever later runs return.
function outcomeSentence(run: ValidationRun, counted: boolean): string {
  const completedBefore = !run.newly_completed && run.progress.status === 'completed'
  if (run.outcome === 'passed') {
    if (run.newly_completed) return 'Missão concluída: o laboratório atende a todos os critérios.'
    return `O laboratório atende a todos os critérios.${completedBefore ? ' Esta missão já estava concluída.' : ''}`
  }
  if (run.outcome === 'failed') {
    if (completedBefore) {
      return 'O laboratório não atende a todos os critérios agora. Sua conclusão desta missão continua registrada.'
    }
    return counted ? 'Missão ainda não concluída.' : 'Missão ainda não concluída. Veja os critérios abaixo.'
  }
  return 'Não foi possível verificar o laboratório agora. Isso não conta como tentativa.'
}

// What the panel says about a run, as one text: the sentence and the count of met
// criteria (lab/criteria.ts), when there is one.
export function runAnnouncement(run: ValidationRun): string {
  const count = run.result ? countCriteria(run.result) : null
  const sentence = outcomeSentence(run, count !== null)
  return count ? `${sentence} ${criteriaText(count)}` : sentence
}

// The sentence, then the count in --dim, in one status (an alert for `error`) so they are
// read together; without a live region when the page already announced this run.
function Outcome({ run, retry, live }: { run: ValidationRun; retry: () => void; live: boolean }) {
  const count = run.result ? countCriteria(run.result) : null
  const failedToCheck = run.outcome === 'error'
  const role = failedToCheck ? 'alert' : 'status'
  return (
    <div className={styles.outcome} data-outcome={run.outcome}>
      <p
        className={failedToCheck ? styles.error : run.outcome === 'passed' ? styles.passed : undefined}
        role={live ? role : undefined}
      >
        {outcomeSentence(run, count !== null)}
        {count && (
          <>
            {' '}
            <span className={styles.count}>{criteriaText(count)}</span>
          </>
        )}
      </p>
      {failedToCheck && (
        <button type="button" onClick={retry}>
          Tentar novamente
        </button>
      )}
      {run.result && <ResultTree node={run.result} />}
    </div>
  )
}

// Statuses and messages exactly as the API sent them, rendered as text.
function ResultTree({ node }: { node: ResultNode }) {
  const nodes = node.kind === 'all' && node.message === null ? node.children : [node]
  return (
    <ul className={styles.tree} aria-label="Critérios">
      {nodes.map((child, index) => (
        <ResultItem key={child.kind === 'check' ? child.id : `${child.kind}-${index}`} node={child} />
      ))}
    </ul>
  )
}

function ResultItem({ node }: { node: ResultNode }) {
  if (node.kind === 'check') {
    return (
      <li className={styles.item} data-status={node.status}>
        <span className={styles.badge}>{statusLabel[node.status]}</span> {node.message}
      </li>
    )
  }
  return (
    <li className={styles.item} data-status={node.status}>
      <span className={styles.badge}>{statusLabel[node.status]}</span>{' '}
      {node.message ?? groupLabel[node.kind]}
      <ul className={styles.tree}>
        {node.children.map((child, index) => (
          <ResultItem key={child.kind === 'check' ? child.id : `${child.kind}-${index}`} node={child} />
        ))}
      </ul>
    </li>
  )
}

const groupLabel: Record<'all' | 'any' | 'not', string> = {
  all: 'Todos estes critérios:',
  any: 'Pelo menos um destes critérios:',
  not: 'O contrário deste critério:',
}
