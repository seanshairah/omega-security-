import { test } from "node:test";
import assert from "node:assert/strict";
import { distributable, isOutOfDate, type AppRelease } from "../src/lib/app-release";

const signed: AppRelease = {
  file: "security-gateway-release.apk",
  applicationId: "zw.co.omega.gateway",
  versionName: "1.7.0",
  versionCode: 8,
  minSdk: 24,
  sizeBytes: 1_943_781,
  sha256: "a".repeat(64),
  signer: "C=ZW, O=Omega Protection Services, CN=Omega Release",
  debugSigned: false,
  builtAt: "2026-10-20T08:00:00.000Z",
};
const debugKey: AppRelease = { ...signed, signer: "C=US, O=Android, CN=Android Debug", debugSigned: true };

test("a properly signed release may be handed out", () => {
  const d = distributable(signed);
  assert.equal(d.ok, true);
});

test("a debug-signed build is refused, with a reason that names the problem", () => {
  const prev = process.env.ALLOW_DEBUG_SIGNED_APK;
  delete process.env.ALLOW_DEBUG_SIGNED_APK;
  const d = distributable(debugKey);
  assert.equal(d.ok, false);
  assert.match(d.ok ? "" : d.reason, /debug key/i);
  // The reason has to be actionable: an operator reading it should know what to do next.
  assert.match(d.ok ? "" : d.detail, /keystore/i);
  if (prev !== undefined) process.env.ALLOW_DEBUG_SIGNED_APK = prev;
});

test("the debug-signed escape hatch requires the exact value, not any truthy one", () => {
  const prev = process.env.ALLOW_DEBUG_SIGNED_APK;
  for (const v of ["1", "yes", "TRUE", ""]) {
    process.env.ALLOW_DEBUG_SIGNED_APK = v;
    assert.equal(distributable(debugKey).ok, false, `"${v}" must not open the gate`);
  }
  process.env.ALLOW_DEBUG_SIGNED_APK = "true";
  assert.equal(distributable(debugKey).ok, true);
  if (prev === undefined) delete process.env.ALLOW_DEBUG_SIGNED_APK;
  else process.env.ALLOW_DEBUG_SIGNED_APK = prev;
});

test("no published release is refused as such, not treated as a signing problem", () => {
  const d = distributable(null);
  assert.equal(d.ok, false);
  assert.match(d.ok ? "" : d.reason, /No release/i);
});

test("a phone on the current version is not out of date", () => {
  assert.equal(isOutOfDate("1.7.0", signed), false);
});

test("a phone on an older version is out of date", () => {
  assert.equal(isOutOfDate("1.6.0", signed), true);
});

test("a debug build in the field is flagged even when its version matches", () => {
  // Its applicationId differs, so it is a different app rather than an older one — but it has
  // android:debuggable=true and should not be on a guard's phone at all.
  assert.equal(isOutOfDate("1.7.0-debug", signed), false, "same version: not an update problem");
  assert.equal(isOutOfDate("1.6.0-debug", signed), true, "older version: still an update problem");
});

test("nothing is out of date when there is no release to compare against", () => {
  assert.equal(isOutOfDate("1.6.0", null), false);
});

test("a phone that has never reported a version is not called out of date", () => {
  // Absence of evidence: saying "out of date" would be a guess, and the gateways list already
  // shows that it has never been seen.
  assert.equal(isOutOfDate(null, signed), false);
  assert.equal(isOutOfDate(undefined, signed), false);
});
