import type { Metadata } from "next";
import { DocView } from "@/components/docs/DocView";

export const metadata: Metadata = { title: "Docs" };
export default function DocsHome() {
  return <DocView slug="introduction" />;
}
