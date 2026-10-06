import type { ReactNode } from "react";
import { DOCS, DOC_GROUPS } from "@/lib/docs/pages";
import { mdText } from "@/lib/md";
import { BASICS, READ, WRITE } from "@/lib/docs-data";
import { DocsNav, type DocIndexEntry } from "@/components/docs/DocsNav";

const apiText = [...BASICS, ...READ, ...WRITE].map((s) => `${s.title} ${s.intro ?? ""} ${(s.routes ?? []).map((r) => `${r.m} ${r.p} ${r.d}`).join(" ")}`).join(" ");

const INDEX: DocIndexEntry[] = [
  ...DOCS.map((d) => ({ slug: d.slug, href: d.slug === "introduction" ? "/docs" : `/docs/${d.slug}`, title: d.title, group: d.group, summary: d.summary, text: mdText(d.md).slice(0, 6000) })),
  { slug: "api", href: "/docs/api", title: "API reference", group: "Reference", summary: "Every public route of the control plane, with examples.", text: apiText.slice(0, 12000) },
];
// keep the API reference right after Contracts in the Reference group
INDEX.sort((a, b) => DOC_GROUPS.indexOf(a.group as never) - DOC_GROUPS.indexOf(b.group as never));

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="wrap">
      <div className="docs-shell">
        <DocsNav index={INDEX} groups={DOC_GROUPS} />
        <div className="docs-main">{children}</div>
      </div>
    </div>
  );
}
