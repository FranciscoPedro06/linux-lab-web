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
import styles from './ValidationPanel.module.css'
import { useValidateLab } from './queries.ts'

const statusLabel: Record<ValidationStatus, string> = {
  passed: 'Atendida',
  failed: 'Não atendida',
  error: 'Não verificada',
}

// Checks the lab's state when the student asks. The API decides the outcome from the
// mission version the lab was created for; nothing is validated automatically.
export function ValidationPanel({ labId, mission }: { labId: string; mission: LabMission }) {
  const validate = useValidateLab(labId)
  // The mission detail, read at the lab's version, says whether an answer is expected.
  // While it loads, or if it cannot be read, the panel validates without one.
  const detail = useMission(mission.slug)
  const requiresAnswer = detail.data?.requires_answer === true
  const [answer, setAnswer] = useState('')
  const tooLong = answerBytes(answer) > MAX_ANSWER_BYTES

  const run = () => {
    if (validate.isPending || tooLong) return
    // An empty field is no answer, which the API reports as such.
    validate.mutate(requiresAnswer && answer !== '' ? answer : undefined)
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
        <button type="submit" disabled={validate.isPending || tooLong}>
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
        <div className={styles.outcome} role="alert">
          <p className={styles.error}>{validate.error.message}</p>
          {validate.error.code !== 'lab_not_ready' && validate.error.status !== 404 && (
            <button type="button" onClick={run}>
              Tentar novamente
            </button>
          )}
        </div>
      )}
      {!validate.isPending && validate.data && <Outcome run={validate.data} retry={run} />}
    </section>
  )
}

function Outcome({ run, retry }: { run: ValidationRun; retry: () => void }) {
  return (
    <div className={styles.outcome} data-outcome={run.outcome}>
      {run.outcome === 'passed' && (
        <p className={styles.passed} role="status">
          Missão concluída: o laboratório atende a todos os critérios.
        </p>
      )}
      {run.outcome === 'failed' && (
        <p role="status">Missão ainda não concluída. Veja os critérios abaixo.</p>
      )}
      {run.outcome === 'error' && (
        <>
          <p className={styles.error} role="alert">
            Não foi possível verificar o laboratório agora. Isso não conta como tentativa.
          </p>
          <button type="button" onClick={retry}>
            Tentar novamente
          </button>
        </>
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
