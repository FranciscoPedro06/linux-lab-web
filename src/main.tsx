import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { App } from './App.tsx'
// Served from this site: the Content-Security-Policy allows fonts from 'self' only.
import '@fontsource/ubuntu-sans-mono/400.css'
import '@fontsource/ubuntu-sans-mono/700.css'
import './index.css'

const root = document.getElementById('root')
if (!root) {
  throw new Error('Root element not found')
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } })

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
