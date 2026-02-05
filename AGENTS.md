# AGENTS.md - IndieAffiliate

## Project Overview

IndieAffiliate is an affiliate management SPA built with React + TypeScript, bundled by Vite, styled with Tailwind CSS v4 + shadcn/ui, and deployed to Cloudflare Workers. The backend is a Hono-based Cloudflare Worker with D1 (SQLite) database and Better Auth for authentication.

## Tech Stack

- **Runtime/Package Manager**: Bun (never use npm or yarn)
- **Language**: TypeScript 5.8, strict mode
- **Frontend**: React 19, react-router-dom 7, @tanstack/react-query 5
- **Backend**: Hono router on Cloudflare Workers, Drizzle ORM + D1 (SQLite)
- **Auth**: Better Auth with `better-auth-cloudflare`, email/password
- **Build**: Vite 6 with SWC (`@vitejs/plugin-react-swc`)
- **Styling**: Tailwind CSS v4 (CSS-based config in `src/index.css`), shadcn/ui (new-york style, stone base, lucide icons)
- **Deployment**: Cloudflare Workers/Pages via wrangler
- **Path Alias**: `@/*` maps to `./src/*`

## Build / Lint / Dev Commands

```bash
bun run dev          # Start Vite dev server
bun run build        # TypeScript check + Vite build (tsc -b && vite build)
bun run lint         # ESLint (flat config): eslint .
bun run preview      # Build + preview locally
bun run deploy       # Build + wrangler deploy to Cloudflare
bun run cf-typegen   # Generate Cloudflare Worker types
```

### Testing

No test framework is configured yet. When tests are added, document the commands here.

### Installing Dependencies

```bash
bun add <package>          # Add a runtime dependency
bun add -d <package>       # Add a dev dependency
```

## Project Structure

```
├── src/
│   ├── main.tsx              # Entry point (React root, providers)
│   ├── App.tsx               # Route definitions
│   ├── index.css             # Tailwind v4 theme (@theme inline, CSS vars)
│   ├── components/
│   │   ├── ui/               # shadcn/ui base components (DO NOT edit directly)
│   │   ├── AuthGuard.tsx     # Auth wrapper that redirects to /login
│   │   └── *.tsx             # Custom app components
│   ├── pages/                # Route-level page components
│   ├── hooks/                # Custom React hooks
│   └── lib/
│       ├── utils.ts          # cn() utility
│       ├── query-client.ts   # React Query client config
│       └── auth-client.ts    # Better Auth React client
├── worker/
│   ├── index.ts              # Hono router + API endpoints
│   ├── auth.ts               # Better Auth server config (D1 + Drizzle)
│   ├── types.ts              # Hono context type definitions
│   ├── db/
│   │   ├── index.ts          # Barrel: re-exports drizzle-orm + all schemas
│   │   ├── auth.schema.ts    # Auth tables (users, sessions, accounts, verifications)
│   │   ├── schema.ts         # App tables (projects, partners, customers)
│   │   └── drizzle/          # Migration SQL files
│   └── services/
│       ├── project-service.ts    # Project CRUD
│       ├── partner-service.ts    # Partner CRUD + stats
│       ├── customer-service.ts   # Customer queries + stats
│       └── dashboard-service.ts  # Aggregated dashboard data
├── drizzle.config.ts         # Drizzle Kit config for D1
├── wrangler.jsonc            # Cloudflare Workers config (D1, assets)
└── components.json           # shadcn/ui configuration
```

## Code Style Guidelines

### Function Declarations (MANDATORY)

Always use `function` declarations. Never use arrow function expressions for components or named functions.

```tsx
// CORRECT
function MyComponent() { ... }
export default MyComponent;
export function helperFn() { ... }

// WRONG - do not use
const MyComponent = () => { ... }
export const helperFn = () => { ... }
```

Arrow functions are acceptable only as inline callbacks (event handlers, `.map()`, `.filter()`, etc.).

### Exports

- Components use `export default ComponentName` at the bottom of the file.
- Utility functions use named exports: `export function cn(...)`.
- shadcn/ui components re-export from their files with named exports.

### Imports

Order imports as follows (separated by blank lines when logical):

1. React / React ecosystem (`react`, `react-dom`, `react-router-dom`)
2. Third-party libraries (`@tanstack/react-query`, `lucide-react`, etc.)
3. Internal aliases (`@/components/...`, `@/lib/...`, `@/hooks/...`)
4. Relative imports (`./`, `../`)
5. CSS imports

Always use the `@/` alias for imports from `src/`. Never use deep relative paths like `../../components/`.

```tsx
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import StatCard from "@/components/StatCard";
```

### TypeScript

- **Strict mode** is enabled (`strict: true`, `noUnusedLocals`, `noUnusedParameters`)
- Use `interface` for object shapes; use `type` for unions, intersections, and utility types
- Define interfaces/types near the top of the file, after imports
- Inline prop types are acceptable for simple components (see `StatCard.tsx`)
- Use `as` type assertions sparingly; prefer type narrowing
- API responses should be typed with explicit interfaces
- Use `verbatimModuleSyntax` — always use `import type` for type-only imports:
  ```tsx
  import { type LucideIcon } from "lucide-react";
  ```

### Naming Conventions

| Element             | Convention          | Example                     |
|---------------------|---------------------|-----------------------------|
| Components          | PascalCase          | `StatCard`, `AppSidebar`    |
| Page components     | PascalCase          | `Dashboard`, `Landing`      |
| Hooks               | camelCase, `use-`   | `use-mobile.ts`             |
| Utility functions   | camelCase           | `cn()`, `queryClient`       |
| Files (components)  | PascalCase.tsx      | `StatCard.tsx`, `Layout.tsx` |
| Files (ui)          | kebab-case.tsx      | `button.tsx`, `dropdown-menu.tsx` |
| Files (hooks)       | kebab-case.ts       | `use-mobile.ts`             |
| Interfaces          | PascalCase          | `DashboardData`             |
| CSS variables       | kebab-case          | `--color-primary`           |

### Formatting

- No Prettier configured; follow existing code style
- Use double quotes for strings in TSX/TS
- Use tabs for indentation in JSON files, spaces (2) in TSX/TS
- Trailing commas in multi-line structures
- Semicolons at end of statements (not in imports from `clsx` style — follow existing file patterns)

### Styling & UI

- **Tailwind CSS v4**: No `tailwind.config.*` file. Theme is in `src/index.css` using `@theme inline` with CSS custom properties (oklch color space)
- Use semantic color tokens: `bg-background`, `text-foreground`, `bg-card`, `text-muted-foreground`, `bg-primary`, `text-destructive`, etc.
- Cards: `rounded-2xl` or `rounded-3xl`, `bg-card/50`, `shadow-xs`, glassmorphism (`backdrop-blur-xl`)
- Accent color is purple — use sparingly for key highlights only
- Fonts: `font-sans` = Satoshi (UI), `font-heading` = Playfair Display (marketing headers)
- Component priority: (1) Check shadcn/ui, (2) Check existing `src/components/`, (3) Create new

### Error Handling

- Use react-query's `isLoading` / `error` states for data fetching
- Display user-friendly loading and error states in components
- Throw `new Error("message")` for API failures after checking `response.ok`
- Wrap API calls in react-query's `queryFn`

### Data Fetching

- All data fetching goes through `@tanstack/react-query`
- Query client is configured in `src/lib/query-client.ts`
- Use `useQuery` with typed `queryFn` returning `Promise<T>`
- API calls go to `/api/` routes handled by the Cloudflare Worker

### Worker / Backend

- Backend code lives in `worker/` using **Hono** as the router
- Database: **Cloudflare D1** (SQLite) with **Drizzle ORM** (`drizzle-orm/d1`)
- Auth: **Better Auth** with `better-auth-cloudflare` wrapper, email/password enabled
- Schema in `worker/db/auth.schema.ts` (auth tables) and `worker/db/schema.ts` (app tables)
- Services are classes that take `DrizzleD1Database` in constructor (see `worker/services/`)
- Hono context (`HonoAppContext` in `worker/types.ts`) carries `user`, `session`, `db`
- Auth middleware validates session on all `/api/*` routes (sets `user` to null if unauthenticated)
- Worker types regenerated via `bun run cf-typegen` after changing `wrangler.jsonc`
- Migrations: `bunx drizzle-kit generate` then `bunx wrangler d1 migrations apply indieaffiliate-db`
- Secrets (like `BETTER_AUTH_SECRET`) set via `bunx wrangler secret put <NAME>`

### Routing

- SPA routing via `react-router-dom` in `src/App.tsx`
- Public routes: `/`, `/login`, `/signup`
- App routes nested under `/app` with `AuthGuard` + `Layout` wrapper
- Use `<Link to="...">` for navigation, not `window.location`

## Key Conventions from Cursor Rules

- Always use `bun` (never npm/yarn) for all package management and script execution
- Before installing any package, check `package.json` to see if it's truly needed
- Optimize for Cloudflare Workers environment
- Implement proper ARIA labels, keyboard navigation, and semantic HTML
- Maintain proper color contrast for accessibility
