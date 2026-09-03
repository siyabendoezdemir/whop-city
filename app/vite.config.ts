import { whop } from '@whop/cli/vite'
import { defineConfig, type Plugin } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

/**
 * Dev-only Whop API proxy.
 *
 * Hosted Whop attaches the app's key in an outbound proxy, so server code never
 * holds a credential. Local dev has no such proxy, and the SSR worker gets no
 * bindings at all — `whop apps dev` exports them into the node process running
 * Vite, and workerd sees none of it.
 *
 * Rather than write the key into a `.dev.vars` or `.env` file, this reproduces
 * the hosted shape: the credential stays in the node process, and the app calls
 * an unauthenticated local origin exactly as it calls the hosted proxy. One code
 * path serves both, and the app is credential-free in both.
 *
 * Deliberately narrow: `apply: 'serve'` keeps it out of every build, and it
 * forwards only GET requests whose path starts `/api/v1/`.
 */
function whopDevApiProxy(): Plugin {
  return {
    name: 'whop-dev-api-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__whop-dev-proxy', (req, res) => {
        void (async () => {
          const key = process.env.WHOP_API_KEY
          const path = req.url ?? '/'

          if (req.method !== 'GET') {
            res.statusCode = 405
            res.end('{"error":{"type":"method_not_allowed"}}')
            return
          }
          if (!path.startsWith('/api/v1/')) {
            res.statusCode = 404
            res.end('{"error":{"type":"not_found"}}')
            return
          }
          if (!key) {
            res.statusCode = 503
            res.end('{"error":{"type":"no_dev_credential"}}')
            return
          }

          try {
            const upstream = await fetch(`https://api.whop.com${path}`, {
              method: 'GET',
              headers: {
                'Api-Version-Date': '2026-09-02-2',
                Authorization: `Bearer ${key}`,
              },
            })
            const body = await upstream.text()
            res.statusCode = upstream.status
            res.setHeader('content-type', 'application/json')
            res.end(body)
          } catch {
            res.statusCode = 502
            res.end('{"error":{"type":"dev_proxy_failed"}}')
          }
        })()
      })
    },
  }
}

const devPort = Number(process.env.WHOP_DEV_PORT ?? 3000)

const config = defineConfig(({ command }) => ({
  resolve: { tsconfigPaths: true },
  define: {
    // Non-secret dev wiring. Both are null in a build, so the hosted path is
    // the only one that survives into production output.
    __WHOP_DEV_PROXY__:
      command === 'serve' ? JSON.stringify(`http://127.0.0.1:${devPort}/__whop-dev-proxy`) : 'null',
    __WHOP_DEV_APP_ID__:
      command === 'serve' ? JSON.stringify(process.env.WHOP_APP_ID ?? null) : 'null',
  },
  plugins: [
    whop({ disableTanstackDevtools: true }),
    whopDevApiProxy(),
    devtools(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
}))

export default config
