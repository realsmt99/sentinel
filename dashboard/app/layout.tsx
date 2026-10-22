import type { Metadata } from "next";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import { Instrument_Serif } from "next/font/google";
import "./globals.css";

const serif = Instrument_Serif({ weight: "400", subsets: ["latin"], variable: "--font-instrument-serif", display: "swap" });

export const metadata: Metadata = {
  title: "Guard",
  description: "Guard: CVE feed to agent team to contained, patched services",
};

const GRAIN =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full antialiased ${GeistSans.variable} ${GeistMono.variable} ${serif.variable}`}>
      <body className="min-h-[100dvh] bg-ink-950 font-sans text-zinc-100 selection:bg-signal-400/30">
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
          <div className="absolute -left-[20%] -top-[30%] h-[70vh] w-[70vw] rounded-full bg-signal-400/[0.07] blur-[140px]" />
          <div className="absolute -bottom-[35%] -right-[15%] h-[70vh] w-[60vw] rounded-full bg-sky-400/[0.04] blur-[160px]" />
        </div>
        {children}
        <div aria-hidden className="pointer-events-none fixed inset-0 z-50 opacity-[0.035]" style={{ backgroundImage: GRAIN }} />
      </body>
    </html>
  );
}
