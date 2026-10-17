import { Navigate, Route, Routes } from 'react-router'
import { LoginPage } from './auth/LoginPage.tsx'
import { SessionTabs, useConfirmedUser } from './auth/tabs.tsx'
import { SignupPage } from './auth/SignupPage.tsx'
import { MissionPage } from './catalog/MissionPage.tsx'
import { HomePage } from './HomePage.tsx'
import { LabPage } from './lab/LabPage.tsx'

export function App() {
  return (
    <SessionTabs>
      <Pages />
    </SessionTabs>
  )
}

// The pages are mounted again whenever the user confirmed by this tab changes (see
// auth/tabs.tsx), so nothing a page holds for one user (a validation result, a typed
// answer, an open terminal) is shown to the next. Only the user matters: loading,
// error and signed-out share one key, so a failing session check does not remount
// (and refetch) in a loop.
function Pages() {
  const owner = useConfirmedUser() ?? 'nobody'
  return (
    <Routes key={owner}>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/signup" element={<SignupPage />} />
      <Route path="/labs/:labId" element={<LabPage />} />
      <Route path="/missions/:slug" element={<MissionPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
