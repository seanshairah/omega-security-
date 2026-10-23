# Distributing the Android app

There is no Play Store. Guards install the app from this portal and update from it. That makes two
things true that a Play listing would otherwise handle:

- **The signing key is the app's identity.** It is what stops someone else's build installing over
  yours, and it is permanent — change it later and every handset needs uninstall-and-reinstall.
- **Nothing updates by itself.** A phone only learns a newer build exists because the server tells
  it on the heartbeat.

## Publishing a release

```
npm run android:release      # build the signed APK
npm run apk:manifest         # describe it for the portal
git add artifacts/android/ && git commit && git push
```

`scripts/dev/apk-manifest.mjs` writes `artifacts/android/release.json`: version name and code,
applicationId, minSdk, size, sha256, and **the signing certificate**. The deployment host has no
Android SDK, so these facts are extracted at build time and committed next to the APK.
`next.config.ts` traces both files into the serverless bundle.

## The portal refuses a debug-signed build

The Android debug key ships with the SDK. Anyone can sign an APK with it, and a phone that accepted
one would accept the next — so `/api/app/download` returns `409` rather than the bytes, and the
devices page says why instead of looking as though no build exists.

```
Signer #1 certificate DN: C=US, O=Android, CN=Android Debug
```

`ALLOW_DEBUG_SIGNED_APK=true` opens the gate for a test handset. It must be exactly `true`, and it
is never right in production.

## Creating the keystore

Once, **on a machine you control**: not a build server, not a shared or disposable container. The key
is the app's permanent identity, and the script that makes it also writes its password to disk.

```
npm run android:keystore
```

`scripts/android-keystore.mjs` needs a JDK (`keytool`, which Android Studio ships). It:

- generates a random password and never prints it or puts it on a command line;
- creates an RSA 4096 key valid for about 27 years, at `~/omega-release-keystore/omega-release.jks`
  (outside the repository);
- writes `android/keystore.properties` (git-ignored, owner-only) with `ANDROID_KEYSTORE_PATH`,
  `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`, which is what
  `android/app/build.gradle.kts` reads (the same names also work as environment variables);
- prints the certificate's SHA-256 fingerprint;
- refuses to run if a keystore or settings file already exists, so it cannot overwrite a key.

**Back up both files immediately**, in two places that survive this machine dying (a password
manager's file storage plus an encrypted USB stick or a second computer), and write the fingerprint
down. Losing the key means every guard's phone needs the app uninstalled and reinstalled, because
Android refuses an update signed by a different key. There is no recovery. Never commit either file.

`.gitignore` already excludes `android/keystore.properties`, `android/*.jks` and `*.keystore`.
Without a keystore the release build falls back to the debug key and logs a warning, which is why the
portal then refuses to serve it.

Verify what you built before shipping it:

```
$ANDROID_SDK_ROOT/build-tools/*/apksigner verify --print-certs \
  artifacts/android/security-gateway-release.apk
```

## Installing on a phone

1. Sign in to the portal on the phone, open **Devices**, tap **Download APK**.
2. Android asks to allow installs from the browser — this is per-source, so it is asked once.
3. Install, open the app, enter the activation code from **Devices → Register device**.

### Moving a phone from the debug build to the release build

The first release-signed build is a fresh install on every phone, not an update:

- the release app id is `zw.co.omega.gateway` and the debug one is `zw.co.omega.gateway.debug`, so
  they are different apps; and
- an app signed with a different key cannot update one signed with another.

For each phone: uninstall the debug app, install the release, and register it again with a new
activation code from **Devices → Register device** (the old registration, its queued events and its
stored credentials go with the uninstall). Do the control-room phone ("Oprosec") first, since portal
calling and call attendance depend on it. After that, every later release updates in place, as long as
it is signed with the same key.

### The test build must be uninstalled first

The debug build has `applicationIdSuffix = ".debug"`, so `zw.co.omega.gateway.debug` is a
*different app* from `zw.co.omega.gateway`. Installing the release will not replace it; both will
run and both will report. Uninstall the debug build before installing the release.

It also carries `android:debuggable="true"` and allows cleartext HTTP, so its stored credentials can
be read over USB. It does not belong on a guard's phone.

## Updates

Every heartbeat response carries the current release:

```json
{ "app": { "versionName": "1.7.0", "versionCode": 8, "sha256": "…", "downloadUrl": "/api/app/download" } }
```

It is omitted entirely when the build is not distributable, so a phone is never pointed at a
download that will be refused.

The devices page marks any phone whose reported `appVersion` differs from the published release, and
the banner counts them. Phones report their version on every heartbeat, so the list is current
without anyone asking.

## Endpoints

| | |
|---|---|
| `GET /api/app/version` | What is published, and whether it can be handed out. Admin session or device token. |
| `GET /api/app/download` | The APK. Same auth. `409` when the build is not distributable. `no-store`, since the URL is stable across versions. |

Both refuse unauthenticated callers: the APK carries the activation flow and should not be a public
download.

## Checks

```
npm test                                  # includes tests/app-release.test.ts
node scripts/dev/app-release-e2e.mjs      # refusals and the portal's wording
```

The e2e asserts the refusals rather than the happy path, because the refusals are what protect the
fleet: an unauthenticated download, a debug-signed build, and APK bytes leaking on a refusal.

## Debug builds from more than one machine

A debug APK is signed with the building machine's own `~/.android/debug.keystore`. Installing a debug
APK built on one machine over one built on another fails with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`
(seen in the v1.8 device test: `artifacts/android/security-gateway-debug.apk` is built in the CI
container, not on your Mac).

- **Do not uninstall to get round it.** Uninstalling deletes the phone's activation and every event
  still queued on it. Sync first (Diagnostics → Sync now, queue at 0) if you ever must.
- Either build every debug APK on the same machine, or give every machine one shared development
  keystore (never committed; `*.jks` and `*.keystore` are git-ignored):

      keytool -genkeypair -keystore ~/omega-dev.jks -alias androiddebugkey -storepass android \
              -keypass android -keyalg RSA -validity 10000 -dname "CN=Omega Dev"
      # android/local.properties on every machine
      omega.debugKeystore=/Users/<you>/omega-dev.jks

  The build prints "Debug builds signed with the shared development keystore …" when it is in use.
  Switching an already-installed phone to the shared key needs one uninstall, so do it before a test
  phone holds real data.
- Release builds are unaffected: they use `ANDROID_KEYSTORE_*` only.
