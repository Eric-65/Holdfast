import { defineConfig, type Connect, type Plugin } from 'vite'
import { createHandler } from './api/hf.js'
import { MemoryStore, storeFromEnv } from './api/_lib/store.js'

/**
 * Serves the Holdfast API during `npm run dev` / `npm run preview`, the way Vercel does in
 * production. Without Upstash variables it keeps data in memory, so it resets on restart.
 * It also mirrors the /i/CODE invite redirect from vercel.json.
 */
function holdfastLocalApi(): Plugin {
  const store = storeFromEnv() ?? new MemoryStore()
  const handler = createHandler(() => store)
  const mount = (middlewares: Connect.Server) => {
    middlewares.use((req, res, next) => {
      const url = req.url ?? ''
      const invite = /^\/i\/([A-Za-z0-9]{5,12})\/?$/.exec(url.split('?')[0]!)
      if (invite) {
        res.statusCode = 307
        res.setHeader('Location', `/?ref=${invite[1]}`)
        return res.end()
      }
      if (url.startsWith('/api/hf')) return void handler(req, res)
      next()
    })
  }
  return {
    name: 'holdfast-local-api',
    configureServer: (server) => mount(server.middlewares),
    configurePreviewServer: (server) => mount(server.middlewares),
  }
}

// Relative base so the build works from any static host path
// (GitHub Pages project sites, Netlify, Vercel, IPFS...).
export default defineConfig({
  base: './',
  plugins: [holdfastLocalApi()],
  build: { target: 'es2020', sourcemap: true },
  test: { environment: 'jsdom' },
} as any)
