"""Guard's narration for the chat view: first-person messages written to chat_messages at each milestone,
each optionally carrying a card the dashboard renders from the run state. Every call refreshes the run's
history file. Never raises: narration must not break the pipeline."""

from __future__ import annotations

import logging
from typing import Any

from psycopg.types.json import Jsonb

from . import db, history

log = logging.getLogger("sentinel.narrate")


def say(text: str, *, role: str = "guard", card: dict[str, Any] | None = None) -> None:
    try:
        run_id = history.ensure_run()
        db.execute(
            "INSERT INTO chat_messages (run_id, role, text, card) VALUES (%s, %s, %s, %s)",
            (run_id, role, text, Jsonb(card) if card else None),
        )
    except Exception as exc:
        log.warning("chat message failed: %s", exc)
        return
    history.save_current()


def user(text: str) -> None:
    say(text, role="user")


def event(text: str, card: dict[str, Any] | None = None) -> None:
    say(text, role="event", card=card)


def _names(names: list[str]) -> str:
    return names[0] if len(names) == 1 else f"{', '.join(names[:-1])} and {names[-1]}"


# --- connect and feed ----------------------------------------------------------------------------


def connected(services: list[dict[str, Any]]) -> None:
    public = [s["name"] for s in services if s.get("exposure") == "public"]
    say(
        f"I'm connected to your project. I found {len(services)} running services: "
        f"{_names([s['name'] for s in services])}. I asked each container what it really runs"
        + (f", and {_names(public)} {'is' if len(public) == 1 else 'are'} reachable from the internet." if public else ".")
        + " Everything is stored in Aiven. Ready when you are: replay the CVE feed.",
        card={"type": "services"},
    )


def new_run(services: list[str]) -> None:
    event(f"New run. Still connected to {_names(services)}." if services else "New run.")


def feed_started(total: int) -> None:
    say(f"Reading the NVD feed of 21 October 2026: {total} new CVEs. I'm matching each one against what you run.",
        card={"type": "feed"})


def feed_checked(funnel: dict[str, Any], matched: dict[str, list[str]]) -> None:
    ids = [cve for cves in matched.values() for cve in cves]
    if not ids:
        say(f"I checked all {funnel.get('total')} CVEs. None of them affects what you run, so nothing to do.")
        return
    say(
        f"I checked all {funnel.get('total')} CVEs. {funnel.get('keyword_hits')} mention a runtime you use, so a "
        f"keyword script would have paged you {funnel.get('keyword_hits')} times. Only {len(ids)} really affect "
        f"you: {', '.join(ids)}. I'm sending my agent team on it.",
        card={"type": "funnel"},
    )


def triage_done(dismissed: int, total: int, examples: str) -> None:
    if total:
        say(f"I looked at the {total} CVEs that only mention PHP. {dismissed} are flaws in PHP applications you "
            f"don't run" + (f" (for example {examples})" if examples else "") + ", so I dismissed them.")


# --- research, scores, actions -------------------------------------------------------------------


def intel_found(data: dict[str, Any], cached: bool) -> None:
    fixes = data.get("fixed_versions") or {}
    fixed = [e.get("version") for e in fixes.values() if isinstance(e, dict) and e.get("version")] if isinstance(fixes, dict) else []
    sources = data.get("sources") or []
    exploited = data.get("exploitation_reported")
    conflicts = data.get("conflicts") or []
    text = (
        ("I already researched this advisory, here is what I found on the web: " if cached else "Here is what I found on the web: ")
        + f"CVSS {data.get('cvss')}. "
        + ("Attackers are already exploiting it. " if exploited else "No exploitation reported yet. ")
        + (f"A fix exists: PHP {', '.join(fixed)}. " if fixed else "I found no official fix yet. ")
        + (f"Sources disagree on one point: {_conflict_text(conflicts[0])}. " if conflicts else "")
        + f"{len(sources)} sources checked."
    )
    say(text, card={"type": "intel"})


def _conflict_text(conflict: Any) -> str:
    if isinstance(conflict, dict):
        return str(conflict.get("summary") or conflict.get("claim") or conflict.get("description") or "see sources")
    return str(conflict)


def ranked(incidents: list[dict[str, Any]]) -> None:
    rows = sorted(incidents, key=lambda i: i.get("danger_score") or 0, reverse=True)
    parts = [f"{i['service']} {i.get('danger_score')}" for i in rows]
    above = [i["service"] for i in rows if (i.get("danger_score") or 0) >= 80]
    say(
        f"I ranked every service by danger: {', '.join(parts)} out of 100. "
        + (f"{_names(above)} {'is' if len(above) == 1 else 'are'} at 80 or above." if above
           else "Nothing reaches 80, so nothing needs to go offline."),
        card={"type": "scores"},
    )
    if rows:
        top = rows[0]
        history.set_title(f"{top['service']} scored {top.get('danger_score')}" + (" · taken offline" if above else ""))


def shutting_down(service: str, score: int) -> None:
    say(f"{service} scored {score}. It is public and attackers are exploiting this flaw, so we need to shut it "
        f"down now. Stopping it and switching on the maintenance page.")


def contained(service: str, offline: bool, alert_sent: bool, edge_status: int | None) -> None:
    if offline:
        say(f"Done: {service} is stopped and visitors see the maintenance page"
            + (f" (the site now answers {edge_status})" if edge_status else "") + ". "
            + ("I sent an urgent alert to your phone." if alert_sent else "The phone alert was skipped."),
            card={"type": "site", "state": "offline", "status": edge_status})
    else:
        say(f"I could not take {service} offline. Please check it.", card={"type": "site", "state": "online"})


def fix_ready(service: str, pr_url: str | None, target: str | None, reason: str | None, alerted: bool) -> None:
    if pr_url:
        number = pr_url.rstrip("/").rsplit("/", 1)[-1]
        say(f"I confirmed the official release and the Docker image, then opened pull request #{number} to move "
            f"{service} to PHP {target or 'the patched version'}" + (" and sent you a notification." if alerted else "."),
            card={"type": "pr", "service": service, "url": pr_url})
    else:
        say(f"The fix for {service} is PHP {target or '?'}, but I did not open a pull request: {reason or 'no change needed'}.")


def waiting(offline: list[str], prs: list[str]) -> None:
    if offline:
        say(f"{_names(offline)} stays offline until the fix is in. Merge the pull request on GitHub and I will "
            f"deploy it myself, or approve the restore here.", card={"type": "next"})
    elif prs:
        say("Everything keeps serving. Merge the pull request on GitHub and I will deploy it.", card={"type": "next"})


# --- merge and restore ----------------------------------------------------------------------------


def merged(service: str, number: int, by: str | None) -> None:
    event(f"Pull request #{number} was merged on GitHub" + (f" by {by}" if by else "") + ".")
    say(f"The fix for {service} is merged. Deploying the patched {service} now.")


def restore_failed(service: str, error: str) -> None:
    say(f"I could not deploy the patched {service}: {error}", card={"type": "site", "state": "offline"})


def solved(service: str, version: str | None, seconds: float | None) -> None:
    took = f" Solved {round(seconds / 60, 1)} minutes after the CVE arrived." if seconds else ""
    say(f"{service} is back online on PHP {version or 'the patched version'} and the maintenance page is gone.{took}",
        card={"type": "site", "state": "online", "version": version})
    try:
        run = history.current_run()
        if run and "solved" not in run["title"]:
            history.set_title(run["title"].replace(" · taken offline", "") + " · solved")
    except Exception as exc:
        log.warning("run title update failed: %s", exc)
