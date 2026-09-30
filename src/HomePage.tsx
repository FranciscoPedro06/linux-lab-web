import { Link, useSearchParams } from 'react-router'
import styles from './auth/Auth.module.css'
import { useAuth, useLogout } from './auth/session.ts'
import { LabPage } from './lab/LabPage.tsx'

export function HomePage() {
  const [params] = useSearchParams()
  const labId = params.get('lab')
  // Development terminal: independent of the account until labs belong to users.
  if (labId) return <LabPage labId={labId} />
  return <Entry />
}

function Entry() {
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
          <p className={styles.muted}>Os módulos e as missões ainda não estão disponíveis.</p>
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
            Sair
          </button>
        </>
      )}
    </main>
  )
}
