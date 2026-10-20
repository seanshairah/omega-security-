/**
 * Width budget for the Android layouts.
 *
 * The portal had the same class of defect and it took a script to find it: a row whose fixed-width
 * icon, divider and chevron ate the width, leaving the label a slot too narrow to read. Android has
 * no `min-width: auto` to blame, but the arithmetic is the same — an icon, a chevron and two
 * paddings inside a weighted column, on a 320 dp screen, and the text has nowhere to go.
 *
 * So this walks each layout the way LinearLayout measures it, works out how many dp each piece of
 * text actually gets, and measures the words against it. Nothing here needs a device.
 *
 *   node scripts/dev/android-layout-audit.mjs
 *   node scripts/dev/android-layout-audit.mjs --width 320 --verbose
 *
 * What it cannot see: the real font (see METRICS), the real string behind an id, and anything a
 * layout does at runtime. A finding means "look at this on a phone", not "the build is broken".
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const RES = "android/app/src/main/res";
const args = process.argv.slice(2);
const VERBOSE = args.includes("--verbose");
const WIDTHS = args.includes("--width") ? [Number(args[args.indexOf("--width") + 1])] : [320, 360, 411];

// Android's own floor for anything a finger has to hit.
const TOUCH_MIN = 48;
// About four characters of body text. A slot narrower than this is a structural mistake, whatever
// string ends up in it.
const SLOT_MIN = 56;

/**
 * Advance widths in units of 1/1000 em, read off Liberation Sans — metric-compatible with Arial.
 * Android draws Roboto, which is a little narrower, so these run a few percent wide; ROBOTO_FACTOR
 * takes the edge off. A finding is worth a look; the absence of one is not a guarantee.
 */
const ROBOTO_FACTOR = 0.96;
const METRICS = {
  regular: {
    191: "'", 222: "ijl", 260: "|", 278: " !,./:;I[\\]ft", 333: "()-`r", 334: "{}", 355: '"',
    389: "*", 469: "^", 500: "Jcksvxyz", 556: "#$0123456789?L_abdeghnopqu", 584: "+<=>~",
    611: "FTZ", 667: "&ABEKPSVXY", 722: "CDHNRUw", 778: "GOQ", 833: "Mm", 889: "%", 944: "W",
    1015: "@",
  },
  bold: {
    238: "'", 278: " ,./I\\ijl", 280: "|", 333: "!()-:;[]`ft", 389: "*r{}", 474: '"', 500: "z",
    556: "#$0123456789J_aceksvxy", 584: "+<=>^~", 611: "?FLTZbdghnopqu", 667: "EPSVXY",
    722: "&ABCDHKNRU", 778: "GOQw", 833: "M", 889: "%m", 944: "W", 975: "@",
  },
};
const CHAR = { regular: new Map(), bold: new Map() };
for (const [face, table] of Object.entries(METRICS)) {
  for (const [w, chars] of Object.entries(table)) for (const c of chars) CHAR[face].set(c, Number(w));
}
const FALLBACK = 560;

const textWidth = (s, sp, bold, spacing) => {
  const face = bold ? "bold" : "regular";
  let em = 0;
  for (const c of s) em += (CHAR[face].get(c) ?? FALLBACK) / 1000 + spacing;
  return em * sp * ROBOTO_FACTOR;
};

/** Greedy wrap, the way a TextView breaks on spaces. */
function wrap(s, avail, sp, bold, spacing) {
  const lines = [];
  let line = "";
  for (const w of s.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${w}` : w;
    if (line && textWidth(next, sp, bold, spacing) > avail) { lines.push(line); line = w; }
    else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

// --- a small XML reader -------------------------------------------------------
// These files are plain: no CDATA, no namespaces beyond the prefixes, attributes always quoted.

function parseXml(src) {
  const stack = [{ tag: "#root", attrs: {}, kids: [] }];
  const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<\/\s*([\w.$]+)\s*>|<\s*([\w.$]+)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>|([^<]+)/g;
  for (const m of src.matchAll(re)) {
    const [, close, open, attrSrc, selfClose, text] = m;
    if (close) { stack.pop(); continue; }
    if (open) {
      const attrs = {};
      for (const a of (attrSrc ?? "").matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = decode(a[2]);
      const node = { tag: open, attrs, kids: [] };
      stack[stack.length - 1].kids.push(node);
      if (!selfClose) stack.push(node);
      continue;
    }
    if (text && text.trim()) stack[stack.length - 1].text = (stack[stack.length - 1].text ?? "") + text;
  }
  return stack[0].kids.find((n) => n.tag !== "#root");
}

const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d));

// --- resources ----------------------------------------------------------------

const strings = new Map();
{
  const root = parseXml(readFileSync(path.join(RES, "values/strings.xml"), "utf8"));
  for (const n of root.kids) {
    if (n.tag === "string") strings.set(n.attrs.name, (n.text ?? "").trim());
    // The longest quantity is the one that has to fit.
    else if (n.tag === "plurals") {
      strings.set(n.attrs.name, n.kids.reduce((best, i) => {
        const t = (i.text ?? "").trim();
        return t.length > best.length ? t : best;
      }, ""));
    }
  }
}

const styles = new Map();
{
  const root = parseXml(readFileSync(path.join(RES, "values/themes.xml"), "utf8"));
  for (const n of root.kids) {
    if (n.tag !== "style") continue;
    const items = {};
    for (const i of n.kids) if (i.tag === "item") items[i.attrs.name] = (i.text ?? "").trim();
    styles.set(n.attrs.name, { parent: n.attrs.parent ?? "", items });
  }
}

/** Style attributes, following only parents defined in this project. */
function styleAttrs(ref) {
  const s = styles.get(String(ref ?? "").replace(/^@style\//, ""));
  return s ? { ...styleAttrs(s.parent), ...s.items } : {};
}

// --- a tiny LinearLayout ------------------------------------------------------

const dp = (v, fallback = 0) => {
  const m = /^(-?[\d.]+)(dp|dip|sp|px)?$/.exec(String(v ?? "").trim());
  return m ? Number(m[1]) : fallback;
};

/** The element's own attributes over the ones its style supplies, prefixes stripped. */
function attributes(node) {
  const merged = {};
  for (const [k, v] of Object.entries(styleAttrs(node.attrs.style))) merged[k.replace(/^android:/, "")] = v;
  for (const [k, v] of Object.entries(node.attrs)) {
    if (k === "style" || k.startsWith("xmlns")) continue;
    merged[k.replace(/^(android|app|tools):/, "")] = v;
  }
  return merged;
}

const padStart = (a) => dp(a.paddingStart, dp(a.paddingLeft, dp(a.paddingHorizontal, dp(a.padding, 0))));
const padEnd = (a) => dp(a.paddingEnd, dp(a.paddingRight, dp(a.paddingHorizontal, dp(a.padding, 0))));
const marStart = (a) => dp(a.layout_marginStart, dp(a.layout_marginLeft, dp(a.layout_marginHorizontal, dp(a.layout_margin, 0))));
const marEnd = (a) => dp(a.layout_marginEnd, dp(a.layout_marginRight, dp(a.layout_marginHorizontal, dp(a.layout_margin, 0))));

const TEXTISH = new Set(["TextView", "Button", "EditText", "com.google.android.material.button.MaterialButton"]);
const FRAMES = new Set(["FrameLayout", "ScrollView", "RelativeLayout", "com.google.android.material.card.MaterialCardView"]);
// A button with a leading icon spends this much on the icon and its padding before any text.
const ICON_CHROME = 48;

const sizeOf = (a) => dp(a.textSize, 14);
const boldOf = (a) => /bold/.test(a.textStyle ?? "");
const spacingOf = (a) => Number(a.letterSpacing ?? 0);

function textOf(a) {
  if (!a.text) return null;
  const m = /^@string\/(.+)$/.exec(a.text);
  const raw = m ? strings.get(m[1]) : a.text;
  if (raw == null) return null;
  // Format specifiers stand in for runtime values we cannot know; drop them rather than invent a
  // length, and the report says the measurement is of the template.
  let t = raw.replace(/%\d+\$[sd]|%[sd]/g, "").replace(/\s+/g, " ").trim();
  if (a.textAllCaps === "true") t = t.toUpperCase();
  return t;
}

const kids = (n) => n.kids;
const isHorizontal = (a) => (a.orientation ?? "horizontal") === "horizontal";

/** The single-line width an element wants, for wrap_content inside a horizontal row. */
function desiredWidth(node, avail) {
  const a = attributes(node);
  if (TEXTISH.has(node.tag)) {
    const t = textOf(a);
    const chrome = padStart(a) + padEnd(a) + (a.icon ? ICON_CHROME : 0);
    // An unknown string gets a fair slice rather than a guess at its length.
    if (t == null) return Math.min(avail, 120);
    return Math.min(avail, textWidth(t, sizeOf(a), boldOf(a), spacingOf(a)) + chrome);
  }
  if (node.tag === "LinearLayout" || FRAMES.has(node.tag)) {
    const inner = avail - padStart(a) - padEnd(a);
    const widths = kids(node).map((c) => {
      const ca = attributes(c);
      return marStart(ca) + marEnd(ca) + resolveWidth(c, inner, () => desiredWidth(c, inner));
    });
    const used = node.tag === "LinearLayout" && isHorizontal(a)
      ? widths.reduce((x, y) => x + y, 0)
      : Math.max(0, ...widths);
    return Math.min(avail, used + padStart(a) + padEnd(a));
  }
  return Math.min(avail, dp(a.layout_width, 24));
}

function resolveWidth(node, avail, wrapFn) {
  const w = attributes(node).layout_width;
  if (w === "match_parent" || w === "fill_parent") return avail;
  if (w === "wrap_content") return wrapFn();
  return dp(w, 0);
}

/** True when nothing constrains this element: it asked for its content's width and got it. */
const selfSized = (node) => attributes(node).layout_width === "wrap_content" && !Number(attributes(node).layout_weight ?? 0);

const findings = [];
const note = (f) => findings.push(f);

/** Walk a subtree, handing each child the width it will really be measured with. */
function walk(node, avail, ctx) {
  const a = attributes(node);
  const inner = avail - padStart(a) - padEnd(a);

  if (TEXTISH.has(node.tag)) return inspectText(node, a, avail, ctx);

  if (node.tag === "LinearLayout" && isHorizontal(a)) {
    const cs = kids(node);
    const weights = cs.map((c) => Number(attributes(c).layout_weight ?? 0));
    const total = weights.reduce((x, y) => x + y, 0);
    // First pass: what the children take before any stretching, margins included. A child declared
    // 0dp with a weight contributes nothing but its margins.
    const base = cs.map((c, i) => {
      const ca = attributes(c);
      const own = weights[i] > 0 && dp(ca.layout_width, -1) === 0
        ? 0
        : resolveWidth(c, inner, () => desiredWidth(c, inner));
      return own + marStart(ca) + marEnd(ca);
    });
    const spare = inner - base.reduce((x, y) => x + y, 0);
    cs.forEach((c, i) => {
      const ca = attributes(c);
      let w = base[i] - marStart(ca) - marEnd(ca);
      if (weights[i] > 0 && total > 0) w += (spare * weights[i]) / total;
      walk(c, Math.max(0, w), ctx);
    });
    return;
  }

  // Vertical LinearLayout, frame or card: every child sees the same width.
  for (const c of kids(node)) {
    const ca = attributes(c);
    const room = inner - marStart(ca) - marEnd(ca);
    walk(c, Math.max(0, resolveWidth(c, room, () => room)), ctx);
  }
}

function inspectText(node, a, avail, ctx) {
  const id = (a.id ?? "").replace(/^@\+?id\//, "");
  const where = `${ctx.file}${id ? ` #${id}` : ""}`;
  const content = avail - padStart(a) - padEnd(a) - (a.icon ? ICON_CHROME : 0);
  const size = sizeOf(a);
  const bold = boldOf(a);
  const spacing = spacingOf(a);
  const t = textOf(a);

  // A self-sized element got exactly the width its own text asked for, so a narrow one is a short
  // string, not a squeezed slot. Only a constrained width can be too small.
  if (content < SLOT_MIN && !selfSized(node)) {
    note({ kind: "slot", where, sample: t ?? "(set at runtime)",
      msg: `${content.toFixed(0)} dp for text at ${size} sp — under ${SLOT_MIN} dp, so whatever goes here is cut` });
    return;
  }
  if (t == null) {
    if (VERBOSE) note({ kind: "dynamic", where, msg: `${content.toFixed(0)} dp at ${size} sp, string set at runtime` });
    return;
  }

  const words = t.split(/\s+/).filter(Boolean);
  const longest = words.reduce((w, x) => (textWidth(x, size, bold, spacing) > textWidth(w, size, bold, spacing) ? x : w), "");
  const longestW = textWidth(longest, size, bold, spacing);
  if (longestW > content) {
    note({ kind: "clip", where, sample: t,
      msg: `"${longest}" needs ${longestW.toFixed(0)} dp and has ${content.toFixed(0)} — it cannot wrap, so it clips` });
    return;
  }

  const lines = wrap(t, content, size, bold, spacing);
  // A heading that turns into a paragraph is a layout problem, not a copy problem.
  if (lines.length > 2 && (bold || size >= 17)) {
    note({ kind: "lines", where, sample: t, msg: `${lines.length} lines at ${size} sp${bold ? " bold" : ""} in ${content.toFixed(0)} dp` });
  } else if (VERBOSE) {
    note({ kind: "ok", where, msg: `${lines.length} line(s), ${content.toFixed(0)} dp at ${size} sp` });
  }
}

/** Interactive elements a finger has to land on, measured against Android's 48 dp. */
function touchTargets(node, ctx) {
  const a = attributes(node);
  if (node.tag === "Button" || node.tag === "ImageButton" || a.clickable === "true") {
    const h = a.layout_height === "wrap_content" ? dp(a.minHeight, 0) : dp(a.layout_height, 0);
    const id = (a.id ?? "").replace(/^@\+?id\//, "");
    if (h > 0 && h < TOUCH_MIN) {
      note({ kind: "touch", where: `${ctx.file}${id ? ` #${id}` : ""}`, msg: `${h} dp tall — under Android's ${TOUCH_MIN} dp` });
    }
  }
  for (const c of kids(node)) touchTargets(c, ctx);
}

// --- run ----------------------------------------------------------------------

const layouts = readdirSync(path.join(RES, "layout")).filter((f) => f.endsWith(".xml")).sort();
const TITLES = {
  slot: "Slots too narrow to hold text",
  clip: "Strings that cannot fit and cannot wrap",
  lines: "Headings wrapping to three or more lines",
  touch: "Touch targets under 48 dp",
  dynamic: "Runtime strings, and the room they get",
  ok: "Fits",
};
let worst = 0;

for (const width of WIDTHS) {
  findings.length = 0;
  for (const file of layouts) {
    const root = parseXml(readFileSync(path.join(RES, "layout", file), "utf8"));
    walk(root, width, { file });
    // Heights do not depend on screen width, so these are gathered on the first pass only.
    if (width === WIDTHS[0]) touchTargets(root, { file });
  }
  const real = findings.filter((f) => f.kind !== "dynamic" && f.kind !== "ok");
  worst = Math.max(worst, real.length);

  console.log(`\n=== ${width} dp wide ===`);
  if (!real.length) console.log("  nothing to look at");
  for (const kind of Object.keys(TITLES)) {
    const rows = findings.filter((f) => f.kind === kind);
    if (!rows.length) continue;
    console.log(`\n  ${TITLES[kind]}`);
    for (const r of rows) {
      console.log(`    ${r.where}: ${r.msg}`);
      if (r.sample) console.log(`      ${JSON.stringify(r.sample.slice(0, 90))}`);
    }
  }
}

console.log(`\n${worst} finding(s) at the narrowest screen checked.`);
process.exit(worst ? 1 : 0);
