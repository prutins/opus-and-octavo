import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  // Relative asset paths, so the build works wherever it's hosted: at a site
  // root, or under a path like GitHub Pages' /<repository>/ (including forks)
  base: './',
  plugins: [react()],
})
