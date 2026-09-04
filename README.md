# Whop City

A living, playable city built from a Whop business.

City is a Whop Website — an app of type `website`, hosted by Whop at its own
`whop.site` route and publishable as a Blueprint. Deploying the Blueprint gives
a business its own copy of the products, the site, and the city that renders
them. It is not a third-party app that sellers install, and there is no sign-in
or business picker.

## Status

The public read-only city runs locally in [`app/`](app): a Whop Website route
that renders three districts from a safe server-derived projection, fixture
backed. **No deploy, no Blueprint publication, and no business-data write has
been performed.**

The operator surface — identity, team-role gating, and any write — is not
started.

## Start here

- [`app/README.md`](app/README.md) — the running product: the privacy boundary,
  the single endpoint, the renderer, and how to verify all of it.

- [`docs/architecture-website-blueprint.md`](docs/architecture-website-blueprint.md)
  — the diagram, the access model, what Whop hosting provides versus what needs
  external persistence, and the exact init command.
- [`docs/website-auth-spike.md`](docs/website-auth-spike.md) — how City answers
  "is this visitor on this business's team?", what the spike proved, and the
  three questions it could not reach.
- [`docs/implementation-plan.md`](docs/implementation-plan.md) — the task plan
  that follows from both.

## Running the spike

[`scripts/auth-spike.mjs`](scripts/auth-spike.mjs) re-runs the read-only checks.
It cannot mutate anything — every CLI call is checked against an allowlist of
read-only verbs — and it scrubs the credential and e-mail local parts from
everything it prints or saves.

```
WHOP_API_KEY=… node scripts/auth-spike.mjs
```

Pass the credential through the environment only: never on a command line, never
in an `.env` file, never in a committed file. Reports are written to
`probe-reports/`, which is git-ignored.

## Ground rules

- The app type `website` is permanent once chosen, and it has now been chosen:
  `app_USXOBX9htLTka7` is a `website` on route `city-spike`.
- A route may not contain the word "whop", so `whop-city` is not a claimable
  subdomain. The current route is deliberately test-scoped so the throwaway
  business does not squat whatever the real deployment wants.
- A `whop.site` route is publicly browsable and has no automatic visitor
  identity. The public city shows a privacy-safe projection only; the operator
  surface requires a verified Whop identity that is on this deployment's team.
- Browser code never receives a Whop API key or OAuth token. Server routes call
  the Whop API through `WHOP_API_ORIGIN` when it is set, falling back to
  `https://api.whop.com` — the binding is absent under `whop apps dev`, so it
  cannot be required. On hosted Whop, the proxy attaches the key; in local dev
  there is no proxy and the key is readable in `process.env`, so treat dev as
  the weaker environment.
- Business identity comes from `WHOP_ACCOUNT_ID` when set, and otherwise from
  `account.id` on the public `GET /apps/{WHOP_APP_ID}`. That binding is also
  absent in dev, and a Blueprint deployment gets a different business anyway.
- No server route forwards an arbitrary path, method, or body to the Whop API.
- Every meaningful change is review → explicit confirm → execute → receipt, and
  membership is re-checked at the write, not just at login.
- Never commit Whop credentials, secrets, or business data.

## License

MIT.
