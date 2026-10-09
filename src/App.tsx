import { Navigate, Route, Routes } from 'react-router'
import { LoginPage } from './auth/LoginPage.tsx'
import { SignupPage } from './auth/SignupPage.tsx'
import { MissionPage } from './catalog/MissionPage.tsx'
import { HomePage } from './HomePage.tsx'
import { LabPage } from './lab/LabPage.tsx'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/labs/:labId" element={<LabPage />} />
      <Route path="/missions/:slug" element={<MissionPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
