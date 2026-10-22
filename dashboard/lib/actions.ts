import { isFeedStreaming } from "./funnel";
import { serviceStatus, type Tone } from "./labels";
import type { ActionName, DashboardState, Service } from "./types";

// POSTs to the agent return right away and the work happens in the background, so an action stays
// "waiting" until its effect shows up in the polled state (or a timeout passes).

export type ActionPhase =
  | { kind: "sending"; at: number }
  | { kind: "waiting"; at: number }
  | { kind: "failed"; at: number; message: string };

export type ActionStatus =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "waiting" }
  | { kind: "stalled"; message: string }
  | { kind: "failed"; message: string };

export interface ActionButton {
  key: string;
  name: ActionName;
  service: string | null;
  label: string;
  busyLabel: string;
  /** Label shown after a first click; a second click confirms. */
  confirmLabel: string | null;
  enabled: boolean;
  emphasis: boolean;
  hint: string | null;
}

export interface ActionControl {
  button: ActionButton;
  busy: boolean;
  disabled: boolean;
  message: { tone: Tone; text: string } | null;
}

export interface ActionControls {
  connect: ActionControl;
  replay: ActionControl;
  restore: ActionControl;
  reset: ActionControl;
  newRun: ActionControl;
  /** Restore control per service name, for services that are offline or restoring. */
  restoreByService: Record<string, ActionControl>;
}

const WAIT_TIMEOUT_MS: Record<ActionName, number> = {
  connect: 30_000,
  replay: 20_000,
  restore: 90_000,
  // Both reset the target containers and the GitHub repo before the state changes.
  reset: 120_000,
  newrun: 120_000,
};
/** Tolerance between the browser clock (click time) and the database clock (run start). */
const CLOCK_SKEW_MS = 5_000;
const MESSAGE_TTL_MS = 10_000;

export function actionKey(name: ActionName, service?: string | null): string {
  return service ? `${name}:${service}` : name;
}

function effectVisible(name: ActionName, service: string | null, state: DashboardState, clickedAt: number): boolean {
  switch (name) {
    case "connect":
      return state.services.length > 0;
    case "replay":
      return state.funnel.total > 0;
    case "restore":
      return state.services.find((s) => s.name === service)?.status !== "OFFLINE";
    case "reset":
      return (
        state.funnel.total === 0 &&
        state.incidents.length === 0 &&
        state.agentRuns.length === 0 &&
        state.services.every((s) => s.status === "HEALTHY")
      );
    case "newrun":
      return state.run !== null && Date.parse(state.run.started_at) > clickedAt - CLOCK_SKEW_MS && state.chat.length > 0;
  }
}

function waitingText(button: ActionButton): string {
  switch (button.name) {
    case "connect":
      return "Guard is scanning Docker for labelled services...";
    case "replay":
      return "Replay accepted, waiting for the first CVEs...";
    case "restore":
      return `Restoring ${button.service} on the patched image...`;
    case "reset":
      return "Disconnecting: saving this run to history and resetting...";
    case "newrun":
      return "Saving this run to history and starting a new one...";
  }
}

export function resolveActionStatus(
  phase: ActionPhase | undefined,
  button: ActionButton,
  state: DashboardState,
  nowMs: number,
): ActionStatus {
  if (!phase) return { kind: "idle" };
  const age = nowMs - phase.at;
  switch (phase.kind) {
    case "sending":
      return { kind: "sending" };
    case "failed":
      return age < MESSAGE_TTL_MS ? { kind: "failed", message: phase.message } : { kind: "idle" };
    case "waiting": {
      if (effectVisible(button.name, button.service, state, phase.at)) return { kind: "idle" };
      const timeout = WAIT_TIMEOUT_MS[button.name];
      if (age < timeout) return { kind: "waiting" };
      if (age < timeout + MESSAGE_TTL_MS) {
        return {
          kind: "stalled",
          message: `Guard accepted "${button.name}" but nothing changed after ${timeout / 1000}s - check the agent trace.`,
        };
      }
      return { kind: "idle" };
    }
  }
}

function restoreButton(service: Service | null): ActionButton {
  const name = service?.name ?? "shop";
  let label = `Approve and restore ${name}`;
  let hint: string | null = null;
  if (!service) hint = "No service is offline";
  else if (service.status === "RESTORING") label = `Restoring ${name}...`;
  else if (service.status !== "OFFLINE") hint = `${name} is ${serviceStatus(service.status).label.toLowerCase()}`;

  return {
    key: actionKey("restore", name),
    name: "restore",
    service: name,
    label,
    busyLabel: `Restoring ${name}...`,
    confirmLabel: null,
    enabled: service?.status === "OFFLINE",
    emphasis: service?.status === "OFFLINE",
    hint,
  };
}

function buildButtons(state: DashboardState, dbNowMs: number) {
  const connected = state.services.length > 0;
  const total = state.funnel.total;
  const restoreTarget =
    state.services.find((s) => s.status === "OFFLINE") ??
    state.services.find((s) => s.status === "RESTORING") ??
    state.services.find((s) => s.name === "shop") ??
    null;

  let replayLabel = "Replay 21 Oct feed";
  let replayHint: string | null = null;
  if (!connected) replayHint = "Connect a system first";
  else if (total > 0) {
    replayLabel = isFeedStreaming(state, dbNowMs) ? `Replaying... ${total} received` : `Feed replayed (${total})`;
    replayHint = "Reset the demo to replay again";
  }

  const connect: ActionButton = {
    key: actionKey("connect"),
    name: "connect",
    service: null,
    label: connected ? "Re-scan system" : "Connect Guard",
    busyLabel: connected ? "Scanning..." : "Connecting...",
    confirmLabel: null,
    enabled: true,
    emphasis: !connected,
    hint: connected ? `${state.services.length} services discovered` : null,
  };
  const replay: ActionButton = {
    key: actionKey("replay"),
    name: "replay",
    service: null,
    label: replayLabel,
    busyLabel: "Starting replay...",
    confirmLabel: null,
    enabled: connected && total === 0,
    emphasis: connected && total === 0,
    hint: replayHint,
  };
  const reset: ActionButton = {
    key: actionKey("reset"),
    name: "reset",
    service: null,
    label: "Disconnect",
    busyLabel: "Disconnecting...",
    confirmLabel: "Click again to disconnect",
    enabled: true,
    emphasis: false,
    hint: "Saves this run to history, resets the demo and goes back to the connect form",
  };
  const newRun: ActionButton = {
    key: actionKey("newrun"),
    name: "newrun",
    service: null,
    label: "New run",
    busyLabel: "Starting...",
    confirmLabel: null,
    enabled: connected,
    emphasis: false,
    hint: "Saves this run to history and starts again, still connected",
  };
  return { connect, replay, restore: restoreButton(restoreTarget), reset, newRun };
}

export function buildActionControls(
  state: DashboardState,
  phases: Record<string, ActionPhase>,
  nowMs: number,
  dbNowMs: number,
): ActionControls {
  const buttons = buildButtons(state, dbNowMs);
  const statusOf = (button: ActionButton) => resolveActionStatus(phases[button.key], button, state, nowMs);
  const resetStatus = statusOf(buttons.reset);
  // While any request is in flight, or a reset is settling, nothing else can be clicked.
  const locked =
    Object.values(phases).some((phase) => phase.kind === "sending") ||
    resetStatus.kind === "sending" ||
    resetStatus.kind === "waiting";

  const toControl = (button: ActionButton): ActionControl => {
    const status = statusOf(button);
    const busy = status.kind === "sending" || status.kind === "waiting";
    const message =
      status.kind === "failed"
        ? { tone: "danger" as const, text: `${button.label}: ${status.message}` }
        : status.kind === "stalled"
          ? { tone: "warning" as const, text: status.message }
          : status.kind === "waiting"
            ? { tone: "info" as const, text: waitingText(button) }
            : null;
    return { button, busy, disabled: !button.enabled || busy || locked, message };
  };

  const restoreByService = Object.fromEntries(
    state.services
      .filter((s) => s.status === "OFFLINE" || s.status === "RESTORING")
      .map((s) => [s.name, toControl(restoreButton(s))]),
  );

  return {
    connect: toControl(buttons.connect),
    replay: toControl(buttons.replay),
    restore: toControl(buttons.restore),
    reset: toControl(buttons.reset),
    newRun: toControl(buttons.newRun),
    restoreByService,
  };
}
