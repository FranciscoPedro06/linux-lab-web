import { Navigate, Route, Routes } from 'react-router'
import { LoginPage } from './auth/LoginPage.tsx'
import { SignupPage } from './auth/SignupPage.tsx'
import { HomePage } from './HomePage.tsx'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
