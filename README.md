# Whop City

A living, playable city built from a Whop business.

## Status

Task 1, the Whop capability spike. No production code has been started: there is
no web app, no 3D city, and no Whop write outside the probe.

## Start here

- Read [`docs/implementation-plan.md`](docs/implementation-plan.md).
- Read [`docs/whop-permission-matrix.md`](docs/whop-permission-matrix.md) for what
  Whop can and cannot do, and for the items still blocking Task 1 sign-off.
- Do not begin the 3D build until the Whop capability matrix and the Paper city screen are approved.
- Never commit Whop credentials, OAuth secrets, webhook secrets, or production data.

## Capability spike

```bash
pnpm install
pnpm test                      # offline contract tests, no network, no secrets
WHOP_LIVE_UNAUTH=1 pnpm test   # adds live checks against api.whop.com, still no secrets
pnpm probe                     # capability sweep; safe to run with no credentials
```

Copy `.env.example` to `.env` to point the probe at a dedicated test business.
`.env` is git-ignored and must stay that way.

## License

MIT.
