import { formatDistanceToNowStrict, differenceInMinutes } from "date-fns";

/**
 * Every wall-clock conversion in the portal is anchored to the company's own timezone, not to
 * whatever clock the server happens to run on.
 *
 * This used to rely on the host: `new Date(y, m, d, h, mi)` and date-fns `format` both read the
 * process timezone. Vercel runs functions with TZ=:UTC and ignores an override, so an administrator
 * in Harare typing 18:00 produced the instant 18:00Z — 20:00 local. A guard arriving punctually at
 * 18:00 Harare (16:00Z) then measured as 120 minutes *early*, outside the check-in window, which the
 * call check-in depends on.
 *
 * Set TIMEZONE=UTC to keep the previous behaviour exactly; see docs/TIMEZONE.md before doing so,
 * because stored rows and this setting have to agree.
 */
export const TZ = process.env.TIMEZONE || "Africa/Harare";

/** Milliseconds that `tz` is ahead of UTC at this instant (DST included). */
function offsetMs(at: Date, tz: string): number {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(at)) p[part.type] = part.value;
  // `hour` is "24" at midnight under hour12:false in some engines; % 24 normalises it.
  const asIfUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second);
  return asIfUtc - at.getTime();
}

/** The instant at which the clock in `TZ` reads this wall-clock time. */
export function zonedWallClockToInstant(y: number, mo: number, d: number, h: number, mi: number, tz: string = TZ): Date {
  const naive = Date.UTC(y, mo - 1, d, h, mi, 0, 0);
  // Two passes: the first offset is read at the wrong instant near a DST edge, the second corrects it.
  let ts = naive - offsetMs(new Date(naive), tz);
  ts = naive - offsetMs(new Date(ts), tz);
  return new Date(ts);
}

/** The wall-clock fields an instant shows on a clock in `TZ`. */
export function instantToZonedParts(d: Date, tz: string = TZ) {
  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(d)) p[part.type] = part.value;
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour % 24, minute: +p.minute };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n: number) => String(n).padStart(2, "0");
const parse = (d: Date | string): Date | null => {
  const v = d instanceof Date ? d : new Date(d);
  return Number.isNaN(v.getTime()) ? null : v;
};

export function fmtTime(d: Date | string | null | undefined): string {
  const v = d == null ? null : parse(d);
  if (!v) return "—";
  const z = instantToZonedParts(v);
  return `${pad(z.hour)}:${pad(z.minute)}`;
}
export function fmtDate(d: Date | string | null | undefined): string {
  const v = d == null ? null : parse(d);
  if (!v) return "—";
  const z = instantToZonedParts(v);
  return `${z.day} ${MONTHS[z.month - 1]} ${z.year}`;
}
export function fmtDateTime(d: Date | string | null | undefined): string {
  const v = d == null ? null : parse(d);
  if (!v) return "—";
  return `${fmtDate(v)} · ${fmtTime(v)}`;
}
export function fmtShort(d: Date | string | null | undefined): string {
  const v = d == null ? null : parse(d);
  if (!v) return "—";
  const z = instantToZonedParts(v);
  return `${z.day} ${MONTHS[z.month - 1]} ${pad(z.hour)}:${pad(z.minute)}`;
}
export function ago(d: Date | string | null | undefined): string {
  const v = d == null ? null : parse(d);
  if (!v) return "—";
  // Elapsed time is an interval between instants, so it needs no timezone.
  return formatDistanceToNowStrict(v, { addSuffix: true });
}
export function minutesBetween(a: Date, b: Date): number {
  return differenceInMinutes(b, a);
}
export function fmtDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
}
/** yyyy-MM-dd as read in TZ, for a date input. */
export function dateInputValue(d: Date): string {
  const z = instantToZonedParts(d);
  return `${z.year}-${pad(z.month)}-${pad(z.day)}`;
}
/** HH:mm as read in TZ, for a time input. */
export function timeInputValue(d: Date): string {
  const z = instantToZonedParts(d);
  return `${pad(z.hour)}:${pad(z.minute)}`;
}
/** Combine a yyyy-MM-dd date and HH:mm time, both read as wall-clock in TZ. */
export function combineDateTime(date: string, time: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return zonedWallClockToInstant(y, mo, d, h, mi);
}
/** Midnight at the start of today, in TZ. */
export function startOfToday(): Date {
  const z = instantToZonedParts(new Date());
  return zonedWallClockToInstant(z.year, z.month, z.day, 0, 0);
}
/** The last minute of today, in TZ. */
export function endOfToday(): Date {
  const z = instantToZonedParts(new Date());
  return new Date(zonedWallClockToInstant(z.year, z.month, z.day, 23, 59).getTime() + 59_999);
}
