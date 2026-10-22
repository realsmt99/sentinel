# Guard architecture

Guard plugs into a running system, reads the CVE feed, and lets a team of OpenAI agents decide, per service, what a new vulnerability actually means. The demo uses **PHP2Shell** (CVE-2026-109618 and CVE-2026-109619, disclosed 21 October 2026): unauthenticated RCE in PHP up to 8.5.11, fixed in 8.5.12, 8.4.27, 8.3.36 and 8.2.35, with no official release for 8.1 and older.

Sources: [CISA alert](https://www.cisa.gov/news-events/alerts/2026/10/21/critical-vulnerabilities-php-require-immediate-patching), [PHP Foundation](https://thephp.foundation/blog/2026/10/21/todays-php-security-release-and-how-were-strengthening-php-security/), [Tenable FAQ](https://www.tenable.com/blog/php2shell-cve-2026-109618-cve-2026-109619-frequently-asked-questions-about-critical-php-remote).

The feed is real: `sentinel/fixtures/nvd-2026-10-21.json` is the NVD API dump of all 544 CVEs published that day. Only 2 of them carry CPE data (both `cpe:2.3:a:php:php`), and 40 mention "PHP" in the description, so a keyword script would have paged the team 40 times.

## 1. How Guard plugs in

The protected system (`target-system/`) knows nothing about Guard except four touch points:

1. **Container labels**: `sentinel.service`, `sentinel.language`, `sentinel.exposure`, `sentinel.revenue`, `sentinel.repo_path`, `sentinel.runtime_mode`. The live runtime version is detected, not declared.
2. **One Nginx include** per route: `include /etc/nginx/sentinel/killswitch.conf;` serves the maintenance page while `runtime/flags/<service>.flag` exists.
3. **Docker access** on the host, where the Guard agent runs.
4. **A GitHub token** for the repository that builds the system.

```mermaid
flowchart LR
    subgraph company [target-system - the company]
        nginx["edge-nginx + killswitch include"]
        shop["shop: PHP 8.3.30 mod_php, public"]
        admin["admin-panel: PHP 8.4.20 FPM, internal"]
        billing["billing-worker: Python 3.12, internal"]
    end
    subgraph sentinelBox [Guard - runs on the host]
        scanner["Scanner: labels + live versions"]
        agentTeam["Agent team + orchestrator"]
        api["FastAPI :8000"]
    end
    pg[("Aiven PostgreSQL")]
    dash["Dashboard :3000"]
    nginx --> shop
    scanner -->|"docker ps / inspect / exec"| company
    scanner --> pg
    agentTeam -->|"flag file + docker stop/start"| company
    agentTeam --> pg
    agentTeam -->|"fix PRs"| gh[GitHub]
    agentTeam -->|"alerts"| phone[ntfy]
    dash --> pg
    dash -->|"button actions"| api
```

## 2. System overview

Everything Guard knows or decides is a row in one Aiven for PostgreSQL service: the inventory, the CVE feed and its triage, the threat intel, the incidents with their scores, and every agent step. Postgres is also the event bus: inserting CVEs fires `pg_notify`, which wakes the agent.

```mermaid
flowchart TB
    subgraph aiven [Aiven for PostgreSQL]
        services[(services)]
        cveEvents[(cve_events)]
        intel[(threat_intel)]
        incidents[(incidents)]
        runs[(agent_runs + agent_log)]
    end
    fixture["NVD fixture: 544 CVEs of 21 Oct"] -->|"replay in chunks of 25"| cveEvents
    cveEvents -->|"NOTIFY cve_batch / feed_done"| listener["LISTEN loop"]
    listener --> stage1["Stage 1 triage - code"]
    stage1 --> orch["Orchestrator - code"]
    orch --> agents["OpenAI agents"]
    agents -->|"Keenable MCP"| web["php.net, CISA, Tenable, ..."]
    agents -->|"function tools"| tools["scoring, docker, GitHub, Docker Hub, ntfy"]
    orch --> incidents
    agents --> runs
    tools --> services
    dashboard["Next.js dashboard"] -->|"poll every 1s"| aiven
```

## 3. Where the MCP servers fit

```mermaid
flowchart LR
    subgraph buildTime [Build time - Cursor]
        cursorAgent["Cursor agent"]
        aivenMcp["Aiven MCP"]
        keenableMcpDev["Keenable MCP"]
    end
    subgraph runTime [Run time - Guard]
        intelAgent["Threat Intel + Remediation agents"]
        keenableMcpRun["Keenable MCP via Agents SDK"]
        keenableRest["Keenable REST fallback"]
        psycopg["psycopg - direct service URI"]
    end
    cursorAgent --> aivenMcp -->|"create service, read-only SQL"| pg[("Aiven PostgreSQL")]
    cursorAgent --> keenableMcpDev
    intelAgent --> keenableMcpRun --> web["Live web"]
    intelAgent -.->|"if MCP fails"| keenableRest --> web
    psycopg -->|"LISTEN/NOTIFY, reads, writes"| pg
```

- Aiven MCP is used from Cursor to create the service and inspect it. Its SQL is read-only, so the schema is applied with `psql`.
- Keenable MCP is used both from Cursor and **at run time** by the Threat Intel and Remediation agents (`MCPServerStreamableHttp`, tools `search_web_pages` and `fetch_page_content`), with the Keenable REST API as fallback.

## 4. Feed funnel

```mermaid
flowchart TD
    received["544 CVEs received"] --> stage1{"Stage 1 - code: CPE or keyword match against the inventory?"}
    stage1 -->|"504: no component we run"| dismissed[DISMISSED]
    stage1 -->|"38: keyword only"| triage["Triage agent: PHP runtime or PHP application?"]
    triage -->|"38 applications we do not run"| dismissed
    stage1 -->|"2: CPE php:php"| matched[MATCHED]
    matched --> group["Grouped into 1 advisory for component php"]
    group --> orchestrator["Orchestrator hands it to the agent team"]
```

## 5. The agent team

Code orchestrates; agents research, explain and act through narrow tools. Each agent has a Pydantic output type and its own lane on the dashboard.

```mermaid
flowchart TD
    orch["Orchestrator - Python, one OpenAI trace"] --> intelAgent["Threat Intel: Keenable MCP + NVD ranges"]
    intelAgent --> riskShop["Risk Scoring: shop"]
    intelAgent --> riskAdmin["Risk Scoring: admin-panel"]
    intelAgent --> riskBilling["Risk Scoring: billing-worker"]
    riskShop -->|"92 TAKE_OFFLINE"| contain["Containment: gated take_offline + urgent alert"]
    riskShop --> fixShop["Remediation: shop"]
    riskAdmin -->|"67 PR_ONLY"| fixAdmin["Remediation: admin-panel"]
    riskBilling -->|"0 NONE"| noAction["Logged, no action"]
    fixShop -->|"verify fix + Docker tag, edit Dockerfile + composer.json"| prs["GitHub PRs"]
    fixAdmin --> prs
    contain --> human["Human approves restore"]
    prs --> human
```

- **Triage** (fast model, once per feed): classifies the 38 keyword-only CVEs. No tools.
- **Threat Intel** (smart model, once per advisory): `search_web_pages`, `fetch_page_content`, `get_nvd_ranges`. Returns CVSS, exploitation evidence, high-risk runtime modes, fixed version per branch with a source each, unsupported branches, conflicts (CISA "not observed" vs Amazon/Tenable "exploited").
- **Risk Scoring** (fast model, one run per service, in parallel): `get_service`, `compute_danger_score`. The tool computes and persists the number; the agent explains it in business terms.
- **Containment** (fast model, for TAKE_OFFLINE): `take_offline` refuses unless the persisted score is at least 80; `send_alert`.
- **Remediation** (smart model, one run per affected service, in parallel with Containment): Keenable to confirm the official release, `check_docker_tag`, `read_repo_file`, `open_fix_pr` (path allowlist = the service folder, never merges). No official fix for the branch means an upgrade PR marked as a breaking change.

After the agents finish, the orchestrator verifies postconditions (the service really is offline, fixes are recorded) and calls the tools itself if an agent skipped a step.

## 6. One incident, end to end

```mermaid
sequenceDiagram
    autonumber
    participant Dash as Dashboard
    participant API as Guard API
    participant PG as Aiven Postgres
    participant Orch as Orchestrator
    participant Agents as Agent team
    participant Web as Keenable + NVD
    participant Sys as target-system
    participant GH as GitHub
    participant Phone as ntfy

    Dash->>API: POST /demo/replay
    API->>PG: INSERT 544 cve_events in chunks
    PG-->>Orch: NOTIFY cve_batch per chunk
    Orch->>PG: stage 1 triage, 2 MATCHED
    Orch->>Agents: Threat Intel
    Agents->>Web: search + fetch advisories, NVD ranges
    Agents->>PG: threat_intel row
    Orch->>Agents: Risk Scoring x3 in parallel
    Agents->>PG: incidents with score + breakdown
    par Containment
        Agents->>Sys: flag file, docker stop shop
        Agents->>Phone: urgent alert
    and Remediation
        Agents->>GH: PR shop to 8.3.36
        Agents->>GH: PR admin-panel to 8.4.27
    end
    Orch->>PG: postconditions verified, summary
    Dash->>API: POST /restore/shop (human approval)
    API->>Sys: compose up patched image, check PHP 8.3.36, remove flag
    API->>PG: shop HEALTHY, incident RESOLVED
```

## 7. Danger score

Deterministic, inside `compute_danger_score`; zero unless the installed version is in an affected range.

```mermaid
flowchart TD
    start["Service + threat intel"] --> affected{"Installed version in an affected range?"}
    affected -->|No| zero["0 - NONE"]
    affected -->|Yes| sum["Sum the factors, cap at 100"]
    sum --> band{"Score band"}
    band -->|"80 or more"| offline["TAKE_OFFLINE: contain now, fix PR, urgent alert"]
    band -->|"50 to 79"| prOnly["PR_ONLY: keep serving, fix PR, alert"]
    band -->|"1 to 49"| digest["DIGEST: fix PR, no alert"]
```

- Severity: CVSS x 4, max 40. PHP2Shell uses its CVSS v4.0 score, 9.2, giving 36.8.
- Exploitation reported by any credible source: +20.
- Exposure: public +20, internal +5.
- Runtime mode named high-risk by the advisory (mod_php, `apache2handler`): +10, other +5.
- Revenue of 10,000 EUR/month or more: +5.
- No official fix for the installed branch (PHP 8.1 and older): +15.

Results: **shop 92** (36.8 + 20 + 20 + 10 + 5), **admin-panel 67** (36.8 + 20 + 5 + 5), **billing-worker 0**.

## 8. Fallback mode

Every lane can finish without its agent. With no `OPENAI_API_KEY`, or when an agent errors or skips its job, code does the same work and the lane is marked `cached` or `failed`:

- Triage: rule "a runtime CVE's description starts with the runtime's own name, `PHP `".
- Threat Intel: cached `threat_intel` row, then `fixtures/php2shell-intel.json`.
- Risk Scoring: the score tool called directly, template explanation.
- Containment and Remediation: the same tools called by code.

Missing GitHub or ntfy configuration is logged as a warning and skipped.

## 9. Service lifecycle

```mermaid
stateDiagram-v2
    [*] --> HEALTHY: Connect
    HEALTHY --> PATCH_PENDING: PR_ONLY or DIGEST
    HEALTHY --> OFFLINE: TAKE_OFFLINE
    OFFLINE --> RESTORING: human clicks Approve and restore
    RESTORING --> HEALTHY: patched container up, version verified, flag removed
    RESTORING --> OFFLINE: verification fails
    PATCH_PENDING --> HEALTHY: PR merged and redeployed
```

## 10. Data model

```mermaid
erDiagram
    services ||--o{ incidents : "scored in"
    cve_events }o--o{ incidents : "cve_ids"
    threat_intel ||--o{ incidents : "component"
    incidents ||--o{ agent_runs : "component"
    agent_runs ||--o{ agent_log : "component, agent, service"

    services {
        int id PK
        text name
        text container_name
        text language
        text runtime_version
        text runtime_mode
        text image
        text exposure
        int monthly_revenue_eur
        text repo_path
        text status
        timestamptz last_seen
    }
    cve_events {
        int id PK
        text cve_id
        timestamptz published
        text description
        numeric cvss
        text cvss_version
        jsonb cpes
        bool keyword_match
        text triage_status
        text triage_reason
        text component
        timestamptz received_at
    }
    threat_intel {
        int id PK
        text component
        array cve_ids
        jsonb data
        timestamptz fetched_at
    }
    incidents {
        int id PK
        text component
        array cve_ids
        int service_id FK
        int danger_score
        jsonb score_breakdown
        text band
        text explanation
        jsonb remediation
        text pr_url
        text status
        timestamptz created_at
        timestamptz mitigated_at
        timestamptz resolved_at
    }
    agent_runs {
        int id PK
        text component
        text agent
        text service
        text status
        text last_tool
        timestamptz started_at
        timestamptz ended_at
        jsonb output
        text error
    }
    agent_log {
        int id PK
        text component
        text agent
        text service
        text level
        text message
        timestamptz ts
    }
```

The `feed_funnel` view aggregates `cve_events` for the dashboard (total, keyword hits, candidates, dismissed, matched).

## 11. Safety design

- Agents act only through tools; the destructive tool re-checks the persisted, deterministic score.
- The PR tool only edits files inside the service's own folder and never merges.
- Every agent output is schema-validated; the orchestrator verifies postconditions and falls back to code.
- Taking a service offline keeps its container and data (stop, not delete) and puts a maintenance page in front of it; a human approves the restore.
- In production the agent's Docker access would go through a restricted socket proxy instead of the host socket.
