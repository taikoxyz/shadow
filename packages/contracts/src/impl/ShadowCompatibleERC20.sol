// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IShadowCompatibleToken} from "../iface/IShadowCompatibleToken.sol";

/// @title  ShadowCompatibleERC20
/// @notice Abstract base for ERC20 tokens supporting Shadow privacy transfers.
abstract contract ShadowCompatibleERC20 is ERC20, IShadowCompatibleToken {
    address private _shadowContract;

    // The _balances mapping slot. Depends entirely on inheritance chain:
    //   - Plain OZ ERC20 (non-upgradeable): slot 0
    //   - Taiko BridgedERC20 / BridgedERC20V2 (upgradeable, large gap arrays): slot 251
    // Override balanceStorageSlot() if your token uses a different slot.
    uint256 private constant _BALANCE_SLOT = 0;

    uint256 private immutable _maxShadowMintAmount;

    modifier onlyShadow() {
        if (msg.sender != _shadowContract) revert ShadowUnauthorised();
        _;
    }

    constructor(string memory name_, string memory symbol_, address shadowContract_, uint256 maxShadowMintAmount_)
        ERC20(name_, symbol_)
    {
        _shadowContract = shadowContract_;
        _maxShadowMintAmount = maxShadowMintAmount_;
    }

    function shadowMint(address to, uint256 amount) external override onlyShadow {
        _mint(to, amount);
    }

    function maxShadowMintAmount() external view virtual override returns (uint256) {
        return _maxShadowMintAmount;
    }

    function balanceStorageSlot(address holder) external pure override returns (bytes32) {
        bytes32 key;
        assembly {
            mstore(0x00, holder)
            mstore(0x20, _BALANCE_SLOT)
            key := keccak256(0x00, 0x40)
        }
        return key;
    }

    /// @dev Allow token governance to update the Shadow contract address.
    function _setShadowContract(address shadowContract_) internal {
        _shadowContract = shadowContract_;
    }
}
