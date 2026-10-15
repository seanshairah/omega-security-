/**
 * Pure call state machine. Android sends several events for one call (RINGING, ANSWERED,
 * ENDED, sometimes out of order when the queue drains after an outage). This reducer turns
 * the current record plus one event into the next record, never regressing a finished call.
 * No database access, so it is unit-tested directly.
 */
import type { CallDirection, CallStatus } from "@prisma/client";

export const CALL_EVENT_TYPES = ["CALL_STARTED", "CALL_ANSWERED", "CALL_ENDED", "CALL_MISSED"] as const;
export const DEVICE_EVENT_TYPES = ["DEVICE_ONLINE", "DEVICE_OFFLINE"] as const;
export type CallEventType = (typeof CALL_EVENT_TYPES)[number];
export type DeviceEventType = (typeof DEVICE_EVENT_TYPES)[number];
export type GatewayEventType = CallEventType | DeviceEventType;

export type IncomingGatewayEvent = {
  eventId: string;
  eventType: GatewayEventType;
  callId?: string;
  phoneNumber?: string;
  direction?: CallDirection;
  timestamp: string | Date;
  /** Device-measured seconds of talk time, when it knows (from the call log). */
  durationSeconds?: number;
  /** Device's own verdict for CALL_ENDED when it read the system call log. */
  answered?: boolean;
  meta?: Record<string, unknown>;
};

export type CallState = {
  direction: CallDirection;
  status: CallStatus;
  startedAt: Date;
  answeredAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
};

export const TERMINAL: CallStatus[] = ["MISSED", "ENDED", "FAILED"];

export function isTerminal(status: CallStatus): boolean {
  return TERMINAL.includes(status);
}

/** Clamp a device clock into a sane window around the server clock. */
export function saneTimestamp(ts: string | Date, now = new Date()): Date {
  const d = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(d.getTime())) return now;
  const min = now.getTime() - 7 * 24 * 3600_000;
  const max = now.getTime() + 5 * 60_000;
  return new Date(Math.min(max, Math.max(min, d.getTime())));
}

/** First state for a call whose first event we see is `ev`. */
export function initialCallState(ev: IncomingGatewayEvent, at: Date): CallState {
  const direction: CallDirection = ev.direction === "OUTGOING" ? "OUTGOING" : "INCOMING";
  const base: CallState = { direction, status: "RINGING", startedAt: at, answeredAt: null, endedAt: null, durationSeconds: null };
  return reduceCall(base, ev, at);
}

/** Apply one event to a call. Returns the same object when nothing changes. */
export function reduceCall(state: CallState, ev: IncomingGatewayEvent, at: Date): CallState {
  switch (ev.eventType) {
    case "CALL_STARTED": {
      if (isTerminal(state.status) || state.status === "ANSWERED") return state; // late duplicate
      return { ...state, startedAt: at < state.startedAt ? at : state.startedAt, status: "RINGING" };
    }
    case "CALL_ANSWERED": {
      if (isTerminal(state.status)) return state.answeredAt ? state : { ...state, answeredAt: at };
      return { ...state, status: "ANSWERED", answeredAt: state.answeredAt ?? at };
    }
    case "CALL_MISSED": {
      if (state.status === "ENDED" || state.status === "FAILED") return state;
      return { ...state, status: "MISSED", endedAt: state.endedAt ?? at, durationSeconds: 0 };
    }
    case "CALL_ENDED": {
      if (isTerminal(state.status) && state.durationSeconds !== null) return state;
      const answered = ev.answered ?? (state.status === "ANSWERED" || state.answeredAt !== null || (ev.durationSeconds ?? 0) > 0);
      const endedAt = state.endedAt ?? at;
      if (!answered) {
        return { ...state, status: state.direction === "INCOMING" ? "MISSED" : "FAILED", endedAt, durationSeconds: 0 };
      }
      const answeredAt = state.answeredAt ?? (ev.durationSeconds != null ? new Date(endedAt.getTime() - ev.durationSeconds * 1000) : state.startedAt);
      const duration = ev.durationSeconds ?? Math.max(0, Math.round((endedAt.getTime() - answeredAt.getTime()) / 1000));
      return { ...state, status: "ENDED", answeredAt, endedAt, durationSeconds: duration };
    }
    default:
      return state;
  }
}

export function fmtCallDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const CALL_STATUS_META: Record<CallStatus, { label: string; tone: "ok" | "warn" | "critical" | "neutral" | "info" | "muted" }> = {
  RINGING: { label: "Ringing", tone: "info" },
  ANSWERED: { label: "Answered", tone: "ok" },
  ENDED: { label: "Completed", tone: "ok" },
  MISSED: { label: "Missed", tone: "critical" },
  FAILED: { label: "Not answered", tone: "warn" },
  UNKNOWN: { label: "Unknown", tone: "muted" },
};
