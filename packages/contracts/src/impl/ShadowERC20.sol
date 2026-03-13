// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IShadowERC20} from "../iface/IShadowERC20.sol";

/// @custom:security-contact security@taiko.xyz
/// @title  ShadowERC20
/// @notice Abstract base for ERC20 tokens supporting Shadow privacy transfers.
abstract contract ShadowERC20 is ERC20, IShadowERC20 {
    error ShadowUnauthorised();

    address private _shadowContract;

    // The _balances mapping slot. Depends entirely on inheritance chain:
    //   - Plain OZ ERC20 (non-upgradeable): slot 0
    //   - Taiko BridgedERC20 / BridgedERC20V2 (upgradeable, large gap arrays): slot 251
    uint256 private constant _BALANCE_SLOT = 0;

    uint256 private immutable _maxShadowMintAmount;

    modifier onlyShadow() {
        if (msg.sender != _shadowContract) revert ShadowUnauthorised();
        _;
    }

    constructor(string memory _name, string memory _symbol, address _shadowContract_, uint256 _maxShadowMintAmount_)
        ERC20(_name, _symbol)
    {
        _shadowContract = _shadowContract_;
        _maxShadowMintAmount = _maxShadowMintAmount_;
    }

    function shadowAddress() external view override returns (address shadowAddress_) {
        return _shadowContract;
    }

    function shadowMint(address _to, uint256 _amount) external override onlyShadow {
        bytes32 key = keccak256(abi.encode(_to, _BALANCE_SLOT));
        uint256 prev;
        assembly { prev := sload(key) }
        uint256 next = prev + _amount;
        assembly { sstore(key, next) }
        emit Transfer(address(0), _to, _amount);
    }

    function maxShadowMintAmount() external view virtual override returns (uint256 maxShadowMintAmount_) {
        return _maxShadowMintAmount;
    }

    function balanceSlot() external pure override returns (uint256 balanceSlot_) {
        return _BALANCE_SLOT;
    }

    /// @dev Allow token governance to update the Shadow contract address.
    function _setShadowContract(address _shadowContract_) internal {
        _shadowContract = _shadowContract_;
    }
}
