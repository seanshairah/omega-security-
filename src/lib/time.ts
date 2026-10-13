import { format, formatDistanceToNowStrict, differenceInMinutes } from "date-fns";

export const TZ = process.env.TIMEZONE || "Africa/Harare";

export function fmtTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return format(new Date(d), "HH:mm");
}
export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return format(new Date(d), "d MMM yyyy");
}
export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return format(new Date(d), "d MMM yyyy · HH:mm");
}
export function fmtShort(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return format(new Date(d), "d MMM HH:mm");
}
export function ago(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return formatDistanceToNowStrict(new Date(d), { addSuffix: true });
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
export function dateInputValue(d: Date): string {
  return format(d, "yyyy-MM-dd");
}
export function timeInputValue(d: Date): string {
  return format(d, "HH:mm");
}
/** Combine a yyyy-MM-dd date and HH:mm time (local server time) into a Date. */
export function combineDateTime(date: string, time: string): Date {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  return new Date(y, mo - 1, d, h, mi, 0, 0);
}
export function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
export function endOfToday(): Date {
  const d = new Date();
  d.setHours(23, 59, 59, 999);
  return d;
}
