/**
 * Routes.
 *
 * `/` is the only public page besides verification. Everything else is behind
 * `RequireAuth`, which preserves the intended path through sign-in — so a
 * trainee who taps "start module" from a shared link lands on the module after
 * signing in, not on the dashboard.
 *
 * Verification is deliberately outside the guard: an inspector checking a
 * certificate is not a trainee and has no account.
 *
 * Every signed-in screen is lazy-loaded. The landing page is what a reviewer
 * opens first and what a trainee on a patchy connection loads most often, so it
 * should not carry the QR encoder, the Dexie layer, and the admin analytics.
 */

import { Suspense, lazy } from "react";
import { Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { BootScreen, RequireAuth } from "./components/RequireAuth";
import { Landing } from "./pages/Landing";
import { Auth } from "./pages/Auth";
import { NotFound } from "./pages/NotFound";

const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const Training = lazy(() => import("./pages/Training").then((m) => ({ default: m.Training })));
const Result = lazy(() => import("./pages/Result").then((m) => ({ default: m.Result })));
const Recheck = lazy(() => import("./pages/Recheck").then((m) => ({ default: m.Recheck })));
const Admin = lazy(() => import("./pages/Admin").then((m) => ({ default: m.Admin })));
const Certificate = lazy(() =>
  import("./pages/Certificate").then((m) => ({ default: m.Certificate })),
);
const CertificateDetail = lazy(() =>
  import("./pages/Certificate").then((m) => ({ default: m.CertificateDetail })),
);
const Verify = lazy(() => import("./pages/Certificate").then((m) => ({ default: m.Verify })));

export function App() {
  return (
    <Suspense fallback={<BootScreen />}>
      <Routes>
        {/* Public */}
        <Route path="/" element={<Landing />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/verify" element={<Verify />} />
        <Route path="/verify/:code" element={<Verify />} />

        {/* Signed in */}
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/train/:moduleCode" element={<Training />} />
          <Route path="/result" element={<Result />} />
          <Route path="/recheck" element={<Recheck />} />
          <Route path="/certificate" element={<Certificate />} />
          <Route path="/certificate/:code" element={<CertificateDetail />} />
          <Route path="/admin" element={<Admin />} />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
