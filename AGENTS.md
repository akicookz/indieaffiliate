# AGENTS.md - UnlockAffiliate

This file is the operating guide for agents/contributors working in this repo.
For full local setup and detailed structure, use `README.md` as the source of truth.

## Quick Context

- Product: affiliate management SPA + partner portal
- Frontend: React + TypeScript + Vite (`src/`)
- Backend: Hono Worker + D1 + Drizzle (`worker/`)
- Auth: Better Auth (`worker/auth.ts`, `src/lib/auth-client.ts`)
- Package manager/runtime: `bun` only

## Local Workflow

```bash
bun install
bun run db:migrate:dev
bun run dev
```

Other common commands:

```bash
bun run lint
bun run build
bun run cf-typegen
bun run db:generate
```

## Codebase Map

- `src/App.tsx`: app routes
- `src/components/`: reusable app components
- `src/components/ui/`: shadcn/ui base components
- `src/pages/`: route-level screens
- `src/lib/`: client utilities (query client, auth client, helpers)
- `worker/index.ts`: API routes, middleware, bindings usage
- `worker/services/`: business logic layer
- `worker/db/`: schemas + SQL migrations
- `wrangler.jsonc`: worker bindings/env configuration

## Non-Negotiable Conventions

### Runtime and tooling

- Use `bun` for all scripts/package operations
- Do not use `npm` or `yarn`

### Function style

- Use function declarations for named functions/components
- Arrow functions are only allowed for inline callbacks

### Imports and modules

- Use `@/` alias for imports from `src/`
- Keep import order consistent: React, third-party, internal alias, relative
- Use `import type` for type-only imports

### TypeScript

- Keep strict typing; avoid `any`
- Prefer `interface` for object shapes and `type` for unions/compositions
- Add explicit types for API responses and service inputs/outputs

### UI/component workflow

1. Check shadcn/ui availability first
2. Reuse existing components in `src/components/` next
3. Create custom component only if no reusable option exists

### Styling

- Tailwind v4 tokens from `src/index.css`
- Use semantic color tokens (`bg-background`, `text-foreground`, etc.)
- Keep glassmorphism style consistent (`rounded-2xl`, subtle borders/shadows)

### Routing and data fetching

- Use `react-router-dom` route patterns in `src/App.tsx`
- Use `@tanstack/react-query` for async data access
- Route API requests through `/api/*` endpoints in the worker

## Stripe billing (env keys)

To connect Stripe for SaaS billing (Checkout, Customer Portal, webhooks), set these in the Worker (e.g. via `bunx wrangler secret put <NAME>` or in Cloudflare dashboard):

| Secret / Var | Required | Description |
|--------------|----------|-------------|
| `BILLING_STRIPE_SECRET_KEY` | Yes (for checkout/portal) | Stripe secret key (sk_live_… or sk_test_…) from Stripe Dashboard → Developers → API keys. |
| `BILLING_STRIPE_WEBHOOK_SECRET` | Yes (for webhooks) | Signing secret from Stripe Dashboard → Developers → Webhooks → your endpoint (e.g. `…/api/billing/webhook`) → “Signing secret”. |
| `BILLING_PRICE_GROWTH` | Yes (for Growth plan) | Stripe Price ID for Growth (e.g. price_…). Create a recurring price in Stripe for $39/mo. |
| `BILLING_PRICE_SCALE` | Yes (for Scale plan) | Stripe Price ID for Scale (e.g. price_…). Create a recurring price for $99/mo. |
| `BILLING_PRICE_STARTER` | Optional | Only if you have a $0 Stripe price for Starter; otherwise free users have no Stripe subscription. |

Growth and Scale checkout sessions use a **14-day free trial**; Stripe collects the card at checkout and charges when the trial ends.

## Backend Notes

- Hono context carries `user`, `session`, and `db`
- Worker services should remain domain-focused and typed
- D1 migration flow:
  - generate: `bun run db:generate`
  - local apply: `bun run db:migrate:dev`
  - remote apply: `bun run db:migrate:prod`

## Documentation and Rules Maintenance

- Keep `README.md`, `AGENTS.md`, and `.cursor/rules/*.mdc` aligned when workflow changes
- Do not put real secrets in docs; use variable names/placeholders only
- Update command docs whenever `package.json` scripts change
