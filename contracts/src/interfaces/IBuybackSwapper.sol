// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

/// @title IBuybackSwapper — pluggable ETH <-> COMD venue for the Flywheel and Incorporations
/// @notice $COMD is launched on Pons; its liquidity lives in a Uniswap v4 pool with Pons's own hook. The contracts
///         never talk to that pool directly: they call a swapper that the owner configures after graduation
///         (`UniswapV4PoolSwapper`), and can re-point if Pons's hook needs a different adapter.
/// @dev Exact-input swaps. ETH→COMD takes `msg.value`, refunds any unused ETH to the caller and delivers COMD to
///      `to`; COMD→ETH pulls `amountIn` from the caller (approval needed) and delivers ETH to `to`.
///      Implementations must revert when `out < minOut` or `block.timestamp > deadline`.
interface IBuybackSwapper {
    function swapExactETHForComd(uint256 minOut, address to, uint256 deadline) external payable returns (uint256);
    function swapExactComdForETH(uint256 amountIn, uint256 minOut, address to, uint256 deadline)
        external
        returns (uint256);
}
