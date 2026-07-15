# wacrm AI coding agent guide

This repo is a self-hosted WhatsApp CRM template built with Next.js 16 App Router, React 19, TypeScript 6, Tailwind v4, and Supabase.

## What matters most

- This is a template repository. The expected workflow is **fork → customize → deploy**. Upstream contributions are secondary; do not assume the codebase is a product meant for feature expansion in the upstream repo.
- The main app lives in `src/`. The Supabase browser client is in `src/lib/supabase/client.ts` and the server-side Supabase client is in `src/lib/supabase/server.ts`.
- Auth and page/API protection are enforced by `src/middleware.ts`.
- The MCP server lives in `mcp-server/` and wraps the public REST API exposed by `docs/public-api.md`. It is read-only by default and requires explicit env guards for writes.

## Local dev and validation

- `npm install`
- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run typecheck`
- `npm run test`

Node version: `>=20.0.0`.

## Key repo conventions

- `src/app/` is the Next.js App Router entrypoint.
- `src/components/` contains reusable UI blocks.
- `src/hooks/` contains shared client-side hooks.
- `src/lib/` contains business logic, Supabase helpers, API routes, WhatsApp integration, and automation engine code.
- `supabase/migrations/` contains schema migrations. Be careful when changing the database shape in a fork.
- `next.config.ts` configures production security and cache headers; do not remove or weaken these rules lightly.
- `docs/` contains important guidance for API and MCP usage.

## Useful docs

- [`README.md`](./README.md) — repository overview and quick start.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — fork workflow and PR guidance.
- [`docs/public-api.md`](./docs/public-api.md) — public REST API reference.
- [`docs/mcp.md`](./docs/mcp.md) — MCP server usage and safety model.
- [`mcp-server/README.md`](./mcp-server/README.md) — MCP tool list and opt-in write guard behavior.

## Agent guidance

- Prefer implementation-focused suggestions that match the repo’s existing patterns.
- Link to existing documentation instead of copying it when the repo already provides the guidance.
- Preserve the template’s fork-first intent: recommend forking and customizing rather than assuming upstream feature additions.
- Use the existing Supabase client/server split and middleware auth flow rather than inventing a new auth pattern.
