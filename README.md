# Whop City

A living, playable city built from a Whop business.

City is a Whop Website — an app of type `website`, hosted by Whop at its own
`whop.site` route and publishable as a Blueprint. Deploying the Blueprint gives
a business its own copy of the products, the site, and the city that renders
them. It is not a third-party app that sellers install, and there is no sign-in
or business picker.

## Status

Architecture revision, before any product code. No `whop apps init`, no deploy,
no Blueprint publication, and no Whop write has been performed.

## Start here

- [`docs/architecture-website-blueprint.md`](docs/architecture-website-blueprint.md)
  — the diagram, what Whop hosting provides versus what needs external
  persistence, the exact init command, and the open decisions.
- [`docs/implementation-plan.md`](docs/implementation-plan.md) — the task plan
  that follows from it.

## Ground rules

- The app type `website` is permanent once chosen. Do not run `whop apps init`
  until the route, name, and test business are confirmed.
- A `whop.site` route is publicly browsable and has no automatic visitor
  identity. Nothing sensitive renders publicly, and no write runs ungated.
- Browser code never receives a Whop API key. Server routes call the Whop API
  through `process.env.WHOP_API_ORIGIN`, and Whop's proxy attaches the key.
- Every meaningful change is review → explicit confirm → execute → receipt.
- Never commit Whop credentials, secrets, or business data.

## License

MIT.
