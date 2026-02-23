// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IEthMinter} from "../../src/iface/IEthMinter.sol";

contract MockEtherMinter is IEthMinter {
    address public lastRecipient;
    uint256 public lastAmount;
    uint256 public mintCount;
    address public firstRecipient;
    uint256 public firstAmount;
    address public secondRecipient;
    uint256 public secondAmount;
    uint256 public revertOnMintNumber;
    bool public shouldRevert;

    error MintFailed();

    function setShouldRevert(bool _shouldRevert) external {
        shouldRevert = _shouldRevert;
    }

    function setRevertOnMintNumber(uint256 _n) external {
        revertOnMintNumber = _n;
    }

    function reset() external {
        lastRecipient = address(0);
        lastAmount = 0;
        mintCount = 0;
        firstRecipient = address(0);
        firstAmount = 0;
        secondRecipient = address(0);
        secondAmount = 0;
        revertOnMintNumber = 0;
        shouldRevert = false;
    }

    function mintEth(address _recipient, uint256 _amount) external {
        uint256 nextMintNumber = mintCount + 1;
        if (shouldRevert) revert MintFailed();
        if (revertOnMintNumber != 0 && nextMintNumber == revertOnMintNumber) revert MintFailed();
        if (mintCount == 0) {
            firstRecipient = _recipient;
            firstAmount = _amount;
        } else if (mintCount == 1) {
            secondRecipient = _recipient;
            secondAmount = _amount;
        }
        lastRecipient = _recipient;
        lastAmount = _amount;
        mintCount++;
    }
}
