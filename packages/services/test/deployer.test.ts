import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { deployLaunch, LaunchRefusedError, parseBroadcast, validateLaunchManifest, type LaunchPolicy } from "../src/index.ts";
import { FORGE_BIN, HAVE_FOUNDRY, cleanupAll, foundryFixture } from "./helpers/util.ts";

after(cleanupAll);

const policy: LaunchPolicy = {
  version: 3,
  kind: "evm_contracts",
  params: {
    chainId: 46630,
    feeTiers: [500, 3000, 10000],
    rewardRule: "equal_connected",
    totalSupply: "1000000000000000000000000000",
    treasuryBps: 1000,
    liquidityBps: 8000,
    contributorPoolBps: 1000,
    recentContributorBps: 800,
    recentContributorWindowSeconds: 43200,
    contributorLockSeconds: 3600,
    perWalletCapBps: 3000,
    poolFloorBps: 1000,
    gasCeilingWei: "50000000000000000",
    pairedCurrencyAllowlist: ["eth", "comd"],
  },
};

describe("launch manifest validation", () => {
  test("accepts a valid manifest and enforces policy", () => {
    const m = { schema: "company.launch.v1", kind: "custom_token", chainId: 46630, script: "script/Launch.s.sol:Launch", token: { name: "Brief", symbol: "BRF" }, pool: { pairWith: "eth", feeTier: 3000 }, economics: { poolBps: 8800, initialMarketCapWei: "10000000000000000000", remainderTo: "0x000000000000000000000000000000000000bEEF" } };
    assert.deepEqual(validateLaunchManifest(m, { ...policy, kind: "custom_token" }), []);
    const errs = validateLaunchManifest({ ...m, chainId: 4663, pool: { pairWith: "doge", feeTier: 100 }, economics: { ...m.economics, poolBps: 9500 } }, { ...policy, kind: "custom_token" });
    for (const needle of ["poolBps must be 1000-9000", "policy chainId", "feeTier 100", "pairWith doge"]) assert.ok(errs.some((e) => e.includes(needle)), `${needle} in ${errs}`);
    assert.ok(validateLaunchManifest({ schema: "company.launch.v1", kind: "evm_contracts", chainId: 1, script: "script/X.s.sol:X", contracts: [] }).some((e) => e.includes("1-8")));
    assert.ok(validateLaunchManifest({ schema: "company.launch.v1", kind: "evm_contracts", chainId: 1, script: "../evil.s.sol:X", contracts: [{ name: "A" }] }).length > 0);
    assert.ok(validateLaunchManifest({ schema: "company.launch.v1", kind: "evm_contracts", chainId: 1, script: "script/X.s.sol:X", contracts: [{ name: "A", args: ["$env:SECRET"] }] }).some((e) => e.includes("placeholders")));
  });
});

describe("deployLaunch", () => {
  test("refuses a live deploy without key/rpc/factory, and a chain mismatch", async () => {
    const dir = await foundryFixture();
    await assert.rejects(deployLaunch({ policy, projectDir: dir, chainId: 46630 }), (e: unknown) => e instanceof LaunchRefusedError && e.problems.length === 3);
    await assert.rejects(deployLaunch({ policy, projectDir: dir, chainId: 4663, dryRun: true }), /chainId/);
  });

  test("dry run without forge returns a plan", async () => {
    const dir = await foundryFixture();
    const r = await deployLaunch({ policy, projectDir: dir, chainId: 46630, dryRun: true, forgeBin: "/nonexistent/forge" });
    assert.equal(r.mode, "plan");
    assert.equal(r.script, "script/Launch.s.sol:Launch");
    assert.equal(r.command, "forge script script/Launch.s.sol:Launch --json");
    assert.equal(r.gasCeilingWei, "50000000000000000");
    assert.ok(r.notes.some((n) => n.includes("forge not found")));
  });

  test("dry run simulates in forge's in-memory EVM", { skip: !HAVE_FOUNDRY && "forge/solc not available" }, async () => {
    const dir = await foundryFixture();
    const r = await deployLaunch({ policy, projectDir: dir, chainId: 46630, dryRun: true, forgeBin: FORGE_BIN, gasPriceWei: 10_000_000n });
    assert.equal(r.mode, "dry-run");
    assert.match(r.addresses.counter, /^0x[0-9a-fA-F]{40}$/, JSON.stringify(r));
    assert.equal(r.addresses.Counter, r.addresses.counter);
    assert.ok(BigInt(r.gasUsed) > 50_000n);
    assert.equal(r.costWei, (BigInt(r.gasUsed) * 10_000_000n).toString());
    assert.equal(r.withinCeiling, true);
    assert.equal(r.transactions[0].contractName, "Counter");

    // a ceiling below the simulated cost is reported (and would refuse a live deploy)
    const tight = await deployLaunch({ policy: { ...policy, params: { ...policy.params, gasCeilingWei: "1" } }, projectDir: dir, chainId: 46630, dryRun: true, forgeBin: FORGE_BIN, gasPriceWei: 1n });
    assert.equal(tight.withinCeiling, false);
  });

  test("a reverting script fails the simulation", { skip: !HAVE_FOUNDRY && "forge/solc not available" }, async () => {
    const dir = await foundryFixture();
    const p = path.join(dir, "script/Launch.s.sol");
    await writeFile(p, `// SPDX-License-Identifier: MIT\npragma solidity 0.8.26;\ncontract Launch { function run() external pure { revert("not today"); } }\n`);
    await assert.rejects(deployLaunch({ policy, projectDir: dir, chainId: 46630, dryRun: true, forgeBin: FORGE_BIN }), /simulation failed/);
  });
});

describe("parseBroadcast", () => {
  test("extracts addresses, transactions, gas and cost", () => {
    const json = {
      transactions: [
        { hash: "0xaa", transactionType: "CREATE", contractName: "Token", contractAddress: "0x1111111111111111111111111111111111111111", function: null, transaction: { gas: "0x30d40" } },
        { hash: "0xbb", transactionType: "CALL", contractName: "ProjectFactory", contractAddress: "0x2222222222222222222222222222222222222222", function: "launch(bytes)", transaction: { gas: "0x186a0" }, additionalContracts: [{ transactionType: "CREATE2", address: "0x3333333333333333333333333333333333333333" }] },
      ],
      receipts: [
        { transactionHash: "0xaa", gasUsed: "0x30000", effectiveGasPrice: "0x3b9aca00" },
        { transactionHash: "0xbb", gasUsed: "0x10000", effectiveGasPrice: "0x3b9aca00" },
      ],
    };
    const r = parseBroadcast(json);
    assert.deepEqual(r.addresses, { Token: "0x1111111111111111111111111111111111111111" });
    assert.equal(r.transactions.length, 3);
    assert.equal(r.transactions[2].contractAddress, "0x3333333333333333333333333333333333333333");
    assert.equal(r.gasUsed, 0x40000n);
    assert.equal(r.costWei, 0x40000n * 1_000_000_000n);
    assert.equal(r.estimatedGas, 0x30d40n + 0x186a0n);
  });
});
