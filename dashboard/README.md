# Guard dashboard

Next.js 16 (App Router, Cache Components) dashboard for the Guard demo. It polls `/api/state` every second (paused while the tab is hidden) and proxies its buttons to the Guard agent API.

## Run

Configuration comes from the repo-root `.env` (`../.env`): `DATABASE_URL` (Aiven direct service URI) and `AGENT_URL` (default `http://localhost:8000`). Variables already set in the shell take precedence.

```bash
pnpm install
pnpm dev                    # http://localhost:3000, for development
pnpm build && pnpm start    # for the demo: no dev overlay, no hot reload
```

## API

- `GET /api/state`: one SQL statement returning services, feed funnel, matched and keyword-only CVEs, agent runs, the last 80 trace lines, incidents and the newest threat intel per component. Errors come back as `{ ok: false, reason, message }` with `reason` one of `not_configured`, `unreachable`, `schema_missing`, `query_failed`.
- `POST /api/action/{connect|replay|reset}` and `POST /api/action/restore` with `{"service": "shop"}`: forwarded to `AGENT_URL` (`/connect`, `/demo/replay`, `/demo/reset`, `/restore/{service}`).
- `GET /api/health`: forwards the agent's `GET /health`.

## Code layout

- `lib/server/`: server-only code (env loading, `pg` pool, the state query, agent API client).
- `lib/*.ts`: pure view-model builders (funnel, lanes, services, incidents, actions, health). Components only render what these return.
- `components/ui/tone.ts`: the single place where semantic tones map to Tailwind classes.

## Local data without the backend

`scripts/seed-snapshot.mjs` fills a local Postgres (with `sentinel/db/schema.sql` applied) from the real NVD fixture. It refuses non-local databases because it truncates every Guard table.

```bash
docker run -d --name sentinel-pg-dev -p 55433:5432 -e POSTGRES_PASSWORD=test postgres:16
psql postgres://postgres:test@localhost:55433/postgres -v ON_ERROR_STOP=1 -f ../sentinel/db/schema.sql
DATABASE_URL=postgres://postgres:test@localhost:55433/postgres node scripts/seed-snapshot.mjs mid-demo
DATABASE_URL=postgres://postgres:test@localhost:55433/postgres pnpm dev
```

Scenarios: `empty`, `connected`, `replay` (streams the feed like `feed.py`), `mid-demo`, `resolved`.
