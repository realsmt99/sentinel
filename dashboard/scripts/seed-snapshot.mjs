// Seeds a LOCAL Postgres that already has sentinel/db/schema.sql applied with a realistic demo state,
// so the dashboard can be developed and restyled without the agent backend running.
//
//   DATABASE_URL=postgres://postgres:test@localhost:55433/postgres node scripts/seed-snapshot.mjs [scenario]
//
// Scenarios: empty | connected | replay (streams the feed like feed.py) | mid-demo (default) | resolved.
// Truncates every Sentinel table first, so it refuses to run against a non-local database.

import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";

const SCENARIOS = ["empty", "connected", "replay", "mid-demo", "resolved"];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const FIXTURE = new URL("../../sentinel/fixtures/nvd-2026-10-21.json", import.meta.url);
const FEED_STARTED_AGO_S = 80;
const PR_SHOP = "https://github.com/your-user/sentinel/pull/12";
const PR_ADMIN = "https://github.com/your-user/sentinel/pull/13";
const CVE_IDS = ["CVE-2026-109618", "CVE-2026-109619"];

const scenario = process.argv[2] ?? "mid-demo";
if (!SCENARIOS.includes(scenario)) {
  console.error(`Unknown scenario "${scenario}". Use one of: ${SCENARIOS.join(", ")}`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Set DATABASE_URL to a local test database.");
  process.exit(1);
}
if (!LOCAL_HOSTS.has(new URL(databaseUrl).hostname)) {
  console.error("Refusing to seed a non-local database: this script truncates every Sentinel table.");
  process.exit(1);
}

const SERVICES = [
  {
    name: "shop",
    container_name: "shop",
    language: "php",
    runtime_version: "8.3.30",
    runtime_mode: "apache2handler",
    image: "sentinel-shop:vulnerable",
    exposure: "public",
    monthly_revenue_eur: 40000,
    repo_path: "target-system/shop/Dockerfile",
  },
  {
    name: "admin-panel",
    container_name: "admin-panel",
    language: "php",
    runtime_version: "8.4.20",
    runtime_mode: "fpm-fcgi",
    image: "sentinel-admin-panel:vulnerable",
    exposure: "internal",
    monthly_revenue_eur: 0,
    repo_path: "target-system/admin-panel/Dockerfile",
  },
  {
    name: "billing-worker",
    container_name: "billing-worker",
    language: "python",
    runtime_version: "3.12.12",
    runtime_mode: null,
    image: "python:3.12-slim",
    exposure: "internal",
    monthly_revenue_eur: 15000,
    repo_path: null,
  },
];

const TRIAGE_REASONS = [
  [/itsourcecode/i, "itsourcecode PHP web app, not deployed here; the PHP runtime is not affected"],
  [/oretnom23/i, "oretnom23 PHP project: application bug, not the PHP runtime"],
  [/projectworlds/i, "ProjectWorlds Advanced Library Management System is not in our inventory"],
  [/dhikshitha29/i, "Insurance-Management-System (a GitHub project) is not deployed here"],
  [/wordpress/i, "WordPress plugin; we run no WordPress"],
  [/avideo/i, "WWBN AVideo is not deployed here"],
  [/coraza/i, "Coraza WAF (Go); only mentions .php file names"],
  [/phpoffice|phppresentation/i, "PHPOffice PHPPresentation library is not in our composer.json"],
  [/e107/i, "e107 CMS is not deployed here"],
  [/tastyigniter/i, "TastyIgniter is not deployed here"],
  [/file-management-system/i, "file-management-system PHP app is not deployed here"],
];

const INTEL = {
  cvss: 9.2,
  exploitation_reported: true,
  exploitation_evidence: [
    {
      claim: "Tenable: exploitation attempts observed in the wild",
      url: "https://www.tenable.com/blog/php2shell-cve-2026-109618-cve-2026-109619-frequently-asked-questions-about-critical-php-remote",
    },
    "Amazon threat intelligence reports scanning for vulnerable PHP builds",
  ],
  high_risk_runtime_modes: ["apache2handler"],
  fixed_versions: {
    "8.5": { version: "8.5.12", source_url: "https://www.php.net/ChangeLog-8.php#8.5.12" },
    "8.4": { version: "8.4.27", source_url: "https://www.php.net/ChangeLog-8.php#8.4.27" },
    "8.3": { version: "8.3.36", source_url: "https://www.php.net/ChangeLog-8.php#8.3.36" },
    "8.2": { version: "8.2.35", source_url: "https://www.php.net/ChangeLog-8.php#8.2.35" },
  },
  unsupported_branches: ["8.1", "8.0", "7.4"],
  conflicts: [
    "CISA: exploitation not observed at publication; Tenable and Amazon: exploitation attempts reported",
    {
      topic: "Affected versions",
      sources: [
        { url: "https://nvd.nist.gov/vuln/detail/CVE-2026-109618", claim: "NVD: 8.3.0 up to (excluding) 8.3.36" },
        {
          url: "https://thephp.foundation/blog/2026/10/21/todays-php-security-release-and-how-were-strengthening-php-security/",
          claim: "PHP Foundation: PHP 5.4 through 8.5.11",
        },
      ],
    },
  ],
  sources: [
    {
      url: "https://www.cisa.gov/news-events/alerts/2026/10/21/critical-vulnerabilities-php-require-immediate-patching",
      title: "CISA: critical vulnerabilities in PHP require immediate patching",
    },
    {
      url: "https://thephp.foundation/blog/2026/10/21/todays-php-security-release-and-how-were-strengthening-php-security/",
      claim: "PHP Foundation: fixed in 8.5.12, 8.4.27, 8.3.36 and 8.2.35",
    },
    {
      url: "https://www.tenable.com/blog/php2shell-cve-2026-109618-cve-2026-109619-frequently-asked-questions-about-critical-php-remote",
      title: "Tenable PHP2Shell FAQ",
    },
    "https://nvd.nist.gov/vuln/detail/CVE-2026-109619",
  ],
};

function pickCvss(metrics = {}) {
  for (const key of ["cvssMetricV40", "cvssMetricV31", "cvssMetricV30", "cvssMetricV2"]) {
    const data = metrics[key]?.[0]?.cvssData;
    if (data) return { cvss: data.baseScore, cvss_version: data.version };
  }
  return { cvss: null, cvss_version: null };
}

/** With `triaged` false, keyword-only CVEs stay CANDIDATE, waiting for the Triage agent. */
function cveRows({ triaged }) {
  const { vulnerabilities } = JSON.parse(readFileSync(FIXTURE, "utf8"));
  return vulnerabilities.map(({ cve }, index) => {
    const description = cve.descriptions?.find((d) => d.lang === "en")?.value ?? "";
    const cpes = cve.configurations ?? [];
    const keyword = /\bphp\b/i.test(description);
    const matched = JSON.stringify(cpes).includes("cpe:2.3:a:php:php:");
    let triage_status = matched ? "MATCHED" : "DISMISSED";
    let triage_reason = "No CPE or keyword match against the inventory";
    if (matched) triage_reason = "CPE cpe:2.3:a:php:php matches php services (shop 8.3.30, admin-panel 8.4.20)";
    else if (keyword && !triaged) {
      triage_status = "CANDIDATE";
      triage_reason = null;
    } else if (keyword) {
      triage_reason =
        TRIAGE_REASONS.find(([pattern]) => pattern.test(description))?.[1] ??
        "PHP application bug, not a PHP runtime vulnerability";
    }
    return {
      cve_id: cve.id,
      published: `${cve.published}Z`,
      description,
      ...pickCvss(cve.metrics),
      cpes,
      keyword_match: keyword,
      triage_status,
      triage_reason,
      component: matched ? "php" : null,
      ago: FEED_STARTED_AGO_S - Math.floor(index / 25) * 0.25,
    };
  });
}

async function insertCves(rows) {
  await client.query(
    `INSERT INTO cve_events (cve_id, published, description, cvss, cvss_version, cpes, keyword_match, triage_status,
                             triage_reason, component, received_at)
     SELECT r.cve_id, r.published, r.description, r.cvss, r.cvss_version, r.cpes, r.keyword_match, r.triage_status,
            r.triage_reason, r.component, ${ago("r.ago")}
       FROM jsonb_to_recordset($1::jsonb) AS r(cve_id text, published timestamptz, description text, cvss numeric,
            cvss_version text, cpes jsonb, keyword_match boolean, triage_status text, triage_reason text,
            component text, ago float8)`,
    [JSON.stringify(rows)],
  );
}

async function streamFeed() {
  const rows = cveRows({ triaged: false }).map((row) => ({ ...row, ago: 0 }));
  for (let i = 0; i < rows.length; i += 25) {
    await insertCves(rows.slice(i, i + 25));
    await sleep(250);
  }
  await sleep(3000);
  const triaged = new Map(cveRows({ triaged: true }).map((row) => [row.cve_id, row.triage_reason]));
  for (const row of rows.filter((r) => r.triage_status === "CANDIDATE")) {
    await client.query(`UPDATE cve_events SET triage_status = 'DISMISSED', triage_reason = $2 WHERE cve_id = $1`, [
      row.cve_id,
      triaged.get(row.cve_id),
    ]);
  }
}

const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
const ago = (param) => `now() - make_interval(secs => ${param})`;

try {
  await client.query("BEGIN");
  await client.query("TRUNCATE services, cve_events, threat_intel, incidents, agent_runs, agent_log RESTART IDENTITY CASCADE");

  if (scenario !== "empty") {
    const ids = {};
    for (const s of SERVICES) {
      const { rows } = await client.query(
        `INSERT INTO services (name, container_name, language, runtime_version, runtime_mode, image, exposure,
                               monthly_revenue_eur, repo_path, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'HEALTHY') RETURNING id`,
        [s.name, s.container_name, s.language, s.runtime_version, s.runtime_mode, s.image, s.exposure, s.monthly_revenue_eur, s.repo_path],
      );
      ids[s.name] = rows[0].id;
    }
    await client.query(
      `INSERT INTO agent_log (component, agent, service, level, message, ts)
       VALUES (NULL, NULL, NULL, 'success', 'Scanner: discovered 3 services from Docker labels (shop, admin-panel, billing-worker)', ${ago("300")})`,
    );

    if (scenario === "mid-demo" || scenario === "resolved") {
      await seedIncident(ids);
    }
    if (scenario === "resolved") {
      await client.query(`UPDATE services SET status = 'HEALTHY', runtime_version = '8.3.36', image = 'sentinel-shop:patched' WHERE name = 'shop'`);
      await client.query(`UPDATE services SET status = 'PATCH_PENDING' WHERE name = 'admin-panel'`);
      await client.query(`UPDATE incidents SET status = 'RESOLVED', resolved_at = ${ago("2")} WHERE service_id = $1`, [ids.shop]);
      await client.query(`UPDATE incidents SET pr_url = $1 WHERE service_id = $2`, [PR_ADMIN, ids["admin-panel"]]);
      await client.query(
        `UPDATE agent_runs SET status = 'done', ended_at = ${ago("20")}, last_tool = 'open_fix_pr(admin-panel, 8.4.27)'
          WHERE agent = 'remediation' AND service = 'admin-panel'`,
      );
      await log("remediation", "admin-panel", "success", `Remediation · admin-panel -> open_fix_pr(admin-panel, 8.4.27) = ${PR_ADMIN}`, 20);
      await log(null, null, "info", "Restore approved by a human: shop -> sentinel-shop:patched", 12);
      await log(null, null, "success", "Restore: shop answers 200 on PHP 8.3.36, flag removed, incident RESOLVED", 2);
    }
  }

  await client.query("COMMIT");
  if (scenario === "replay") await streamFeed();
  console.log(`Seeded scenario "${scenario}".`);
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  await client.end();
}

async function log(agent, service, level, message, secondsAgo) {
  await client.query(
    `INSERT INTO agent_log (component, agent, service, level, message, ts) VALUES ($1, $2, $3, $4, $5, ${ago("$6::float8")})`,
    [agent ? "php" : null, agent, service, level, message, secondsAgo],
  );
}

async function run(agent, service, status, lastTool, startedAgo, endedAgo, output = null) {
  await client.query(
    `INSERT INTO agent_runs (component, agent, service, status, last_tool, started_at, ended_at, output)
     VALUES ($1, $2, $3, $4, $5, ${ago("$6::float8")}, CASE WHEN $7::float8 IS NULL THEN NULL ELSE ${ago("$7::float8")} END, $8)`,
    [agent === "triage" ? null : "php", agent, service, status, lastTool, startedAgo, endedAgo, output && JSON.stringify(output)],
  );
}

async function seedIncident(ids) {
  await insertCves(cveRows({ triaged: true }));

  await client.query(`INSERT INTO threat_intel (component, cve_ids, data, fetched_at) VALUES ('php', $1, $2, ${ago("86400")})`, [
    CVE_IDS,
    JSON.stringify(INTEL),
  ]);

  await client.query(`UPDATE services SET status = 'OFFLINE' WHERE name = 'shop'`);

  const incident = (service, score, breakdown, band, explanation, extra) =>
    client.query(
      `INSERT INTO incidents (component, cve_ids, service_id, danger_score, score_breakdown, band, explanation,
                              remediation, pr_url, status, created_at, mitigated_at)
       VALUES ('php', $1, $2, $3, $4, $5, $6, $7, $8, $9, ${ago("68")},
               CASE WHEN $10::float8 IS NULL THEN NULL ELSE ${ago("$10::float8")} END)`,
      [CVE_IDS, ids[service], score, JSON.stringify(breakdown), band, explanation, extra.remediation ?? null, extra.pr_url ?? null, extra.status, extra.mitigatedAgo ?? null],
    );

  await incident(
    "shop",
    92,
    { severity: 36.8, exploitation: 20, exposure: 20, runtime_mode: 10, revenue: 5, no_fix: 0 },
    "TAKE_OFFLINE",
    "shop is public, earns 40k EUR a month and runs PHP 8.3.30 under mod_php, the setup the advisory calls highest risk. Exploitation is reported, so it was taken offline while the fix PR waits for review.",
    {
      status: "MITIGATED",
      mitigatedAgo: 57,
      pr_url: PR_SHOP,
      remediation: JSON.stringify({
        target_version: "8.3.36",
        fix_verified: true,
        docker_tag_verified: true,
        files_changed: ["target-system/shop/Dockerfile", "target-system/shop/composer.json"],
        pr_url: PR_SHOP,
        notes: "8.3.36 is the official fix (php.net ChangeLog, 21 Oct 2026); php:8.3.36-apache exists on Docker Hub.",
      }),
    },
  );
  await incident(
    "admin-panel",
    67,
    { severity: 36.8, exploitation: 20, exposure: 5, runtime_mode: 5, revenue: 0, no_fix: 0 },
    "PR_ONLY",
    "admin-panel is affected (PHP 8.4.20) but internal-only and earns no direct revenue: keep it serving and patch through a PR.",
    { status: "OPEN" },
  );
  await incident(
    "billing-worker",
    0,
    { in_affected_range: false, installed: "python 3.12.12" },
    "NONE",
    "billing-worker runs Python 3.12, not PHP: PHP2Shell does not apply.",
    { status: "OPEN" },
  );

  await run("triage", null, "done", null, 74, 66, { dismissed: 38, escalated: 0 });
  await run("threat_intel", null, "cached", "get_nvd_ranges(CVE-2026-109618)", 75.8, 75.1, INTEL);
  for (const [service, score, band] of [["shop", 92, "TAKE_OFFLINE"], ["admin-panel", 67, "PR_ONLY"], ["billing-worker", 0, "NONE"]]) {
    await run("risk_scoring", service, "done", `compute_danger_score(${service})`, 73, 69.5, { service, score, band });
  }
  await run("containment", "shop", "done", "send_alert(URGENT: shop taken offline)", 67, 57, {
    service: "shop",
    offline: true,
    alert_sent: true,
    message: "shop is behind the maintenance page; urgent alert sent with the PR link",
  });
  await run("remediation", "shop", "done", "open_fix_pr(shop, 8.3.36)", 67, 30);
  await run("remediation", "admin-panel", "running", "check_docker_tag(php, 8.4.27-fpm)", 67, null);

  const lines = [
    [null, null, "info", "Feed: replaying NVD 2026-10-21, 544 CVEs in chunks of 25", 80],
    [null, null, "warn", "Stage 1: CVE-2026-109618 MATCHED cpe:2.3:a:php:php (inventory runs php: shop, admin-panel)", 76.5],
    [null, null, "warn", "Stage 1: CVE-2026-109619 MATCHED cpe:2.3:a:php:php", 76.5],
    [null, null, "info", "Orchestrator: advisory php [CVE-2026-109618, CVE-2026-109619] -> Threat Intel", 76],
    ["threat_intel", null, "info", "Threat Intel -> cache hit: threat_intel row for php", 75.8],
    ["threat_intel", null, "info", "Threat Intel -> get_nvd_ranges(CVE-2026-109618)", 75.6],
    ["threat_intel", null, "warn", "Threat Intel: sources disagree on exploitation (CISA: not observed; Tenable, Amazon: exploited)", 75.2],
    [null, null, "info", "Feed done: 544 received, 40 keyword hits, 38 candidates, 2 matched", 74.5],
    ["triage", null, "info", "Triage -> reviewing 38 keyword-only CVEs", 74],
    ["risk_scoring", "shop", "info", "Risk Scoring · shop -> get_service(shop)", 73],
    ["risk_scoring", "admin-panel", "info", "Risk Scoring · admin-panel -> get_service(admin-panel)", 73],
    ["risk_scoring", "billing-worker", "info", "Risk Scoring · billing-worker -> get_service(billing-worker)", 73],
    ["risk_scoring", "shop", "error", "Risk Scoring · shop -> compute_danger_score(shop) = 92 TAKE_OFFLINE", 70],
    ["risk_scoring", "admin-panel", "warn", "Risk Scoring · admin-panel -> compute_danger_score(admin-panel) = 67 PR_ONLY", 70],
    ["risk_scoring", "billing-worker", "success", "Risk Scoring · billing-worker -> compute_danger_score(billing-worker) = 0 NONE", 70],
    ["containment", "shop", "info", "Containment -> take_offline(shop): persisted score 92 >= 80, gate passed", 67],
    ["remediation", "shop", "info", "Remediation · shop -> search_web_pages(PHP 8.3.36 release PHP2Shell)", 66],
    ["remediation", "admin-panel", "info", "Remediation · admin-panel -> search_web_pages(PHP 8.4.27 security release)", 66],
    ["triage", null, "success", "Triage: dismissed 38 of 38 (PHP web apps, not the PHP runtime)", 66],
    ["remediation", "shop", "info", "Remediation · shop -> fetch_page_content(php.net/ChangeLog-8.php)", 60],
    ["containment", "shop", "success", "Containment: shop offline - flag written, container stopped, maintenance page live", 58],
    ["containment", "shop", "info", "Containment -> send_alert(URGENT: shop taken offline)", 57.5],
    ["remediation", "shop", "info", "Remediation · shop -> check_docker_tag(php, 8.3.36-apache) = exists", 52],
    ["remediation", "shop", "info", "Remediation · shop -> read_repo_file(target-system/shop/Dockerfile)", 48],
    ["remediation", "shop", "info", "Remediation · shop -> read_repo_file(target-system/shop/composer.json)", 45],
    ["remediation", "admin-panel", "error", "Remediation · admin-panel: Keenable fetch timed out after 20s, retrying", 40],
    ["remediation", "shop", "success", `Remediation · shop -> open_fix_pr(shop, 8.3.36) = ${PR_SHOP}`, 30],
    ["remediation", "admin-panel", "info", "Remediation · admin-panel -> fetch_page_content(php.net/ChangeLog-8.php)", 18],
    ["remediation", "admin-panel", "info", "Remediation · admin-panel -> check_docker_tag(php, 8.4.27-fpm)", 4],
  ];
  for (const [agent, service, level, message, secondsAgo] of lines) {
    await log(agent, service, level, message, secondsAgo);
  }
}
