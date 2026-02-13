// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IEtherMinter} from "../../src/iface/IEtherMinter.sol";

contract MockEtherMinter is IEtherMinter {
    address public lastRecipient;
    uint256 public lastAmount;
    uint256 public mintCount;
    bool public shouldRevert;

    error MintFailed();

    function setShouldRevert(bool _shouldRevert) external {
        shouldRevert = _shouldRevert;
    }

    function mintEther(address _recipient, uint256 _amount) external {
        mintEth(_recipient, _amount);
    }

    function mintEth(address _recipient, uint256 _amount) public {
        if (shouldRevert) revert MintFailed();
        lastRecipient = _recipient;
        lastAmount = _amount;
        mintCount++;
    }
}
