// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

/// @custom:security-contact security@taiko.xyz
interface IEthMinter {
    /// @notice Mints ETH to the specified recipient.
    function mintEth(address _recipient, uint256 _amount) external;
}
