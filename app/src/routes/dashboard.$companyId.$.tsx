import { createFileRoute } from '@tanstack/react-router'

import { CityShell } from '../components/CityShell'

/**
 * Deep links into the owner's city.
 *
 * Whop appends whatever path the creator navigated to, so `/dashboard/biz_x/
 * anything` has to resolve rather than 404 inside the dashboard iframe.
 */
export const Route = createFileRoute('/dashboard/$companyId/$')({
  component: OwnerCityRoute,
  ssr: false,
})

function OwnerCityRoute() {
  return <CityShell />
}
