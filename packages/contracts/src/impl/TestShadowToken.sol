// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {ShadowCompatibleERC20} from "./ShadowCompatibleERC20.sol";

/// @custom:security-contact security@taiko.xyz
/// @title  TestShadowToken
/// @notice Concrete ERC20 for testing Shadow ERC20 support on Hoodi.
///         Uses _BALANCE_SLOT = 0 (plain OZ ERC20 layout).
contract TestShadowToken is ShadowCompatibleERC20 {
    error OnlyDeployer();

    address private immutable _deployer;

    constructor(address _shadowContract, uint256 _maxShadowMintAmount)
        ShadowCompatibleERC20("Test Shadow Token", "TST", _shadowContract, _maxShadowMintAmount)
    {
        _deployer = msg.sender;
    }

    /// @notice Mint tokens for testing. Only callable by the deployer.
    function devMint(address _to, uint256 _amount) external {
        if (msg.sender != _deployer) revert OnlyDeployer();
        _mint(_to, _amount);
    }
}
