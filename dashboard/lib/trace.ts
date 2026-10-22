import { formatClock } from "./format";
import { laneLabel, logLevelTone, type Tone } from "./labels";
import type { LogLine } from "./types";

export interface TraceLine {
  id: number;
  time: string;
  label: string;
  tone: Tone;
  message: string;
}

export function buildTrace(log: LogLine[]): TraceLine[] {
  return log.map((line) => ({
    id: line.id,
    time: formatClock(line.ts),
    label: laneLabel(line.agent, line.service),
    tone: logLevelTone(line.level),
    message: line.message,
  }));
}
