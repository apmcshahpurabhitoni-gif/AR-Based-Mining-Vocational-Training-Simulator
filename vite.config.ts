import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    // Freebuff requires HMR to remain disabled.
    hmr: false,
    // Never let a browser hold on to a bundle.
    //
    // This is not only a development convenience. Trainees share a network,
    // and a device that kept an old copy of the app would be scored against
    // gate logic that is no longer the logic being certified — a certificate
    // issued under rules nobody is currently teaching. A stale bundle here is
    // a correctness problem, so it is refused at the server.
    headers: {
      "Cache-Control": "no-store, must-revalidate",
    },
    // Same-origin proxy to a local Convex backend.
    //
    // Without it the app is only usable from inside this sandbox: the browser
    // would have to reach `127.0.0.1:3210`, which on any other machine is the
    // trainee's own loopback — nothing listening, and blocked as mixed content
    // anyway because the page is served over HTTPS. Routing through the dev
    // server's own origin fixes both.
    //
    // Only used when `VITE_CONVEX_URL` is unset. A real deployment points at a
    // Convex Cloud URL and never touches this path.
    //
    // The regex is load-bearing, and narrowing it to "/convex" breaks the app
    // in a way that looks like a black screen with no error. Vite serves this
    // project's own `convex/_generated/*` sources from that same prefix — the
    // client imports them from `lib/api.ts` — so a bare "/convex" rule swallows
    // the app's own JavaScript, forwards it to the backend, and gets a 404.
    // Match only Convex's HTTP surface, which is all the client ever calls.
    proxy: {
      "^/convex/(api|version)": {
        target: "http://127.0.0.1:3210",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/convex/, ""),
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
