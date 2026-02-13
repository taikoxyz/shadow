// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IEthMinter} from "./IEthMinter.sol";

/// @custom:security-contact security@taiko.xyz
/// @notice Backward-compatible alias kept for legacy callers.
interface IEtherMinter is IEthMinter {
    /// @notice Legacy alias retained for historical compatibility.
    function mintEther(address _recipient, uint256 _amount) external;
}
