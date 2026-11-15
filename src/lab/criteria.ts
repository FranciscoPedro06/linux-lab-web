import type { ResultNode } from './api.ts'

// How many of a run's leaf checks were met. Leaves are the nodes with kind `check`;
// operators (`all`, `any`, `not`) are groups and never count. Every leaf ends `passed`,
// `failed` or `error` (the API evaluates every leaf, with no short-circuiting):
// - passed counts as met;
// - failed is not met;
// - error is a check that could not run: not met, and reported apart (`unverified`).
//
// A count is only given for trees made of `all` groups and checks, where the run meets
// the mission exactly when every leaf passed. Under `not` a passed leaf makes the
// condition fail, and under `any` one passed leaf is enough, so counting their leaves
// would contradict the run's outcome; for those trees, and for a tree without leaves,
// there is no count (null) and the panel shows the criteria only.
export type CriteriaCount = { met: number; total: number; unverified: number }

export function countCriteria(node: ResultNode): CriteriaCount | null {
  const count: CriteriaCount = { met: 0, total: 0, unverified: 0 }
  if (!walk(node, count) || count.total === 0) return null
  return count
}

// Adds the leaves under `node`; false when the tree has an operator other than `all`.
function walk(node: ResultNode, count: CriteriaCount): boolean {
  if (node.kind === 'check') {
    count.total += 1
    if (node.status === 'passed') count.met += 1
    if (node.status === 'error') count.unverified += 1
    return true
  }
  if (node.kind !== 'all') return false
  return node.children.every((child) => walk(child, count))
}

export function criteriaText({ met, total, unverified }: CriteriaCount): string {
  const noun = total === 1 ? 'critério atendido' : 'critérios atendidos'
  const text = `${met} de ${total} ${noun}`
  if (unverified === 0) return `${text}.`
  return `${text} (${unverified} não ${unverified === 1 ? 'verificado' : 'verificados'}).`
}
