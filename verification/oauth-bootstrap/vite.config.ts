import { whop } from '@whop/cli/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { defineConfig } from 'vite'

// Worker-only build. There is no client entry, so `dist/client` stays empty and
// the packed archive carries a single server module with one outbound call site.
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
