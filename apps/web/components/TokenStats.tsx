"use client";
import { useAccount } from "wagmi";
import { useRead } from "@/lib/useChain";
import { MOCK_CHAIN } from "@/lib/mock-chain";
import { units } from "@/lib/format";
import { TOTAL_SUPPLY } from "@/lib/config";

const DEAD = "0x000000000000000000000000000000000000dEaD";
import { MockTag } from "./Mocked";

export function TokenStats() {
  const { address } = useAccount();
  // Pons's token may have no burn(): "burned" = what sits at the dead address plus any supply reduction
  const supply = useRead<bigint>("ComdToken", "totalSupply", [], MOCK_CHAIN.token.totalSupply, { watch: true });
  const dead = useRead<bigint>("ComdToken", "balanceOf", [DEAD], MOCK_CHAIN.token.dead, { watch: true });
  const bal = useRead<bigint>("ComdToken", "balanceOf", [address], MOCK_CHAIN.token.balance, { enabled: !!address });
  const burned = supply.value != null ? TOTAL_SUPPLY - supply.value + (dead.value ?? 0n) : undefined;
  const pct = (a?: bigint) => (a != null ? `${((Number(a) / Number(TOTAL_SUPPLY)) * 100).toFixed(3)}%` : "—");
  return (
    <div className="stats rv-kids">
      <div className="stat rv"><span className="v">1,000,000,000</span><span className="k">Minted once · fixed</span></div>
      <div className="stat rv"><span className="v">Pons</span><span className="k">Launched · liquidity locked</span></div>
      <div className="stat rv"><span className="v">5%</span><span className="k">Tax per buy &amp; sell · in ETH</span></div>
      <div className="stat rv"><span className="v">{units(supply.value != null ? supply.value - (dead.value ?? 0n) : undefined, 18, 0)}</span><span className="k">Circulating<MockTag on={supply.mock} /></span></div>
      <div className="stat rv"><span className="v">{units(burned, 18, 0)}</span><span className="k">Burned (0x…dEaD) · {pct(burned)}</span></div>
      {address && <div className="stat rv"><span className="v">{units(bal.value, 18, 2)}</span><span className="k">You hold</span></div>}
    </div>
  );
}
