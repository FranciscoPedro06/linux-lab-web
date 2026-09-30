import { type ChangeEvent, type FormEvent, useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router'
import type { SignupInput } from './api.ts'
import styles from './Auth.module.css'
import { useAuth, useSignup } from './session.ts'

// Limits enforced by the API, repeated here only for the browser's own validation.
const MIN_PASSWORD_LENGTH = 12
const MAX_PASSWORD_LENGTH = 128
const MAX_DISPLAY_NAME_LENGTH = 80

export function SignupPage() {
  const auth = useAuth()
  const signup = useSignup()
  const navigate = useNavigate()
  const [form, setForm] = useState<SignupInput>({
    email: '',
    password: '',
    display_name: '',
    invite_code: '',
  })

  if (auth.status === 'authenticated') return <Navigate to="/" replace />

  const update = (field: keyof SignupInput) => (event: ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [field]: event.target.value }))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    signup.mutate(form, { onSuccess: () => navigate('/', { replace: true }) })
  }

  return (
    <main className={styles.page}>
      <h1 className={styles.title}>Linux Lab</h1>
      <form className={styles.form} onSubmit={submit} aria-labelledby="signup-heading">
        <h2 id="signup-heading" className={styles.heading}>
          Criar conta
        </h2>
        <label className={styles.field}>
          Nome
          <input
            name="display_name"
            autoComplete="name"
            required
            maxLength={MAX_DISPLAY_NAME_LENGTH}
            value={form.display_name}
            onChange={update('display_name')}
          />
        </label>
        <label className={styles.field}>
          Email
          <input
            type="email"
            name="email"
            autoComplete="email"
            required
            value={form.email}
            onChange={update('email')}
          />
        </label>
        <label className={styles.field}>
          Senha
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={MAX_PASSWORD_LENGTH}
            aria-describedby="password-hint"
            value={form.password}
            onChange={update('password')}
          />
          <span id="password-hint" className={styles.hint}>
            De {MIN_PASSWORD_LENGTH} a {MAX_PASSWORD_LENGTH} caracteres.
          </span>
        </label>
        <label className={styles.field}>
          Código de convite
          <input
            name="invite_code"
            autoComplete="off"
            required
            value={form.invite_code}
            onChange={update('invite_code')}
          />
        </label>
        {signup.error && (
          <p className={styles.error} role="alert">
            {signup.error.message}
          </p>
        )}
        <button className={styles.button} type="submit" disabled={signup.isPending}>
          {signup.isPending ? 'Criando conta…' : 'Criar conta'}
        </button>
      </form>
      <p className={styles.muted}>
        Já tem conta? <Link to="/login">Entrar</Link>
      </p>
    </main>
  )
}
