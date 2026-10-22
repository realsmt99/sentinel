"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Bell, Check, Cube, Database, GithubLogo, Globe, PlugsConnected, X } from "@phosphor-icons/react";
import type { ActionControl } from "@/lib/actions";
import { Button } from "../ui/button";
import { PASTEL } from "./tag";

export type ConnectionField = "database_url" | "github_repo" | "compose_file" | "target_url" | "ntfy_topic";
export type ConnectionValues = Record<ConnectionField, string>;

const FIELDS: { key: ConnectionField; label: string; hint: string; icon: ReactNode }[] = [
  { key: "database_url", label: "Aiven PostgreSQL", hint: "Inventory, CVE feed, decisions and the event bus", icon: <Database size={16} weight="bold" /> },
  { key: "github_repo", label: "GitHub repository", hint: "Where the fix pull requests are opened", icon: <GithubLogo size={16} weight="bold" /> },
  { key: "compose_file", label: "Docker project", hint: "The docker-compose file of the system to protect", icon: <Cube size={16} weight="bold" /> },
  { key: "target_url", label: "Website", hint: "Checked live, switched to the maintenance page if needed", icon: <Globe size={16} weight="bold" /> },
  { key: "ntfy_topic", label: "Phone alerts", hint: "ntfy topic your phone is subscribed to", icon: <Bell size={16} weight="bold" /> },
];

type TestState = { state: "testing" } | { state: "pass" | "fail"; detail: string };

interface ConnectFormProps {
  control: ActionControl;
  onConnect: (values: ConnectionValues) => void;
}

/** Connect your project: pre-filled with the current connection, every field testable live. */
export function ConnectForm({ control, onConnect }: ConnectFormProps) {
  const [values, setValues] = useState<ConnectionValues | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [tests, setTests] = useState<Partial<Record<ConnectionField, TestState>>>({});

  useEffect(() => {
    let cancelled = false;
    fetch("/api/config", { cache: "no-store" })
      .then((res) => res.json())
      .then((body: Record<string, unknown>) => {
        if (cancelled) return;
        if (body.ok) {
          setValues(Object.fromEntries(FIELDS.map((f) => [f.key, typeof body[f.key] === "string" ? (body[f.key] as string) : ""])) as ConnectionValues);
        } else {
          setLoadError(typeof body.error === "string" ? body.error : "Could not load the current connection");
        }
      })
      .catch((err: unknown) => !cancelled && setLoadError(err instanceof Error ? err.message : String(err)));
    return () => {
      cancelled = true;
    };
  }, []);

  const test = async (field: ConnectionField) => {
    if (!values) return;
    setTests((prev) => ({ ...prev, [field]: { state: "testing" } }));
    let result: TestState;
    try {
      const res = await fetch("/api/config/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ field, value: values[field] }),
      });
      const body = (await res.json()) as { ok: boolean; passed?: boolean; detail?: string; error?: string };
      result = body.ok ? { state: body.passed ? "pass" : "fail", detail: body.detail ?? "" } : { state: "fail", detail: body.error ?? "test failed" };
    } catch (err) {
      result = { state: "fail", detail: err instanceof Error ? err.message : String(err) };
    }
    setTests((prev) => ({ ...prev, [field]: result }));
  };

  if (loadError) {
    return <div className="rounded-xl border border-line bg-white p-6 text-sm text-pale-red-ink">{loadError}</div>;
  }
  if (!values) {
    return <div className="skeleton h-[420px] rounded-xl" />;
  }

  const passed = FIELDS.filter((f) => tests[f.key]?.state === "pass").length;
  return (
    <form
      className="rounded-xl border border-line bg-white"
      onSubmit={(event) => {
        event.preventDefault();
        onConnect(values);
      }}
    >
      <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3.5">
        <div>
          <div className="text-sm font-medium text-ink">Connect your project</div>
          <div className="text-xs text-mute">Pre-filled with the current project. Change any field to protect another one.</div>
        </div>
        <span className="font-mono text-xs text-mute">
          {passed}/{FIELDS.length} tested
        </span>
      </div>

      <ul className="divide-y divide-line">
        {FIELDS.map((field, i) => {
          const result = tests[field.key];
          return (
            <li key={field.key} style={{ animationDelay: `${i * 70}ms` }} className="grid animate-rise gap-2 px-5 py-4 sm:grid-cols-[170px_minmax(0,1fr)]">
              <label htmlFor={field.key} className="flex items-start gap-2.5 pt-2">
                <span className="mt-px text-ink-soft">{field.icon}</span>
                <span>
                  <span className="block text-sm font-medium text-ink">{field.label}</span>
                  <span className="block text-[11px] leading-snug text-mute">{field.hint}</span>
                </span>
              </label>
              <div className="min-w-0">
                <div className="flex gap-2">
                  <input
                    id={field.key}
                    value={values[field.key]}
                    onChange={(event) => {
                      setValues({ ...values, [field.key]: event.target.value });
                      setTests((prev) => ({ ...prev, [field.key]: undefined }));
                    }}
                    spellCheck={false}
                    autoComplete="off"
                    className="min-w-0 flex-1 rounded-md border border-line bg-bone-50 px-3 py-2 font-mono text-[12px] text-ink outline-none transition-colors duration-200 focus:border-ink/30 focus:bg-white"
                  />
                  <button
                    type="button"
                    onClick={() => void test(field.key)}
                    disabled={result?.state === "testing"}
                    className="shrink-0 rounded-md border border-line bg-white px-3 text-xs text-ink-soft transition-[background-color,transform] duration-200 hover:bg-bone-50 active:scale-[0.97] disabled:opacity-50"
                  >
                    Test
                  </button>
                </div>
                <TestLine result={result} />
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
        <button
          type="button"
          onClick={() => FIELDS.forEach((f) => void test(f.key))}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-white px-3 py-2 text-xs text-ink-soft transition-[background-color,transform] duration-200 hover:bg-bone-50 active:scale-[0.97]"
        >
          Test all connections
        </button>
        <div className="flex flex-col items-end gap-1">
          <Button
            theme="light"
            variant="primary"
            busy={control.busy}
            disabled={control.disabled}
            icon={<PlugsConnected size={14} weight="bold" />}
            onClick={() => onConnect(values)}
          >
            {control.busy ? control.button.busyLabel : control.button.label}
          </Button>
          {control.message && <span className={`max-w-xs text-right text-[11px] ${PASTEL[control.message.tone].text}`}>{control.message.text}</span>}
        </div>
      </div>
    </form>
  );
}

function TestLine({ result }: { result: TestState | undefined }) {
  if (!result) return null;
  if (result.state === "testing") {
    return (
      <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-mute">
        <span className="size-1.5 animate-breathe rounded-full bg-pale-blue-ink" />
        Testing...
      </p>
    );
  }
  const pass = result.state === "pass";
  return (
    <p className={`mt-1.5 flex animate-line-in items-start gap-1.5 text-[11px] ${pass ? "text-pale-green-ink" : "text-pale-red-ink"}`}>
      <span className={`mt-px flex size-3.5 shrink-0 items-center justify-center rounded-full ${pass ? "bg-pale-green" : "bg-pale-red"}`}>
        {pass ? <Check size={9} weight="bold" /> : <X size={9} weight="bold" />}
      </span>
      <span className="min-w-0 break-words">{result.detail}</span>
    </p>
  );
}
