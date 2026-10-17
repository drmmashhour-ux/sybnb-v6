import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// Three entry pages: the full app (index.html) plus the LIGHT SR / STR pages (sr.html, str.html),
// which do not load React or any map code.
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        sr: resolve(__dirname, 'sr.html'),
        str: resolve(__dirname, 'str.html'),
      },
    },
  },
})
