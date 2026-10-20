/**
 * Describes the release APK so the portal can serve it and phones can tell whether they are
 * out of date. Writes artifacts/android/release.json next to the APK.
 *
 * The portal cannot run aapt2 or apksigner — there is no Android SDK on the deployment host — so
 * the facts are extracted here, at build time, and committed alongside the binary.
 *
 * The signer is recorded deliberately. An APK signed with the Android debug key must never reach
 * a guard's phone: that key is public, so anyone could ship an update over it. Recording it here
 * lets the download route refuse, instead of the mistake being invisible until it matters.
 *
 *   node scripts/dev/apk-manifest.mjs
 */
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

const APK = "artifacts/android/security-gateway-release.apk";
const OUT = "artifacts/android/release.json";
const SDK = process.env.ANDROID_SDK_ROOT || process.env.ANDROID_HOME || "/opt/android-sdk";

function tool(name) {
  const dir = path.join(SDK, "build-tools");
  if (!existsSync(dir)) throw new Error(`no Android build-tools under ${dir}; set ANDROID_SDK_ROOT`);
  const version = readdirSync(dir).sort().pop();
  const p = path.join(dir, version, name);
  if (!existsSync(p)) throw new Error(`${name} not found in ${dir}/${version}`);
  return p;
}

if (!existsSync(APK)) {
  console.error(`${APK} does not exist. Build it first: npm run android:release`);
  process.exit(1);
}

const badging = execFileSync(tool("aapt2"), ["dump", "badging", APK], { encoding: "utf8" });
const pick = (re) => (badging.match(re) ?? [])[1];
const versionName = pick(/versionName='([^']+)'/);
const versionCode = Number(pick(/versionCode='(\d+)'/));
const applicationId = pick(/package: name='([^']+)'/);
const minSdk = Number(pick(/minSdkVersion:'(\d+)'/));

const certs = execFileSync(tool("apksigner"), ["verify", "--print-certs", APK], { encoding: "utf8" });
const signer = (certs.match(/Signer #1 certificate DN: (.+)/) ?? [])[1]?.trim() ?? "unknown";
// The debug key's DN is fixed and well known.
const debugSigned = /CN=Android Debug/i.test(signer);

const bytes = readFileSync(APK);
const manifest = {
  file: path.basename(APK),
  applicationId,
  versionName,
  versionCode,
  minSdk,
  sizeBytes: statSync(APK).size,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  signer,
  debugSigned,
  builtAt: new Date().toISOString(),
};

writeFileSync(OUT, JSON.stringify(manifest, null, 2) + "\n");
console.log(`${OUT}:`);
for (const [k, v] of Object.entries(manifest)) console.log(`  ${k}: ${v}`);
if (debugSigned) {
  console.log("\nWARNING: this APK is signed with the Android debug key, which is public.");
  console.log("The portal will refuse to serve it to phones until it is signed with a real key.");
}
