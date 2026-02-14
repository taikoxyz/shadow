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
        uint48 blockNumber = uint48(block.number);
        bytes32 blockHash = keccak256("block");
        anchor.setBlockHash(blockNumber, blockHash);

        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: blockNumber,
            blockHash: blockHash,
            chainId: block.chainid,
            noteIndex: 1,
            amount: 1 ether,
            recipient: address(0xBEEF),
            nullifier: keccak256("nullifier"),
            powDigest: bytes32(uint256(1) << 24)
        });

        bool ok = verifier.verifyProof("", input);
        assertTrue(ok);
    }

    function test_verifyProof_RevertWhen_BlockNumberIsZero() external {
        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: 0,
            blockHash: bytes32(uint256(1)),
            chainId: block.chainid,
            noteIndex: 1,
            amount: 1 ether,
            recipient: address(0xBEEF),
            nullifier: keccak256("nullifier"),
            powDigest: bytes32(uint256(1) << 24)
        });

        vm.expectRevert(abi.encodeWithSelector(IShadowVerifier.BlockHashNotFound.selector, uint48(0)));
        verifier.verifyProof("", input);
    }

    function test_verifyProof_RevertWhen_BlockHashMismatch() external {
        uint48 blockNumber = uint48(block.number);
        bytes32 expectedBlockHash = keccak256("expected");
        bytes32 actualBlockHash = keccak256("actual");
        anchor.setBlockHash(blockNumber, expectedBlockHash);

        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: blockNumber,
            blockHash: actualBlockHash,
            chainId: block.chainid,
            noteIndex: 1,
            amount: 1 ether,
            recipient: address(0xBEEF),
            nullifier: keccak256("nullifier"),
            powDigest: bytes32(uint256(1) << 24)
        });

        vm.expectRevert(abi.encodeWithSelector(IShadowVerifier.BlockHashMismatch.selector, expectedBlockHash, actualBlockHash));
        verifier.verifyProof("", input);
    }

    function test_verifyProof_RevertWhen_BlockHashIsZero() external {
        uint48 blockNumber = uint48(block.number);
        anchor.setBlockHash(blockNumber, bytes32(0));

        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: blockNumber,
            blockHash: bytes32(0),
            chainId: block.chainid,
            noteIndex: 1,
            amount: 1 ether,
            recipient: address(0xBEEF),
            nullifier: keccak256("nullifier"),
            powDigest: bytes32(uint256(1) << 24)
        });

        vm.expectRevert(abi.encodeWithSelector(IShadowVerifier.BlockHashNotFound.selector, blockNumber));
        verifier.verifyProof("", input);
    }

    function test_verifyProof_RevertWhen_BlockHashMissing() external {
        uint48 blockNumber = uint48(block.number);

        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: blockNumber,
            blockHash: bytes32(uint256(1)),
            chainId: block.chainid,
            noteIndex: 1,
            amount: 1 ether,
            recipient: address(0xBEEF),
            nullifier: keccak256("nullifier"),
            powDigest: bytes32(uint256(1) << 24)
        });

        vm.expectRevert(abi.encodeWithSelector(IShadowVerifier.BlockHashNotFound.selector, blockNumber));
        verifier.verifyProof("", input);
    }

    function test_verifyProof_RevertWhen_AnchorReverts() external {
        uint48 blockNumber = uint48(block.number);
        ShadowVerifier revertingVerifier = new ShadowVerifier(address(new RevertingAnchor()), address(circuitVerifier));

        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: blockNumber,
            blockHash: bytes32(uint256(1)),
            chainId: block.chainid,
            noteIndex: 1,
            amount: 1 ether,
            recipient: address(0xBEEF),
            nullifier: keccak256("nullifier"),
            powDigest: bytes32(uint256(1) << 24)
        });

        vm.expectRevert(abi.encodeWithSelector(IShadowVerifier.BlockHashNotFound.selector, blockNumber));
        revertingVerifier.verifyProof("", input);
    }

    function test_verifyProof_RevertWhen_ProofVerificationFails() external {
        uint48 blockNumber = uint48(block.number);
        bytes32 blockHash = keccak256("block");
        anchor.setBlockHash(blockNumber, blockHash);
        circuitVerifier.setShouldVerify(false);

        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: blockNumber,
            blockHash: blockHash,
            chainId: block.chainid,
            noteIndex: 1,
            amount: 1 ether,
            recipient: address(0xBEEF),
            nullifier: keccak256("nullifier"),
            powDigest: bytes32(uint256(1) << 24)
        });

        vm.expectRevert(abi.encodeWithSelector(IShadowVerifier.ProofVerificationFailed.selector));
        verifier.verifyProof("", input);
    }
}
