"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-renders a server page every `ms` while `active` (a matter, ruling or incorporation still in progress). */
export function LiveRefresh({ active, ms = 5000 }: { active: boolean; ms?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") router.refresh();
    }, ms);
    return () => clearInterval(id);
  }, [active, ms, router]);
  return null;
}
