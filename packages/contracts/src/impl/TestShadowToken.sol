// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ShadowCompatibleERC20} from "./ShadowCompatibleERC20.sol";

/// @title  TestShadowToken
/// @notice Concrete ERC20 for testing Shadow ERC20 support on Hoodi.
///         Uses _BALANCE_SLOT = 0 (plain OZ ERC20 layout).
contract TestShadowToken is ShadowCompatibleERC20 {
    address private immutable _deployer;

    constructor(address shadowContract_, uint256 maxShadowMintAmount_)
        ShadowCompatibleERC20("Test Shadow Token", "TST", shadowContract_, maxShadowMintAmount_)
    {
        _deployer = msg.sender;
    }

    /// @notice Mint tokens for testing. Only callable by the deployer.
    function devMint(address to, uint256 amount) external {
        require(msg.sender == _deployer, "only deployer");
        _mint(to, amount);
    }
}
