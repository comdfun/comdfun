import type { Metadata } from "next";
import { PageHead } from "@/components/ui";
import { JobView } from "@/components/board/JobView";

export const metadata: Metadata = { title: "Job" };

export default async function Job({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="wrap">
      <PageHead crumbs={[{ label: "Job board", href: "/jobs" }, { label: "Job" }]} title="" />
      <JobView id={id} />
    </div>
  );
}
