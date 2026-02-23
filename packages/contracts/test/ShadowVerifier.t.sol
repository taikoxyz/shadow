// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {ShadowVerifier} from "../src/impl/ShadowVerifier.sol";
import {IAnchor} from "../src/iface/IAnchor.sol";
import {IShadow} from "../src/iface/IShadow.sol";
import {IShadowVerifier} from "../src/iface/IShadowVerifier.sol";
import {MockCircuitVerifier} from "./mocks/MockCircuitVerifier.sol";
import {MockAnchor} from "./mocks/MockAnchor.sol";

contract RevertingAnchor is IAnchor {
    function blockHashes(uint256) external pure returns (bytes32) {
        revert("anchor reverted");
    }
}

contract ShadowVerifierTest is Test {
    MockAnchor internal anchor;
    MockCircuitVerifier internal circuitVerifier;
    ShadowVerifier internal verifier;

    function setUp() public {
        anchor = new MockAnchor();
        circuitVerifier = new MockCircuitVerifier();
        verifier = new ShadowVerifier(address(anchor), address(circuitVerifier));
    }

    function test_constructor_RevertWhen_AnchorIsZeroAddress() external {
        vm.expectRevert(IShadowVerifier.ZeroAddress.selector);
        new ShadowVerifier(address(0), address(circuitVerifier));
    }

    function test_constructor_RevertWhen_CircuitVerifierIsZeroAddress() external {
        vm.expectRevert(IShadowVerifier.ZeroAddress.selector);
        new ShadowVerifier(address(anchor), address(0));
    }

    function test_verifyProof_succeeds() external {
        uint64 blockNumber = uint64(block.number);
        bytes32 blockHash = keccak256("blockhash");
        anchor.setBlockHash(blockNumber, blockHash);

        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: blockNumber,
            chainId: block.chainid,
            amount: 1 ether,
            recipient: address(0xBEEF),
            nullifier: keccak256("nullifier")
        });

        bool ok = verifier.verifyProof("", input);
        assertTrue(ok);
    }

    function test_verifyProof_RevertWhen_BlockNumberIsZero() external {
        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: 0,
            chainId: block.chainid,
            amount: 1 ether,
            recipient: address(0xBEEF),
            nullifier: keccak256("nullifier")
        });

        vm.expectRevert(abi.encodeWithSelector(IShadowVerifier.BlockHashNotFound.selector, uint64(0)));
        verifier.verifyProof("", input);
    }

    function test_verifyProof_RevertWhen_BlockHashIsZero() external {
        uint64 blockNumber = uint64(block.number);
        // Don't set block hash - it will be zero

        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: blockNumber,
            chainId: block.chainid,
            amount: 1 ether,
            recipient: address(0xBEEF),
            nullifier: keccak256("nullifier")
        });

        vm.expectRevert(abi.encodeWithSelector(IShadowVerifier.BlockHashNotFound.selector, blockNumber));
        verifier.verifyProof("", input);
    }

    function test_verifyProof_RevertWhen_ProofVerificationFails() external {
        uint64 blockNumber = uint64(block.number);
        bytes32 blockHash = keccak256("blockhash");
        anchor.setBlockHash(blockNumber, blockHash);
        circuitVerifier.setShouldVerify(false);

        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: blockNumber,
            chainId: block.chainid,
            amount: 1 ether,
            recipient: address(0xBEEF),
            nullifier: keccak256("nullifier")
        });

        vm.expectRevert(abi.encodeWithSelector(IShadowVerifier.ProofVerificationFailed.selector));
        verifier.verifyProof("", input);
    }

    function test_verifyProof_succeeds_withOldBlock() external {
        // Per PRD: "no freshness constraint is enforced (old blocks are acceptable)"
        uint64 oldBlockNumber = 1;
        bytes32 blockHash = keccak256("old-blockhash");
        anchor.setBlockHash(oldBlockNumber, blockHash);

        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: oldBlockNumber,
            chainId: block.chainid,
            amount: 1 ether,
            recipient: address(0xBEEF),
            nullifier: keccak256("nullifier-old-block")
        });

        bool ok = verifier.verifyProof("", input);
        assertTrue(ok);
    }

    function test_verifyProof_RevertWhen_FutureBlockNotInAnchor() external {
        // Future block would not have a hash in the anchor
        uint64 futureBlockNumber = uint64(block.number + 1000);
        // Don't set any block hash - simulates future block not existing

        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: futureBlockNumber,
            chainId: block.chainid,
            amount: 1 ether,
            recipient: address(0xBEEF),
            nullifier: keccak256("nullifier-future")
        });

        vm.expectRevert(abi.encodeWithSelector(IShadowVerifier.BlockHashNotFound.selector, futureBlockNumber));
        verifier.verifyProof("", input);
    }
}
