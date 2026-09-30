import { type FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import styles from './Auth.module.css'
import { useAuth, useLogin } from './session.ts'

export function LoginPage() {
  const auth = useAuth()
  const login = useLogin()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  if (auth.status === 'authenticated') return <Navigate to="/" replace />

  const submit = (event: FormEvent) => {
    event.preventDefault()
    login.mutate({ email, password }, { onSuccess: () => navigate('/', { replace: true }) })
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Linux Lab</h1>
      <form className={styles.form} onSubmit={submit} aria-labelledby="login-heading">
        <h2 id="login-heading" className={styles.heading}>
          Entrar
        </h2>
        <label className={styles.field}>
          Email
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label className={styles.field}>
          Senha
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {login.error && (
          <p className={styles.error} role="alert">
            {login.error.message}
          </p>
        )}
        <button className={styles.button} type="submit" disabled={login.isPending}>
          {login.isPending ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <p className={styles.muted}>
        Ainda não tem conta? <Link to="/signup">Cadastre-se com um convite</Link>
      </p>
    </main>
  )
}
