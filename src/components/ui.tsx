/**
 * Shared UI primitives.
 *
 * Small, deliberately unopinionated pieces used everywhere. The visual weight
 * of the product lives in the screens; these just keep the markup consistent
 * and the accessibility guarantees in one place.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { clsx } from "clsx";
import { Link } from "react-router-dom";

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-amber-400 text-ink-950 hover:bg-amber-300 active:bg-amber-500 shadow-[0_6px_24px_-10px_rgba(255,176,32,0.8)] font-semibold",
  secondary:
    "bg-ink-800 text-fog-50 hover:bg-ink-700 border border-ink-600 active:bg-ink-800",
  ghost: "text-fog-200 hover:text-fog-50 hover:bg-ink-800/70",
  danger: "bg-halt-400 text-ink-950 hover:bg-halt-300 font-semibold",
};

const SIZES: Record<Size, string> = {
  sm: "h-9 px-3.5 text-sm gap-1.5",
  md: "h-11 px-5 text-sm gap-2",
  lg: "h-14 px-7 text-base gap-2.5",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={clsx(
        "inline-flex items-center justify-center rounded-lg transition-all duration-150",
        "disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      {...rest}
    />
  );
}

export function LinkButton({
  to,
  variant = "primary",
  size = "md",
  className,
  children,
}: {
  to: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      className={clsx(
        "inline-flex items-center justify-center rounded-lg transition-all duration-150",
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {children}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export function Panel({
  children,
  className,
  as: As = "div",
}: {
  children: ReactNode;
  className?: string;
  as?: "div" | "section" | "article";
}) {
  return <As className={clsx("panel p-5 sm:p-6", className)}>{children}</As>;
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-4 font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-fog-600">
      {children}
    </h2>
  );
}

export function Chip({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "amber" | "go" | "halt" | "warn";
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-ink-800 text-fog-400 border-ink-600",
    amber: "bg-amber-400/10 text-amber-300 border-amber-400/30",
    go: "bg-go-400/10 text-go-300 border-go-400/30",
    halt: "bg-halt-400/10 text-halt-300 border-halt-400/30",
    warn: "bg-warn-400/10 text-warn-400 border-warn-400/30",
  };
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/** A number with its unit. Tabular so live values do not jitter. */
export function Stat({
  value,
  label,
  tone = "neutral",
}: {
  value: ReactNode;
  label: ReactNode;
  tone?: "neutral" | "amber" | "go" | "halt";
}) {
  const tones: Record<string, string> = {
    neutral: "text-fog-50",
    amber: "text-amber-300",
    go: "text-go-300",
    halt: "text-halt-300",
  };
  return (
    <div>
      <div className={clsx("tnum font-mono text-3xl font-semibold tracking-tight", tones[tone])}>
        {value}
      </div>
      <div className="mt-1 text-xs leading-snug text-fog-600">{label}</div>
    </div>
  );
}

/**
 * Horizontal meter.
 *
 * Always paired with a numeric readout somewhere in the same card — a bar on
 * its own is unreadable for screen readers and ambiguous on a phone.
 */
export function Meter({
  value,
  max = 1,
  tone = "amber",
  className,
}: {
  value: number;
  max?: number;
  tone?: "amber" | "go" | "halt" | "warn";
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / (max || 1)) * 100));
  const tones: Record<string, string> = {
    amber: "bg-amber-400",
    go: "bg-go-400",
    halt: "bg-halt-400",
    warn: "bg-warn-400",
  };
  return (
    <div
      className={clsx("h-1.5 w-full overflow-hidden rounded-full bg-ink-700", className)}
      role="presentation"
    >
      <div
        className={clsx("h-full rounded-full transition-[width] duration-500", tones[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function Verdict({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className={clsx("font-semibold", ok ? "text-go-300" : "text-halt-300")}>{children}</span>
  );
}

/** Empty state used before any telemetry exists. */
export function EmptyState({ title, body }: { title: string; body: ReactNode }) {
  return (
    <div className="panel-inset grid-bg-fine flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="font-mono text-xs uppercase tracking-[0.18em] text-fog-600">{title}</p>
      <p className="max-w-sm text-sm text-fog-400">{body}</p>
    </div>
  );
}
