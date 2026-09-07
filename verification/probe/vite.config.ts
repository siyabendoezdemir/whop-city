import { whop } from '@whop/cli/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'

// Worker-only build. There is no client entry, so `dist/client` stays empty and
// the packed archive carries a single server module — which is the whole point:
// the smaller the artifact, the less there is to audit before it goes live.
export default defineConfig({
  plugins: [whop(), cloudflare({ viteEnvironment: { name: 'ssr' } })],
  environments: {
    ssr: {
      build: {
        outDir: 'dist/server',
        rollupOptions: { output: { entryFileNames: 'index.js' } },
      },
    },
  },
})
