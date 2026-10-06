import type { Metadata } from "next";
import { PageHead } from "@/components/ui";
import { CoinList } from "@/components/inc/CoinList";

export const metadata: Metadata = { title: "Incorporations" };
export default function Incorporations() {
  return (
    <div className="wrap">
      <PageHead crumbs={[{ label: "Company.md", href: "/" }, { label: "Incorporations" }]} title="Incorporations" lede={<>Company coins, priced in $COMD and backed by it. You trade with ETH on the surface; <strong>underneath every buy is a $COMD buy</strong> on the official COMD/ETH pool.</>} />
      <CoinList />
    </div>
  );
}
