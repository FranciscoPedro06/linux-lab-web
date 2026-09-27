import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

// The dev server forwards API and WebSocket traffic so the browser sees a single origin,
// as it does in production behind Caddy.
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://localhost:8000'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: apiTarget },
      '/ws': { target: apiTarget, ws: true },
    },
  },
  test: {
    environment: 'node',
  },
})
