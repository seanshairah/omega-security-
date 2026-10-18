#!/usr/bin/env node
/**
 * Android build helper. Usage:
 *   npm run android:sync     check the SDK/JDK, write android/local.properties
 *   npm run android:debug    build the debug APK  → artifacts/android/security-gateway-debug.apk
 *   npm run android:release  build the release APK → artifacts/android/security-gateway-release.apk
 *   npm run android:build    both, plus unit tests
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, copyFileSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..", "..");
const android = join(root, "android");
const out = join(root, "artifacts", "android");
const cmd = process.argv[2] ?? "build";

function sdkHome() {
  const fromEnv = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const local = join(android, "local.properties");
  if (existsSync(local)) { const m = readFileSync(local, "utf8").match(/^sdk\.dir=(.+)$/m); if (m && existsSync(m[1].replace(/\\:/g, ":"))) return m[1].replace(/\\:/g, ":"); }
  const guesses = [join(process.env.HOME ?? "", "Android", "Sdk"), join(process.env.LOCALAPPDATA ?? "", "Android", "Sdk"), join(process.env.HOME ?? "", "Library", "Android", "sdk"), "/opt/android-sdk"];
  return guesses.find((g) => g && existsSync(g));
}

function run(args) {
  const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
  const r = spawnSync(gradlew, args, { cwd: android, stdio: "inherit", shell: process.platform === "win32" });
  if (r.status !== 0) { console.error(`\nGradle failed (${args.join(" ")}). See docs/TROUBLESHOOTING.md → Android build.`); process.exit(r.status ?? 1); }
}

function sync() {
  const sdk = sdkHome();
  if (!sdk) { console.error("Android SDK not found. Install Android Studio or the command-line tools and set ANDROID_HOME. See docs/LOCAL_DEVELOPMENT.md."); process.exit(1); }
  // Keep any developer settings already in local.properties (e.g. omega.devHttpHosts); only sdk.dir is managed here.
  const localPath = join(android, "local.properties");
  const kept = existsSync(localPath) ? readFileSync(localPath, "utf8").split(/\r?\n/).filter((l) => l.trim() && !/^sdk\.dir=/.test(l)) : [];
  writeFileSync(localPath, [`sdk.dir=${sdk.replace(/\\/g, "/")}`, ...kept].join("\n") + "\n");
  const java = spawnSync("java", ["-version"], { encoding: "utf8" });
  const ver = (java.stderr || java.stdout || "").split("\n").find((l) => /version/.test(l)) ?? "not found";
  console.log(`SDK: ${sdk}\nJava: ${ver.trim()}\nlocal.properties written.`);
  if (!/"(17|21)/.test(ver)) console.warn("Warning: JDK 17 or 21 is required by the Android Gradle plugin.");
}

function copy(type) {
  mkdirSync(out, { recursive: true });
  const src = join(android, "app", "build", "outputs", "apk", type, `app-${type}.apk`);
  if (!existsSync(src)) { console.error(`APK not found at ${src}`); process.exit(1); }
  const dst = join(out, `security-gateway-${type}.apk`);
  copyFileSync(src, dst);
  console.log(`\nAPK: ${dst}`);
}

sync();
if (cmd === "sync") process.exit(0);
if (cmd === "debug" || cmd === "build") { run(["assembleDebug", "--console=plain", "-q"]); copy("debug"); }
if (cmd === "release" || cmd === "build") { run(["assembleRelease", "--console=plain", "-q"]); copy("release"); }
if (cmd === "build") run(["testDebugUnitTest", "--console=plain", "-q"]);
if (cmd === "test") run(["testDebugUnitTest", "--console=plain"]);
