import { whop } from '@whop/cli/vite'
import { defineConfig } from 'vite'
import { devtools } from '@tanstack/devtools-vite'

import { tanstackStart } from '@tanstack/react-start/plugin/vite'

import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'

/**
 * Fixtures are compiled in, or they do not exist.
 *
 * `CITY_FIXTURES` as a runtime binding was not an enforcement boundary — it
 * relied on `.dev.vars` not being uploaded, which is a convention. A hosted
 * deployment that had the variable injected by any other means could publish an
 * invented city as live.
 *
 * So the switch is now a build-time constant. `vite build` compiles it to
 * `false` and the fixture branch, the scenario table and the fixture module
 * itself are eliminated from the worker. Only `vite build --mode fixtures`
 * keeps them, and that mode is never what `whop apps deploy` runs.
 *
 * `dev` gets fixtures because there is no deployable artefact involved.
 */
function fixturesCompiledIn(mode: string, command: string): boolean {
  return mode === 'fixtures' || command === 'serve'
}

const config = defineConfig(({ mode, command }) => ({
  resolve: { tsconfigPaths: true },
  define: {
    __CITY_FIXTURES_BUILD__: JSON.stringify(fixturesCompiledIn(mode, command)),
  },
  plugins: [
    whop({ disableTanstackDevtools: true }),
    devtools(),
    cloudflare({ viteEnvironment: { name: 'ssr' } }),
    tailwindcss(),
    // The custom server entry is what gives City exactly one fixed API path.
    // Naming it explicitly rather than relying on filename discovery, so the
    // endpoint cannot quietly stop existing if that convention changes.
    tanstackStart({ server: { entry: './server.ts' } }),
    viteReact(),
  ],
}))

export default config
