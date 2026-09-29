import { Link } from "react-router-dom";
import { ShieldCheck } from "lucide-react";
import { LinkButton } from "../components/ui";

export function NotFound() {
  return (
    <div className="grid min-h-dvh place-items-center bg-ink-950 px-4">
      <div className="text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-ink-800 text-amber-400">
          <ShieldCheck className="h-6 w-6" />
        </span>
        <p className="mt-6 font-mono text-5xl font-semibold tracking-tight text-fog-50">404</p>
        <h1 className="mt-3 text-lg font-medium text-fog-200">No such page</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-fog-600">
          That route does not exist. If you followed a certificate link, the code may be
          mistyped.
        </p>
        <div className="mt-7 flex justify-center gap-3">
          <LinkButton to="/dashboard">Training</LinkButton>
          <LinkButton to="/verify" variant="secondary">
            Verify a certificate
          </LinkButton>
        </div>
        <p className="mt-10 text-xs text-fog-800">
          <Link to="/" className="hover:text-fog-400">
            Back to KAVACH
          </Link>
        </p>
      </div>
    </div>
  );
}
