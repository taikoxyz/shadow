// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IEthMinter} from "../iface/IEthMinter.sol";

/// @title DummyEtherMinter
/// @notice Test-only minter that emits events without actually minting ETH.
/// @dev Used for testnet deployments where the protocol cannot mint real ETH.
/// @custom:security-contact security@taiko.xyz
contract DummyEtherMinter is IEthMinter {
    event EthMinted(address indexed recipient, uint256 amount);

    /// @inheritdoc IEthMinter
    function mintEth(address _recipient, uint256 _amount) external {
        emit EthMinted(_recipient, _amount);
    }
}
