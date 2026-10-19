/**
 * Login throttling: 10 failed attempts per 15 minutes per client address and per account, counted
 * in memory (per instance; a WAF rule is still recommended at the edge). Successful logins clear
 * the account's counter.
 */
const WINDOW_MS = 15 * 60_000;
const LIMIT = 10;
const failures = new Map<string, number[]>();

function prune(key: string, now: number) {
  const list = (failures.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length) failures.set(key, list); else failures.delete(key);
  return list;
}

export function loginBlocked(ip: string | null, email: string, now = Date.now()): { blocked: boolean; retryAfterSeconds: number } {
  const keys = [`ip:${ip ?? "unknown"}`, `acct:${email.toLowerCase()}`];
  let retry = 0;
  for (const k of keys) {
    const list = prune(k, now);
    if (list.length >= LIMIT) retry = Math.max(retry, Math.ceil((WINDOW_MS - (now - list[0])) / 1000));
  }
  return { blocked: retry > 0, retryAfterSeconds: retry };
}

export function recordLoginFailure(ip: string | null, email: string, now = Date.now()) {
  for (const k of [`ip:${ip ?? "unknown"}`, `acct:${email.toLowerCase()}`]) failures.set(k, [...prune(k, now), now]);
}

export function clearLoginFailures(email: string) { failures.delete(`acct:${email.toLowerCase()}`); }

/** For tests. */
export function _resetThrottle() { failures.clear(); }
