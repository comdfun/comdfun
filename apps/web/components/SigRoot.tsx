"use client";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/** Each route family gets a signature colour (CSS [data-sig]). */
export function sigFor(path: string) {
  const m = (p: string) => path === p || path.startsWith(`${p}/`);
  if (m("/jobs") || m("/launches")) return "matters";
  if (m("/oracle")) return "rulings";
  if (m("/published")) return "filings";
  if (m("/heartbeats")) return "retainers";
  if (m("/agents") || m("/mint") || m("/pair")) return "counsel";
  if (m("/launch")) return "retain";
  if (m("/swap") || m("/token")) return "comd";
  if (m("/stake")) return "stake";
  if (m("/bond")) return "bond";
  if (m("/flywheel")) return "flywheel";
  if (m("/incorporations")) return "incorporations";
  if (m("/docs")) return "docs";
  return "home";
}

export function SigRoot({ children }: { children: ReactNode }) {
  const path = usePathname() || "/";
  return (
    <div className="sig-root" data-sig={sigFor(path)}>
      {children}
    </div>
  );
}
