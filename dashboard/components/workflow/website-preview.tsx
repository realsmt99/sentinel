import type { Tone } from "@/lib/labels";
import type { SiteCheck } from "@/lib/types";
import type { WorkflowView } from "@/lib/workflow";
import { Tag } from "../stage/tag";

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function verdict(check: SiteCheck | null, site: WorkflowView["site"]): { label: string; tone: Tone; down: boolean } {
  if (check?.maintenance) return { label: "Stopped by Guard", tone: "danger", down: true };
  if (check && check.status === null) return { label: "Unreachable", tone: "danger", down: true };
  if (check && check.status !== null && check.status >= 500) return { label: "Down", tone: "danger", down: true };
  if (check && check.status !== null && check.status < 400) return { label: "Online", tone: "success", down: false };
  if (site.state === "restoring") return { label: "Restoring", tone: "info", down: true };
  return site.state === "offline" ? { label: "Stopped by Guard", tone: "danger", down: true } : { label: "Checking", tone: "muted", down: false };
}

/** The protected website, framed live and checked over HTTP every 2s, the way a visitor sees it. */
export function WebsitePreview({ site, check, tall = false }: { site: WorkflowView["site"]; check: SiteCheck | null; tall?: boolean }) {
  const v = verdict(check, site);
  const version = check?.phpVersion ?? (check?.maintenance ? null : site.version);
  return (
    <figure
      className={`overflow-hidden rounded-xl border bg-white transition-colors duration-700 ease-out-expo ${v.down ? "border-pale-red-ink/30" : "border-line"}`}
    >
      <div className="flex items-center gap-3 border-b border-line px-3.5 py-2.5">
        <span className="flex gap-1.5" aria-hidden>
          <span className="size-2.5 rounded-full bg-line" />
          <span className="size-2.5 rounded-full bg-line" />
          <span className="size-2.5 rounded-full bg-line" />
        </span>
        <span className="min-w-0 flex-1 truncate rounded-md bg-bone-100 px-3 py-1 font-mono text-[11px] text-mute">{hostOf(site.url)}</span>
        <Tag tone={v.tone} pulse={v.down}>
          {v.label}
        </Tag>
      </div>
      <div className={`relative overflow-hidden bg-bone-50 ${tall ? "aspect-[16/9]" : "aspect-[16/7]"}`}>
        <iframe
          key={`${check?.maintenance ?? site.state}-${check?.phpVersion ?? site.version}`}
          src={site.url}
          title={`Live view of ${site.service}`}
          className="absolute left-0 top-0 h-[200%] w-[200%] origin-top-left scale-50 border-0"
        />
      </div>
      <figcaption className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-3.5 py-2 font-mono text-[11px] text-mute">
        <span>
          GET / →{" "}
          <span className={check?.status && check.status < 400 ? "text-pale-green-ink" : "text-pale-red-ink"}>
            {check ? (check.status ?? "no answer") : "..."}
          </span>
          {check ? ` · ${check.ms} ms` : ""}
          {check?.maintenance ? " · maintenance page" : ""}
        </span>
        <span>{version ? `${site.service} · PHP ${version}` : site.service}</span>
      </figcaption>
    </figure>
  );
}
