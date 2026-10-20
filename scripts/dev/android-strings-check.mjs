/**
 * Reports Android strings that nothing references, and plural-by-parenthesis.
 *
 * A removed screen leaves its strings behind, and they are invisible: the build does not warn, and
 * a translator is handed them along with the live ones. One sweep found 53 dead keys out of 288.
 *
 *   node scripts/dev/android-strings-check.mjs          # report
 *   node scripts/dev/android-strings-check.mjs --strict # exit 1 if anything is found
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const RES = "android/app/src/main/res";
const SRC = "android/app/src/main/kotlin";
const STRINGS = path.join(RES, "values/strings.xml");
// Referenced by the framework or the manifest rather than by our own code.
const ALWAYS_KEEP = new Set(["app_name"]);

const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = path.join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

const xml = readFileSync(STRINGS, "utf8");
const keys = [...xml.matchAll(/<(?:string|plurals) name="([^"]+)"/g)].map((m) => m[1]);

const haystack = [...walk(SRC), ...walk(RES).filter((f) => f !== STRINGS && f.endsWith(".xml")),
  path.join("android/app/src/main", "AndroidManifest.xml")]
  .map((f) => readFileSync(f, "utf8")).join("\n");

const used = new Set([...haystack.matchAll(/(?:R\.(?:string|plurals)\.|@string\/|@plurals\/)([a-zA-Z0-9_]+)/g)].map((m) => m[1]));
const dead = keys.filter((k) => !used.has(k) && !ALWAYS_KEEP.has(k));

// "%1$d event(s)" cannot be inflected by a translator, and renders as "1 event(s)".
const parenPlural = [...xml.matchAll(/<string name="([^"]+)">([^<]*\(s\)[^<]*)</g)].map((m) => `${m[1]}: ${m[2].trim()}`);

if (dead.length) console.log(`unreferenced (${dead.length}/${keys.length}):\n  ${dead.join("\n  ")}`);
if (parenPlural.length) console.log(`plural-by-parenthesis (${parenPlural.length}) — use <plurals>:\n  ${parenPlural.join("\n  ")}`);
if (!dead.length && !parenPlural.length) console.log(`${keys.length} strings: all referenced, no plural-by-parenthesis.`);

if (process.argv.includes("--strict") && (dead.length || parenPlural.length)) process.exit(1);
