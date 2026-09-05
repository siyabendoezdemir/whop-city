import { createFileRoute } from '@tanstack/react-router'

import { CityShell } from '../components/CityShell'

/**
 * The owner's city.
 *
 * Whop renders this path inside the creator's own business dashboard and
 * attaches a signed token to every same-origin request it makes. The snapshot
 * endpoint verifies that token and checks the user is an admin of this
 * business before any real figure crosses the wire — see `server/viewer.ts`.
 *
 * The route itself is the same city as the public one. It has to be: the
 * difference between a visitor and the owner is what the numbers say, not
 * which game they are playing. Nothing about the business is rendered on the
 * server, so nothing lands in the HTML either.
 */
export const Route = createFileRoute('/dashboard/$companyId')({
  component: OwnerCityRoute,
  ssr: false,
})

function OwnerCityRoute() {
  return <CityShell />
}
