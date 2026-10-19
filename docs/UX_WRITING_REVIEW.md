# UX writing review

## The `uz-writing` plugin

**`uz-writing` is not available in this environment and was not run.** `ListPlugins` returns no
plugin by that name, and no skill by that name is installed. No output from it is reproduced
anywhere in this change.

The closest available equivalent, the **`ux-writing` skill**, was loaded and used instead: its
review checklist (button labels, system-voice versus task-voice, the full set of states, errors
with a next action, translation-safe sentences, character budgets, links that stand alone, one term
per concept, register by stake, and a final cut pass) is the method behind the defect list below.
Where it hands off to `sepia` and `plain-prose`, those rules were applied by hand to the proposed
strings: no "seamlessly", no "effortlessly", no enthusiasm in an empty state, no em-dash triads.

## Method

Strings were harvested from `src/app` and `src/components` by category: page titles and
descriptions, section descriptions, button labels, status and error messages, empty states, tooltips
and navigation labels. They were sorted by length, because in this product density is the defect.
The vocabulary of position states was treated as fixed and protected: **live, last verified, recent,
stale, unverified, unavailable, inside, outside, uncertain, not assessed** each mean a different
thing to an operator and none of them may be merged for brevity.

## Defect list and changes applied

| Where | Current | Proposed and applied | Why |
|---|---|---|---|
| `client-location-forms.tsx` → Position and geofence | 467-character paragraph explaining the map, both measurement buttons, the confirmation step and config versioning | "Where the site centre is, and how far from it still counts as on site. Without coordinates, GPS verification stays off for this site." plus an `Explainer` disclosure holding the three measurement routes and the save consequence | The longest string in the product sat above the controls it described. Progressive disclosure keeps every fact, next to the control, for the one administrator who needs it |
| `operations/map` → page description | "… Every point is a dated fix with its accuracy, not a live stream. Refreshes every 30 s." appended to four counts | "12 positioned on 5 live shifts · 2 off site · 1 stale · 0 without a fix" | The counts are the operational content. The caution about dated fixes is already carried by the legend under the map, where the dots are |
| `operations/map` → empty state | "No live shift has a site with coordinates or a guard with a fix. Place sites on the map (Locations → Edit) and activate guard phones." | Icon, "Nothing to plot yet", the reason, and a **Set a site centre** button | An empty state with instructions but no control makes the operator navigate by hand. Three parts: what belongs here, why it is empty, the action that fills it |
| `locations/[id]` → map card | Card hidden entirely when the site had no coordinates | Empty state: "No site centre set", "GPS verification stays off for this site until it has coordinates. SMS attendance checks are unaffected.", **Set the site centre** | A hidden card teaches nothing. The absent state is the one that needs explaining, and it reassures that SMS checks still run |
| `monitoring` → description | "Guards you are watching closely. Every event for them is highlighted, pushed to your devices, and shown here live. Refreshes every 30 seconds." | "Every event for these guards is highlighted here and pushed to your devices." | "Guards you are watching closely" restates the page title. The polling interval describes the system, not the task |
| `calls` → description | "Ringing and in-progress calls, then missed calls from the last 24 hours that nobody has handled. Refreshes every 10 seconds." | "Calls in progress, then unhandled missed calls from the last 24 hours." | Same two defects: an implementation detail and a word count the operator reads once |
| `alerts` → description | 178 characters covering offline arrival, the synced-late mark and timestamp semantics | "Sent from the guard app. An alert raised offline arrives on reconnection, marked synced late; the time shown is when the guard pressed the button." | Kept every distinction, cut the preamble. The timestamp rule stays because misreading it changes a decision |
| `operations/exceptions` → description | "Poor accuracy and no fix are GPS conditions; location off and permission removed need the guard; site has no coordinates needs an administrator." | "Grouped per shift, with every reason seen. Who to chase: GPS conditions clear on their own, a phone setting needs the guard, a missing site centre needs an administrator." | Reordered around the operator's actual question, which is who to call. The reason codes are already spelled out in the rows |
| `gateway-form.tsx` → Device mode | "One app, two jobs. An operations gateway is …" | Opens on the distinction itself, drops the slogan | "One app, two jobs" is a sentence about the product, not about the choice in front of the administrator |
| `location-simulator.tsx`, `call-simulator.tsx` | Both explained intake, deduplication, guard matching and the exit rule | "Fixes go through the same intake as the real app." / "Events go through the same intake as the real app." | A test tool needs to promise fidelity, not describe the pipeline |
| Guard workspace → map controls | "Request GPS fix", "Recenter", "Copy", "Use as site centre…" | "Request fix", "Recenter", "Copy", "Set site centre", each with an icon and a tooltip naming what it acts on ("Copy the coordinates of the last verified position") | Labels shortened only where an icon carries the same meaning. The tooltip holds the precision the label loses, so nothing becomes ambiguous |
| Guard workspace → no device | "No activated guard phone: SMS and calls only." | "No guard phone: SMS and calls only", with a `location_off` icon | Shorter, and the icon makes it scannable in a row of controls |
| New: recent path control | n/a | "Path" toggle, tooltip "Draw the last 25 recorded positions as a path" | A new control, labelled with the noun an operator uses, with the exact count in the tooltip rather than a vague "history" |

## Deliberately not changed

- **Position vocabulary.** "Last verified position", "monitoring fix", "requested fix", "stale",
  "uncertain", "not assessed" stay exactly as they are. Each is a distinct state in
  `src/lib/guard-status.ts` and shortening any of them would make the interface lie.
- **Mock-location warnings.** "Phones that reported a mock (fake) location provider at some point.
  Treat their location events with caution; it is a warning, not an accusation." The length is the
  point: it stops an operator treating a warning as proof of cheating.
- **The TEST coordinates warning.** Unchanged, for the same reason.
- **Accuracy explanations in the site picker.** An administrator setting a fence is making a
  decision with a long tail of consequences and is reading carefully. Density is correct there.
- **"Refreshes every N seconds" in the fleet map's `AutoRefresh`.** Removed from the page
  description but the behaviour is unchanged.

## Checklist result

| Check | Result |
|---|---|
| Every button label says what happens | Pass. "Submit" and "OK" appear nowhere; destructive actions name their object |
| System voice where task voice belongs | Fixed in six page descriptions |
| All states written | Empty, loading, partial, error and offline states exist for the feed, the map, the location request and the picker. The map's absent-coordinates state was the gap, now filled |
| Errors give a next action | Pass. Location-request failures map to `FAILURE_META` reasons with what to do; login throttling states the wait |
| Concatenated fragments | One remains by design: the fleet map's count line is assembled from numbers. It is data, not a sentence to translate |
| Character budget at 320 px | Checked at 390 px in `scripts/dev/layout-e2e.mjs`; the identity bar and map controls truncate rather than overflow |
| Links read alone | Pass after this change: "Set the site centre", "Set a site centre", "Open shift" |
| One term per concept | "Site" (never "location" in prose), "guard phone" (never "device" in prose), "fix" (never "ping"), "fence" (never "perimeter"). The code still uses `Location` and `GatewayDevice` as model names, which is correct and invisible to operators |
| Register by stake | Pass. No personality in alert, emergency or failure strings |
| Cut test | Applied: the changes above remove roughly 1,400 characters of screen text without losing a single fact, because the facts moved to where they are used |
