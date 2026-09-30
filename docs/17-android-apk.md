# 17 — The Android APK

KAVACH is a web app. This document is about the one thing that makes it
installable as a file a trainee can be handed: the Android wrapper, and how a
build of it actually happens.

**Status: a debug-signed APK has been built and verified.** `KAVACH-0.1.0-debug.apk`,
**5.5 MB**, `in.gov.sih26041.kavach`, signed with the Android debug certificate,
containing the web bundle and the launcher icons. It has **not** been run on a
handset — see §5, which is the honest list of what is still unproven.

The Freebuff *hosting* image is Node-only and still cannot build one; that
matters only for deploys. The development sandbox can, and did, by installing
its own toolchain — which is now a script rather than a set of notes.

---

## 1. What is in the repository

| Path | What it is |
|---|---|
| `capacitor.config.ts` | The whole configuration: app id, app name, and the fact that the web assets are `dist/` |
| `android/` | The native Android project. **Committed**, because it is the source of the APK and a wrapper that exists on one machine is not a build anyone can reproduce |
| `android/app/src/main/AndroidManifest.xml` | One addition: the `CAMERA` permission (see §4) |
| `scripts/build-apk.sh` | The whole toolchain, from a clean machine: JDK 21, Android SDK, licences, web build, sync, APK |
| `.github/workflows/android-apk.yml` | The same build on a runner that already has the toolchain. Runs on every push to `main`, every pull request, and on demand |
| `scripts/make-icons.ts` | Also draws the Android launcher icons and splash, so the APK carries the shield mark rather than Capacitor's default |

`android/.gitignore`d entries are only what Gradle produces and what Capacitor
copies in from `dist/` on every sync. The rest of the project is untouched:
`vite build` is still the web build, the deployed site is still the same app, and
the PWA still works — the wrapper is an *additional* delivery route, not a
replacement.

## 2. Getting an APK

### From a clean machine (what produced the current one)

```bash
sh scripts/build-apk.sh
```

That is the whole thing. It installs a JDK 21 and the Android SDK under
`/opt/kavach-toolchain` if they are missing, accepts the SDK licences,
builds the web app, copies it into the native project, assembles the APK, and
leaves it in the project root as `KAVACH-<version>-debug.apk`.

It needs root the first time, because it writes to `/opt` and installs a
package. On a machine where you are not root, install a JDK 21 yourself and
point it somewhere you own:

```bash
TOOLCHAIN_DIR=~/kavach-toolchain sh scripts/build-apk.sh
```

The script is idempotent — re-running it with the toolchain already in place
takes about thirty seconds and rebuilds only what changed.

### The workflow

Push to `main`, or open a pull request, or press **Run workflow**. When it goes
green the APK is at the bottom of the run page under **Artifacts**, as
`kavach-debug-apk`. This is the better route for anything that gets handed to
someone else, because the artefact is traceable to a commit.

### Installing it

It is a **debug-signed** APK. That is the right artefact for a pilot: Android
signs debug builds with a keystore Gradle generates on the spot, so it installs
by sideload with no signing key, no store account and nothing to keep safe.

**It builds clean every time, and the size depends on that.** Gradle's
incremental packager appends to the APK and does not always reclaim the space
when an input shrinks. Building repeatedly while the bundle changed — which is
exactly what a developer does, and what dropping source maps does — left
orphaned blocks behind: identical entries in the central directory, in a file
twice the size. The same code built once on a clean checkout is 5.5 MB; built
nine times it was 10.7 MB. `scripts/build-apk.sh` therefore runs `clean
assembleDebug`, so the artefact does not depend on how many times you have built
before. It costs about thirty seconds and it is the difference between an APK
whose size means something and one that does not.

- **Over USB**: enable Developer options and USB debugging on the handset, plug
  it in, and run `adb install -r KAVACH-0.1.0-debug.apk`.
- **Without a cable**: copy the file to the handset (SD card, USB drive, Drive,
  anything) and open it from the file manager. Android will ask you to allow
  installs from that source — say yes. It will not ask for a password; a debug
  build is not a store build.

To update it later, install the new APK over the old one. The `-r` flag and
Android's own installer both replace in place, and the app's local data
(completed attempts, the offline queue) survives, because it is the same
application id and the same signing key.

### The two builds are the same build

`capacitor.config.ts` points `webDir` at the Vite output, so the APK contains
the same bundle as the deployed site apart from the backend URL, which is
decided at build time. That matters: a difference between what a reviewer tested
and what a trainee gets is exactly the kind of difference nobody notices until
the pilot.

## 3. The backend URL, and why it is a secret

`src/lib/api.ts` reads `VITE_CONVEX_URL` at build time and bakes it into the
bundle. Vite inlines `VITE_*` variables; there is no runtime lookup.

So an APK built without it points at its own local origin
(`https://localhost/convex`), which is not a deployment. The workflow takes the
value from a repository secret named `VITE_CONVEX_URL`:

> **Settings → Secrets and variables → Actions → New repository secret**

The build does **not** fail when the secret is missing. It warns, and the APK is
still produced and still installs: the room, the AR path, the offline store and
the pre-pilot disclosure all work, and a backend-dependent step reports the
backend as unreachable — which is the behaviour the app already has when it
loses the network. A red build for a missing secret would be a worse first
experience than a working artefact with a warning attached to it.

Set the secret before a pilot. It is currently unset, because the Convex
deployment it would point at has not been made yet — that needs `convex login`
in a browser and the first Deploy, both of which are human clicks.

## 4. The camera permission, and why it is in the manifest

`AndroidManifest.xml` declares `android.permission.CAMERA`, and the app is
marked as **not** requiring camera hardware.

This is load-bearing rather than tidy. The camera AR surface calls
`getUserMedia`, and an Android WebView does not prompt on its own: it refuses the
call unless the *native* manifest declares the permission. Without that line the
camera view fails silently — no error dialog, no console message a reviewer
would see, just a black rectangle where the AR should be.

`required="false"` on the camera feature is the other half: the 3D room needs no
camera at all, so the app must still install on a handset without one.

## 5. What a release build would still need

Not built, and not needed for a pilot:

- **A signing keystore.** `assembleRelease` is wired up
  (`bun run android:release`) but a release APK has to be signed with a key we
  hold, kept, and can rotate. That is a decision about key custody, not a build
  flag.
- **A version code and name.** `versionCode 1` / `versionName "1.0"` in
  `android/app/build.gradle`. An update install needs a higher code than the one
  already on the handset, or Android refuses it.
- **Play Store metadata, a privacy policy, and a data-safety declaration.** The
  app records assessment results and shows a camera view, which is more than a
  store listing question.
- **A device test.** The APK has been built and its contents verified — package
  id, label, signature, the web bundle inside it — but **it has never been run on
  a handset**. The WebView is not a browser: it is a different WebView version
  per Android release, it handles `getUserMedia` through a permission bridge,
  and its WebGL capabilities are not the ones a desktop test measured. The
  `?view=` presets in `docs/16` phase 0 are the way to check this — open them on
  the actual handset and photograph them. Until somebody does, treat the file as
  "builds and installs", not as "works".

## 6. What this app says about itself

The APK carries an in-app notice, permanently, in English and Hindi:

> **Pre-release build · under active development · some features may not work**

It is on every signed-in page, above the header, and in full on the landing
page. It is not dismissible, and that is deliberate: an installable file on a
miner's phone is a *more* credible-looking artefact than a URL, so it is exactly
the delivery route where a trainee is most likely to mistake a working build for
a finished product. The same reasoning as the hazard tape above it and the
pre-pilot disclosure beside it.

It says *may not work*, never *is unsafe*. Those are different claims, and only
the first is true — the gate fails closed, no certificate is issued to anyone
today, and what is unfinished here is the software, not the safety case. A test
in `src/lib/i18n.test.ts` fails the build if that notice is ever reworded into
claiming the app is certified, approved, or unsafe.

## 7. What this does not change

The wrapper changes how the app is **delivered**. It changes nothing about what
it assesses.

`runner.ts`, `scoring.ts` and `gate.ts` are untouched, the marker vocabulary is
untouched, and no module content changed. The camera permission grants the
WebView access to the camera the AR surface already asked for; it does not
record, upload or transmit anything, and the app has no network code beyond the
Convex client that was already there.

The pre-pilot disclosure in `docs/08` and on the landing page applies to the APK
exactly as it applies to the web app. An APK is a more credible-looking artefact
than a URL, which makes the disclosure more important, not less: an installable
file on a miner's phone is the easiest thing in the world to mistake for a
certificate.
