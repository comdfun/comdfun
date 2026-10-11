/**
 * The matter share card. It is drawn from whatever the docket happens to hold, so what matters is that nothing can
 * make it crash or spill: a question in a language the 3×5 face has never seen, a token id that is not a Counsel,
 * a status longer than the chip, a matter with no seats at all. The card is 1200×630 in every one of those cases.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { filingCard, renderFilingCardPNG } from "../src/index.js";

const dims = (b: Buffer) => ({ w: b.readUInt32BE(16), h: b.readUInt32BE(20) });
const base = { docket: "Matter 2026-0412", objective: "Which stablecoins are natively issued on Robinhood Chain?", status: "On the record" };

test("the card is 1200×630 whatever it is handed", () => {
  const cases: Parameters<typeof filingCard>[0][] = [
    base,
    { ...base, tokenIds: [7, 1776, 42], facts: "3 counsel · 7 submissions · cross-examined", tone: "ok" },
    { ...base, tokenIds: [], facts: "", tone: "work" },
    { ...base, objective: "", status: "", docket: "" },
    { ...base, objective: "x".repeat(4000), status: "A STATUS FAR LONGER THAN ANY CHIP SHOULD EVER CARRY", facts: "y".repeat(400) },
    { ...base, objective: "日本語の質問です。これは三行に収まりますか。", facts: "ممتاز" },
    { ...base, objective: "Compare “smart” wallets — ERC-4337 vs EIP-7702 — and say which you'd build on; cite sources.", tone: "bad" },
    { ...base, tokenIds: [0, -5, 2001, 3.5, NaN, 12] as number[] },
    { ...base, url: "comd.fun/jobs/0123456789abcdef0123456789abcdef" },
  ];
  for (const c of cases) {
    const a = filingCard(c);
    assert.deepEqual([a.r.w * a.unit, a.r.h * a.unit], [1200, 630], JSON.stringify(c).slice(0, 80));
    assert.deepEqual(dims(renderFilingCardPNG(c)), { w: 1200, h: 630 });
  }
});

test("two matters do not draw the same card, and one matter always draws the same card", () => {
  const a = renderFilingCardPNG({ ...base, tokenIds: [7] });
  const b = renderFilingCardPNG({ ...base, tokenIds: [8] });
  assert.ok(!a.equals(b), "different Counsel, different card");
  assert.ok(a.equals(renderFilingCardPNG({ ...base, tokenIds: [7] })), "the same matter renders byte for byte the same");
  assert.ok(!a.equals(renderFilingCardPNG({ ...base, tokenIds: [7], status: "Being written" })), "the state shows");
});
