// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {TickMath} from "v4-core/src/libraries/TickMath.sol";

/// @title TickAlign — tick rounding to a tick spacing
/// @notice Reviewed before launch (contracts/AUDIT.md).
library TickAlign {
    function floor(int24 tick, int24 spacing) internal pure returns (int24) {
        int24 c = tick / spacing;
        if (tick < 0 && tick % spacing != 0) c--;
        return c * spacing;
    }

    function ceil(int24 tick, int24 spacing) internal pure returns (int24) {
        int24 f = floor(tick, spacing);
        return f == tick ? tick : f + spacing;
    }

    function minUsable(int24 spacing) internal pure returns (int24) {
        return (TickMath.MIN_TICK / spacing) * spacing;
    }

    function maxUsable(int24 spacing) internal pure returns (int24) {
        return (TickMath.MAX_TICK / spacing) * spacing;
    }
}
