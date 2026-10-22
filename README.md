# Guard
demo : https://www.youtube.com/watch?v=l42jKfeXURg
**Autonomous SecOps agent team, built on Aiven for PostgreSQL and the OpenAI Agents SDK.**

Guard plugs into a running system, reads the CVE feed, and decides per service what a new vulnerability actually means: dismiss it, open a fix PR while the service keeps earning, or take it offline now. Built for the Aiven "Future Founders: Data-Centric Agents" hackathon.

## The problem

When a critical CVE drops, security teams lose hours checking whether they run the affected package, whether it is exposed, and whether a patch exists. Keyword alerts drown them; naive automation takes down services that were never at risk.

On 21 October 2026, NVD published **544 CVEs**. Among them was **PHP2Shell** (CVE-2026-109618 and CVE-2026-109619): unauthenticated remote code execution in PHP, CVSS v4.0 9.2, fixed in 8.5.12 / 8.4.27 / 8.3.36 / 8.2.35. A keyword script matching "PHP" would have alerted **40 times** that day; only **2** CVEs affect the PHP runtime itself.

## What the demo shows

1. **The company**: a running system (`target-system/`) with a public PHP 8.3.30 shop, an internal PHP 8.4.20 admin panel and a Python billing worker. It knows nothing about Guard.
2. **Plug in**: Guard discovers the three services from Docker labels and live runtime versions, and stores the inventory in Aiven.
3. **The feed**: the real NVD feed of 21 Oct is replayed. Code and a Triage agent narrow 544 CVEs to the 2 that matter.
4. **The agent team**: Threat Intel researches PHP2Shell live (Keenable + NVD ranges), Risk Scoring scores every service in parallel: **shop 92**, admin-panel 67, billing-worker 0.
5. **Action**: Containment takes the shop offline behind a maintenance page and alerts a phone; Remediation verifies the official fix and opens PRs that bump PHP in the Dockerfile and `composer.json`. The admin panel keeps running.
6. **Human in the loop**: an engineer approves the restore; the shop comes back on PHP 8.3.36.

Every fact and decision is a row in Aiven. The agents research and explain; deterministic code decides.

## Architecture

- **Aiven for PostgreSQL**: inventory, CVE feed and triage, threat intel, incidents with scores, every agent step, and the event bus (`LISTEN/NOTIFY`).
- **Guard** (`sentinel/`, Python 3.12): feed replay, two-stage triage, a code-driven orchestrator and five OpenAI agents (Triage, Threat Intel, Risk Scoring, Containment, Remediation) with narrow tools; FastAPI on :8000.
- **Keenable**: live web research for the agents, via MCP (REST fallback).
- **Dashboard** (`dashboard/`, Next.js): feed funnel, agent lanes, service cards with scores, live trace, incident detail; :3000.
- **target-system/**: the protected "company", with one Nginx include as Guard's maintenance switch.

Diagrams and details: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

### Danger score

Zero unless the installed version is affected; otherwise CVSS x 4 (max 40) + exploitation reported 20 + public 20 / internal 5 + high-risk runtime mode 10 / other 5 + revenue >= 10k EUR/month 5 + no official fix for the branch 15, capped at 100. At 80 or more the service is taken offline; 50 to 79 gets a PR and an alert; 1 to 49 a PR only.

## Run it

Prerequisites: Docker (Colima on macOS), `uv`, `pnpm`, `psql`.

1. **Configure**: `cp .env.example .env` and fill in `DATABASE_URL` (the **direct** Aiven service URI, PostgreSQL 15+, not the pool), `OPENAI_API_KEY`, `GITHUB_TOKEN` + `GITHUB_REPO`, `NTFY_TOPIC`. `KEENABLE_API_KEY` is optional.
2. **Database**: `psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sentinel/db/schema.sql`
3. **Target system**:

```bash
mkdir -p runtime/flags
docker compose -f target-system/docker-compose.yml build
SHOP_IMAGE=sentinel-shop:patched docker compose -f target-system/docker-compose.yml build --build-arg PHP_VERSION=8.3.36 shop
docker compose -f target-system/docker-compose.yml up -d
```

4. **Guard**: `cd sentinel && uv run sentinel`
5. **Dashboard**: `cd dashboard && pnpm install && pnpm dev`, then open http://localhost:3000. The shop is at http://localhost:8080.
6. **Push the repo to GitHub** before a live run: the Remediation agent reads `target-system/` from the default branch and opens PRs against it.

Demo buttons: **Connect Guard**, **Replay 21 Oct feed**, **Approve and restore shop**, **Reset demo** (also `scripts/reset.sh`, add `--clear-intel` to force fresh research).

### Live and fallback mode

Without an OpenAI key, or when an agent fails, every lane finishes in code (rule triage, saved intel fixture, direct tool calls) and is marked `cached` or `failed` on the dashboard. Missing GitHub or ntfy configuration is skipped with a warning. Set `INTEL_OFFLINE=1` to use the saved threat intel instead of live research.

### Tests

`cd sentinel && uv run pytest`: scoring cases, NVD branch ranges, the stage-1 funnel over the real feed (2 matched / 38 candidates / 504 dismissed / 40 keyword hits), and the exact Dockerfile and `composer.json` edits.

## Safety design

- Agents act only through tools; `take_offline` re-checks the persisted deterministic score.
- The PR tool only edits files in the service's own folder and never merges.
- Agent outputs are schema-validated; the orchestrator verifies postconditions and falls back to code.
- Offline means stopped behind a maintenance page, not deleted; a human approves the restore.

## Repository layout

```
target-system/   the protected system: compose, nginx, shop, admin-panel
sentinel/        Python agent: feed, triage, orchestrator, agents, tools, API, schema, fixtures, tests
dashboard/       Next.js dashboard
docs/            architecture diagrams
scripts/         reset.sh
runtime/flags/   maintenance flags (gitignored)
```
