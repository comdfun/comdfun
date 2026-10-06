import type { Metadata } from "next";
import { DocView } from "@/components/docs/DocView";
import { DOCS, DOC_BY_SLUG } from "@/lib/docs/pages";

export function generateStaticParams() {
  return DOCS.filter((d) => d.slug !== "introduction").map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const d = DOC_BY_SLUG.get((await params).slug);
  return { title: d ? `${d.title} · Docs` : "Docs", description: d?.summary };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  return <DocView slug={(await params).slug} />;
}
