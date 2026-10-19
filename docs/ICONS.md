# Icon system

One icon set, chosen once: **Material Symbols** (rounded, weight 400), inlined as path data.

## Why Material Symbols

| Candidate | Coverage of enterprise concepts | Licence | Delivery | Verdict |
|---|---|---|---|---|
| **Material Symbols** | Widest of the three. Has the operational concepts this product needs, including `gpp_maybe`, `signal_cellular_off`, `share_location`, `battery_alert`, `e911_emergency`, `shield_person`. | Apache 2.0 | `@material-symbols/svg-400` ships per-icon SVG, so a build step can inline only what is used | **Chosen** |
| Hugeicons | Good breadth and a distinctive look | Free tier is limited; the full set is a paid licence | npm package | Rejected: licensing cost with no coverage advantage |
| Feather | Clean and small | MIT | npm package | Rejected: ~290 icons, no filled variant, and gaps exactly where this product is specific (GPS state, battery levels, cellular state) |

Material Symbols also has a filled and an outlined variant of every glyph, which the interface uses
to mean *selected* versus *available* without inventing a second visual language.

## Implementation

- `scripts/dev/build-icons.mjs` reads the curated list in that file and writes
  `src/components/ui/icons.generated.ts` with the outline and filled path data for each icon.
  Run it after editing the list: `node scripts/dev/build-icons.mjs`.
- `src/components/ui/icon.tsx` exports `Icon` and `IconButton`.
- No icon font, no runtime stylesheet, no network request, so there is no flash of missing glyphs
  and no layout shift while a font loads. The generated module is ~116 KB of source, ~25 KB
  gzipped, tree-shaken per route by the bundler.
- Google Fonts' `material-symbols` stylesheet was rejected for the same reason: it is a third
  request on the critical path of a tool used in a control room on poor connections.

```tsx
<Icon name="my_location" size="sm" filled />           // decoration, hidden from screen readers
<Icon name="warning" label="Warning" />                 // meaningful, announced
<IconButton icon="refresh" label="Refresh the feed" />  // icon-only control, label required
```

`size` takes `xs|sm|md|lg|xl` (12/14/16/20/24 px) or a number. Sizes match the `--size-icon-*`
tokens in `globals.css`.

## Concept map

| Concept | Icon |
|---|---|
| Home, overview | `home` |
| Active operations | `sensors` |
| Guards, people | `groups`, `shield_person`, `person_off` |
| Emergency, alert | `e911_emergency`, `report`, `warning` |
| Assistance | `medical_services` |
| GPS, position | `location_on`, `my_location`, `location_off`, `wrong_location`, `where_to_vote` |
| Maps, geofence | `map`, `satellite_alt`, `pin_drop`, `route`, `fit_screen`, `radar` |
| Shifts, attendance | `calendar_today`, `assignment`, `schedule`, `event_available`, `event_busy` |
| Calls | `call`, `phone_in_talk`, `phone_callback`, `phone_forwarded`, `phone_missed`, `call_end` |
| SMS, messages | `sms`, `chat`, `forum`, `send`, `mail` |
| Notifications | `notifications`, `notifications_active`, `notifications_off` |
| Devices, battery, connectivity | `mobile`, `devices`, `cell_tower`, `signal_cellular_alt`, `signal_cellular_off`, `wifi_off`, `battery_full`, `battery_alert` |
| Sync, refresh | `sync`, `refresh`, `cloud_off`, `cloud_done` |
| Reports, analytics | `bar_chart`, `trending_up`, `trending_down`, `article` |
| Search, filter | `search`, `manage_search`, `filter_list`, `tune` |
| Administration | `settings`, `manage_accounts`, `badge`, `security`, `verified_user` |

## Accessibility rules

- An icon never carries a state on its own. Every status in the portal is a **word**, plus a
  colour, plus (sometimes) a glyph. An operator who cannot distinguish the colours still reads
  "off site", "stale", "offline".
- Emergencies, offline states and geofence violations are always spelled out in text.
- An icon-only control requires `label`, which becomes both its tooltip and its accessible name.
- Decorative icons are `aria-hidden`, so a screen reader does not announce "image" between words.
- One size per context, one alignment: icons sit on the text baseline via `align-[-0.125em]`.

## Migration note

The portal previously used `@phosphor-icons/react`. All 39 glyph usages were mapped to Material
Symbols and the dependency was removed, so only one icon library ships. The two libraries are not
mixed anywhere.
