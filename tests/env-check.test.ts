import { test } from "node:test";
import assert from "node:assert/strict";
import { checkEnv, simulatorEnabled } from "../src/lib/env-check";
import { loginBlocked, recordLoginFailure, clearLoginFailures, _resetThrottle } from "../src/lib/auth/throttle";

const base = { DATABASE_URL: "postgresql://x", AUTH_SECRET: "a".repeat(40), CRON_SECRET: "s1", AUTOMATION_SECRET: "s2", SMS_PROVIDER: "sendai", SMS_WEBHOOK_SECRET: "whsec_real" };

test("production refuses a missing or default AUTH_SECRET; development only warns", () => {
  assert.equal(checkEnv({ ...base, NODE_ENV: "production" }).length, 0);
  const prod = checkEnv({ ...base, NODE_ENV: "production", AUTH_SECRET: "change-me-to-a-long-random-string-at-least-32-chars" });
  assert.equal(prod.find((i) => i.key === "AUTH_SECRET")?.level, "fatal");
  const dev = checkEnv({ ...base, NODE_ENV: "development", AUTH_SECRET: "" });
  assert.equal(dev.find((i) => i.key === "AUTH_SECRET")?.level, "warn");
  const short = checkEnv({ ...base, NODE_ENV: "production", AUTH_SECRET: "real-but-short-secret" });
  assert.equal(short.find((i) => i.key === "AUTH_SECRET")?.level, "warn", "a real but short secret never blocks a deploy");
});

test("example defaults and plain-http app URL are flagged in production", () => {
  const issues = checkEnv({ ...base, NODE_ENV: "production", CRON_SECRET: "change-me", SMS_WEBHOOK_SECRET: "change-me", NEXT_PUBLIC_APP_URL: "http://172.20.10.3:3000", SIMULATOR_ENABLED: "true" }).map((i) => i.key);
  for (const k of ["CRON_SECRET", "SMS_WEBHOOK_SECRET", "NEXT_PUBLIC_APP_URL", "SIMULATOR_ENABLED"]) assert.ok(issues.includes(k), k);
});

test("simulator: on in development, off in production unless SMS is simulated or explicitly enabled", () => {
  assert.equal(simulatorEnabled({ NODE_ENV: "development" }), true);
  assert.equal(simulatorEnabled({ NODE_ENV: "production", SMS_PROVIDER: "sendai" }), false);
  assert.equal(simulatorEnabled({ NODE_ENV: "production", SMS_PROVIDER: "simulated" }), true);
  assert.equal(simulatorEnabled({ NODE_ENV: "production", SMS_PROVIDER: "sendai", SIMULATOR_ENABLED: "true" }), true);
  assert.equal(simulatorEnabled({ NODE_ENV: "development", SIMULATOR_ENABLED: "false" }), false);
});

test("login throttle: ten failures block the address and the account for the window", () => {
  _resetThrottle();
  const t0 = 1_000_000;
  for (let i = 0; i < 9; i++) recordLoginFailure("1.2.3.4", "a@x", t0 + i);
  assert.equal(loginBlocked("1.2.3.4", "a@x", t0 + 10).blocked, false);
  recordLoginFailure("1.2.3.4", "a@x", t0 + 10);
  assert.equal(loginBlocked("1.2.3.4", "a@x", t0 + 11).blocked, true);
  assert.equal(loginBlocked("9.9.9.9", "a@x", t0 + 11).blocked, true, "the account is blocked from any address");
  assert.equal(loginBlocked("1.2.3.4", "b@x", t0 + 11).blocked, true, "the address is blocked for any account");
  assert.equal(loginBlocked("9.9.9.9", "b@x", t0 + 11).blocked, false);
  clearLoginFailures("a@x");
  assert.equal(loginBlocked("9.9.9.9", "a@x", t0 + 12).blocked, false, "a successful login clears the account");
  assert.equal(loginBlocked("1.2.3.4", "b@x", t0 + 16 * 60_000).blocked, false, "the window expires");
});
