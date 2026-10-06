import type { Metadata } from "next";
import { PageHead } from "@/components/ui";
import { CoinList } from "@/components/inc/CoinList";

export const metadata: Metadata = { title: "Incorporations" };
export default function Incorporations() {
  return (
    <div className="wrap">
      <PageHead crumbs={[{ label: "Company.md", href: "/" }, { label: "Incorporations" }]} title="Incorporations" lede={<>Company coins, priced in $COMD and backed by it. You trade with ETH on the surface; <strong>underneath every buy is a $COMD buy</strong> on the official COMD/ETH pool. At <strong>400k $COMD</strong> raised a coin graduates into a locked <strong>Uniswap v4 pool paired with $COMD</strong>; its pool fees go to Counsel.</>} />
      <CoinList />
    </div>
  );
}
