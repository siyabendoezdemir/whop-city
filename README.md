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
  — the diagram, the access model, what Whop hosting provides versus what needs
  external persistence, and the exact init command.
- [`docs/website-auth-spike.md`](docs/website-auth-spike.md) — how City answers
  "is this visitor on this business's team?", and what the spike must prove.
- [`docs/implementation-plan.md`](docs/implementation-plan.md) — the task plan
  that follows from both.

## Ground rules

- The app type `website` is permanent once chosen. Do not run `whop apps init`
  until the route, name, and test business are confirmed.
- A `whop.site` route is publicly browsable and has no automatic visitor
  identity. The public city shows a privacy-safe projection only; the operator
  surface requires a verified Whop identity that is on this deployment's team.
- Browser code never receives a Whop API key or OAuth token. Server routes call
  the Whop API through `process.env.WHOP_API_ORIGIN`, and Whop's proxy attaches
  the key.
- No server route forwards an arbitrary path, method, or body to the Whop API.
- Every meaningful change is review → explicit confirm → execute → receipt, and
  membership is re-checked at the write, not just at login.
- Never commit Whop credentials, secrets, or business data.

## License

MIT.
