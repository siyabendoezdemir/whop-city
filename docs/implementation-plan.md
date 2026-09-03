# Whop City Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Ship a polished, desktop-first playable Whop Website/Blueprint where a Whop seller signs in, selects a business, sees its live commerce operation as a bright low-poly startup city, receives actionable missions, performs one real Whop action through a review/confirm/receipt flow, and appears anonymously on an opt-out-free leaderboard.

**Architecture:** A Vite/TanStack Start web application is the Whop Website and canonical UI. It renders a real-time 3D isometric city with React Three Fiber, while ordinary React surfaces handle all accessible operational controls. One TypeScript service on Siya’s Hetzner VPS owns durable state, encrypted OAuth token storage, normalized business snapshots, webhook ingestion, leaderboard calculations, and background sync; the UI never receives a Whop API key or refresh token. Durable state lives in one local SQLite database in WAL mode, not a separately hosted database.

**Tech Stack:** TypeScript; React 19; Vite + TanStack Start; `@whop/cli/vite`; React Three Fiber + Three.js + Drei; Zustand; TanStack Query; Node.js + Fastify; SQLite (WAL mode) + Drizzle ORM + `better-sqlite3`; one in-process serialized job runner; Socket.IO (or native WebSocket); Whop OAuth 2.1 + PKCE, REST API, webhooks; Vitest; Playwright; Docker Compose; GitHub Actions; Caddy on Hetzner.

---

## Product contract

### First playable release — definition of done

A new Whop seller can:

1. open City, sign in with Whop, and choose one owned Whop business;
2. authorize only the least permissions City needs;
3. see a city generated from current business data, not mock stats;
4. inspect three functional districts:
   - **Commerce Core** — revenue/customers;
   - **Offer Forge** — products/plans/pricing;
   - **Creator Quarter** — affiliate readiness/activity;
5. see deterministic, understandable missions tied to those systems;
6. complete a manual real-world-work mission as `claimed`, clearly distinct from `verified`;
7. trigger one permitted Whop write through a mandatory review → explicit confirmation → execution → immutable receipt sequence;
8. observe the affected city state update through the event/sync path;
9. see their anonymous city on a public leaderboard, with an optional identity reveal later;
10. use the product on desktop; mobile can view city health and leaderboard but does not promise full 3D operation.

### V1 real action

**Create a draft offer** from Offer Forge, with optional affiliate programme settings only if the API-permission spike proves the required create/update surface works under user OAuth. The action must create a real Whop product only after the player reviews exact fields and presses a labelled confirmation button. It receives an idempotency key and creates a receipt linked to the returned Whop product ID.

Reason: product creation is a documented, concrete user-OAuth-capable write. Do not substitute a fake “upgrade building” animation for the write.

### V1 non-goals

- No payouts, transfers, refunds, price changes to an existing live offer, bulk messages, affiliate invitations, ads, or any money-moving action.
- No automatic execution of user-facing business actions.
- No generalized LLM business adviser or opaque “AI score.”
- No open-world terrain, multiplayer visits, guilds, chat, trading, or native apps.
- No paid asset purchase until Siya chooses and approves a specific licensed asset pack.
- No claim that every Whop metric/action is currently supported; all copy must name only verified integrations.

### Visual contract

- Original bright modern-startup city: sunlit SF/product-company feeling; Whop-adjacent color energy without copying Whop brand components or Clash of Clans art.
- One explorable isometric city block with three built functional districts and three visibly locked/under-construction future districts.
- No generic analytics dashboard surrounding a game canvas. The city is the default work surface.
- Paper is the source of truth before production UI implementation.

---

## Source constraints to preserve

- Whop `website` app type is permanent and cannot later become a `b2c_app`; City is intentionally a `website` so it can publish as a Blueprint.
- Use Whop OAuth 2.1 + PKCE for “Sign in with Whop”; store refresh tokens only in the Hetzner backend encrypted at rest.
- Pin the Whop API version at the integration boundary. Keep the version in a single environment/config value and contract-test it.
- Whop app/API keys, OAuth client secret, webhook signing secret, and database credentials never reach browser code or the public GitHub repository.
- Webhooks are at-least-once and unordered: signature-verify raw payloads, record `webhook-id`, ignore duplicates, and reconcile current state before applying order-sensitive changes.
- User stays anonymous on public leaderboard by default. “Anonymous” is not an opt-out; participation remains mandatory per product decision. Do not expose business name, raw revenue, customer count, or city details unless the player deliberately enables a separately worded reveal setting.

---

## Proposed repository

Create public repository: `siyaozdemir/whop-city` (confirm exact GitHub username during setup).

```text
whop-city/
├── apps/
│   ├── web/                         # Whop Website: Vite/TanStack Start/R3F
│   │   ├── src/
│   │   │   ├── routes/
│   │   │   ├── components/
│   │   │   │   ├── city/
│   │   │   │   ├── districts/
│   │   │   │   ├── missions/
│   │   │   │   └── operations/
│   │   │   ├── features/
│   │   │   │   ├── auth/
│   │   │   │   ├── business-selection/
│   │   │   │   ├── city/
│   │   │   │   ├── leaderboard/
│   │   │   │   └── operations/
│   │   │   ├── lib/
│   │   │   └── styles/
│   │   ├── public/assets/            # committed only for redistributable assets
│   │   ├── vite.config.ts
│   │   ├── whop.app.json             # generated only after Whop Website creation
│   │   └── package.json
│   └── worker/                       # Hetzner API, serialized jobs, webhook endpoint
│       ├── src/
│       │   ├── http/
│       │   ├── whop/
│       │   ├── jobs/
│       │   ├── sync/
│       │   └── security/
│       └── package.json
├── packages/
│   ├── domain/                       # typed district metrics, city state, missions, receipts
│   ├── city-engine/                  # deterministic metrics → district/city transformation
│   ├── whop-client/                  # pinned/versioned Whop API adapter + DTO validation
│   ├── db/                           # SQLite/Drizzle schema, migrations, repositories
│   └── config/                       # shared lint/tsconfig/env validation
├── tests/
│   ├── contracts/                    # Whop payload fixtures/adapter contract tests
│   ├── e2e/                          # Playwright buyer journey
│   └── fixtures/
├── infra/
│   ├── docker-compose.yml
│   ├── Caddyfile
│   └── systemd/
├── docs/
│   ├── product-brief.md
│   ├── whop-permission-matrix.md
│   ├── event-model.md
│   ├── asset-licenses.md
│   └── runbook.md
├── .github/workflows/ci.yml
├── .env.example
├── LICENSE
├── README.md
├── pnpm-workspace.yaml
└── package.json
```

---

## Data model

### Durable tables

- `players`: internal ID, Whop user ID, leaderboard alias seed, reveal preference, created/updated timestamps.
- `connected_businesses`: player/business relationship, selected status, sync state, source metadata.
- `oauth_credentials`: encrypted access/refresh tokens, expiry, scopes, key version; never returned by API.
- `business_snapshots`: normalized point-in-time business metrics plus source (`poll`, `webhook`, `operation`), freshness, and raw-payload hash/reference.
- `district_states`: business/district level, health, change direction, explanation keys, generated timestamp.
- `missions`: rule ID, target evidence, state (`available | claimed | verified | expired`), manual claim note, proof reference.
- `operation_intents`: a user-reviewed, not-yet-executed write payload with expiry and immutable content hash.
- `operation_receipts`: completed/failed execution with correlation ID, Whop resource ID, response summary, timestamp, actor, and idempotency key.
- `leaderboard_entries`: anonymous public score, rank inputs, snapshot timestamp; no raw sensitive metric fields.
- `webhook_deliveries`: webhook ID, signature-verification status, event type, received time, processed time, error state.

### City engine inputs and outputs

The engine is deterministic and testable. It accepts normalized business metrics and emits:

```ts
CityState = {
  cityLevel: number;
  vitality: 0..100;
  updatedAt: string;
  districts: Array<{
    id: 'commerce' | 'offers' | 'affiliates' | 'traffic' | 'community' | 'growth';
    level: number;
    health: 'thriving' | 'steady' | 'blocked' | 'unbuilt';
    direction: 'up' | 'flat' | 'down';
    explanation: string;
    visualVariant: string;
  }>;
}
```

No black-box score. Every district must show the input signal and the remediation rule in plain language.

---

## Implementation tasks

### Task 1: Verify Whop capabilities in a sandbox before product code

**Objective:** Replace assumptions with an explicit live permission/action matrix.

**Files:**
- Create: `docs/whop-permission-matrix.md`
- Create: `tests/contracts/whop-sandbox.spec.ts`
- Create: `packages/whop-client/src/capability-probe.ts`

**Steps:**
1. Create a fresh Whop test business and a separate sandbox/development app; record IDs only in local `.env`, never in Git.
2. Configure a local and production OAuth redirect URI.
3. Inventory available OAuth scopes in the Whop developer dashboard and map each required read/write operation to its least scope.
4. Confirm, against the target API version, the exact endpoints/fields for:
   - list accessible businesses;
   - read products/plans and active members/customer signals;
   - read affiliate readiness/activity;
   - create a hidden/draft product with an idempotency key;
   - read resulting product;
   - create/test webhooks or document why app-level webhook setup is not viable for per-user businesses.
5. Exercise only the new test business. Capture request/response fixtures with IDs/redacted PII removed.
6. Mark every unsupported field/action as unavailable in the matrix and remove it from v1 copy/UI.

**Verification:** one repeatable sandbox test returns a normalized business snapshot and creates exactly one test product from an explicit action intent; duplicate idempotency submission does not create a second product.

**Commit:** `test: establish whop capability contract`

### Task 2: Write the product brief and create approved Paper design

**Objective:** Freeze the game’s job, IA, city grammar, and operating surfaces before implementation.

**Files:**
- Create: `docs/product-brief.md`
- Create: `docs/design-brief.md`
- Create: Paper file/page with `Whop City / Components` and `Whop City / First city state` artboards.

**Steps:**
1. Write the one-sentence primary job: “Help a Whop seller see the most leveraged next business action by turning verified business state into a city they want to improve.”
2. Produce a component sheet: city district focus card, mission card, neutral operation button, dangerous/confirm operation button, receipt, leaderboard row, city-health indicator, mobile read-only card.
3. Design one actual desktop city state: Commerce Core active, Offer Forge needing work, Creator Quarter blocked, three future districts visibly but quietly locked.
4. Design the complete click path: city → district → mission → operation review → confirm → receipt → updated city.
5. Capture reference and target screenshots at matching desktop dimensions. Get Siya’s explicit visual approval before code.

**Verification:** one approved Paper artboard proves the functional user journey with no generic dashboard rails or fake controls.

**Commit:** `docs: approve whop city v1 interaction design`

### Task 3: Create repository and reproducible project skeleton

**Objective:** Establish an open-source project that runs locally without secrets.

**Files:**
- Create all root workspace files listed in the repository tree.
- Create: `README.md`, `LICENSE` (MIT unless Siya chooses otherwise), `.env.example`, `.gitignore`, `.github/workflows/ci.yml`.

**Steps:**
1. Create the public GitHub repository only after Siya confirms the repo name and the first Paper state is approved.
2. Initialize pnpm workspace and strict TypeScript settings.
3. Scaffold the Whop Website from the official CLI inside `apps/web`; preserve its `whop.app.json` and Vite plugin integration.
4. Add worker, shared packages, lint, formatting, typecheck, Vitest, Playwright, and CI.
5. Make `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` run with no credentials.

**Verification:** a clean clone passes CI and renders a non-product “City is under construction” route locally.

**Commit:** `chore: initialize whop city workspace`

### Task 4: Implement secure Whop OAuth and business selection

**Objective:** Let an owner sign in, choose one business, and safely establish a backend connection.

**Files:**
- Create: `apps/web/src/routes/auth/*`
- Create: `apps/worker/src/http/oauth.ts`
- Create: `apps/worker/src/security/token-vault.ts`
- Create: `packages/db/src/schema/oauth.ts`
- Test: `tests/contracts/oauth-flow.spec.ts`, `tests/e2e/onboarding.spec.ts`

**Steps:**
1. Implement OAuth 2.1 Authorization Code + PKCE with state, nonce, callback validation, rotating-refresh-token persistence, and session-cookie security.
2. Encrypt refresh tokens at rest using a server-held encryption key; write key rotation as a runbook item.
3. Fetch businesses visible to the signed-in owner and require an explicit business selection.
4. Store only the selected business connection; show a disconnect/revoke control.
5. Render consent text describing exactly what City reads, what v1 may write, and that leaderboard participation is anonymous by default.
6. Add failure states: denied consent, expired token, no accessible business, unavailable Whop API, disconnected business.

**Verification:** Playwright proves a test user cannot access another user’s selected business and that the browser never receives an API key/refresh token.

**Commit:** `feat: connect a Whop business with OAuth`

### Task 5: Build the normalized sync pipeline and live-update boundary

**Objective:** Turn Whop data into fresh, trustworthy city input.

**Files:**
- Create: `packages/whop-client/src/*`
- Create: `apps/worker/src/sync/*`
- Create: `apps/worker/src/http/webhooks.ts`
- Create: `packages/db/src/schema/snapshots.ts`
- Create: `docs/event-model.md`
- Test: `tests/contracts/webhook-idempotency.spec.ts`, `tests/contracts/snapshot-normalization.spec.ts`

**Steps:**
1. Create one typed Whop adapter; it owns auth headers, API-version pin, pagination, schema validation, and redacted structured errors.
2. Normalize only v1 metrics: revenue/customer signal, products/plans/pricing, and affiliate programme/activity fields proven in Task 1.
3. On connection, perform an initial snapshot. Poll active city sessions every 15 seconds; use a 60-second worker reconciliation only while connected/active. Do not run expensive permanent polling for inactive users.
4. If Task 1 confirms viable webhooks, verify raw-body signatures, dedupe `webhook-id`, enqueue work, respond immediately, and reconcile the authoritative current state after relevant events.
5. Publish a WebSocket event only after snapshot transaction succeeds.
6. Persist freshness (`live`, `refreshing`, `delayed`) and show it in the UI—never claim real time when data is stale.

**Verification:** duplicate/out-of-order webhook fixtures result in one valid current snapshot; a sandbox product creation causes a fresh city event visible in a connected test client.

**Commit:** `feat: synchronize live whop business state`

### Task 6: Implement deterministic city score, districts, and missions

**Objective:** Map business state to explainable city visuals and useful next actions.

**Files:**
- Create: `packages/city-engine/src/*`
- Create: `packages/domain/src/city.ts`, `mission.ts`
- Create: `apps/worker/src/missions/*`
- Test: `packages/city-engine/src/*.spec.ts`, `tests/fixtures/business-snapshots.ts`

**Steps:**
1. Define threshold/rule tables in code for Commerce Core, Offer Forge, and Creator Quarter; version each rule.
2. For every score/health state, attach an exact explanation and at most two suggested next actions.
3. Seed three future-district definitions (`traffic`, `community`, `growth`) as locked, non-clickable roadmap objects. Do not show data they cannot yet calculate.
4. Implement manual mission claims: user submits a concise statement; state becomes `claimed`, not `verified`; distinguish visually and on leaderboard score.
5. Implement verification rules that turn a relevant Whop snapshot/event into `verified` mission completion.
6. Ensure city visual level changes are bounded and cannot jump from a single arbitrary raw metric.

**Verification:** fixture tests prove every city state is deterministic, explains itself, and cannot award `verified` status solely from a manual claim.

**Commit:** `feat: derive city districts and missions from business state`

### Task 7: Implement the first safe operation and immutable receipt trail

**Objective:** Make the game surface execute one real business action safely.

**Files:**
- Create: `apps/web/src/features/operations/*`
- Create: `apps/worker/src/http/operations.ts`
- Create: `apps/worker/src/whop/create-offer.ts`
- Create: `packages/db/src/schema/operations.ts`
- Test: `tests/contracts/create-offer.spec.ts`, `tests/e2e/create-offer-receipt.spec.ts`

**Steps:**
1. Start from a mission/district context and build an operation intent server-side; preview title, description, pricing choice, visibility, affiliate configuration, and expected city consequence.
2. Require checkbox acknowledgement: “This creates a real Whop product in [business name].” The confirm button must use a concrete label, e.g. “Create real draft offer.”
3. Generate and store an idempotency key before the request; expire unconfirmed intents.
4. Execute only on confirm. Validate the response, snapshot fresh state, then write an immutable success/failure receipt.
5. Show a receipt including action, selected business, exact change, Whop product ID/link if safe, timestamp, and synchronization state.
6. Trigger a city construction/update animation only after backend execution and snapshot confirmation—not button click.

**Verification:** E2E validates cancellation causes zero Whop writes; confirmation produces one write/one receipt; retry cannot duplicate the offer; a failed API response creates a failure receipt and no false city upgrade.

**Commit:** `feat: create real whop offers with review and receipts`

### Task 8: Build the 3D city as the primary work surface

**Objective:** Deliver the visually compelling city experience from approved Paper, without reducing operations to a dashboard.

**Files:**
- Create: `apps/web/src/components/city/CityCanvas.tsx`
- Create: `apps/web/src/components/city/CameraController.tsx`
- Create: `apps/web/src/components/districts/*.tsx`
- Create: `apps/web/src/components/city/asset-manifest.ts`
- Create: `apps/web/public/assets/city/*`
- Create: `docs/asset-licenses.md`
- Test: `apps/web/src/components/city/*.test.tsx`

**Steps:**
1. Before buying assets, shortlist 2–3 coherent commercial packs and show Siya price, license, attribution/resale restriction, polygon/texture budgets, and source. Obtain approval before purchase.
2. Use a composed low-poly block, not a generic premade city. Establish original district silhouettes and material palette.
3. Add camera pan/zoom/reset, safe hit targets, reduced-motion option, keyboard focus fallback, and HTML overlay semantics.
4. Build three district states each: thriving, steady, blocked. Use modest life signals—pedestrians, lights, construction, delivery movement—not noisy particle spam.
5. Keep scene asset loading progressive and show a usable loading state. Render only required objects; use instancing/sprite batching where applicable.
6. Make the city responsive on desktop. On mobile, use a static/read-only city health presentation plus full mission/leaderboard controls; do not promise full free-camera operation.

**Verification:** benchmark target on a mid-tier laptop and current iPhone-class mobile browser; no inaccessible canvas-only controls; screenshot comparison against approved Paper.

**Commit:** `feat: render the whop city game surface`

### Task 9: Add anonymous leaderboard and privacy controls

**Objective:** Make progress social without exposing business data.

**Files:**
- Create: `apps/web/src/features/leaderboard/*`
- Create: `apps/worker/src/leaderboard/*`
- Create: `packages/db/src/schema/leaderboard.ts`
- Test: `tests/contracts/leaderboard-privacy.spec.ts`, `tests/e2e/leaderboard.spec.ts`

**Steps:**
1. Calculate a stable public score from city level/district state/verified milestones—not raw revenue.
2. Generate anonymous aliases server-side (e.g. `Copper Skylark #482`) without business-name derivation.
3. Always create one leaderboard entry per connected player; default public record contains alias, city tier, score, and change direction only.
4. Add a settings flow for optional name/business reveal with clear preview and immediate revoke.
5. Implement a 30-day rank history only after basic leaderboard works; no social graph in v1.

**Verification:** database/API tests prove raw revenue, Whop IDs, business names, customer counts, and manual-claim text never reach the public leaderboard payload.

**Commit:** `feat: add anonymous city leaderboard`

### Task 10: Deploy to Hetzner, Whop Websites, and a Chia subdomain

**Objective:** Establish a secure, repeatable production path with observability and recovery.

**Files:**
- Create: `infra/docker-compose.yml`
- Create: `infra/Caddyfile`
- Create: `infra/systemd/whop-city-worker.service`
- Create: `docs/runbook.md`
- Modify: `apps/web/whop.app.json`

**Steps:**
1. Create a dedicated non-root service user and isolated Docker network on Hetzner. Do not use the root account for application processes.
2. Deploy one worker/API container, Caddy, and a host-mounted SQLite data volume. Enable WAL mode, set a busy timeout, and ensure exactly one service process is the database writer.
3. Put `api.city.chia.so` behind HTTPS; configure Whop OAuth callback and webhook target there.
4. Configure production secrets in Hetzner and Whop app secret storage—never shell history, source, or GitHub Actions logs.
5. Create Whop Website as `website` app type, attach CLI project link, deploy preview first, then promote a verified build to `<route>.whop.site`.
6. Deploy the canonical web experience to the chosen `city.chia.so` route only after DNS/SSL verification.
7. Add uptime/health checks, structured redacted logs, an encrypted off-host SQLite backup plus restore test, OAuth disconnect/revoke test, and rollback procedure.

**Verification:** exact production smoke test: sign in → choose test business → city loads from live snapshot → create/cancel one operation safely → receipt → leaderboard entry; then prove Whop build rollback and Hetzner backup restore procedure.

**Commit:** `ops: deploy whop city production stack`

### Task 11: Documentation, open-source hygiene, and launch evidence

**Objective:** Make the public repo genuinely usable and prepare proof-backed launch material.

**Files:**
- Modify: `README.md`
- Create: `CONTRIBUTING.md`, `SECURITY.md`, `docs/architecture.md`, `docs/demo-script.md`
- Create: `.github/ISSUE_TEMPLATE/*`

**Steps:**
1. Document local development using demo fixtures; never ask external contributors for a production Whop key.
2. Document all data categories, leaderboard privacy model, OAuth disconnect, and operational action safety boundaries.
3. Add a 60–90 second demo script and exact capture checklist: sign-in, before-city, mission, operation review, receipt, real-time city change, anonymous leaderboard.
4. Record only current proven behavior. Do not claim full operating-console capabilities in launch content.
5. Publish source/licensing for every third-party asset and a way to replace non-redistributable paid assets in an open-source checkout.

**Verification:** a fresh clone can run demo mode; an external reviewer can understand what is real, what is mocked, and how to report a security issue.

**Commit:** `docs: prepare public whop city launch`

---

## Testing and quality gates

- **Unit:** city rules, scoring, mission state transitions, aliases, operation-intent hashing, encrypted-token adapter interfaces.
- **Contract:** Whop OAuth exchange/refresh, adapter schema validation, API-version pin, webhook signature/dedupe/order handling, create-offer idempotency.
- **Integration:** SQLite migration/WAL/locking behavior, serialized job flow, snapshot → city event update, receipt transaction integrity.
- **E2E:** OAuth state/callback, business selection, district inspect, manual claim, cancel operation, confirm operation, receipt, anonymous leaderboard.
- **Visual:** approved Paper state matched by desktop screenshot; mobile companion state; no fake functional UI.
- **Security:** no secret in bundle/repo/logs; OAuth state/PKCE validation; CSRF/session tests; access isolation; no remote write without explicit review acknowledgement.
- **Ops:** SQLite backup/restore rehearsal, rollback test, webhook retry/idempotency test, stale-data UI test.

---

## Sequencing and stop points

1. **Do not start code** until Task 1 capability matrix and Task 2 Paper city screen are complete/approved.
2. **Do not buy assets** until Siya approves a pack/license/cost choice.
3. **Do not create live Whop products** outside the new test business until the exact action is approved in the operation review UI.
4. **Do not create the public repo** until Siya confirms the proposed repo name and author/license settings; creation is external state.
5. Stop the first build after Task 9 passes its end-to-end acceptance checks. Deployment/launch is a deliberate next increment.

## Risks and mitigations

- **OAuth scopes or per-user webhooks insufficient for desired metrics/actions:** establish this in Task 1; build only confirmed actions and use bounded active-session polling for near-real-time fallback.
- **Whop API data gaps:** encode availability states rather than inventing a weak metric or showing zero as failure.
- **3D asset licensing conflicts with public OSS repo:** keep purchased files out of Git; publish an asset manifest and free placeholder pack.
- **Game skin hides consequential business action:** mandatory review/confirm/receipt and state update only after verified completion.
- **Leaderboard leaks seller performance:** score only; anonymous alias only; strict API DTO test.
- **Near-real-time cost/load:** event-led sync when viable; bounded polling only for active sessions; snapshot dedupe.
- **Scope explosion:** only three functional districts and exactly one proven write action in v1.

## Content capture checkpoints

- Paper city screen approval: film the initial district sketch and reference comparison.
- First live OAuth selection: show “this is my real Whop business, not a demo.”
- First data snapshot: cut from a bare lot to a city that matches actual product/customer state.
- First action: empty Offer Forge → review → real Whop product receipt → construction animation.
- First leaderboard: anonymous city enters the ranking, with no revenue leak.

## Sources

- Whop Websites/Blueprints: https://docs.whop.com/developer/websites/blueprints
- Whop Website hosting: https://docs.whop.com/developer/websites/hosting
- Whop Website CLI quickstart: https://docs.whop.com/developer/websites/quickstart
- Whop OAuth/auth scoping: https://docs.whop.com/developer/guides/auth-scoping
- Whop products: https://docs.whop.com/api-reference/products/create-product
- Whop webhooks: https://docs.whop.com/developer/guides/webhooks
- Whop API versioning: https://docs.whop.com/developer/api/versioning
