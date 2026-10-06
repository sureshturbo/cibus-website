# AGENTS.md

Instructions for coding agents working in this repository.

## What this is

Cibus Trading e-commerce platform: customer storefront, staff admin panel, and a
REST API. Built from a client proposal document, not from an existing codebase.

The customer storefront follows the **layout, spacing and interaction of
`https://thaiman.in/`** as a visual reference, but all branding, copy and data are
Cibus's own. Do not copy Thaiman's text, logos or product content — only the design
language.

**Out of scope by agreement:** payment gateway integration and tax processing.
Orders are confirmed manually and invoices note payment as arranged separately. The
`Payment` model exists as a placeholder and no gateway is wired up. Do not add
either without asking.

## Current state

| Path | State |
| --- | --- |
| `apps/api` | Implemented, boots, typechecks. Zero automated tests. |
| `packages/shared` | Implemented. Pure functions and Zod schemas. Zero tests. |
| `apps/storefront` | Implemented and builds. Zero automated tests. |
| `apps/admin` | Not started. |

`apps/admin` is named in the root `package.json` scripts but does not exist, so the
root `npm run dev` and `npm run build` still fail. Run the API and storefront
directly (see Commands).

## Commands

Run `npm.cmd`, not `npm` — PowerShell blocks `npm.ps1` with an execution-policy
error. This shell is Windows PowerShell 5.1: there is **no `rg`, `grep`, `head`,
`tail`, `sed`, `wc`, and no `<<` heredocs**. Use the editor/read tools, `node -e`,
or `Invoke-RestMethod`/`curl.exe` instead.

```bash
# API
cd apps/api
npx.cmd tsc -p tsconfig.json --noEmit    # faster than the npm script
npx.cmd tsx prisma/seed.ts               # idempotent
node dist/index.js                       # after a build

# Storefront
cd apps/storefront
npm.cmd run dev                          # vite on :5173, proxies /api,/uploads,/health to :4000
npx.cmd tsc -p tsconfig.json --noEmit    # typecheck
npm.cmd run build                        # tsc then vite build
node scripts/check-classes.mjs src       # class audit: every used class must be defined

# Root (types/build across workspaces; build fails while admin is missing)
npm.cmd run typecheck
```

Build order matters: `@cibus/api` imports the *compiled* output of
`@cibus/shared`, so rebuilding shared after editing it is required before the API
will typecheck. This bites most often when adding a new schema export.

There is no `npm test` that currently exercises anything; `apps/api` declares
`vitest run` and `@cibus/shared` declares no test script at all.

Local dev: API on `http://localhost:4000`, storefront on `http://localhost:5173`.
The Vite proxy keeps the browser on one origin so the httpOnly auth cookies work
without CORS.

## Conventions

### Money

Integer minor units (paise) everywhere. Never floats, never Prisma `Decimal`.

Convert at the boundary with `toMinor` / `fromMinor` from `@cibus/shared`. Client
input arrives as `"249.00"` and must be converted before it reaches a service.
Format for display with `formatMoney()` (`Intl.NumberFormat("en-IN")`) from the
storefront's `api.ts`.

Percentages in offers are stored as **basis points**: `1250` means 12.50%. There
are two distinct constants and conflating them is a real bug that has already
shipped once — see "Known pitfalls".

### Server owns pricing

No price, discount or stock figure from a client is ever trusted. Carts store
only `productId` and `quantity`. `pricing.service.ts` is the single place that
turns a cart into money, so the storefront preview and the stored order cannot
disagree. Anything that computes a total must route through it.

### Stock

`stock_movements` is the source of truth; `products.stockQuantity` is a cache
that must equal the ledger sum and is only ever written in the same transaction as
the ledger row. Never update the quantity directly.

Order lines snapshot product name, slug, SKU, unit price and unit label at
purchase time. This is why historical invoices stay correct after the catalogue
is edited. Do not "simplify" these into joins against `products`.

### Auth

- Access tokens are short-lived JWTs in httpOnly cookies; refresh tokens are
  opaque random strings stored as SHA-256 digests, so a database leak does not
  yield live sessions.
- `requireAdmin` is applied to the whole `adminRouter` via `adminRouter.use(...)`
  rather than per route. That is deliberate: a new route then cannot forget its
  own guard. Keep it that way.
- **Signing in is required to place an order.** Guest checkout is deliberately
  disabled (`GUEST_CHECKOUT_ENABLED=false`). Guest *carts* still exist — a
  visitor can browse and fill a basket, then sign in and `POST /api/shop/cart/merge`
  folds it into the account. The storefront only calls `api.mergeCart()` from
  `AuthContext.adoptSession`; login/register do **not** auto-merge.
- Order and invoice reads are scoped by `customerId`. Do not drop the
  `options.customerId` check to "simplify" a lookup; it is what stops one customer
  reading another's data by guessing an id.

### Errors

Throw `AppError` subclasses from `lib/errors.ts`. They carry an HTTP status and a
stable code. Never return a bare `new Error()` from a service reachable by a route
— it becomes an opaque 500. Never leak stack traces or SQL to a client;
`errorHandler` handles that, so just throw.

### Responses

Uniform envelope, always: `{ success: true, data, meta? }` or
`{ success: false, error: { code, message, requestId, details? } }`. Use
`sendOk` / `validate` / `validatedQuery` from `lib/http.ts`. Every async route
handler is wrapped in `controller()` so rejections reach the error pipeline.

### Uploads

Never serve a user-uploaded file as-is. Images are re-encoded through `sharp`
(which strips EXIF and any embedded payload) and served with `X-Content-Type-Options:
nosniff`. `isServableUpload` gates the static `/uploads` mount by extension.

### Comments

Explain *why*, not *what*. The codebase uses comments for non-obvious reasoning —
why a discount cannot stack, why a number is basis points, why stock is consumed
at one status and not another. Do not add comments restating code, and do not add
any at all unless the reasoning is genuinely non-obvious.

## Storefront (`apps/storefront`)

React 18 + TypeScript + Vite + `react-router-dom` v6. Entry `src/main.tsx` renders
`App`; `src/App.tsx` wires the providers and routes.

### Provider order

`CartProvider` → `AuthProvider` → `UiProvider` → `ToastProvider`. The cart wraps
auth because a guest basket is merged at sign-in; UI wraps everything because the
shell's overlays (cart, search, filters, auth, menu) are opened from any page.

### Routes

| Route | Page |
| --- | --- |
| `/` | `Home` |
| `/products` | `Products` (listing, filters, sort, pagination) |
| `/product/:slug` | `ProductDetail` — note **singular** `product`, not `products` |
| `/cart` | `CartPage` |
| `/checkout` | `Checkout` (account required) |
| `/order-confirmation/:id` | `OrderConfirmation` |
| `/account`, `/account/orders` | `Account` |
| `/page/:slug` | `StaticPage` (server-driven CMS pages) |
| `*` | `NotFound` |

### Layout and chrome

- Header nav is **Home / Food Products (dropdown of categories) / About Us /
  Contact Us**. The top utility bar (business hours, "Sign in / Register", phone)
  was intentionally removed — do not re-add it.
- The desktop inline search *bar* was removed too; the search **icon + sheet**
  remain (`.search-field` is still used by the search sheet).
- `.header-main` is hidden below `1200px`; `MobileHeader` takes over. Keep that
  breakpoint in sync with `chrome.css`.
- Sign-in/registration is a **sheet** (`components/layout/AuthSheet.tsx`), not a
  page. It has Sign in/Register tabs and a password show/hide toggle.
- `.site-footer` inner blocks use `.container`; if you set their padding, keep the
  horizontal `var(--gutter)` or the footer runs to the screen edge (already fixed
  once).

### Styles

CSS is plain, global, and imported in this order in `main.tsx`:
`tokens` → `base` → `components` → `chrome` → `shop` → `pages` → `flows`.

- Class naming is BEM (`block__element--modifier`). Reuse existing classes before
  inventing new ones; genuinely new flows go in `src/styles/flows.css`.
- `node scripts/check-classes.mjs src` asserts every class used in TSX is defined
  in the CSS. Run it after UI changes; it must report `missing=0`.
- Design tokens live in `src/styles/tokens.css`. Key colours: primary `#61b482`,
  base `#366b11`, hover `#3d850a`, ink `#253d4e`, campaign `#0b6b00`, topbar
  `#ffe0c2`, wash `#efffe3`. Radii: image `10px`, control `30px`, pill `999px`.
- Spacing uses `--space-*` tokens (`--space-1` = 0.25rem). Prefer tokens over raw
  values. `.container` supplies the `--gutter` side padding; beware overrides that
  set horizontal padding to `0`.

### Data access

- `src/api.ts` is the single place that talks to the API and unwraps the
  `{ success, data }` envelope. Add endpoints there, not inline in components.
- Types live in `src/types.ts`.
- Filtering/sort is server-side; the URL query string is the source of truth.
  Product list keys: `category` (slug), `search`, `sort`, `inStock`. Sort enum
  values use underscores: `newest | price_asc | price_desc | name_asc | name_desc`.
- `GET /api/public/products/:slug` returns `data: { product: {...} }` (wrapped).
- Category slugs: `chilled-dairy`, `dry-goods-staples`, `fresh-produce`, `snacks`.

### Placeholder imagery

The catalogue has no uploaded images yet. `public/images/` holds temporary WebP
assets and `PLACEHOLDER_IMAGES` in `api.ts` maps them:

| Constant | File | Used for |
| --- | --- | --- |
| `product` | `/images/product.webp` | All product images (cards, detail, related, cart, checkout, search) |
| `hero` | `/images/hero.webp` | Home hero slider |
| `category` | `/images/category.webp` | Category tiles; promo banner backgrounds |
| `feature` | `/images/feature.webp` | Hero slide / "Why us" feature split |

`primaryImageOf()` returns a real image when one exists, otherwise the product
placeholder, so cards never render an empty box. Replace these assets (and the
constants) with real media when uploads land; do not scatter the paths.

## Database

- Prisma 6, MariaDB 10.4 (XAMPP). Start it with
  `C:\xampp\mysql\bin\mysqld.exe --defaults-file=C:\xampp\mysql\bin\my.ini`.
  It is a manually started process, not a Windows service.
- Migrations live in `apps/api/prisma/migrations`. Never edit an applied
  migration; add a new one.
- `npm.cmd run prisma:seed` is idempotent — matched on natural keys, safe to re-run.
- Seeded accounts: customer `customer@cibus.local` / `Customer!2026`; admin
  `admin@cibus.local` / `ChangeMe!2026` (from `apps/api/.env`).

## Environment

`apps/api/.env` exists locally and is gitignored. `config/env.ts` validates at
boot and throws rather than starting with a bad value. Copy from `.env.example`
when setting up a new environment.

`config/env.ts` locates the package root by walking up to the nearest
`package.json`. Do not "simplify" this to a fixed number of `..` hops: the file
runs from `src/config/` under tsx and `dist/config/` after a build, so no fixed
depth is correct for both.

Production boot refuses insecure defaults (dev JWT secrets, default admin
password, localhost in `CORS_ORIGINS`).

## Known pitfalls

- **Basis points.** `BASIS_POINTS_PER_PERCENT` (100) converts a percent figure to
  basis points. Computing a discount needs `BASIS_POINTS_DIVISOR` (10 000). Using
  the wrong one made a 5% offer discount a cart to zero. `percentToBasisPoints`
  and `basisPointsToPercent` use the first; `rawDiscountFor` needs the second.
- **Health paths.** `healthRouter` is mounted at `/health`, so its internal routes
  must be `/` and `/ready`. Declaring `/health` inside gives `/health/health`.
- **IPv6 rate limits.** `express-rate-limit` v8 wants `ipKeyGenerator(req.ip)`,
  not raw `req.ip`, or IPv6 clients bypass limits by rotating addresses.
- **Idempotency.** `placeOrder` releases an `IN_PROGRESS` key after a 600 ms poll
  even when the original request may still be running, so concurrent checkouts
  sharing a key can both proceed. Known and unfixed; needs a real lock, not a
  timeout.
- **Public category filter.** The list route used to pass `category` straight to
  the service, which filters on `categorySlug`, so the filter was silently
  ignored. It now maps `category` → `categorySlug`; keep that mapping.
- **Checkout preview.** `POST /api/shop/checkout/preview` re-validates the full
  checkout body and always 400s if you only send an offer code. The storefront
  uses `GET /api/shop/cart/preview?offerCode=` (`api.cartPreview`) instead.
- **Storefront inline `<input>`.** Form inputs must carry `className="input"`;
  there is no global `input` rule. Bare `<input>` renders as an unstyled browser
  field.

## Conventions to keep

- ES modules throughout, `"type": "module"`, `.js` extensions in relative imports.
- Express 4 with the async `controller()` wrapper, not Express 5 async handlers.
- Zod schemas live in `packages/shared/src/schemas.ts` so the clients reuse them.
- Route files stay thin: parse, delegate to a service, wrap the response. Business
  logic belongs in `apps/api/src/services/`.
- Prisma selects are centralised in `services/selects.ts` rather than inlined, so
  the storefront and admin views cannot drift.