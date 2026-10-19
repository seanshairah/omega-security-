/**
 * Production configuration sanity. Called once at server start (instrumentation.ts) and summarised
 * (count only, never values) by /api/health. Development never blocks; production refuses to start
 * without a real AUTH_SECRET because every session cookie is signed with it.
 */
export type EnvIssue = { key: string; level: "fatal" | "warn"; message: string };

const DEFAULTS = new Set(["change-me", "change-me-to-a-long-random-string-at-least-32-chars", "dev-secret-change-me-dev-secret-change-me"]);

export function checkEnv(env: Record<string, string | undefined> = process.env): EnvIssue[] {
  const prod = env.NODE_ENV === "production";
  const issues: EnvIssue[] = [];
  const secret = env.AUTH_SECRET ?? "";
  // Missing or an example default is fatal in production (sessions would be signed with a public value).
  // A real but short secret only warns, so a deploy never takes a running site down over key length.
  if (!secret || DEFAULTS.has(secret)) issues.push({ key: "AUTH_SECRET", level: prod ? "fatal" : "warn", message: "AUTH_SECRET is unset or the example default; sessions are signed with it. Set a random string of at least 32 characters." });
  else if (secret.length < 32) issues.push({ key: "AUTH_SECRET", level: "warn", message: "AUTH_SECRET is shorter than 32 characters; rotate it to a longer random string." });
  if (!env.DATABASE_URL) issues.push({ key: "DATABASE_URL", level: "fatal", message: "DATABASE_URL is not set." });
  for (const k of ["CRON_SECRET", "AUTOMATION_SECRET"]) if (prod && (!env[k] || DEFAULTS.has(env[k]!))) issues.push({ key: k, level: "warn", message: `${k} is unset or the example default; the automation endpoints accept anyone who knows it.` });
  if (prod && env.SMS_PROVIDER && env.SMS_PROVIDER !== "simulated" && (!env.SMS_WEBHOOK_SECRET || DEFAULTS.has(env.SMS_WEBHOOK_SECRET))) issues.push({ key: "SMS_WEBHOOK_SECRET", level: "warn", message: "SMS_WEBHOOK_SECRET is the example default; inbound SMS webhooks cannot be verified." });
  if (prod && (env.SMS_PROVIDER ?? "simulated") === "simulated") issues.push({ key: "SMS_PROVIDER", level: "warn", message: "SMS_PROVIDER=simulated in production: no real SMS is sent." });
  if (prod && env.NEXT_PUBLIC_APP_URL && !/^https:\/\//.test(env.NEXT_PUBLIC_APP_URL)) issues.push({ key: "NEXT_PUBLIC_APP_URL", level: "warn", message: "NEXT_PUBLIC_APP_URL should be an https:// address; guard phones refuse plain http in release builds." });
  if (prod && env.SIMULATOR_ENABLED === "true") issues.push({ key: "SIMULATOR_ENABLED", level: "warn", message: "The simulator is enabled in production; simulated events land in real data." });
  return issues;
}

/** Simulator and simulated-event API: on outside production, or when SMS is simulated, or when explicitly enabled. */
export function simulatorEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.SIMULATOR_ENABLED === "true") return true;
  if (env.SIMULATOR_ENABLED === "false") return false;
  return env.NODE_ENV !== "production" || (env.SMS_PROVIDER ?? "simulated") === "simulated";
}
