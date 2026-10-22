/** Sentinel mark: a shield with a scan line and a watching core. */
export function LogoMark({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" aria-hidden className={className}>
      <path
        d="M16 3.5 L26.5 8 V15.6 C26.5 21.9 22.2 26.8 16 28.6 C9.8 26.8 5.5 21.9 5.5 15.6 V8 Z"
        className="stroke-signal-400"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M10 16 H22" className="stroke-signal-400" strokeWidth="1.6" strokeLinecap="round" opacity="0.45" />
      <circle cx="16" cy="16" r="2.9" className="fill-signal-400" />
    </svg>
  );
}
