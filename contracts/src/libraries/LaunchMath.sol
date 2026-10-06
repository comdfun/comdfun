// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {TickMath} from "v4-core/src/libraries/TickMath.sol";
import {FullMath} from "v4-core/src/libraries/FullMath.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title LaunchMath — opening tick of a token from a market cap
/// @notice UNAUDITED — experimental.
library LaunchMath {
    error BadPrice();

    /// @notice Tick at which a token with `supply` opens at `marketCap` (paired atomic units) — unaligned.
    /// @dev price = token1/token0 in atomic units; sqrtP = sqrt(num/den)·2^96. num·2^192/den overflows 256 bits
    ///      once num/den ≥ 2^64 (security review L-02), so large ratios use sqrt(num·2^96/den)·2^48 instead.
    function openingTick(bool tokenIs0, uint256 marketCap, uint256 supply) internal pure returns (int24) {
        (uint256 num, uint256 den) = tokenIs0 ? (marketCap, supply) : (supply, marketCap);
        uint256 sqrtP = num / den < (1 << 64)
            ? Math.sqrt(FullMath.mulDiv(num, 1 << 192, den))
            : Math.sqrt(FullMath.mulDiv(num, 1 << 96, den)) << 48;
        if (sqrtP < TickMath.MIN_SQRT_PRICE || sqrtP >= TickMath.MAX_SQRT_PRICE) revert BadPrice();
        return TickMath.getTickAtSqrtPrice(uint160(sqrtP));
    }
}
