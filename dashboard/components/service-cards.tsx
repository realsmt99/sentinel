import type { ReactNode } from "react";
import { Cube } from "@phosphor-icons/react";
import type { ActionControl } from "@/lib/actions";
import { formatPoints, prLabel } from "@/lib/format";
import type { Tone } from "@/lib/labels";
import type { Breakdown, RiskView, ServiceView } from "@/lib/services";
import { ActionButtonView } from "./action-bar";
import { Badge } from "./ui/badge";
import { ExternalLink } from "./ui/external-link";
import { Panel } from "./ui/panel";
import { toneBorder, toneStroke, toneSurface, toneText } from "./ui/tone";

interface ServiceGridProps {
  services: ServiceView[];
  restoreControls: Record<string, ActionControl>;
  onRun: (control: ActionControl) => void;
  index?: number;
}

export function ServiceGrid({ services, restoreControls, onRun, index = 0 }: ServiceGridProps) {
  return (
    <Panel
      index={index}
      eyebrow="Inventory · Docker labels"
      icon={<Cube size={11} weight="bold" />}
      title="Services and their danger score"
      subtitle="Discovered from sentinel.* labels and live runtime versions. Scores come from one Risk Scoring agent per service, computed by a deterministic tool."
    >
      <div className="grid gap-3 lg:grid-cols-[1.15fr_1fr]">
        {services.map((view, i) => (
          <ServiceCard
            key={view.service.id}
            view={view}
            featured={i === 0 && services.length > 1}
            restore={restoreControls[view.service.name]}
            onRun={onRun}
          />
        ))}
      </div>
    </Panel>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-600">{label}</dt>
      <dd className="mt-0.5 break-words text-zinc-200">{children}</dd>
    </div>
  );
}

interface ServiceCardProps {
  view: ServiceView;
  featured: boolean;
  restore?: ActionControl;
  onRun: (c: ActionControl) => void;
}

function ServiceCard({ view, featured, restore, onRun }: ServiceCardProps) {
  const { service } = view;
  return (
    <article
      className={`flex flex-col rounded-2xl p-5 ring-1 ring-inset transition-colors duration-700 ease-spring ${toneSurface[view.status.tone]} ${toneBorder[view.status.tone]} ${featured ? "lg:row-span-2" : ""}`}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-medium tracking-tight text-zinc-50">{service.name}</h3>
          <p className="truncate font-mono text-[11px] text-zinc-600">{service.image ?? service.container_name}</p>
        </div>
        <Badge tone={view.status.tone} pulse={service.status === "RESTORING"}>
          {view.status.label}
        </Badge>
      </header>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        <Fact label="Runtime">{view.runtime}</Fact>
        <Fact label="Mode">{view.runtimeMode ?? "-"}</Fact>
        <Fact label="Exposure">{view.exposure}</Fact>
        <Fact label="Revenue">{view.revenue}</Fact>
      </dl>

      <RiskBlock risk={view.risk} featured={featured} />

      {restore && (
        <div className="mt-5">
          <ActionButtonView control={restore} onRun={onRun} />
        </div>
      )}
    </article>
  );
}

function ScoreRing({ score, tone, size }: { score: number | null; tone: Tone; size: number }) {
  const stroke = size > 120 ? 7 : 6;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - Math.min(Math.max(score ?? 0, 0), 100) / 100);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox={`0 0 ${size} ${size}`} className="-rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-white/[0.06]" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          className={`transition-[stroke-dashoffset] duration-[1400ms] ease-spring ${toneStroke[tone]}`}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className={`font-mono font-medium tabular-nums tracking-tight ${size > 120 ? "text-4xl" : "text-2xl"} ${toneText[tone]}`}>
          {score ?? "-"}
        </span>
        <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-600">of 100</span>
      </div>
    </div>
  );
}

function RiskBlock({ risk, featured }: { risk: RiskView | null; featured: boolean }) {
  if (!risk) {
    return (
      <div className="mt-5 flex items-center gap-4 border-t border-white/5 pt-4">
        <ScoreRing score={null} tone="muted" size={featured ? 136 : 88} />
        <p className="text-xs text-zinc-500">Not scored yet. A Risk Scoring agent scores this service after the Threat Intel research.</p>
      </div>
    );
  }
  const tone = risk.band?.tone ?? "neutral";
  return (
    <div className="mt-5 border-t border-white/5 pt-4 text-xs">
      <div className="flex items-center gap-5">
        <ScoreRing score={risk.score} tone={tone} size={featured ? 136 : 88} />
        <div className="flex min-w-0 flex-col items-start gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-600">Danger score</span>
          {risk.band && <Badge tone={risk.band.tone}>{risk.band.label}</Badge>}
          {risk.incidentStatus && <Badge tone={risk.incidentStatus.tone}>Incident {risk.incidentStatus.label.toLowerCase()}</Badge>}
          {risk.prUrl && (
            <ExternalLink href={risk.prUrl} className="text-signal-300">
              {prLabel(risk.prUrl)}
            </ExternalLink>
          )}
        </div>
      </div>

      {risk.explanation && <p className="mt-4 leading-relaxed text-zinc-300">{risk.explanation}</p>}
      <ScoreBreakdown breakdown={risk.breakdown} score={risk.score} rule={risk.band?.rule ?? null} />
    </div>
  );
}

function ScoreBreakdown({ breakdown, score, rule }: { breakdown: Breakdown; score: number | null; rule: string | null }) {
  if (breakdown.rows.length === 0 && breakdown.facts.length === 0) return null;
  return (
    <details className="mt-4 rounded-xl bg-black/20 ring-1 ring-inset ring-white/5">
      <summary className="cursor-pointer list-none px-3 py-2 text-zinc-400 transition-colors duration-300 hover:text-zinc-100">
        Score breakdown
      </summary>
      <div className="border-t border-white/5 px-3 pb-3 pt-2">
        {breakdown.rows.length > 0 && (
          <table className="w-full">
            <tbody>
              {breakdown.rows.map((row) => (
                <tr key={row.key} className="align-top">
                  <td className="py-1 pr-2 text-zinc-300">
                    {row.label}
                    {row.note && <span className="block text-zinc-600">{row.note}</span>}
                  </td>
                  <td className="py-1 text-right font-mono tabular-nums text-zinc-100">{formatPoints(row.points)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t border-white/5">
              <tr>
                <td className="pt-2 pr-2 text-zinc-500">Sum{breakdown.total !== null ? ` (reported: ${breakdown.total})` : ""}</td>
                <td className="pt-2 text-right font-mono tabular-nums text-zinc-300">{breakdown.sum}</td>
              </tr>
              <tr>
                <td className="pr-2 text-zinc-500">Danger score (rounded, capped at 100)</td>
                <td className="text-right font-mono tabular-nums text-zinc-50">{score ?? "-"}</td>
              </tr>
            </tfoot>
          </table>
        )}
        {breakdown.facts.length > 0 && (
          <dl className="mt-2 space-y-0.5">
            {breakdown.facts.map((fact) => (
              <div key={fact.label} className="flex gap-2">
                <dt className="text-zinc-600">{fact.label}</dt>
                <dd className="text-zinc-300">{fact.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {rule && <p className="mt-2 text-zinc-600">Band rule: {rule}</p>}
      </div>
    </details>
  );
}
