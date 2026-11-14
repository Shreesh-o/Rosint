import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { trackedUsersPlugin } from './vite-plugin-tracked-users.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), trackedUsersPlugin()],
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
})
