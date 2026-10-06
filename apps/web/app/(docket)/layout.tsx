import { DocketNav } from "@/components/DocketNav";

export default function DocketLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="wrap">
      <DocketNav />
      {children}
    </div>
  );
}
