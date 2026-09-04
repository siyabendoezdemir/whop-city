import { createFileRoute } from '@tanstack/react-router'

import { CityShell } from '../components/CityShell'

/**
 * The city route.
 *
 * Client-only: the world is a WebGL canvas and the projection arrives from
 * `GET /api/city/snapshot`, so there is nothing useful to render on the server
 * and nothing about the business is embedded in the HTML.
 */
export const Route = createFileRoute('/')({
  component: CityRoute,
  ssr: false,
})

function CityRoute() {
  return <CityShell />
}
