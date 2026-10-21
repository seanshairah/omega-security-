/**
 * Which shift a guard's phone should monitor. Pure; the config endpoint uses it, and so must
 * anything that has to agree with the phone.
 *
 * The phone treats a shift as active from 10 minutes before its start to 30 minutes after its end
 * (ShiftConfig.isActiveAt). This picks with the same window, so the phone and the server never
 * disagree about "the current shift":
 *
 *   1. a shift in progress (start <= now <= end); with back-to-back shifts, the one that started last
 *   2. one about to start (inside its 10 minutes before) over one just ended (inside its 30 after)
 *   3. otherwise the next one to start
 *
 * Before this, the endpoint sent the earliest unclosed shift that ended within 60 minutes. With two
 * shifts in a row and the first not yet closed, the phone got the first, judged it over, and showed
 * "No shift" while a shift was running.
 */
export const DEVICE_SHIFT_WINDOW = { beforeMinutes: 10, afterMinutes: 30 } as const;

export type ShiftTimes = { id: string; startAt: Date; endAt: Date };

export function selectDeviceShift<T extends ShiftTimes>(shifts: T[], now: Date): T | null {
  const t = now.getTime();
  const before = DEVICE_SHIFT_WINDOW.beforeMinutes * 60_000;
  const after = DEVICE_SHIFT_WINDOW.afterMinutes * 60_000;
  const inProgress = shifts.filter((s) => s.startAt.getTime() <= t && t <= s.endAt.getTime());
  if (inProgress.length) return inProgress.reduce((a, b) => (b.startAt > a.startAt ? b : a));
  const starting = shifts.filter((s) => s.startAt.getTime() > t && s.startAt.getTime() - before <= t);
  if (starting.length) return starting.reduce((a, b) => (b.startAt < a.startAt ? b : a));
  const ended = shifts.filter((s) => s.endAt.getTime() < t && t <= s.endAt.getTime() + after);
  if (ended.length) return ended.reduce((a, b) => (b.endAt > a.endAt ? b : a));
  const upcoming = shifts.filter((s) => s.startAt.getTime() > t);
  return upcoming.length ? upcoming.reduce((a, b) => (b.startAt < a.startAt ? b : a)) : null;
}
