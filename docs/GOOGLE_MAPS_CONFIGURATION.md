# Google Maps Configuration (duty-site picker)

The admin portal places duty sites on a map. The picker lives in the **web portal only** (Locations → Add / Edit → *Position and geofence*, and the *Geofence for this shift* section on shifts). The Android app never loads Google Maps: it receives the finished coordinates and radius from the server and judges GPS fixes against them offline.

## 1. What the picker does

| Action | Result |
|---|---|
| Search (Places suggestions or the **Search** button) | Moves the pin to the chosen place; records the Google place id |
| Click the map | Moves the pin |
| Drag the pin | Fine-tunes the centre |
| **Use my position** | Pins the browser's position (useful on a phone standing at the site) |
| Radius | Draws the geofence circle; 20–5000 m; presets 50 / 100 / 150 / 250 / 500 |
| Latitude / longitude inputs | Always editable; typing moves the pin |
| **Coordinates are** | `MAP` (placed on the map, verified), `MANUAL` (typed/pasted), `TEST` (temporary test values) |
| Preview | Centre, radius, approximate area in hectares, and the rule the phone applies |
| Save | Validates the pair (both or neither, 0,0 rejected, radius range) and, when the fence moved or resized, raises the site's **config version** and writes an audit entry with before/after |

### Provenance and the TEST flag

Every set of coordinates carries a source. `TEST` is for values typed during device testing (for example the temporary EOP-02 coordinates used on the Pixel). A `TEST` site shows an orange warning on its page, on shifts and on the guard's phone, is never stamped `coordinatesVerifiedAt`, and must be replaced by a map placement before GPS verification at that site is relied on. The demo seed marks EOP-02 as `TEST` for this reason.

### Shift-level override

A shift can carry its own fence (gate post, car park, patrol area). It is set on the new-shift form or on the shift page (*Geofence for this shift*), with a reason that goes on the timeline. The server, the portal maps and the phone all use the override while it exists; removing it reverts to the site's fence. Changing it raises the **shift** config version.

### Config versioning and device sync

- Each site has `configVersion` (starts at 1, +1 when centre or radius changes). Each shift has `configVersion` (+1 when its override changes).
- `GET /api/gateways/config` returns `configVersion: "<site>.<shift>"` together with the effective fence and its source (`SITE` or `SHIFT_OVERRIDE`).
- The phone caches the config, applies it immediately (the monitoring loop wakes on any change) and echoes `configVersion` in every heartbeat. The server stores `configVersionApplied` / `configAppliedAt` on the device, and the heartbeat response carries the current version so the phone can re-download when they differ.
- The device page shows the applied version next to the current one.

## 2. Setting up the key

1. In Google Cloud Console create a project (or use the company one) and enable **Maps JavaScript API**, **Places API (New)** and **Geocoding API**.
2. Create an **API key**. Under *Application restrictions* choose **Websites** and add the portal's domains (for example `https://omega-security-gamma.vercel.app/*` and any custom domain). Under *API restrictions* allow only the three APIs above.
3. Set the environment variable on Vercel (Production and Preview) and in `.env` locally:

```
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=AIza…
```

4. Redeploy. The picker detects the key at build time (`NEXT_PUBLIC_*` variables are inlined into the browser bundle).

The key is a browser key by design: it is visible to anyone using the portal, which is why the referrer restriction matters. Never commit it to the repository; `.env` is git-ignored and `.env.example` leaves it blank.

### Billing

Google Maps Platform includes a monthly free allowance that comfortably covers an operations team placing a few dozen sites. Map loads, Places autocomplete sessions and geocoding requests are billed per use beyond that; set a budget alert in Google Cloud.

## 3. Without a key

If `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is empty the picker falls back automatically to **OpenStreetMap** tiles via Leaflet, with the same pin, radius, inputs and preview, and search through OpenStreetMap's Nominatim service (fine for occasional use; it has no SLA). Everything saved is identical, so a key can be added later without touching the data.

If the Google script fails to load at runtime (blocked network, invalid key, missing API), the picker shows the error and switches to OpenStreetMap for that page load.

## 4. Where the data goes

| Field | Table | Set by |
|---|---|---|
| `latitude`, `longitude`, `geofenceRadiusM` | `Location` | picker or typed |
| `coordinatesSource`, `placeId`, `coordinatesUpdatedAt`, `coordinatesVerifiedAt` | `Location` | save action |
| `configVersion` | `Location`, `Shift` | save actions, on fence change only |
| `geofenceLatitude`, `geofenceLongitude`, `geofenceRadiusM`, `geofenceNote` | `Shift` | shift override |
| `configVersionApplied`, `configAppliedAt` | `GatewayDevice` | heartbeat |

All of it is additive (migration `20261018120000_site_config_versioning`). Existing sites keep their coordinates with `coordinatesSource = null` until they are saved again.

## 5. Troubleshooting

- **Blank grey map, console says `RefererNotAllowedMapError`**: add the portal's URL pattern to the key's website restrictions.
- **`ApiNotActivatedMapError`**: enable Maps JavaScript API on the project.
- **Suggestions box missing but Search works**: Places API (New) is not enabled; the geocoder search still functions.
- **Pin saved but phone still shows the old fence**: check the device page: *config applied* should match the current version within one heartbeat (default 2 min). If not, the phone is offline or its token was revoked.
