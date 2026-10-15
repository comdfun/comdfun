"use client";
// The site header and footer, everywhere but the films, which render full-bleed.
import { usePathname } from "next/navigation";

export function Chrome({ children }: { children: React.ReactNode }) {
  return (usePathname() ?? "").startsWith("/film") ? null : <>{children}</>;
}
