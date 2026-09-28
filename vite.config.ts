import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// The dev server forwards API and WebSocket traffic so the browser sees a single origin,
// as it does in production behind Caddy.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:8000'

// File change events do not cross some bind mounts (Docker Desktop on Windows), so the
// Compose environment asks for polling.
const usePolling = process.env.DEV_WATCH_POLLING === 'true'

export default defineConfig({
  plugins: [react()],
  server: {
    watch: usePolling ? { usePolling: true, interval: 300 } : undefined,
    proxy: {
      '/api': { target: apiTarget },
      '/ws': { target: apiTarget, ws: true },
    },
  },
  test: {
    environment: 'node',
  },
})
