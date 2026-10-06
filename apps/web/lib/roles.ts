// The firm's role wallets on Robinhood Chain mainnet (4663). Static: these are the operator's accounts, not
// deployed contracts (contract addresses come from the @company/abi address book after deployment).

export interface RoleAddress { role: string; address: `0x${string}`; does: string }

export const ROLE_ADDRESSES: RoleAddress[] = [
  { role: "Deployer", address: "0x71A2e394A20bea28C6C80Dbdc8e238Da40050E29", does: "Deploys the contracts" },
  { role: "Admin", address: "0xe5375641670C965c264C234839cEbAc9f4e1d2FD", does: "Owns every contract" },
  { role: "Settler", address: "0x4ddFf58eEEC4D838fb9e7069fF48faFCD7a898e0", does: "Signs work records and reward roots" },
  { role: "Registrar", address: "0x620962425FF8539ecD9F1D02D71B336d61802D03", does: "Deploys the swarm's launches" },
  { role: "Keeper", address: "0x163Bdf367c6B20BC561439bdc0523D49cae6be19", does: "Runs buybacks and the revenue split" },
  { role: "Attester", address: "0x1aC3F8bd5dB5C26A5E1bcE2201c378b5fcBF8272", does: "Signs oracle rulings" },
];

export const BLOCKSCOUT = "https://robinhoodchain.blockscout.com";
export const roleExplorerUrl = (address: string) => `${BLOCKSCOUT}/address/${address}`;
