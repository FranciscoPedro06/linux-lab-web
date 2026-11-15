import { describe, expect, it } from 'vitest'
import type { CheckResult, OperatorResult, ResultNode, ValidationStatus } from './api.ts'
import { countCriteria, criteriaText } from './criteria.ts'

function check(id: string, status: ValidationStatus): CheckResult {
  return { kind: 'check', id, status, message: `${id}.` }
}

// An operator's status as the API combines it (linux-lab-api validation/evaluate.py).
function group(
  kind: OperatorResult['kind'],
  children: ResultNode[],
  message: string | null = null,
): OperatorResult {
  const statuses = children.map((child) => child.status)
  let status: ValidationStatus
  if (kind === 'all') {
    status = statuses.includes('failed')
      ? 'failed'
      : statuses.includes('error')
        ? 'error'
        : 'passed'
  } else if (kind === 'any') {
    status = statuses.includes('passed')
      ? 'passed'
      : statuses.includes('error')
        ? 'error'
        : 'failed'
  } else {
    const only = statuses[0]
    status = only === 'passed' ? 'failed' : only === 'failed' ? 'passed' : 'error'
  }
  return { kind, status, message, children }
}

const all = (...children: ResultNode[]) => group('all', children)

describe('countCriteria', () => {
  it('counts three passed leaves as 3 of 3', () => {
    expect(
      countCriteria(all(check('a', 'passed'), check('b', 'passed'), check('c', 'passed'))),
    ).toEqual({
      met: 3,
      total: 3,
      unverified: 0,
    })
  })

  it('counts two passed and one failed as 2 of 3', () => {
    expect(
      countCriteria(all(check('a', 'passed'), check('b', 'failed'), check('c', 'passed'))),
    ).toEqual({
      met: 2,
      total: 3,
      unverified: 0,
    })
  })

  // The API has no pending or not-applicable state: a check that could not run is
  // `error`. It stays in the total, is never met, and is reported apart.
  it('counts two passed and one that could not run as 2 of 3, one unverified', () => {
    expect(
      countCriteria(all(check('a', 'passed'), check('b', 'passed'), check('c', 'error'))),
    ).toEqual({
      met: 2,
      total: 3,
      unverified: 1,
    })
  })

  it('counts leaves in different nested groups, never the groups, each leaf once', () => {
    // Permissões { dono OK, grupo OK } and Serviço { processo error, porta OK }.
    const tree = all(
      group('all', [check('owner', 'passed'), check('group', 'passed')], null),
      group(
        'all',
        [check('process', 'error'), check('port', 'passed')],
        'O serviço ainda não está pronto.',
      ),
    )
    expect(countCriteria(tree)).toEqual({ met: 3, total: 4, unverified: 1 })
  })

  it('goes through deeper nesting', () => {
    const tree = all(
      check('a', 'passed'),
      all(all(check('b', 'failed'), all(check('c', 'passed'))), check('d', 'passed')),
    )
    expect(countCriteria(tree)).toEqual({ met: 3, total: 4, unverified: 0 })
  })

  it('counts a mission whose root is a single check', () => {
    // hidden-file: the answer condition alone.
    expect(countCriteria(check('word', 'failed'))).toEqual({ met: 0, total: 1, unverified: 0 })
    expect(countCriteria(check('word', 'passed'))).toEqual({ met: 1, total: 1, unverified: 0 })
  })

  it('counts a flat mission like secure-deploy-script', () => {
    const ids = [
      'script-content',
      'env-content',
      'script-mode',
      'env-mode',
      'readme-mode',
      'script-owner',
      'env-owner',
    ]
    const tree = all(...ids.map((id) => check(id, id.endsWith('mode') ? 'failed' : 'passed')))
    expect(countCriteria(tree)).toEqual({ met: 4, total: 7, unverified: 0 })
  })

  // Under `not` a passed leaf makes the condition fail; under `any` one passed leaf is
  // enough. Counting their leaves would contradict the run's outcome, so no count.
  it('gives no count for a tree with not', () => {
    const tree = all(check('a', 'passed'), group('not', [check('secret', 'passed')]))
    expect(tree.status).toBe('failed')
    expect(countCriteria(tree)).toBeNull()
  })

  it('gives no count for a tree with any', () => {
    const tree = all(
      check('a', 'passed'),
      group('any', [check('cp', 'passed'), check('mv', 'failed')]),
    )
    expect(tree.status).toBe('passed')
    expect(countCriteria(tree)).toBeNull()
  })

  it('gives no count for a group without leaves', () => {
    expect(countCriteria(all())).toBeNull()
    expect(countCriteria(all(all(), all()))).toBeNull()
  })

  it('agrees with the outcome: every leaf of an all-only tree passed exactly when it passed', () => {
    const statuses: ValidationStatus[] = ['passed', 'failed', 'error']
    for (const a of statuses) {
      for (const b of statuses) {
        for (const c of statuses) {
          const tree = all(check('a', a), all(check('b', b), check('c', c)))
          const count = countCriteria(tree)
          expect(count?.met === count?.total).toBe(tree.status === 'passed')
        }
      }
    }
  })
})

describe('criteriaText', () => {
  it('says how many were met, in the singular for one criterion', () => {
    expect(criteriaText({ met: 2, total: 3, unverified: 0 })).toBe('2 de 3 critérios atendidos.')
    expect(criteriaText({ met: 0, total: 1, unverified: 0 })).toBe('0 de 1 critério atendido.')
  })

  it('says how many could not be checked', () => {
    expect(criteriaText({ met: 2, total: 3, unverified: 1 })).toBe(
      '2 de 3 critérios atendidos (1 não verificado).',
    )
    expect(criteriaText({ met: 1, total: 4, unverified: 3 })).toBe(
      '1 de 4 critérios atendidos (3 não verificados).',
    )
  })
})
