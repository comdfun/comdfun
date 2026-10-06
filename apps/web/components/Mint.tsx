"use client";
import { useEffect, useState } from "react";
import { useAccount, useWriteContract } from "wagmi";
import type { Abi, Hex } from "viem";
import { contract } from "@/lib/contracts";
import { ALLOWLIST_URL, MOCK } from "@/lib/config";
import { MOCK_CHAIN } from "@/lib/mock-chain";
import { useRead } from "@/lib/useChain";
import { units, fmtNum } from "@/lib/format";
import { TxButton } from "./tx/TxButton";
import { MockTag, NotDeployed } from "./Mocked";
import { celebrate } from "@/lib/fx";

const PHASES = ["Closed", "Allowlist", "Public"];

export function Mint() {
  const { address } = useAccount();
  const nft = contract("CounselNFT");
  const M = MOCK_CHAIN.counsel;
  const phase = useRead<number>("CounselNFT", "phase", [], M.phase, { watch: true });
  const price = useRead<bigint>("CounselNFT", "price", [], M.price);
  const supply = useRead<bigint>("CounselNFT", "totalSupply", [], M.totalSupply, { watch: true });
  const max = useRead<bigint>("CounselNFT", "MAX_SUPPLY", [], M.maxSupply);
  const perWallet = useRead<bigint>("CounselNFT", "maxPerWallet", [], M.maxPerWallet);
  const minted = useRead<bigint>("CounselNFT", "mintedBy", [address], M.mintedBy, { enabled: !!address });
  // the contract owner (Admin) gets a small control panel here, so the phase can be changed without an explorer
  const owner = useRead<string>("CounselNFT", "owner", []);
  const baseURI = useRead<string>("CounselNFT", "baseURI", []);
  const isOwner = !!address && !!owner.value && owner.value.toLowerCase() === address.toLowerCase();
  const [qty, setQty] = useState(1);
  const [proof, setProof] = useState<Hex[] | null | undefined>(undefined);
  const { writeContractAsync } = useWriteContract();

  useEffect(() => {
    setProof(undefined);
    if (!address || phase.value !== 1 || !ALLOWLIST_URL) return;
    fetch(ALLOWLIST_URL)
      .then((r) => r.json())
      .then((j) => {
        const book = (j.proofs ?? j) as Record<string, Hex[]>;
        const key = Object.keys(book).find((k) => k.toLowerCase() === address.toLowerCase());
        setProof(key ? book[key] : null);
      })
      .catch(() => setProof(null));
  }, [address, phase.value]);

  const left = perWallet.value != null ? Number(perWallet.value - (minted.value ?? 0n)) : 2;
  const soldOut = supply.value != null && max.value != null && supply.value >= max.value;
  const total = (price.value ?? 0n) * BigInt(qty);
  const pct = supply.value != null && max.value ? Number(supply.value) / Number(max.value) : 0;
  const p = phase.value ?? 0;
  const canMint = !!nft.address && !soldOut && left > 0 && (p === 2 || (p === 1 && !!proof));
  const free = price.value === 0n || price.value == null;

  return (
    <div className="folder c-lime" data-tab="Counsel · 2,000 in all" style={{ display: "grid", gap: 16 }}>
      {!nft.address && !MOCK && <NotDeployed name="CounselNFT" />}
      <div className="mint-price">{free ? "Free mint" : `${units(price.value, 18, 4)} ETH`}<small>{free ? "Price 0 · you pay gas only" : "per Counsel, plus gas"}<MockTag on={price.mock} /></small></div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="label">Phase<MockTag on={phase.mock} /></span>
        <span className={`badge fill ${p === 2 ? "ok" : p === 1 ? "brass" : ""} ${p ? "live" : ""}`}>{PHASES[p] ?? "—"}</span>
      </div>
      <div>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
          <span className="num" style={{ fontSize: 34, color: "var(--lime)", lineHeight: 1 }}>{fmtNum(supply.value)} <span className="muted">/ {fmtNum(max.value)}</span></span>
          <span className="small muted">Counsel minted</span>
        </div>
        <div className="meter rv c-lime"><span style={{ width: `${pct * 100}%` }} /></div>
      </div>
      <dl className="kv">
        <dt>Price</dt><dd>{free ? <span className="ok">Free · 0 ETH (gas only)</span> : `${units(price.value, 18, 4)} ETH`}</dd>
        <dt>Per wallet</dt><dd>{fmtNum(perWallet.value)}{address ? ` · you have minted ${fmtNum(minted.value)}` : ""}</dd>
        <dt>Royalty</dt><dd>5% to the treasury (ERC-2981)</dd>
      </dl>
      <div className="row">
        <span className="label">Quantity</span>
        <div className="seg" role="group" aria-label="Quantity">
          <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="One fewer">−</button>
          <button type="button" aria-pressed="true" aria-live="polite">{qty}</button>
          <button type="button" onClick={() => setQty((q) => Math.min(Math.max(1, left), q + 1))} aria-label="One more">+</button>
        </div>
        <span className="small muted">Total {total === 0n ? <span className="ok">free</span> : `${units(total, 18, 4)} ETH`}</span>
      </div>
      {p === 1 && address && (
        <p className="small" role="status">{!ALLOWLIST_URL ? "Allowlist proofs are not published yet." : proof === undefined ? "Checking the allowlist…" : proof ? <span className="ok">This wallet is on the allowlist.</span> : <span className="err-text">This wallet is not on the allowlist. Wait for the public phase.</span>}</p>
      )}
      <TxButton
        label={soldOut ? "Sold out" : p === 0 ? "Minting closed" : left <= 0 ? "Wallet limit reached" : free ? `Free mint · ${qty} Counsel` : `Mint ${qty} Counsel`}
        disabled={!canMint}
        run={() =>
          p === 1
            ? writeContractAsync({ address: nft.address!, abi: nft.abi as Abi, functionName: "allowlistMint", args: [BigInt(qty), proof!], value: total } as never)
            : writeContractAsync({ address: nft.address!, abi: nft.abi as Abi, functionName: "mint", args: [BigInt(qty)], value: total } as never)
        }
        onDone={() => { supply.refetch(); minted.refetch(); celebrate("Seated"); }}
      />
      {isOwner && (
        <div className="card c-gold" style={{ display: "grid", gap: 10, marginTop: 6 }}>
          <span className="label">Owner controls · you are the contract owner</span>
          <div className="btn-row">
            {PHASES.map((label, i) => (
              <TxButton
                key={label}
                label={p === i ? `${label} (current)` : `Set ${label.toLowerCase()}`}
                disabled={p === i}
                run={() => writeContractAsync({ address: nft.address!, abi: nft.abi as Abi, functionName: "setPhase", args: [i] } as never)}
                onDone={() => { phase.refetch(); celebrate(`Phase: ${label}`); }}
              />
            ))}
          </div>
          <span className="small muted">Closed → nobody mints · Allowlist → Merkle proofs only · Public → anyone, free, {fmtNum(perWallet.value)} per wallet. Changes are on-chain transactions from this wallet.</span>
          <div className="btn-row" style={{ marginTop: 4 }}>
            <TxButton
              label="Refresh metadata on marketplaces"
              disabled={!baseURI.value}
              run={() => writeContractAsync({ address: nft.address!, abi: nft.abi as Abi, functionName: "setBaseURI", args: [baseURI.value] } as never)}
              onDone={() => celebrate("Metadata refresh emitted")}
            />
          </div>
          <span className="small muted">Re-sets the current base URI, which emits ERC-4906 <code>BatchMetadataUpdate(1, 2000)</code>: OpenSea and other marketplaces re-read every Counsel&apos;s traits and image. One transaction, cents of gas; use it whenever the metadata changes.</span>
        </div>
      )}
    </div>
  );
}
