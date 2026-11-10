import { defineConfig } from 'vite'

// Relative base so the build works from any static host path
// (GitHub Pages project sites, Netlify, Vercel, IPFS...).
export default defineConfig({
  base: './',
  build: { target: 'es2020', sourcemap: true },
  test: { environment: 'jsdom' },
} as any)
