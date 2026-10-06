import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Address } from "viem";
import { PageHead } from "@/components/ui";
import { CoinDetail } from "@/components/inc/CoinDetail";

export const metadata: Metadata = { title: "Company coin" };
export default async function Coin({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) notFound();
  return (
    <div className="wrap">
      <PageHead crumbs={[{ label: "Company.md", href: "/" }, { label: "Incorporations", href: "/incorporations" }, { label: `${address.slice(0, 8)}…` }]} title="" />
      <CoinDetail address={address as Address} />
    </div>
  );
}
