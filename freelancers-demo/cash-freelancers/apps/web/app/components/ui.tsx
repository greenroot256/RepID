import type { ReactNode } from "react";

export type Tone = "default" | "warn" | "danger";

const TONE_CLASS: Record<Tone, string> = {
  default: "pill",
  warn: "pill pill-warn",
  danger: "pill pill-danger"
};

export function Pill({ children, tone = "default" }: { children: ReactNode; tone?: Tone }) {
  return <span className={TONE_CLASS[tone]}>{children}</span>;
}

export function EmptyState({
  title,
  children
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <h3>{title}</h3>
      {children}
    </div>
  );
}

export function Notice({
  children,
  tone = "default"
}: {
  children: ReactNode;
  tone?: "default" | "warn" | "danger";
}) {
  const className = tone === "default" ? "notice" : `notice notice-${tone}`;
  return (
    <p className={className} role={tone === "default" ? undefined : "alert"}>
      {children}
    </p>
  );
}

export function Field({
  label,
  hint,
  error,
  children
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
      {hint && !error && <p className="hint">{hint}</p>}
      {error && <p className="field-error">{error}</p>}
    </div>
  );
}

/** The reference's "step 1 / 2 / 3" progress list, with a done/current state. */
export function StepList({
  steps,
  current
}: {
  steps: string[];
  /** Index of the step in progress; everything before it is done. */
  current: number;
}) {
  return (
    <ul className="step-list">
      {steps.map((label, index) => (
        <li
          key={label}
          className={index < current ? "done" : index === current ? "current" : undefined}
        >
          <span className="marker" aria-hidden="true">
            {index < current ? "✓" : index + 1}
          </span>
          <span>{label}</span>
        </li>
      ))}
    </ul>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="wallet-address" role="status">
      <span className="spinner" aria-hidden="true" />
      {label ?? "Loading…"}
    </span>
  );
}
