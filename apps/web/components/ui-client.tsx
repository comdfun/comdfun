"use client";
import type { ReactNode } from "react";
export function Badge({ tone, children }: { tone?: "brass" | "ok" | "bad" | "muted"; children: ReactNode }) {
  return <span className={`badge ${tone && tone !== "muted" ? tone : ""}`}>{children}</span>;
}
