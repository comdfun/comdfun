// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Counter} from "../src/Counter.sol";

/// No forge-std in the fixture: failures are plain reverts, which forge reports as failed tests.
contract CounterTest {
    Counter internal counter;

    function setUp() public {
        counter = new Counter(address(this));
    }

    function test_Increment() public {
        counter.increment();
        require(counter.number() == 1, "increment");
    }

    function test_SetNumberByOwner() public {
        counter.setNumber(42);
        require(counter.number() == 42, "set");
    }

    function testFuzz_SetNumber(uint256 x) public {
        counter.setNumber(x);
        require(counter.number() == x, "fuzz");
    }
}
