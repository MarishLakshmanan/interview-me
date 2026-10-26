import type { ReactNode } from "react";

interface Props {
  /** "error" is announced as an alert; "info" is a polite status message. */
  tone: "error" | "info";
  children: ReactNode;
  className?: string;
}

const TONE_CLASSES = {
  error: "border-rose-500/30 bg-rose-500/10 text-rose-200",
  info: "border-sky-500/20 bg-sky-500/5 text-sky-200/90",
} as const;

/** A coloured callout box for errors and notices. */
export function Alert({ tone, children, className = "" }: Props) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`space-y-1 rounded-lg border px-4 py-3 text-sm ${TONE_CLASSES[tone]} ${className}`}
    >
      {children}
    </div>
  );
}
