"use client";
// The site header, ticker, footer and status bar everywhere except the front door. The gate is a choice between
// two products; a nav bar listing the insides of both is the thing it exists to spare people.
import { usePathname } from "next/navigation";

export function Chrome({ children }: { children: React.ReactNode }) {
  return usePathname() === "/" ? null : <>{children}</>;
}
