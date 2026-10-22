import type { ReactNode } from "react";
import { safeHttpUrl } from "@/lib/format";

/** Renders plain text when the URL is missing or not http(s). */
export function ExternalLink({ href, className = "", children }: { href: string | null; className?: string; children: ReactNode }) {
  const url = safeHttpUrl(href);
  if (!url) return <span className={className}>{children}</span>;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`underline decoration-white/15 underline-offset-[3px] transition-colors duration-300 hover:text-white hover:decoration-signal-400/60 ${className}`}
    >
      {children}
    </a>
  );
}
