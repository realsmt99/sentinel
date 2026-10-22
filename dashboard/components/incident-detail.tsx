import type { ReactNode } from "react";
import { CheckCircle, Siren, WarningCircle } from "@phosphor-icons/react";
import { formatClock, formatDateTime, formatDuration, prLabel } from "@/lib/format";
import type { IncidentGroupView, IncidentRowView, RemediationView } from "@/lib/incidents";
import type { IntelLink, IntelView } from "@/lib/intel";
import type { CveEvent } from "@/lib/types";
import { Badge } from "./ui/badge";
import { ExternalLink } from "./ui/external-link";
import { Panel } from "./ui/panel";
import { toneText } from "./ui/tone";

const SECTION = "text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500";

export function IncidentDetail({ groups, index = 0 }: { groups: IncidentGroupView[]; index?: number }) {
  if (groups.length === 0) {
    return (
      <Panel index={index} eyebrow="Incident" icon={<Siren size={11} weight="bold" />} title="No incident yet">
        <p className="max-w-[60ch] text-sm leading-relaxed text-zinc-500">
          When a CVE matches the inventory, the research, the decision for every service and the fix PRs show up here.
        </p>
      </Panel>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      {groups.map((group, i) => (
        <IncidentPanel key={group.component} group={group} index={index + i} />
      ))}
    </div>
  );
}

function IncidentPanel({ group, index }: { group: IncidentGroupView; index: number }) {
  return (
    <Panel
      index={index}
      eyebrow="Incident"
      icon={<Siren size={11} weight="bold" />}
      title={
        <span className="flex flex-wrap items-center gap-2.5">
          {group.title}
          <Badge tone={group.status.tone}>{group.status.label}</Badge>
        </span>
      }
      subtitle={`${group.cveIds.join(", ") || "CVE ids pending"} · ${group.affectedCount} affected ${group.affectedCount === 1 ? "service" : "services"}`}
    >
      <div className="flex flex-col gap-8">
        <Timing group={group} />
        <Decisions rows={group.rows} />
        {group.intel ? (
          <IntelSection intel={group.intel} fetchedAt={group.intelFetchedAt} fromCache={group.intelFromCache} />
        ) : (
          <p className="text-xs text-zinc-500">Threat intel not available yet.</p>
        )}
        {group.cves.length > 0 && <MatchedCves cves={group.cves} />}
      </div>
    </Panel>
  );
}

function Stat({ label, value, detail }: { label: string; value: ReactNode; detail?: ReactNode }) {
  return (
    <div className="min-w-0 py-1 md:px-5 md:first:pl-0">
      <div className={SECTION}>{label}</div>
      <div className="mt-1.5 font-mono text-2xl font-medium tabular-nums tracking-tight text-zinc-50">{value}</div>
      {detail && <div className="mt-1 text-[11px] text-zinc-500">{detail}</div>}
    </div>
  );
}

function Timing({ group }: { group: IncidentGroupView }) {
  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-4 md:gap-0 md:divide-x md:divide-white/5">
      <Stat label="CVE received" value={formatClock(group.cveReceivedAt)} detail="replayed NVD feed" />
      <Stat label="Incident opened" value={formatDuration(group.timeToOpenMs)} detail="after the CVE arrived" />
      <Stat
        label="Time to mitigate"
        value={formatDuration(group.timeToMitigateMs)}
        detail={group.firstMitigatedAt ? `at ${formatClock(group.firstMitigatedAt)}` : "not mitigated yet"}
      />
      <Stat label="Time to resolve" value={formatDuration(group.timeToResolveMs)} detail={group.resolveDetail} />
    </div>
  );
}

function Decisions({ rows }: { rows: IncidentRowView[] }) {
  return (
    <div>
      <h3 className={SECTION}>Decision per service</h3>
      <ul className="mt-2 divide-y divide-white/5">
        {rows.map((row) => (
          <li key={row.id} className="grid gap-3 py-4 text-xs md:grid-cols-[150px_minmax(0,1fr)]">
            <div className="flex items-baseline gap-3 md:flex-col md:gap-1">
              <span className="text-sm font-medium text-zinc-100">{row.service}</span>
              <span className={`font-mono text-2xl font-medium tabular-nums tracking-tight ${toneText[row.band?.tone ?? "neutral"]}`}>
                {row.score ?? "-"}
              </span>
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {row.band && <Badge tone={row.band.tone}>{row.band.label}</Badge>}
                {row.status && <Badge tone={row.status.tone}>{row.status.label}</Badge>}
                {row.prUrl && (
                  <ExternalLink href={row.prUrl} className="text-signal-300">
                    {prLabel(row.prUrl)}
                  </ExternalLink>
                )}
                {row.receivedToMitigatedMs !== null && (
                  <span className="text-zinc-500">mitigated {formatDuration(row.receivedToMitigatedMs)} after the CVE</span>
                )}
                {row.receivedToResolvedMs !== null && (
                  <span className="text-zinc-500">resolved {formatDuration(row.receivedToResolvedMs)} after the CVE</span>
                )}
              </div>
              {row.explanation && <p className="mt-2 leading-relaxed text-zinc-300">{row.explanation}</p>}
              {row.remediation && <Remediation remediation={row.remediation} />}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Check({ ok, label }: { ok: boolean | null; label: string }) {
  if (ok === null) return null;
  return (
    <span className={`inline-flex items-center gap-1 ${ok ? "text-emerald-300" : "text-amber-300"}`}>
      {ok ? <CheckCircle size={13} weight="fill" /> : <WarningCircle size={13} weight="fill" />}
      {label}
    </span>
  );
}

function Remediation({ remediation }: { remediation: RemediationView }) {
  return (
    <div className="mt-3 rounded-xl bg-black/20 px-3 py-2.5 ring-1 ring-inset ring-white/5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="text-zinc-500">Remediation</span>
        {remediation.targetVersion && (
          <span className="text-zinc-100">
            target <span className="font-mono">{remediation.targetVersion}</span>
          </span>
        )}
        <Check ok={remediation.fixVerified} label="official fix verified" />
        <Check ok={remediation.dockerTagVerified} label="Docker tag exists" />
      </div>
      {remediation.filesChanged.length > 0 && (
        <p className="mt-1.5 break-words font-mono text-[11px] text-zinc-400">{remediation.filesChanged.join("  ·  ")}</p>
      )}
      {remediation.notes && <p className="mt-1.5 text-zinc-500">{remediation.notes}</p>}
    </div>
  );
}

function LinkList({ links }: { links: IntelLink[] }) {
  return (
    <ul className="space-y-1.5">
      {links.map((link, index) => (
        <li key={`${link.url ?? link.label}-${index}`} className="break-words leading-relaxed">
          {link.url ? (
            <ExternalLink href={link.url} className="text-zinc-300">
              {link.label}
            </ExternalLink>
          ) : (
            <span className="text-zinc-300">{link.label}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function IntelBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <h4 className="text-[11px] font-medium text-zinc-400">{title}</h4>
      <div className="mt-1.5 text-xs">{children}</div>
    </div>
  );
}

function IntelSection({ intel, fetchedAt, fromCache }: { intel: IntelView; fetchedAt: string | null; fromCache: boolean }) {
  const exploitation =
    intel.exploitationReported === null ? "unknown" : intel.exploitationReported ? "reported" : "not reported";
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className={SECTION}>Threat intel</h3>
        <span className="text-[11px] text-zinc-600">researched {formatDateTime(fetchedAt)}</span>
        {fromCache && <Badge tone="neutral">served from cache</Badge>}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Badge tone="danger">CVSS {intel.cvss ?? "?"}</Badge>
        <Badge tone={intel.exploitationReported ? "danger" : "neutral"}>Exploitation {exploitation}</Badge>
        {intel.highRiskRuntimeModes.map((mode) => (
          <Badge key={mode} tone="warning">
            High risk: {mode}
          </Badge>
        ))}
      </div>

      <div className="mt-5 grid gap-6 lg:grid-cols-2">
        {intel.fixedVersions.length > 0 && (
          <IntelBlock title="Official fixes per branch">
            <table className="w-full">
              <tbody className="divide-y divide-white/5">
                {intel.fixedVersions.map((fix) => (
                  <tr key={fix.branch}>
                    <td className="py-1.5 pr-3 font-mono text-zinc-500">{fix.branch}</td>
                    <td className="py-1.5 pr-3 font-mono text-zinc-100">{fix.version ?? "?"}</td>
                    <td className="py-1.5 text-right">
                      {fix.source && (
                        <ExternalLink href={fix.source} className="text-zinc-500">
                          source
                        </ExternalLink>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(intel.unsupportedBranches.length > 0 || intel.minSupportedBranch) && (
              <p className="mt-2 text-zinc-500">
                No official fix:{" "}
                {intel.unsupportedBranches.length > 0
                  ? intel.unsupportedBranches.join(", ")
                  : `branches older than ${intel.minSupportedBranch}`}
              </p>
            )}
          </IntelBlock>
        )}

        {intel.exploitationEvidence.length > 0 && (
          <IntelBlock title="Exploitation evidence">
            <LinkList links={intel.exploitationEvidence} />
          </IntelBlock>
        )}

        {intel.conflicts.length > 0 && (
          <IntelBlock title="Conflicting sources">
            <ul className="space-y-2">
              {intel.conflicts.map((conflict, index) => (
                <li key={`${conflict.summary}-${index}`} className="rounded-xl bg-amber-400/[0.05] px-3 py-2 text-amber-200 ring-1 ring-inset ring-amber-400/15">
                  {conflict.summary}
                  {conflict.links.length > 0 && (
                    <div className="mt-1.5">
                      <LinkList links={conflict.links} />
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </IntelBlock>
        )}

        {intel.sources.length > 0 && (
          <IntelBlock title={`Sources (${intel.sources.length})`}>
            <LinkList links={intel.sources} />
          </IntelBlock>
        )}
      </div>
    </div>
  );
}

function MatchedCves({ cves }: { cves: CveEvent[] }) {
  return (
    <details className="rounded-2xl bg-white/[0.02] text-xs ring-1 ring-inset ring-white/5">
      <summary className="cursor-pointer list-none px-4 py-3 text-zinc-400 transition-colors duration-300 hover:text-zinc-100">
        Matched CVEs ({cves.length})
      </summary>
      <ul className="space-y-3 border-t border-white/5 px-4 py-3">
        {cves.map((cve) => (
          <li key={cve.id}>
            <div className="flex flex-wrap items-center gap-2">
              <ExternalLink href={`https://nvd.nist.gov/vuln/detail/${encodeURIComponent(cve.cve_id)}`} className="font-mono text-zinc-100">
                {cve.cve_id}
              </ExternalLink>
              {cve.cvss !== null && <Badge tone="danger">{`CVSS ${cve.cvss}${cve.cvss_version ? ` (v${cve.cvss_version})` : ""}`}</Badge>}
              <span className="text-zinc-600">received {formatClock(cve.received_at)}</span>
            </div>
            <p className="mt-1.5 leading-relaxed text-zinc-300">{cve.description}</p>
          </li>
        ))}
      </ul>
    </details>
  );
}
