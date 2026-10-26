import type { HTMLAttributes } from "react";

/** A rounded dark panel that groups related content. */
export function Card({ className = "", ...rest }: HTMLAttributes<HTMLElement>) {
  return <section className={`rounded-2xl border border-zinc-800 bg-zinc-900/70 p-5 sm:p-6 ${className}`} {...rest} />;
}
