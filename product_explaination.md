# Sentinel 🛡️
**Autonomous SecOps & Uptime Agent**

Sentinel is an event-driven, autonomous agent that cross-references incoming CVE streams with a live database of your running infrastructure. It reasons over this data and live web intelligence to either silently draft a hotfix (protecting revenue) or instantly isolate the container (protecting the system from zero-day breaches).

---

## 2. Core Architecture & Infrastructure
The system consists of four isolated, containerized components communicating over shared volumes, a Docker socket, and secure database connections.

1. **Ingress Proxy (Nginx):** Acts as the system killswitch. It monitors a shared file volume for a specific flag (`/var/run/sentinel/maintenance.flag`). If the agent creates this flag, Nginx executes a sub-millisecond reroute of incoming traffic to a static `503 "Under Maintenance"` page, preventing exploitation without dropping TCP connections.
2. **Business Workload (Target Container):** The active production application (e.g., a vulnerable PHP storefront) exposed to the web.
3. **State & Memory Core (Aiven Managed PostgreSQL):** The central data layer. It houses the live Software Bill of Materials (SBOM), active container states, and incident history.
4. **Autonomous Agent (Python/LangGraph):** The reasoning engine. It has programmatic access to the host's Docker daemon to inspect or halt containers, and it communicates with external APIs for web intelligence and free mobile alerting.

---

## 3. The Data Layer (Aiven PostgreSQL)
To satisfy the hackathon's "Data at the Core" requirement, Sentinel does not rely on static LLM prompts. Its reasoning is entirely grounded in the Aiven PostgreSQL database.

* **Infrastructure Inventory (`infrastructure_services` table):** Stores every running microservice, its container ID, installed language/version, network exposure (public vs. internal), and estimated monthly revenue impact.
* **Incident Feed (`security_incidents` table):** Acts as the agent's long-term memory, logging exactly why a decision was made, what CVE triggered it, and the time to resolution.

---

## 4. Live Web Intelligence (Keenable API)
Because LLM training data is static, the agent must fetch real-time intelligence for zero-day vulnerabilities (e.g., CVE-2026-109618 "PHP2Shell"). Sentinel uses the Keenable Search API to fetch live advisories:

* **Search (`search_web_pages`):** The agent queries Keenable with recency filters to find the newest GitHub advisories or NIST disclosures.
* **Extraction (`fetch_page_content`):** Using Keenable's `live=True` prompt-based extraction feature, the agent pulls targeted Markdown rather than parsing noisy HTML. It specifically extracts the exact safe patched version (e.g., PHP 8.3.36) and whether the exploit is active in the wild.

---

## 5. Multi-Layer Reasoning & Decision Matrix
When a new threat is ingested, the agent executes a deterministic decision tree:

* **Phase 1: Local Context Verification.** Query Aiven PostgreSQL. If the vulnerable package is *not* running in the current stack, discard the alert (stops alert fatigue).
* **Phase 2: Web Intelligence.** Query Keenable. Determine the severity, exploitability, and availability of a patch.
* **Phase 3: The Action Engine (Trade-off Analysis):**
  * **Path A (Revenue Protection):** If the asset is internal, or the CVE is low-severity, the agent keeps the container running. It autonomously opens a Git Pull Request to bump the dependency and sends a low-priority notification.
  * **Path B (Emergency Isolation):** If the asset is public-facing, the CVSS is critical (>= 9.0), and the exploit is active, the agent immediately writes the Nginx maintenance flag, halts the vulnerable Docker container, logs the incident in Aiven, and fires a high-priority alert to the user's phone using a **free messaging service** (e.g., `ntfy.sh`, Telegram Bot API, or a free Email-to-SMS gateway).

---

## 6. Human-in-the-Loop Restoration
Once a critical threat is mitigated and the system is in maintenance mode, a human engineer reviews the agent's drafted patch. 

Upon approval, a restoration script:
1. Updates the Aiven PostgreSQL state to `"HEALTHY"`
2. Restarts the patched Docker container
3. Deletes the Nginx flag, seamlessly restoring live traffic.
```eof

The README is ready for your repository! Using tools like `ntfy.sh` (which sends free push notifications to an app on your phone via simple HTTP POST requests) or a Telegram bot will be much easier to set up for a hackathon than dealing with SMS carrier registrations and trial limits. Good luck with the Aiven Hackathon! Let me know if you need to add installation instructions or screenshots to this file.