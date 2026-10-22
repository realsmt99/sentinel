"use client";

import { Broadcast } from "@phosphor-icons/react";
import { useCountUp } from "@/hooks/use-count-up";
import { formatCount } from "@/lib/format";
import type { FunnelStep, FunnelView } from "@/lib/funnel";
import type { Tone } from "@/lib/labels";
import type { CveEvent } from "@/lib/types";
import { Badge } from "./ui/badge";
import { ExternalLink } from "./ui/external-link";
import { Panel } from "./ui/panel";
import { toneText } from "./ui/tone";

const nvdUrl = (cveId: string) => `https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cveId)}`;

const BAR: Record<Tone, string> = {
  neutral: "bg-zinc-300",
  muted: "bg-zinc-600",
  info: "bg-sky-400",
  success: "bg-emerald-400",
  warning: "bg-amber-400",
  danger: "bg-rose-400",
};

interface FeedFunnelProps {
  view: FunnelView;
  index?: number;
  className?: string;
}

export function FeedFunnel({ view, index = 0, className = "" }: FeedFunnelProps) {
  const total = Math.max(view.steps[0]?.value ?? 0, 1);
  return (
    <Panel
      index={index}
      className={className}
      eyebrow="NVD feed · 21 Oct 2026"
      icon={<Broadcast size={11} weight="bold" />}
      title="From 544 CVEs to what matters"
      subtitle="Code matches every CVE against the inventory (CPE, then keywords); the Triage agent handles keyword-only hits."
      actions={
        view.streaming ? (
          <Badge tone="info" pulse>
            Receiving
          </Badge>
        ) : null
      }
    >
      <ol className="divide-y divide-white/5">
        {view.steps.map((step) => (
          <FunnelRow key={step.key} step={step} total={total} />
        ))}
      </ol>
      {view.keywordCves.length > 0 && <TriageDecisions cves={view.keywordCves} />}
    </Panel>
  );
}

function FunnelRow({ step, total }: { step: FunnelStep; total: number }) {
  const value = useCountUp(step.value);
  const ratio = step.value > 0 ? Math.max(step.value / total, 0.015) : 0;
  return (
    <li className="py-3 first:pt-0">
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">{step.label}</div>
          <div className="mt-0.5 line-clamp-2 break-words text-xs text-zinc-400">{step.caption}</div>
        </div>
        <div className={`font-mono text-2xl font-medium tabular-nums tracking-tight ${toneText[step.tone]}`}>
          {formatCount(value)}
        </div>
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.04]">
        <div
          className={`h-full origin-left rounded-full transition-transform duration-[1200ms] ease-spring ${BAR[step.tone]}`}
          style={{ transform: `scaleX(${ratio})` }}
        />
      </div>
    </li>
  );
}

function TriageDecisions({ cves }: { cves: CveEvent[] }) {
  return (
    <details className="group mt-4 rounded-2xl bg-white/[0.02] text-xs ring-1 ring-inset ring-white/5">
      <summary className="cursor-pointer list-none px-4 py-3 text-zinc-400 transition-colors duration-300 hover:text-zinc-100">
        Triage decisions for the {cves.length} keyword-only CVEs
      </summary>
      <ul className="thin-scroll max-h-72 space-y-3 overflow-y-auto border-t border-white/5 px-4 py-3">
        {cves.map((cve) => (
          <li key={cve.id}>
            <div className="flex flex-wrap items-center gap-2">
              <ExternalLink href={nvdUrl(cve.cve_id)} className="font-mono text-zinc-200">
                {cve.cve_id}
              </ExternalLink>
              <Badge tone={cve.triage_status === "DISMISSED" ? "muted" : "info"}>{cve.triage_status}</Badge>
            </div>
            <p className="mt-1 text-zinc-300">{cve.triage_reason ?? "Waiting for the Triage agent"}</p>
            <p className="mt-0.5 line-clamp-1 text-zinc-600">{cve.description}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
