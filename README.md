# UnlockAffiliate

UnlockAffiliate is an affiliate management platform with:

- React + TypeScript SPA (`src/`)
- Cloudflare Worker API using Hono (`worker/`)
- D1 (SQLite) + Drizzle ORM
- Better Auth (email/password + social providers)
- Tailwind CSS v4 + shadcn/ui

## Tech Stack

- Runtime/package manager: `bun`
- Frontend: React 19, Vite 6, React Router 7, TanStack Query 5
- Backend: Hono on Cloudflare Workers
- Database: D1 with Drizzle ORM migrations
- Auth: Better Auth + `better-auth-cloudflare`
- Styling: Tailwind CSS v4, shadcn/ui, lucide icons

## Prerequisites

- Bun installed (`bun --version`)
- Cloudflare account (needed for remote deploy/resources)
- Optional for deploys: Wrangler auth (`bunx wrangler login`)

## Local Setup

1. Install dependencies

```bash
bun install
```

2. Create local secrets file

Create `.dev.vars` in the project root (this file is gitignored via `.dev.vars*`) and set:

```bash
BETTER_AUTH_SECRET=<generate your own token here>
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
RESEND_API_KEY=
ENCRYPTION_KEY=<generate your own token here>
SALT=<generate your own token here>
VITE_SITE_URL=http://localhost:5173
```

Notes:

- `BETTER_AUTH_URL` is configured in `wrangler.jsonc` for local/prod.
- Social login values can be left empty if you are not testing social auth.
- `ENCRYPTION_KEY` and `SALT` are used for API key/token encryption paths.

3. Run local DB migrations

```bash
bun run db:migrate:dev
```

4. Start local app

```bash
bun run dev
```

The app runs at `http://localhost:5173`.

## Scripts

```bash
bun run dev             # Start Vite + Cloudflare Worker integration
bun run build           # TypeScript check + production build
bun run lint            # ESLint
bun run preview         # Build + preview
bun run deploy          # Build + deploy via wrangler
bun run cf-typegen      # Regenerate Cloudflare Worker types
bun run db:generate     # Generate Drizzle SQL migrations
bun run db:migrate:dev  # Apply migrations to local D1
bun run db:migrate:prod # Apply migrations to remote D1
```

## Database Workflow

When schema changes are made:

1. Update schema files in `worker/db/schema.ts` or `worker/db/auth.schema.ts`
2. Generate migration:

```bash
bun run db:generate
```

3. Apply locally:

```bash
bun run db:migrate:dev
```

4. Apply remotely when ready:

```bash
bun run db:migrate:prod
```

## Project Structure

```text
.
├── src/                          # React SPA
│   ├── App.tsx                   # Route definitions
│   ├── main.tsx                  # React root, providers
│   ├── index.css                 # Tailwind v4 theme/tokens
│   ├── components/
│   │   ├── ui/                   # shadcn/ui base components
│   │   └── *.tsx                 # App-specific components
│   ├── pages/                    # Route-level pages
│   ├── hooks/                    # Custom hooks
│   └── lib/                      # Client utilities (auth/query/cn)
├── worker/                       # Cloudflare Worker API
│   ├── index.ts                  # Hono routes + middleware
│   ├── auth.ts                   # Better Auth server configuration
│   ├── types.ts                  # Worker context/env typings
│   ├── validation.ts             # Zod validation helpers
│   ├── db/
│   │   ├── schema.ts             # App domain tables
│   │   ├── auth.schema.ts        # Auth tables
│   │   └── drizzle/              # SQL migrations
│   └── services/                 # Domain services used by routes
├── wrangler.jsonc                # Cloudflare bindings + vars
├── drizzle.config.ts             # Drizzle kit config
├── worker-configuration.d.ts     # Generated worker/env types
├── AGENTS.md                     # Agent and contributor conventions
└── .cursor/rules/                # Cursor project rules
```

## Deployment Notes

- Production deploy command: `bun run deploy`
- Ensure Cloudflare bindings exist:
  - D1 database binding: `DB`
  - R2 bucket binding: `UPLOADS`
  - Secrets/vars configured in Worker environment

## Working Conventions

- Use `bun` only (no npm/yarn)
- Use `@/` alias for imports from `src/`
- Prefer function declarations for named functions/components
- Before creating UI components, check existing `src/components/ui/` and `src/components/`
- Keep `AGENTS.md` and `.cursor/rules/` aligned with workflow changes
