# DropCart API

![CI](https://github.com/tawchifulislam/dropcart-server/actions/workflows/ci.yml/badge.svg)

**An API for limited-edition drops that cannot be oversold.** When hundreds of shoppers press Reserve in the same second, exactly as many succeed as there are units in stock, and every other request fails cleanly.

- **Live demo:** <https://dropcart-client.vercel.app> (no sign-up needed, choose "Continue as a guest")
- **Web app repository:** [dropcart-client](https://github.com/tawchifulislam/dropcart-client)
- **API:** <https://dropcart-server-5grr.onrender.com> (health check at `/health`)

> The demo runs on free hosting. If the first request is slow, the API was asleep and needs about a minute to wake up.

## Why this project

Most portfolio stores stop at "add to cart". DropCart is built around a harder problem: items are scarce and many people want them at the same moment, so correctness under concurrency is the product. Around that core it covers real payments, an AI assistant that cannot invent products, role-based access with ownership, and the operational basics of running a public demo.

## Reviewer's guide

| If you want to see | Look at |
| --- | --- |
| Concurrency-safe stock handling | [`src/services/reservation.service.ts`](src/services/reservation.service.ts) |
| Idempotent payments, late payments, automatic refunds | [`src/services/payment.service.ts`](src/services/payment.service.ts) |
| Swappable payment providers | [`src/payments/`](src/payments) |
| Grounded LLM tool use | [`src/copilot/`](src/copilot) |
| Authentication, roles and ownership scoping | [`src/middleware/auth.ts`](src/middleware/auth.ts), [`src/services/scope.ts`](src/services/scope.ts) |
| Input and environment validation | [`src/schemas/`](src/schemas), [`src/config/env.ts`](src/config/env.ts) |
| Scripted tests | [`src/scripts/load-test.ts`](src/scripts/load-test.ts), [`payment-test.ts`](src/scripts/payment-test.ts), [`copilot-test.ts`](src/scripts/copilot-test.ts) |

## Verified behavior

### Automated tests

`npm test` runs about 45 tests against an in-memory MongoDB, and the same suite runs in CI on every push. They cover 200 buyers racing for 10 units (in the service and through the HTTP API), reservation rules and expiry, payment fulfillment including five simultaneous webhooks and late payments, roles and ownership scoping, the copilot tools, and the demo reset.

### Concurrency

`npm run load-test` creates a temporary drop, fires every reservation request at the same instant using distinct signed-in users, then checks the database. Results from two runs:

| Simultaneous buyers | Units in drop | Reserved (`201`) | Rejected (`409`) | Unexpected | Stock left | Active holds | Slowest request |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 200 | 10 | 10 | 190 | 0 | 0 | 10 | 7.8 s |
| 500 | 25 | 25 | 475 | 0 | 0 | 25 | 17.0 s |

Both runs passed: exactly as many reservations as units, no overselling, stock never negative. The runs used a development machine for the API process and a hosted MongoDB Atlas database. The slow tail shows the cost of queueing hundreds of requests on one Node process and a shared database. Latency has not been profiled or optimized yet (see next steps), because correctness was the goal of this test.

### Payments and AI

- `npm run payment-test` checks normal fulfillment, five concurrent duplicate webhooks (fulfilled once), a late payment where stock is still available (honored), and a late payment where the unit was taken (refunded).
- `npm run copilot-test` asks about a product that does not exist and verifies no product cards appear, checks that budget searches return only real products within budget, and that "add to cart" really changes the cart. Model output is probabilistic, so the script prints the replies.

## How reservations work

Reserving a unit is a single `findOneAndUpdate` whose filter checks everything at once: the drop is live and enough stock remains. If the filter matches, the decrement happens in the same operation.

```ts
const drop = await Drop.findOneAndUpdate(
  {
    _id: dropId,
    startsAt: { $lte: now },
    endsAt: { $gt: now },
    stockRemaining: { $gte: quantity },
  },
  { $inc: { stockRemaining: -quantity } },
  { new: true }
);
```

If it returns `null`, the request lost the race or the drop is not on sale. A follow-up read only decides which message to show (`SOLD_OUT`, `NOT_STARTED`, `ENDED`). It never decides who gets the unit.

```mermaid
sequenceDiagram
  participant S as Shopper
  participant A as API
  participant D as MongoDB
  S->>A: POST /drops/:id/reserve
  A->>D: findOneAndUpdate (live and stock >= qty), $inc -qty
  alt unit taken
    A->>D: insert reservation (active, expires in 5 min)
    A-->>S: 201 reservation
  else lost the race
    A-->>S: 409 SOLD_OUT
  end
```

Further guards:

- A partial unique index allows one **active** reservation per user per drop.
- If creating the reservation fails after stock was taken, the stock is returned in a compensating update.
- Expiry flips a reservation from `active` to `expired` with an atomic update. Only the process that wins that flip returns the stock, so a unit is never released twice. A background sweeper handles expiry, and a drop that looks sold out also triggers a lazy check.

## Payments

Hosted Stripe Checkout, behind a provider interface so the rest of the code does not care which provider runs.

```mermaid
sequenceDiagram
  participant S as Shopper
  participant A as API
  participant P as Stripe
  S->>A: POST /checkout/:reservationId
  A->>P: create Checkout Session
  A-->>S: session url
  S->>P: pays on the hosted page
  P-->>A: webhook checkout.session.completed
  A->>A: fulfill order (reservation active to completed)
  P-->>S: redirect to success page
  S->>A: POST /orders/:id/sync
```

- The order becomes `paid` in the webhook handler. The success page also calls a sync endpoint that asks the provider, so a delayed webhook does not leave the shopper waiting.
- Fulfillment is idempotent. Duplicate webhooks, or a webhook racing the sync call, fulfill exactly once.
- Stripe sessions cannot live less than 30 minutes, while holds last 5. When a reservation ends, the API expires the session explicitly.
- **Late payment.** If a payment arrives after the hold ended, the API tries to take the stock again. If a unit is still available the order is honored, otherwise the payment is refunded automatically.
- `PAYMENT_PROVIDER=mock` serves a simulated card page and runs the same fulfillment code, which keeps the demo and the tests independent of any external account.

## AI shopping copilot

`POST /copilot/chat` runs a Gemini function-calling loop (at most 4 steps per message).

| Tool | Purpose |
| --- | --- |
| `searchProducts` | Keyword and price search over the real catalog |
| `listLiveDrops` | Drops that are live right now |
| `showProducts` | Tells the UI which products to render as cards |
| `addToCart` | Adds a validated product to the user's own cart |

Grounding rules: the system prompt forbids inventing products, cards are built from database rows, product ids are validated on the server, and the user id always comes from the session, never from model arguments. History is stored in raw form (including Gemini thought signatures) and trimmed only on user-turn boundaries. Each user is limited to 6 messages per minute and 60 per day.

## Roles and ownership

| Role | Can do |
| --- | --- |
| `shopper` | Browse, reserve, pay, cart, copilot |
| `admin` | Manage **their own** products and drops, see their own revenue |
| `superadmin` | Everything, plus user roles and the demo reset |

Roles are read from the database on every admin request, not from the token, so demoting someone takes effect immediately. Requests for another admin's resources return `404`, so their existence is not revealed. Nobody can change their own role, so the last superadmin cannot be removed by mistake.

## Tech stack

Node.js 20+, TypeScript, Express 5, MongoDB with Mongoose, Zod, JWT in `httpOnly` cookies, bcrypt, Stripe Checkout, Google Gemini (`@google/genai`), express-rate-limit. Hosted on Render and MongoDB Atlas, with GitHub Actions for CI and the nightly demo reset.

## Getting started

Requirements: Node 20 or newer and a MongoDB database (Atlas free tier works).

```bash
git clone https://github.com/tawchifulislam/dropcart-server.git
cd dropcart-server
npm install
cp .env.example .env
```

Fill in `.env` (variables are listed below), then:

```bash
npm run seed
npm run dev
```

The API listens on `http://localhost:4000`. Register an account in the [web app](https://github.com/tawchifulislam/dropcart-client), then make yourself the first superadmin:

```bash
npm run set-role -- you@example.com superadmin
```

<details>
<summary><strong>Environment variables</strong></summary>

| Name | Default | Description |
| --- | --- | --- |
| `MONGODB_URI` | none | Connection string |
| `MONGODB_DB` | `dropcart` | Database name, kept separate from the URI on purpose |
| `JWT_SECRET` | none | At least 32 characters |
| `JWT_TTL_SECONDS` | `604800` | Session lifetime |
| `PORT` | `4000` | HTTP port |
| `CLIENT_ORIGIN` | `http://localhost:3000` | Web app origin. Must be `https` in production. Used for CORS and payment redirect URLs |
| `RESERVATION_TTL_SECONDS` | `300` | How long a hold lasts |
| `PAYMENT_PROVIDER` | `mock` | `mock` or `stripe` |
| `PAYMENT_CURRENCY` | `bdt` | Currency sent to Stripe |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | none | Required when the provider is `stripe` |
| `GEMINI_API_KEY` | none | Enables the copilot |
| `GEMINI_MODEL` | `gemini-3.5-flash` | Model name |
| `DEMO_MODE` | `false` | Enables guest accounts and the demo reset endpoints |
| `DEMO_RESET_TOKEN` | none | At least 24 characters, required in demo mode |

The environment is validated at startup. A missing or invalid value stops the server with a readable message.

</details>

<details>
<summary><strong>Scripts</strong></summary>

| Command | What it does |
| --- | --- |
| `npm run dev` | Start with file watching |
| `npm run build`, `npm start` | Compile and run the production build |
| `npm run typecheck` | Type check without emitting |
| `npm run seed` | Reset sample data (products, drops, demo sales) |
| `npm run set-role -- <email> <role>` | Change a user's role |
| `npm run db:reset -- --yes` | Drop the configured database (never in production) |
| `npm run load-test` | Concurrency test against a running server |
| `npm run payment-test` | Fulfillment, idempotency and late payment checks |
| `npm run copilot-test` | Grounding checks against the real model |
| `npm run gemini-check` | Diagnose Gemini access and tool declarations |

Run tests against a separate database with `MONGODB_DB=dropcart_test`. The load test needs the server and the script to use the same database:

```bash
MONGODB_DB=dropcart_test npm run dev
MONGODB_DB=dropcart_test npm run load-test
LOAD_TEST_BUYERS=500 LOAD_TEST_STOCK=25 MONGODB_DB=dropcart_test npm run load-test
```

</details>

<details>
<summary><strong>API reference</strong></summary>

Auth: **Public**, **User** (any signed-in account), **Admin** (`admin` or `superadmin`), **Super** (`superadmin`).

**Account and catalog**

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/auth/register`, `/auth/login`, `/auth/logout` | Public | Session cookie auth |
| POST | `/auth/guest` | Public | Temporary guest account, demo mode only |
| GET | `/auth/me` | User | Current account |
| GET | `/products` | Public | `search`, `category`, `page`, `limit` |
| GET | `/products/categories` | Public | Category names |
| GET | `/products/:idOrSlug` | Public | Product with its current drop |
| GET | `/drops/live`, `/drops/upcoming`, `/drops/:id` | Public | Drops with product data |

**Reservation and checkout**

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/drops/:id/reserve` | User | Atomic reservation |
| GET | `/drops/:id/reservation` | User | My active hold for a drop |
| GET | `/reservations/mine`, `/reservations/:id` | User | History and detail |
| DELETE | `/reservations/:id` | User | Release a hold |
| POST | `/checkout/:reservationId` | User | Create or resume a payment session |
| GET | `/orders/:id` | User | Order status |
| POST | `/orders/:id/sync` | User | Ask the provider and fulfill if paid |
| POST | `/orders/:id/mock-confirm` | User | Mock provider only |
| POST | `/webhooks/stripe` | Signature | Stripe events |

**Cart and copilot**

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/cart` | User | Cart with drop status |
| POST | `/cart/items` | User | Add or update an item |
| DELETE | `/cart/items/:productId` | User | Remove an item |
| POST | `/copilot/chat` | User | Rate limited |
| GET, DELETE | `/copilot/session` | User | Read or clear the conversation |

**Admin**

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/admin/overview`, `/admin/drops`, `/admin/drops/:id/stats` | Admin | Scoped dashboard data |
| POST, PUT, DELETE | `/admin/drops`, `/admin/drops/:id` | Admin | Only upcoming drops can change |
| GET, POST, PUT | `/admin/products`, `/admin/products/:id` | Admin | Scoped to the owner |
| GET | `/admin/users` | Super | Search users |
| PATCH | `/admin/users/:id/role` | Super | Change a role |
| POST | `/admin/demo/reset` | Super | Demo mode only |
| POST | `/demo/reset` | Token | Scheduled reset, demo mode only |
| GET | `/health` | Public | Readiness, checks the database connection |

Errors use one shape: `{ "error": "message", "code": "CODE", "details"?: ... }`.

</details>

<details>
<summary><strong>Data model</strong></summary>

| Collection | Notes |
| --- | --- |
| `users` | name, email, password hash, role |
| `products` | name, slug, category, description, images, variants, specs, base price, owner |
| `drops` | product, start and end, drop price, `stockTotal`, `stockRemaining` |
| `reservations` | drop, user, quantity, `expiresAt`, status `active / completed / expired / released` |
| `orders` | reservation (unique), amount, provider, session and payment ids, status `pending / paid / cancelled / refunded / refund_failed` |
| `carts` | one document per user |
| `chatsessions` | display messages plus raw model history |

Prices are whole taka. Amounts are converted to minor units only when talking to Stripe.

</details>

<details>
<summary><strong>Project structure</strong></summary>

```text
src/
  config/        environment validation, database connection
  controllers/   request handlers
  copilot/       prompt, tool declarations and executors, catalog search
  middleware/    auth and roles, errors, rate limits
  models/        Mongoose schemas
  payments/      provider interface, Stripe and mock implementations
  routes/        route tables
  schemas/       Zod input schemas
  scripts/       seed, role management, load and payment tests
  services/      reservations, payments, catalog, admin, cart, copilot, demo
  utils/         small helpers
```

</details>

## Deployment

Render web service, MongoDB Atlas, optional Stripe webhook.

| Setting | Value |
| --- | --- |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm start` |
| Health check path | `/health` |
| `NODE_ENV` | `production` |

1. Create an Atlas user limited to `readWrite` on the production database, and allow the connection from Render.
2. Set the environment variables above. Generate a new `JWT_SECRET` for production.
3. For Stripe, add a webhook endpoint at `https://<your-service>/webhooks/stripe` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`, then set `STRIPE_WEBHOOK_SECRET` and `PAYMENT_PROVIDER=stripe`.
4. Seed the production database once from your machine with the production URI exported for that command only.

On Render's free plan the service sleeps after 15 minutes without traffic and takes about a minute to wake. Use a monitor that pings `/health`, or a paid instance, for a smooth demo.

## Demo mode

For a public demo, set `DEMO_MODE=true` and a `DEMO_RESET_TOKEN`.

- The sample drops are time based, so they eventually end. A scheduled GitHub Actions workflow (`.github/workflows/demo-reset.yml`) calls `POST /demo/reset` nightly, and superadmins get a "Reset demo data" button in the admin dashboard.
- A reset clears orders, reservations, carts and chats, and recreates the sample products and drops. Accounts, and products created by admins, are kept. The endpoint allows one call per minute and returns `404` when demo mode is off.
- `POST /auth/guest` creates a temporary guest account so reviewers can try the store without signing up. Guest accounts older than a day are deleted by the nightly reset, and guest creation is rate limited.

## Security notes

- Session in an `httpOnly`, `Secure`, `SameSite=Lax` cookie. Responses are sent with `Cache-Control: no-store`.
- Passwords are hashed with bcrypt. Login does a hash comparison even for unknown emails.
- Every input is validated with Zod. Webhooks verify the Stripe signature against the raw body.
- Ownership is enforced in queries, not only in the UI.
- Product descriptions are written by admins and read by the model. The copilot can only read data and change the signed-in user's own cart, which limits the effect of a malicious description.

## Trade-offs and next steps

- **Atomic update instead of transactions.** Keeps contention low under a rush. The cost: a crash between taking stock and creating the reservation can leak one unit. That fails safe (under-selling, never overselling).
- **Latency under a burst is unoptimized.** A rejected request makes several database round trips (existing-hold check, the atomic attempt, an expiry sweep, a read to explain the failure). Next step: profile, then cut round trips on the sold-out path and re-run the load test to compare.
- **Automated tests run as scripts.** They need a database and are not part of CI yet. Next step: Vitest with an in-memory MongoDB so the concurrency and payment checks run on every push.
- Rate limit counters live in memory, so they reset on restart and are not shared between instances. A shared store such as Redis would fix that.
- Product images are URLs or static paths. There is no upload pipeline yet.
- Stripe does not onboard businesses registered in every country, so payments run in test mode here and the mock provider keeps the demo usable. The provider interface is where a local gateway would plug in.
- Search is keyword based, not semantic.
