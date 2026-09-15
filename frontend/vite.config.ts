import react from '@vitejs/plugin-react'
import { ServerResponse } from 'node:http'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // In development the page (5173) reaches the backend (8000) through /api,
      // so the browser sees a single origin and no CORS setup is needed.
      '/api': {
        target: 'http://localhost:8000',
        rewrite: (path) => path.replace(/^\/api/, ''),
        configure: (proxy) => {
          // Backend not running: answer 502 so the page can say so clearly.
          proxy.on('error', (_err, _req, res) => {
            if (res instanceof ServerResponse && !res.headersSent) {
              res.writeHead(502, { 'content-type': 'application/json' })
              res.end(JSON.stringify({ detail: 'Backend unreachable' }))
            }
          })
        },
      },
    },
  },
})
