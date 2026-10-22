"use client";

import { ArrowUpRight, GitPullRequest } from "@phosphor-icons/react";
import { formatClock } from "@/lib/format";
import type { ChatCard } from "@/lib/types";
import type { PhoneAlert } from "@/lib/workflow";
import { ActionButtonView } from "../action-bar";
import { SceneVisual, type SceneContext } from "../stage/scenes";
import { Tag } from "../stage/tag";
import { LogoMark } from "../ui/logo";
import { WebsitePreview } from "../workflow/website-preview";

const card = "rounded-xl border border-line bg-white";

interface CardProps {
  card: ChatCard;
  ctx: SceneContext;
  readOnly: boolean;
}

/** The card under a Guard message, rendered from the run state (live, or a saved snapshot). */
export function ChatCardView({ card: c, ctx, readOnly }: CardProps) {
  switch (c.type) {
    case "services":
      return <SceneVisual sceneKey="connect" ctx={ctx} />;
    case "feed":
      return <SceneVisual sceneKey="feed" ctx={ctx} />;
    case "funnel":
      return <MatchedCard ctx={ctx} />;
    case "intel":
      return <SceneVisual sceneKey="research" ctx={ctx} />;
    case "scores":
      return <SceneVisual sceneKey="score" ctx={ctx} />;
    case "site":
      return <SiteCard ctx={ctx} readOnly={readOnly} />;
    case "pr":
      return <PrCard ctx={ctx} service={c.service ?? null} url={c.url ?? null} />;
    case "next":
      return readOnly ? null : <NextCard ctx={ctx} />;
    default:
      return null;
  }
}

function MatchedCard({ ctx }: { ctx: SceneContext }) {
  const cves = ctx.state.matchedCves;
  if (cves.length === 0) return null;
  return (
    <ul className={`${card} divide-y divide-line`}>
      {cves.map((cve) => (
        <li key={cve.id} className="px-5 py-3.5">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`https://nvd.nist.gov/vuln/detail/${cve.cve_id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-sm text-ink underline decoration-line underline-offset-4 hover:decoration-ink"
            >
              {cve.cve_id}
            </a>
            {cve.cvss !== null && <Tag tone="danger">CVSS {cve.cvss}</Tag>}
          </div>
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-mute">{cve.description}</p>
        </li>
      ))}
    </ul>
  );
}

export function NotificationCard({ alert }: { alert: PhoneAlert }) {
  return (
    <a
      href={alert.url ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      className="flex max-w-md animate-rise items-start gap-3 rounded-2xl bg-[#1c1c1a] px-3.5 py-3 text-white transition-transform duration-200 active:scale-[0.99]"
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[#2b2b29]">
        <LogoMark className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-[10px] uppercase tracking-wide text-white/50">
          ntfy · your phone
          {alert.urgent && <span className="rounded-full bg-[#9f2f2d] px-1.5 text-[9px] font-semibold text-white">Urgent</span>}
          <span className="ml-auto normal-case">{formatClock(alert.ts)}</span>
        </span>
        <span className="mt-0.5 block text-[13px] font-semibold leading-snug">{alert.title}</span>
        <span className="block text-xs leading-snug text-white/70">{alert.body}</span>
      </span>
    </a>
  );
}

function SiteCard({ ctx, readOnly }: { ctx: SceneContext; readOnly: boolean }) {
  const urgent = ctx.view.alerts.filter((a) => a.urgent);
  const site = ctx.view.site;
  return (
    <div className="space-y-3">
      {readOnly ? (
        <div className={`${card} flex items-center justify-between gap-4 px-5 py-4`}>
          <div>
            <div className="text-sm font-medium text-ink">{site.service} at the end of this run</div>
            <div className="text-xs text-mute">{site.version ? `PHP ${site.version}` : "version unknown"}</div>
          </div>
          <Tag tone={site.state === "online" ? "success" : "danger"}>{site.state === "online" ? "Online" : "Stopped by Guard"}</Tag>
        </div>
      ) : (
        <WebsitePreview site={site} check={ctx.site} />
      )}
      {urgent.map((alert) => (
        <NotificationCard key={alert.id} alert={alert} />
      ))}
    </div>
  );
}

function PrCard({ ctx, service, url }: { ctx: SceneContext; service: string | null; url: string | null }) {
  const pr = ctx.view.pullRequests.find((p) => p.url === url || p.service === service);
  const href = pr?.url ?? url;
  if (!href) return null;
  const target = pr ? /PHP ([\d.]+)/.exec(pr.title)?.[1] ?? null : null;
  const running = ctx.state.services.find((s) => s.name === service)?.runtime_version ?? null;
  const from = running && running !== target ? running : null;
  const alert = ctx.view.alerts.find((a) => !a.urgent && a.url === href);
  return (
    <div className="space-y-3">
      <div className={`${card} overflow-hidden`}>
        <a href={href} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-4 px-5 py-4 transition-colors duration-200 hover:bg-bone-50">
          <span className="flex size-9 items-center justify-center rounded-md bg-pale-green text-pale-green-ink">
            <GitPullRequest size={18} weight="bold" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-medium text-ink">{pr?.label ?? "Pull request"}</span>
            <span className="block text-sm text-mute">{pr?.title ?? href}</span>
          </span>
          <span className="flex items-center gap-1 text-sm text-ink transition-transform duration-200 group-hover:translate-x-0.5">
            Open on GitHub
            <ArrowUpRight size={14} weight="bold" />
          </span>
        </a>
        {from && target && service && (
          <pre className="border-t border-line bg-bone-50 px-5 py-3 font-mono text-[12px] leading-relaxed">
            <span className="text-mute">{`target-system/${service}/Dockerfile\n`}</span>
            <span className="text-pale-red-ink">{`- ARG PHP_VERSION=${from}\n`}</span>
            <span className="text-pale-green-ink">{`+ ARG PHP_VERSION=${target}`}</span>
          </pre>
        )}
      </div>
      {alert && <NotificationCard alert={alert} />}
    </div>
  );
}

function NextCard({ ctx }: { ctx: SceneContext }) {
  const offline = ctx.view.offline;
  const restoring = ctx.view.steps.restore === "active";
  const pr = ctx.view.pullRequests.find((p) => p.service === offline?.service) ?? ctx.view.pullRequests[0];
  if (ctx.view.steps.restore === "done") return null;
  return (
    <div className={`${card} flex flex-wrap items-center justify-between gap-4 px-5 py-4`}>
      <div className="text-sm text-ink-soft">
        {pr ? (
          <a href={pr.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-ink underline decoration-line underline-offset-4 hover:decoration-ink">
            Merge {pr.label} on GitHub
            <ArrowUpRight size={12} weight="bold" />
          </a>
        ) : (
          "Waiting for a fix"
        )}
        <span className="text-mute">{restoring ? " and I deploy it, or approve here" : " and I deploy it"}</span>
      </div>
      {restoring && <ActionButtonView control={ctx.controls.restore} onRun={ctx.onRun} compact theme="light" />}
    </div>
  );
}
