// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {ShadowVerifier} from "../src/impl/ShadowVerifier.sol";
import {ICheckpointStore} from "../src/iface/ICheckpointStore.sol";
import {IShadow} from "../src/iface/IShadow.sol";
import {IShadowVerifier} from "../src/iface/IShadowVerifier.sol";
import {MockCircuitVerifier} from "./mocks/MockCircuitVerifier.sol";
import {MockCheckpointStore} from "./mocks/MockCheckpointStore.sol";

contract RevertingCheckpointStore is ICheckpointStore {
    function saveCheckpoint(Checkpoint calldata) external {}

    function getCheckpoint(uint48) external pure returns (Checkpoint memory) {
        revert("checkpoint store reverted");
    }
}

contract ShadowVerifierTest is Test {
    MockCheckpointStore internal checkpointStore;
    MockCircuitVerifier internal circuitVerifier;
    ShadowVerifier internal verifier;

    function setUp() public {
        checkpointStore = new MockCheckpointStore();
        circuitVerifier = new MockCircuitVerifier();
        verifier = new ShadowVerifier(address(checkpointStore), address(circuitVerifier));
    }

    function test_constructor_RevertWhen_CheckpointStoreIsZeroAddress() external {
        vm.expectRevert(IShadowVerifier.ZeroAddress.selector);
        new ShadowVerifier(address(0), address(circuitVerifier));
    }

    function test_constructor_RevertWhen_CircuitVerifierIsZeroAddress() external {
        vm.expectRevert(IShadowVerifier.ZeroAddress.selector);
        new ShadowVerifier(address(checkpointStore), address(0));
    }

    function test_verifyProof_succeeds() external {
        uint48 blockNumber = uint48(block.number);
        bytes32 stateRoot = keccak256("root");
        checkpointStore.setCheckpoint(blockNumber, bytes32(0), stateRoot);

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

        vm.expectRevert(abi.encodeWithSelector(IShadowVerifier.CheckpointNotFound.selector, uint48(0)));
        verifier.verifyProof("", input);
    }

    function test_verifyProof_RevertWhen_CheckpointStateRootIsZero() external {
        uint48 blockNumber = uint48(block.number);
        checkpointStore.setCheckpoint(blockNumber, bytes32(0), bytes32(0));

        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: blockNumber,
            chainId: block.chainid,
            amount: 1 ether,
            recipient: address(0xBEEF),
            nullifier: keccak256("nullifier")
        });

        vm.expectRevert(abi.encodeWithSelector(IShadowVerifier.CheckpointNotFound.selector, blockNumber));
        verifier.verifyProof("", input);
    }

    function test_verifyProof_RevertWhen_CheckpointMissing() external {
        uint48 blockNumber = uint48(block.number);

        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: blockNumber,
            chainId: block.chainid,
            amount: 1 ether,
            recipient: address(0xBEEF),
            nullifier: keccak256("nullifier")
        });

        vm.expectRevert(abi.encodeWithSelector(IShadowVerifier.CheckpointNotFound.selector, blockNumber));
        verifier.verifyProof("", input);
    }

    function test_verifyProof_RevertWhen_CheckpointStoreReverts() external {
        uint48 blockNumber = uint48(block.number);
        ShadowVerifier revertingVerifier = new ShadowVerifier(address(new RevertingCheckpointStore()), address(circuitVerifier));

        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: blockNumber,
            chainId: block.chainid,
            amount: 1 ether,
            recipient: address(0xBEEF),
            nullifier: keccak256("nullifier")
        });

        vm.expectRevert(abi.encodeWithSelector(IShadowVerifier.CheckpointNotFound.selector, blockNumber));
        revertingVerifier.verifyProof("", input);
    }

    function test_verifyProof_RevertWhen_ProofVerificationFails() external {
        uint48 blockNumber = uint48(block.number);
        bytes32 stateRoot = keccak256("root");
        checkpointStore.setCheckpoint(blockNumber, bytes32(0), stateRoot);
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
}
