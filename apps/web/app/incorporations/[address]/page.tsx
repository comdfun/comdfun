import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { Address } from "viem";
import { PageHead } from "@/components/ui";
import { CoinDetail } from "@/components/inc/CoinDetail";
import { createPublicClient, erc20Abi } from "viem";
import { activeChain, rpcTransport } from "@/lib/chains";
import { isHiddenCoin } from "@/lib/hidden-coins";

export const dynamic = "force-dynamic";

/** Whether this address is a coin the site does not carry. Read on the server so its page never renders. */
async function hidden(address: string): Promise<boolean> {
  if (isHiddenCoin({ address })) return true;
  try {
    const c = createPublicClient({ chain: activeChain, transport: rpcTransport({ timeout: 4_000 }) });
    const [symbol, name] = await Promise.all([
      c.readContract({ address: address as Address, abi: erc20Abi, functionName: "symbol" }),
      c.readContract({ address: address as Address, abi: erc20Abi, functionName: "name" }),
    ]);
    return isHiddenCoin({ symbol, name });
  } catch {
    return false; // the client checks again once it has read the coin
  }
}

export const metadata: Metadata = { title: "Company coin" };
export default async function Coin({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) notFound();
  if (await hidden(address)) notFound();
  return (
    <div className="wrap">
      <PageHead crumbs={[{ label: "Company.md", href: "/" }, { label: "Incorporations", href: "/incorporations" }, { label: `${address.slice(0, 8)}…` }]} title="" />
      <CoinDetail address={address as Address} />
    </div>
  );
}
