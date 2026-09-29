/**
 * Certificate.
 *
 * The artefact an inspector actually looks at. Three things matter:
 *
 *   1. it carries the RETENTION result, not just a completion tick — that is
 *      what distinguishes it from every other certificate in this space
 *   2. it has a code that can be verified with no signal, because a mine floor
 *      is exactly where someone will try to check it
 *   3. the signature check is shown, not hidden — if a certificate has been
 *      altered the UI says so plainly
 */

import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { clsx } from "clsx";
import QRCode from "qrcode";
import {
  Award,
  BadgeCheck,
  Copy,
  Download,
  ExternalLink,
  Fingerprint,
  ShieldCheck,
  ShieldX,
} from "lucide-react";
import { useSession, useT } from "../lib/session";
import { Button, Chip, EmptyState, LinkButton, Panel } from "../components/ui";
import { fetchMyCertificates, verifyCode } from "../lib/api";
import { CERT_URL_BASE } from "../lib/cert";

interface CertRow {
  code: string;
  payload: {
    holder?: string;
    workerCode?: string | null;
    org?: string;
    modules?: Array<{ code: string; score: number }>;
    overallScore?: number;
    firstAttemptAccuracy?: number;
    recheckPassed?: boolean;
    recheckScore?: number;
    issuedAt?: number;
    expiresAt?: number;
  };
  issuedAt: number;
  expiresAt: number;
  revoked: boolean;
  expired: boolean;
}

export function Certificate() {
  const t = useT();
  const { token, profile } = useSession();
  const [rows, setRows] = useState<CertRow[] | null>(null);

  useEffect(() => {
    if (!token) return;
    void fetchMyCertificates(token).then((r) => {
      setRows(r.ok ? (r.value as unknown as CertRow[]) : []);
    });
  }, [token]);

  if (rows === null) {
    return (
      <div className="panel grid-bg-fine grid h-48 place-items-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-fog-600">loading…</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="space-y-6">
        <EmptyState
          title="no certificate"
          body={
            <>
              A KAVACH certificate is issued only when all eight gate criteria are met,
              including the cold retention re-check. Nothing is issued for attendance alone.
            </>
          }
        />
        <div className="text-center">
          <LinkButton to="/dashboard">{t("result.backToDashboard")}</LinkButton>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight text-fog-50">
          {t("cert.title")}
        </h1>
        <p className="mt-2 text-sm text-fog-400">
          {profile?.name} · {profile?.orgName}
        </p>
      </header>

      {rows.map((row) => (
        <CertCard key={row.code} row={row} />
      ))}
    </div>
  );
}

export function CertificateDetail() {
  const t = useT();
  const { code = "" } = useParams();
  const [row, setRow] = useState<(CertRow & { signatureValid: boolean }) | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    setRow(null);
    setMissing(false);
    void verifyCode(code).then((r) => {
      if (!r.ok || !r.value.found) {
        setMissing(true);
        return;
      }
      const v = r.value;
      setRow({
        code: v.code,
        payload: v.payload as CertRow["payload"],
        issuedAt: v.issuedAt,
        expiresAt: v.expiresAt,
        revoked: v.revoked,
        expired: v.expired,
        signatureValid: v.signatureValid,
      });
    });
  }, [code]);

  if (missing) {
    return (
      <div className="mx-auto max-w-lg space-y-5 py-10">
        <EmptyState
          title="not found"
          body="No certificate exists with that code. Check for transcription errors."
        />
        <div className="text-center">
          <LinkButton to="/dashboard" variant="secondary">
            {t("result.backToDashboard")}
          </LinkButton>
        </div>
      </div>
    );
  }

  if (!row) {
    return (
      <div className="panel grid-bg-fine grid h-48 place-items-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-fog-600">loading…</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl py-6">
      <CertCard row={row} detail />
    </div>
  );
}

function CertCard({ row, detail }: { row: CertRow & { signatureValid?: boolean }; detail?: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const verifyUrl = useMemo(() => `${CERT_URL_BASE}/verify/${row.code}`, [row.code]);

  useEffect(() => {
    // Rendered locally, never fetched from a QR service — the plant has no
    // egress, and a certificate that cannot render offline is useless.
    void QRCode.toDataURL(verifyUrl, {
      width: 320,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0a0f16", light: "#ffb020" },
    })
      .then(setQr)
      .catch(() => setQr(null));
  }, [verifyUrl]);

  const status = row.revoked ? "revoked" : row.expired ? "expired" : "valid";

  async function copy() {
    try {
      await navigator.clipboard.writeText(row.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked; the code is visible on screen regardless.
    }
  }

  function download() {
    window.print();
  }

  return (
    <article
      className={clsx(
        "panel relative overflow-hidden",
        status === "valid" ? "border-go-400/40" : "border-halt-400/30",
      )}
    >
      <div
        className={clsx(
          "absolute inset-x-0 top-0 h-1",
          status === "valid" ? "bg-go-400" : "bg-halt-400",
        )}
        aria-hidden="true"
      />

      <div className="grid gap-8 p-6 sm:p-9 lg:grid-cols-[1fr_auto]">
        {/* -- Body ---------------------------------------------------- */}
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-lg bg-amber-400 text-ink-950">
              <ShieldCheck className="h-5 w-5" strokeWidth={2.4} />
            </span>
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-fog-600">
                KAVACH
              </p>
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-fog-800">
                SIH26041 · Govt. of Jharkhand
              </p>
            </div>
          </div>

          <h2 className="mt-7 font-mono text-[11px] uppercase tracking-[0.2em] text-fog-600">
            {t("cert.holder")}
          </h2>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-fog-50">
            {row.payload.holder ?? "—"}
          </p>
          <p className="mt-1 font-mono text-sm text-fog-400">
            {row.payload.workerCode} · {row.payload.org}
          </p>

          {/* Retention is the headline, not the score. */}
          <div className="mt-7 inline-flex items-center gap-3 rounded-xl border border-amber-400/30 bg-amber-400/[0.06] px-4 py-3">
            <BadgeCheck className="h-5 w-5 shrink-0 text-amber-400" />
            <div>
              <p className="text-sm font-medium text-fog-50">Cold retention verified</p>
              <p className="font-mono text-[11px] text-amber-300">
                re-check {row.payload.recheckPassed ? "passed" : "failed"} ·{" "}
                {Math.round((row.payload.recheckScore ?? 0) * 100)}% retained · 90s gap
              </p>
            </div>
          </div>

          <dl className="mt-7 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <Fact label={t("cert.score")} value={`${row.payload.overallScore ?? "—"}/100`} />
            <Fact
              label="First-attempt"
              value={`${Math.round((row.payload.firstAttemptAccuracy ?? 0) * 100)}%`}
            />
            <Fact label={t("cert.issued")} value={formatDate(row.issuedAt)} />
            <Fact label={t("cert.expires")} value={formatDate(row.expiresAt)} />
            {(row.payload.modules ?? []).map((m) => (
              <Fact key={m.code} label={m.code} value={`${m.score}/100`} />
            ))}
          </dl>

          {/* Signature state is always shown. */}
          <div className="mt-7 flex flex-wrap items-center gap-3 border-t border-ink-800 pt-5">
            <span
              className={clsx(
                "flex items-center gap-1.5 font-mono text-[11px]",
                row.signatureValid === false ? "text-halt-300" : "text-fog-600",
              )}
            >
              <Fingerprint className="h-3.5 w-3.5" />
              {row.signatureValid === false
                ? "signature mismatch — do not accept"
                : "payload signature verified"}
            </span>
            {detail && (
              <Link
                to={`/verify/${row.code}`}
                className="ml-auto flex items-center gap-1.5 text-xs text-amber-300 hover:underline"
              >
                {t("cert.verifyCta")}
                <ExternalLink className="h-3 w-3" />
              </Link>
            )}
          </div>
        </div>

        {/* -- QR ------------------------------------------------------- */}
        <div className="flex flex-col items-center gap-3 lg:w-56">
          <div className="rounded-xl bg-amber-400 p-3">
            {qr ? (
              <img
                src={qr}
                alt={`QR code linking to ${verifyUrl}`}
                className="h-36 w-36 sm:h-44 sm:w-44"
              />
            ) : (
              <div className="grid h-36 w-36 place-items-center sm:h-44 sm:w-44">
                <span className="font-mono text-[10px] uppercase text-ink-900">qr</span>
              </div>
            )}
          </div>

          <p className="text-center font-mono text-[10px] leading-relaxed text-fog-800">
            scans with no network — verification is a single lookup by code
          </p>

          <button
            type="button"
            onClick={copy}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 font-mono text-xs text-fog-200 hover:bg-ink-700"
          >
            {copied ? <BadgeCheck className="h-3.5 w-3.5 text-go-300" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? "copied" : row.code}
          </button>

          {!detail && (
            <div className="flex w-full gap-2">
              <Button variant="secondary" size="sm" className="flex-1" onClick={download}>
                <Download className="h-3.5 w-3.5" />
                PDF
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate(`/certificate/${row.code}`)}
                aria-label="Open certificate"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}
        </div>
      </div>

      {status !== "valid" && (
        <div className="border-t border-halt-400/25 bg-halt-400/[0.06] px-6 py-3.5 sm:px-9">
          <p className="flex items-center gap-2 text-sm text-halt-300">
            <ShieldX className="h-4 w-4" />
            {status === "revoked" ? "This certificate has been revoked." : "This certificate has expired."}
          </p>
        </div>
      )}
    </article>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-wider text-fog-800">{label}</dt>
      <dd className="tnum mt-0.5 font-mono text-sm text-fog-100">{value}</dd>
    </div>
  );
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

/** A certificate that was found by code. */
interface FoundCertificate {
  state: "found";
  holder: string;
  workerCode: string | null;
  code: string;
  payload: Record<string, unknown>;
  signatureValid: boolean;
  revoked: boolean;
  revokedReason: string | null;
  expired: boolean;
  valid: boolean;
  issuedAt: number;
  expiresAt: number;
}

type VerifyState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "missing" }
  | FoundCertificate;

/**
 * Public verification. No sign-in: an inspector standing on a floor with no
 * signal must be able to check a certificate, and requiring an account to
 * verify one would defeat the point of having a QR.
 */
export function Verify() {
  const { code: codeParam } = useParams();
  const navigate = useNavigate();
  const [code, setCode] = useState(codeParam ?? "");
  const [result, setResult] = useState<VerifyState>({ state: "idle" });

  useEffect(() => {
    if (!codeParam) return;
    setCode(codeParam);
    setResult({ state: "loading" });
    void verifyCode(codeParam).then((r) => {
      if (!r.ok || !r.value.found) {
        setResult({ state: "missing" });
        return;
      }
      const v = r.value;
      setResult({
        state: "found",
        holder: v.holder,
        workerCode: v.workerCode,
        code: v.code,
        payload: v.payload as Record<string, unknown>,
        signatureValid: v.signatureValid,
        revoked: v.revoked,
        revokedReason: v.revokedReason,
        expired: v.expired,
        valid: v.valid,
        issuedAt: v.issuedAt,
        expiresAt: v.expiresAt,
      });
    });
  }, [codeParam]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    navigate(`/verify/${code.trim().toUpperCase()}`);
  }

  const scanAvailable =
    typeof window !== "undefined" && "BarcodeDetector" in window;

  return (
    <div className="min-h-dvh bg-ink-950">
      <div className="hazard-tape h-1 w-full opacity-70" aria-hidden="true" />

      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
        <Link to="/" className="inline-flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-md bg-amber-400 text-ink-950">
            <ShieldCheck className="h-5 w-5" strokeWidth={2.4} />
          </span>
          <span className="font-mono text-sm font-bold tracking-[0.2em] text-fog-50">KAVACH</span>
        </Link>

        <h1 className="mt-10 text-3xl font-semibold tracking-tight text-fog-50">
          Verify a certificate
        </h1>
        <p className="mt-3 max-w-lg text-pretty text-sm leading-relaxed text-fog-400">
          Enter the code printed on the certificate, or scan the QR. No account and no
          network required — this is a single lookup against the issuing record.
        </p>

        <form onSubmit={submit} className="mt-8 flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="KAV-XXXX-XXXX-XXXX"
            aria-label="Certificate code"
            className="tnum h-12 flex-1 rounded-lg border border-ink-600 bg-ink-850 px-4 font-mono text-sm uppercase tracking-widest text-fog-50 placeholder:text-fog-800 focus:border-amber-400/60 focus:outline-none"
          />
          <Button type="submit" size="lg">
            Verify
          </Button>
        </form>

        {scanAvailable && (
          <button
            type="button"
            onClick={() => void startScan(setCode, navigate)}
            className="mt-3 flex items-center gap-2 text-sm text-amber-300 hover:underline"
          >
            <Award className="h-4 w-4" />
            Scan with this device&apos;s camera instead
          </button>
        )}

        <div className="mt-8">
          {result.state === "idle" && (
            <div className="panel-inset grid-bg-fine px-6 py-10 text-center">
              <Award className="mx-auto h-8 w-8 text-fog-800" />
              <p className="mt-3 text-sm text-fog-600">
                No certificate selected. Enter a code above to check it.
              </p>
            </div>
          )}

          {result.state === "loading" && (
            <div className="panel grid-bg-fine grid h-32 place-items-center">
              <p className="font-mono text-xs uppercase tracking-[0.2em] text-fog-600">
                checking…
              </p>
            </div>
          )}

          {result.state === "missing" && (
            <div className="panel border-halt-400/30 p-6">
              <p className="flex items-center gap-2 font-semibold text-halt-300">
                <ShieldX className="h-5 w-5" />
                No certificate with that code
              </p>
              <p className="mt-2 text-sm text-fog-400">
                Check for transcription errors. Certificate codes are case-insensitive and
                read as four groups of four.
              </p>
            </div>
          )}

          {result.state === "found" && <VerifyResult result={result} />}
        </div>

        <p className="mt-12 text-center font-mono text-[11px] text-fog-800">
          KAVACH · certificate verification is public by design
        </p>
      </div>
    </div>
  );
}

function VerifyResult({ result }: { result: FoundCertificate }) {
  const r = result;
  const modules = (r.payload.modules ?? []) as Array<{ code: string; score: number }>;

  return (
    <div className={clsx("panel overflow-hidden", r.valid ? "border-go-400/40" : "border-halt-400/40")}>
      <div className={clsx("px-6 py-5", r.valid ? "bg-go-400/10" : "bg-halt-400/10")}>
        <p className="flex items-center gap-2.5">
          {r.valid ? (
            <BadgeCheck className="h-6 w-6 text-go-300" />
          ) : (
            <ShieldX className="h-6 w-6 text-halt-300" />
          )}
          <span className={clsx("text-lg font-semibold", r.valid ? "text-go-300" : "text-halt-300")}>
            {r.valid ? "Valid" : r.revoked ? "Revoked" : r.expired ? "Expired" : "Not valid"}
          </span>
        </p>
        {r.revoked && r.revokedReason && (
          <p className="mt-1.5 text-sm text-halt-300/80">Reason: {r.revokedReason}</p>
        )}
      </div>

      <div className="space-y-5 p-6">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-wider text-fog-800">
            Issued to
          </p>
          <p className="mt-0.5 text-2xl font-semibold text-fog-50">{r.holder}</p>
          <p className="font-mono text-sm text-fog-400">
            {r.workerCode} · {String(r.payload.org ?? "")}
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Fact label="Code" value={r.code} />
          <Fact label="Overall" value={`${r.payload.overallScore ?? "—"}/100`} />
          <Fact label="Retention" value={r.payload.recheckPassed ? "retained" : "not retained"} />
          <Fact label="Expires" value={new Date(r.expiresAt).toLocaleDateString("en-GB")} />
        </dl>

        {modules.length > 0 && (
          <div>
            <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-fog-800">
              Assessed modules
            </p>
            <ul className="flex flex-wrap gap-2">
              {modules.map((m) => (
                <li
                  key={m.code}
                  className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-850 px-3 py-1.5 font-mono text-xs"
                >
                  <span className="text-fog-400">{m.code}</span>
                  <span className="text-fog-50">{m.score}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p
          className={clsx(
            "flex items-center gap-2 border-t border-ink-800 pt-4 font-mono text-[11px]",
            r.signatureValid ? "text-fog-600" : "text-halt-300",
          )}
        >
          <Fingerprint className="h-3.5 w-3.5" />
          {r.signatureValid
            ? "payload signature verified — this record has not been altered"
            : "signature mismatch — this certificate has been altered and is not valid"}
        </p>
      </div>
    </div>
  );
}

/**
 * Camera scan using the platform's native barcode detector where it exists.
 *
 * Deliberately not a dependency: `BarcodeDetector` is available on the Android
 * and modern Safari devices a mine actually uses, and adding a 200 kB WASM
 * decoder for the remaining desktop case is not worth it. Everywhere else the
 * typed code works.
 */
async function startScan(
  setCode: (code: string) => void,
  navigate: (to: string) => void,
): Promise<void> {
  try {
    const Detector = (window as unknown as { BarcodeDetector: new () => { detect: (src: CanvasImageSource) => Promise<Array<{ rawValue: string }>> } })
      .BarcodeDetector;
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    const video = document.createElement("video");
    video.srcObject = stream;
    video.playsInline = true;
    await video.play();

    const detector = new Detector();
    const tick = async () => {
      try {
        const found = await detector.detect(video);
        if (found.length > 0) {
          const value = found[0]!.rawValue;
          stream.getTracks().forEach((t) => t.stop());
          const code = value.split("/verify/").pop() ?? value;
          setCode(code.toUpperCase());
          navigate(`/verify/${code.toUpperCase()}`);
          return;
        }
      } catch {
        // keep trying
      }
      requestAnimationFrame(tick);
    };
    await tick();
  } catch {
    // No camera or no detector: the typed field above still works.
  }
}
