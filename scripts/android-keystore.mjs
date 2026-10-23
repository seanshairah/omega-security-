#!/usr/bin/env node
/**
 * Creates the Android RELEASE keystore, once, and points the build at it.
 *
 *   npm run android:keystore
 *
 * Run it on a machine you control, not on a build server or in a shared container: the key it makes
 * is the app's permanent identity. Lose it and every guard's phone needs the app uninstalled and
 * reinstalled, because Android refuses an update signed by a different key.
 *
 * What it does
 *   - generates a random password (never typed, never printed, never on a command line);
 *   - makes an RSA 4096 key valid for about 27 years, with a keystore under ~/omega-release-keystore;
 *   - writes android/keystore.properties (git-ignored) so `npm run android:release` signs with it;
 *   - prints the certificate fingerprint, so you can check later what a build was signed with.
 *
 * It refuses to run if a keystore or properties file already exists. It never overwrites a key.
 *
 *   --dir <folder>    where the keystore goes (default ~/omega-release-keystore)
 *   --props <file>    where the build settings go (default android/keystore.properties)
 */
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const arg = (name) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const dir = path.resolve(arg("dir") ?? path.join(os.homedir(), "omega-release-keystore"));
const props = path.resolve(arg("props") ?? "android/keystore.properties");
const jks = path.join(dir, "omega-release.jks");
const ALIAS = "omega";

const fail = (msg) => { console.error(`\n${msg}\n`); process.exit(1); };

if (existsSync(jks)) fail(`A keystore already exists at ${jks}.\nThis script never overwrites a key. If it is the one you want, point android/keystore.properties at it instead.`);
if (existsSync(props)) fail(`${props} already exists, so a release key is probably configured. Not overwriting it.`);

try { execFileSync("keytool", ["-help"], { stdio: "ignore" }); } catch {
  fail("keytool was not found. Install a JDK (Android Studio ships one), then run this again.");
}

// One password for the store and the key: modern keystores (PKCS12) require them to match.
const password = randomBytes(24).toString("base64url");
const env = { ...process.env, OMEGA_KS_PASSWORD: password };

mkdirSync(dir, { recursive: true, mode: 0o700 });
execFileSync("keytool", [
  "-genkeypair", "-keystore", jks, "-alias", ALIAS,
  "-keyalg", "RSA", "-keysize", "4096", "-validity", "10000",
  "-dname", "CN=Omega Protection Services, O=Omega Protection Services, L=Harare, C=ZW",
  "-storepass:env", "OMEGA_KS_PASSWORD", "-keypass:env", "OMEGA_KS_PASSWORD",
], { env, stdio: ["ignore", "ignore", "inherit"] });
chmodSync(jks, 0o600);

const esc = (v) => v.replace(/\\/g, "\\\\"); // .properties files treat a backslash as an escape
mkdirSync(path.dirname(props), { recursive: true });
writeFileSync(props, [
  "# Release signing for npm run android:release. Never commit this file or the keystore.",
  `ANDROID_KEYSTORE_PATH=${esc(jks)}`,
  `ANDROID_KEYSTORE_PASSWORD=${password}`,
  `ANDROID_KEY_ALIAS=${ALIAS}`,
  `ANDROID_KEY_PASSWORD=${password}`,
  "",
].join("\n"), { mode: 0o600 });
chmodSync(props, 0o600);

const listing = execFileSync("keytool", ["-list", "-v", "-keystore", jks, "-alias", ALIAS, "-storepass:env", "OMEGA_KS_PASSWORD"], { env, encoding: "utf8" });
const sha256 = (listing.match(/SHA256:\s*([0-9A-F:]+)/i) ?? [])[1] ?? "(could not read it; run keytool -list -v)";

console.log(`
Release keystore created.

  keystore    ${jks}
  settings    ${props}   (holds the password)
  alias       ${ALIAS}
  SHA-256     ${sha256}

Do this now, before anything else:
  1. Copy BOTH files to a place that survives this machine dying: a password manager's file
     storage, plus an encrypted USB stick or another computer. Two places, not one.
  2. Write the SHA-256 above somewhere. It is how you will recognise a genuine build later.
  3. Never commit either file. They are git-ignored; do not move them into the repository.

Then build and publish:
  npm run android:release
  npm run apk:manifest        # records the signer; the portal serves the APK only if it is not the debug key
`);
