// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Counter} from "../src/Counter.sol";

interface Vm {
    function envUint(string calldata name) external view returns (uint256);
    function envOr(string calldata name, address defaultValue) external view returns (address);
    function addr(uint256 privateKey) external pure returns (address);
    function startBroadcast(uint256 privateKey) external;
    function stopBroadcast() external;
}

/// Launch script convention used by the Registrar (see skills/evm-project-launch):
/// reads DEPLOYER_PRIVATE_KEY, PROJECT_FACTORY, LAUNCH_MANIFEST from env and returns named addresses.
contract Launch {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (address counter) {
        uint256 pk = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address owner = vm.envOr("LAUNCH_OWNER", vm.addr(pk));
        vm.startBroadcast(pk);
        counter = address(new Counter(owner));
        vm.stopBroadcast();
    }
}
