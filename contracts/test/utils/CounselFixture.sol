// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {CounselNFT} from "../../src/CounselNFT.sol";

/// @notice Deploys the CounselNFT the way Deploy.s.sol does: implementation + ERC1967 proxy initialized atomically.
library CounselFixture {
    function deploy(address owner, address treasury, string memory baseURI) internal returns (CounselNFT) {
        CounselNFT impl = new CounselNFT();
        bytes memory init = abi.encodeCall(CounselNFT.initialize, (owner, baseURI, treasury));
        return CounselNFT(address(new ERC1967Proxy(address(impl), init)));
    }
}
