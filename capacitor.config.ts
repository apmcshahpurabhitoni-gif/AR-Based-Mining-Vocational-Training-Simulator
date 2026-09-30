import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The Android wrapper — `docs/17`.
 *
 * KAVACH is a web app. This file is the whole of what makes it installable as
 * an APK: Capacitor ships the built `dist/` inside a native Android project
 * and serves it from a local origin, so the app runs offline on a handset with
 * no app store and no network round-trip to load a shell.
 *
 * Three things in here are deliberate rather than defaults:
 *
 * - **`webDir: "dist"`** is the Vite output, so there is one build. The APK and
 *   the deployed site are byte-identical apart from the backend URL baked in at
 *   build time, and a difference between them would be a difference between
 *   what a reviewer tested and what a trainee gets.
 *
 * - **`server.androidScheme: "https"`** makes the local origin `https://`, not
 *   `http://localhost`. A WebView on a plain-HTTP origin will not load a camera
 *   stream, will refuse most of the WebXR-adjacent APIs, and gives the service
 *   worker a different scope than the one it was registered for. It also means
 *   the app is treated as a secure context, which is what the AR path needs.
 *
 * - **No plugins are listed.** The AR path uses the phone's camera through
 *   `getUserMedia`, and Capacitor has no opinion about that; adding a camera
 *   plugin would mean adding a native permission model and a second way for
 *   the camera to fail.
 */
const config: CapacitorConfig = {
  appId: "in.gov.sih26041.kavach",
  appName: "KAVACH",
  webDir: "dist",
  android: {
    // The status bar sits over the room on a phone held in landscape, and the
    // room's own controls are at the bottom edge. Transparent bars with the
    // layout drawn behind them is the only way the bottom bar stays reachable.
    backgroundColor: "#0b0f14",
  },
  server: {
    androidScheme: "https",
  },
};

export default config;
