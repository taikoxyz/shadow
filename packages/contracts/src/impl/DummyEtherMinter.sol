// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IEtherMinter} from "../iface/IEtherMinter.sol";

/// @custom:security-contact security@taiko.xyz

contract DummyEtherMinter is IEtherMinter {
    event EthMinted(address indexed recipient, uint256 amount);

    function mintEth(address _recipient, uint256 _amount) public {
        emit EthMinted(_recipient, _amount);
    }

    function mintEther(address _recipient, uint256 _amount) external {
        mintEth(_recipient, _amount);
    }
}
