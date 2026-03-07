// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ShadowCompatibleERC20} from "./ShadowCompatibleERC20.sol";

/// @title  TestShadowToken
/// @notice Concrete ERC20 for testing Shadow ERC20 support on Hoodi.
///         Uses _BALANCE_SLOT = 0 (plain OZ ERC20 layout).
contract TestShadowToken is ShadowCompatibleERC20 {
    constructor(address shadowContract_, uint256 maxShadowMintAmount_)
        ShadowCompatibleERC20("Test Shadow Token", "TST", shadowContract_, maxShadowMintAmount_)
    {}
}
