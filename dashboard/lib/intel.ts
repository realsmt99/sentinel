import { displayUrl, safeHttpUrl } from "./format";

// threat_intel.data is written by an LLM agent whose schema may still move: every field is optional
// and accepted in the shapes we have seen or expect (strings, lists, {url, claim} objects, maps).

export interface IntelLink {
  label: string;
  url: string | null;
}

export interface IntelFix {
  branch: string;
  version: string | null;
  source: string | null;
}

export interface IntelConflict {
  summary: string;
  links: IntelLink[];
}

export interface IntelView {
  name: string | null;
  cvss: number | null;
  exploitationReported: boolean | null;
  exploitationEvidence: IntelLink[];
  highRiskRuntimeModes: string[];
  fixedVersions: IntelFix[];
  unsupportedBranches: string[];
  minSupportedBranch: string | null;
  conflicts: IntelConflict[];
  sources: IntelLink[];
}

type Json = Record<string, unknown>;

const KNOWN_KEYS = ["cvss", "fixed_versions", "sources", "exploitation_reported", "conflicts"];
const URL_KEYS = ["url", "source_url", "href", "link", "source"];
const TEXT_KEYS = ["claim", "title", "name", "summary", "description", "text", "quote", "label", "evidence", "note"];

export function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstString(obj: Json, keys: string[]): string | null {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() && !Number.isNaN(Number(value))) return Number(value);
  if (isRecord(value)) return toNumber(value.score ?? value.base_score ?? value.baseScore ?? value.value);
  return null;
}

function toBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const v = value.toLowerCase();
    if (["true", "yes", "reported", "exploited"].includes(v)) return true;
    if (["false", "no", "not observed", "none"].includes(v)) return false;
  }
  return null;
}

function toStringList(value: unknown): string[] {
  if (value === null || value === undefined) return [];
  const items = Array.isArray(value) ? value : [value];
  return items
    .map((item) => {
      if (typeof item === "string" || typeof item === "number") return String(item);
      if (isRecord(item)) return firstString(item, ["branch", "name", "mode", "label", ...TEXT_KEYS]) ?? JSON.stringify(item);
      return null;
    })
    .filter((item): item is string => Boolean(item));
}

export function toLink(item: unknown): IntelLink | null {
  if (typeof item === "string") {
    const url = safeHttpUrl(item);
    return url ? { label: displayUrl(url), url } : { label: item, url: null };
  }
  if (!isRecord(item)) return null;
  let url: string | null = null;
  for (const key of URL_KEYS) {
    url = safeHttpUrl(item[key]);
    if (url) break;
  }
  const label = firstString(item, TEXT_KEYS) ?? (url ? displayUrl(url) : null);
  return label ? { label, url } : null;
}

function toLinks(value: unknown): IntelLink[] {
  if (value === null || value === undefined) return [];
  const items = Array.isArray(value) ? value : [value];
  return items.map(toLink).filter((link): link is IntelLink => link !== null);
}

function toFixes(value: unknown): IntelFix[] {
  const entries: [string, unknown][] = Array.isArray(value)
    ? value.filter(isRecord).map((item) => [String(item.branch ?? item.version ?? "?"), item])
    : isRecord(value)
      ? Object.entries(value)
      : [];

  return entries
    .map(([branch, fix]) => {
      if (typeof fix === "string" || typeof fix === "number") return { branch, version: String(fix), source: null };
      if (!isRecord(fix)) return { branch, version: null, source: null };
      const version = fix.version ?? fix.fixed_version ?? fix.fixed;
      const source = URL_KEYS.map((key) => safeHttpUrl(fix[key])).find(Boolean) ?? null;
      return { branch, version: version === undefined || version === null ? null : String(version), source };
    })
    .sort((a, b) => b.branch.localeCompare(a.branch, "en", { numeric: true }));
}

function toConflicts(value: unknown): IntelConflict[] {
  if (value === null || value === undefined) return [];
  const items = Array.isArray(value) ? value : [value];
  return items
    .map((item): IntelConflict | null => {
      if (typeof item === "string") return { summary: item, links: [] };
      if (!isRecord(item)) return null;
      const summary =
        firstString(item, ["summary", "description", "topic", "claim", "conflict", "text", "note", "title"]) ??
        Object.entries(item)
          .filter(([, v]) => typeof v === "string")
          .map(([k, v]) => `${k}: ${v}`)
          .join(" · ");
      const links = [
        ...toLinks(item.sources ?? item.positions ?? item.claims ?? item.evidence),
        ...URL_KEYS.map((key) => safeHttpUrl(item[key]))
          .filter((url): url is string => Boolean(url))
          .map((url) => ({ label: displayUrl(url), url })),
      ];
      return summary ? { summary, links } : null;
    })
    .filter((conflict): conflict is IntelConflict => conflict !== null);
}

function unwrap(data: unknown): Json | null {
  let value = data;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!isRecord(value)) return null;
  if (KNOWN_KEYS.some((key) => key in value)) return value;
  const nested = Object.values(value).find((v) => isRecord(v) && KNOWN_KEYS.some((key) => key in v));
  return isRecord(nested) ? nested : value;
}

export function parseThreatIntel(data: unknown): IntelView | null {
  const root = unwrap(data);
  if (!root) return null;
  const minSupported = root.min_supported_branch;
  return {
    name: firstString(root, ["name", "advisory", "title", "nickname"]),
    cvss: toNumber(root.cvss),
    exploitationReported: toBoolean(root.exploitation_reported),
    exploitationEvidence: toLinks(root.exploitation_evidence),
    highRiskRuntimeModes: toStringList(root.high_risk_runtime_modes),
    fixedVersions: toFixes(root.fixed_versions),
    unsupportedBranches: toStringList(root.unsupported_branches),
    minSupportedBranch:
      typeof minSupported === "string" || typeof minSupported === "number" ? String(minSupported) : null,
    conflicts: toConflicts(root.conflicts),
    sources: toLinks(root.sources),
  };
}
