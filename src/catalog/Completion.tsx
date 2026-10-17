import { earlierCompletedVersion, type Progress } from './api.ts'
import styles from './Completion.module.css'

// Marks a mission the user completed. Nothing is shown for a mission not completed.
// A completion recorded on an earlier version is still a completion; the version is
// mentioned, not presented as lost.
export function Completion({ progress, currentVersion }: { progress: Progress; currentVersion: number }) {
  if (progress.status !== 'completed') return null
  const earlier = earlierCompletedVersion(progress, currentVersion)
  return (
    <span className={styles.completion}>
      <span className={styles.badge}>Concluída</span>
      {earlier !== null && <span className={styles.version}> na versão {earlier}</span>}
    </span>
  )
}
