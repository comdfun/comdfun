// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @notice Minimal fixture contract for Clerk tests.
contract Counter {
    uint256 public number;
    address public immutable owner;

    event Incremented(uint256 newValue);

    constructor(address owner_) {
        owner = owner_;
    }

    function increment() external {
        number += 1;
        emit Incremented(number);
    }

    function setNumber(uint256 n) external {
        require(msg.sender == owner, "not owner");
        number = n;
    }
}
