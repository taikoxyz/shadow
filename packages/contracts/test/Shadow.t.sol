// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {OwnableUpgradeable} from "../src/lib/OwnableUpgradeable.sol";
import {Shadow} from "../src/impl/Shadow.sol";
import {IShadow} from "../src/iface/IShadow.sol";
import {ShadowVerifier} from "../src/impl/ShadowVerifier.sol";
import {MockCircuitVerifier} from "./mocks/MockCircuitVerifier.sol";
import {MockEtherMinter} from "./mocks/MockEtherMinter.sol";
import {MockAnchor} from "./mocks/MockAnchor.sol";

contract ShadowTest is Test {
    event Claimed(bytes32 indexed nullifier, address indexed recipient, uint256 amount);

    MockAnchor internal anchor;
    MockCircuitVerifier internal circuitVerifier;
    ShadowVerifier internal shadowVerifier;
    MockEtherMinter internal etherMinter;
    Shadow internal shadow;

    function setUp() public {
        anchor = new MockAnchor();
        circuitVerifier = new MockCircuitVerifier();
        shadowVerifier = new ShadowVerifier(address(anchor), address(circuitVerifier));
        etherMinter = new MockEtherMinter();

        Shadow shadowImpl = new Shadow(address(shadowVerifier), address(etherMinter), address(this));
        ERC1967Proxy shadowProxy =
            new ERC1967Proxy(address(shadowImpl), abi.encodeCall(Shadow.initialize, (address(this))));
        shadow = Shadow(address(shadowProxy));
    }

    function test_constructor_RevertWhen_VerifierIsZeroAddress() external {
        vm.expectRevert(OwnableUpgradeable.ZeroAddress.selector);
        new Shadow(address(0), address(etherMinter), address(this));
    }

    function test_constructor_RevertWhen_EtherMinterIsZeroAddress() external {
        vm.expectRevert(OwnableUpgradeable.ZeroAddress.selector);
        new Shadow(address(shadowVerifier), address(0), address(this));
    }

    function test_constructor_RevertWhen_FeeRecipientIsZeroAddress() external {
        vm.expectRevert(OwnableUpgradeable.ZeroAddress.selector);
        new Shadow(address(shadowVerifier), address(etherMinter), address(0));
    }

    function test_feeRecipient_isImmutable() external view {
        assertEq(shadow.feeRecipient(), address(this));
    }

    function test_claim_succeeds() external {
        uint64 blockNumber = uint64(block.number);
        bytes32 blockHash = keccak256("blockhash");
        anchor.setBlockHash(blockNumber, blockHash);

        address recipient = address(0xBEEF);
        bytes32 nullifierValue = keccak256("nullifier");
        uint256 amount = 1 ether;

        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: blockNumber,
            chainId: block.chainid,
            amount: amount,
            recipient: recipient,
            nullifier: nullifierValue
        });

        vm.expectEmit(true, true, false, true, address(shadow));
        emit Claimed(nullifierValue, recipient, amount);
        shadow.claim("", input);
        uint256 fee = amount / 1000;
        uint256 netAmount = amount - fee;
        assertEq(etherMinter.mintCount(), 2);
        assertEq(etherMinter.firstRecipient(), recipient);
        assertEq(etherMinter.firstAmount(), netAmount);
        assertEq(etherMinter.secondRecipient(), address(this));
        assertEq(etherMinter.secondAmount(), fee);
        assertTrue(shadow.isConsumed(nullifierValue));
    }

    function test_claim_mintsOnlyOnceWhen_FeeIsZero() external {
        uint64 blockNumber = uint64(block.number);
        bytes32 blockHash = keccak256("blockhash");
        anchor.setBlockHash(blockNumber, blockHash);

        address recipient = address(0xBEEF);
        bytes32 nullifierValue = keccak256("nullifier-fee-zero");
        uint256 amount = 999;

        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: blockNumber,
            chainId: block.chainid,
            amount: amount,
            recipient: recipient,
            nullifier: nullifierValue
        });

        vm.expectEmit(true, true, false, true, address(shadow));
        emit Claimed(nullifierValue, recipient, amount);
        shadow.claim("", input);

        assertEq(etherMinter.mintCount(), 1);
        assertEq(etherMinter.firstRecipient(), recipient);
        assertEq(etherMinter.firstAmount(), amount);
        assertEq(etherMinter.secondRecipient(), address(0));
        assertEq(etherMinter.secondAmount(), 0);
        assertTrue(shadow.isConsumed(nullifierValue));
    }

    function test_claim_RevertWhen_ChainIdMismatch() external {
        uint64 blockNumber = uint64(block.number);
        bytes32 blockHash = keccak256("blockhash");
        anchor.setBlockHash(blockNumber, blockHash);

        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: blockNumber,
            chainId: block.chainid + 1,
            amount: 1 ether,
            recipient: address(0xBEEF),
            nullifier: keccak256("nullifier")
        });

        vm.expectRevert(abi.encodeWithSelector(IShadow.ChainIdMismatch.selector, block.chainid + 1, block.chainid));
        shadow.claim("", input);
    }

    function test_claim_RevertWhen_ProofVerificationFailed() external {
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

        vm.expectRevert(IShadow.ProofVerificationFailed.selector);
        shadow.claim("", input);
    }

    function test_claim_RevertWhen_ProofVerificationFailed_doesNotConsumeOrMint() external {
        uint64 blockNumber = uint64(block.number);
        bytes32 blockHash = keccak256("blockhash");
        anchor.setBlockHash(blockNumber, blockHash);
        circuitVerifier.setShouldVerify(false);

        bytes32 nullifierValue = keccak256("nullifier-security");
        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: blockNumber,
            chainId: block.chainid,
            amount: 1 ether,
            recipient: address(0xBEEF),
            nullifier: nullifierValue
        });

        vm.expectRevert(IShadow.ProofVerificationFailed.selector);
        shadow.claim("", input);

        assertFalse(shadow.isConsumed(nullifierValue));
        assertEq(etherMinter.mintCount(), 0);
    }

    function test_claim_RevertWhen_EtherMintFails_doesNotConsumeNullifier() external {
        uint64 blockNumber = uint64(block.number);
        bytes32 blockHash = keccak256("blockhash");
        anchor.setBlockHash(blockNumber, blockHash);
        etherMinter.setShouldRevert(true);

        bytes32 nullifierValue = keccak256("nullifier-mint-failure");
        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: blockNumber,
            chainId: block.chainid,
            amount: 1 ether,
            recipient: address(0xBEEF),
            nullifier: nullifierValue
        });

        vm.expectRevert(MockEtherMinter.MintFailed.selector);
        shadow.claim("", input);

        assertFalse(shadow.isConsumed(nullifierValue));
        assertEq(etherMinter.mintCount(), 0);
    }

    function test_claim_RevertWhen_FeeMintFails_doesNotConsumeOrMint() external {
        uint64 blockNumber = uint64(block.number);
        bytes32 blockHash = keccak256("blockhash");
        anchor.setBlockHash(blockNumber, blockHash);
        etherMinter.setRevertOnMintNumber(2);

        bytes32 nullifierValue = keccak256("nullifier-fee-mint-failure");
        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: blockNumber,
            chainId: block.chainid,
            amount: 1000,
            recipient: address(0xBEEF),
            nullifier: nullifierValue
        });

        vm.expectRevert(MockEtherMinter.MintFailed.selector);
        shadow.claim("", input);

        assertFalse(shadow.isConsumed(nullifierValue));
        assertEq(etherMinter.mintCount(), 0);
    }

    function test_claim_RevertWhen_NullifierReused() external {
        uint64 blockNumber = uint64(block.number);
        bytes32 blockHash = keccak256("blockhash");
        anchor.setBlockHash(blockNumber, blockHash);

        bytes32 nullifierValue = keccak256("nullifier");
        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: blockNumber,
            chainId: block.chainid,
            amount: 1 ether,
            recipient: address(0xBEEF),
            nullifier: nullifierValue
        });

        shadow.claim("", input);
        vm.expectRevert(abi.encodeWithSelector(IShadow.NullifierAlreadyConsumed.selector, nullifierValue));
        shadow.claim("", input);
    }

    function test_claim_RevertWhen_InvalidRecipient() external {
        uint64 blockNumber = uint64(block.number);
        bytes32 blockHash = keccak256("blockhash");
        anchor.setBlockHash(blockNumber, blockHash);

        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: blockNumber,
            chainId: block.chainid,
            amount: 1 ether,
            recipient: address(0),
            nullifier: keccak256("nullifier")
        });

        vm.expectRevert(abi.encodeWithSelector(IShadow.InvalidRecipient.selector, address(0)));
        shadow.claim("", input);
    }

    function test_claim_RevertWhen_InvalidAmount() external {
        uint64 blockNumber = uint64(block.number);
        bytes32 blockHash = keccak256("blockhash");
        anchor.setBlockHash(blockNumber, blockHash);

        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: blockNumber,
            chainId: block.chainid,
            amount: 0,
            recipient: address(0xBEEF),
            nullifier: keccak256("nullifier")
        });

        vm.expectRevert(abi.encodeWithSelector(IShadow.InvalidAmount.selector, 0));
        shadow.claim("", input);
    }

    function test_isConsumed_returnsFalse_WhenNotConsumed() external view {
        assertFalse(shadow.isConsumed(keccak256("unused")));
    }

    function test_initialize_RevertWhen_AlreadyInitialized() external {
        vm.expectRevert();
        shadow.initialize(address(this));
    }

    function test_transferOwnership_succeeds() external {
        address newOwner = address(0x1234);
        shadow.transferOwnership(newOwner);
        assertEq(shadow.pendingOwner(), newOwner);

        vm.prank(newOwner);
        shadow.acceptOwnership();
        assertEq(shadow.owner(), newOwner);
    }

    function test_feeRecipient_doesNotChangeWithOwnershipTransfer() external {
        address initialFeeRecipient = shadow.feeRecipient();
        assertEq(initialFeeRecipient, address(this));

        address newOwner = address(0x1234);
        shadow.transferOwnership(newOwner);
        vm.prank(newOwner);
        shadow.acceptOwnership();

        assertEq(shadow.owner(), newOwner);
        assertEq(shadow.feeRecipient(), initialFeeRecipient);
    }

    function test_upgradeToAndCall_RevertWhen_NotOwner() external {
        Shadow newImpl =
            new Shadow(address(shadowVerifier), address(etherMinter), address(0xCAFE));

        vm.prank(address(0xBEEF));
        vm.expectRevert();
        shadow.upgradeToAndCall(address(newImpl), "");
    }

    function test_upgradeToAndCall_succeedsAndUpdatesFeeRecipient() external {
        address newFeeRecipient = address(0xCAFE);
        Shadow newImpl = new Shadow(address(shadowVerifier), address(etherMinter), newFeeRecipient);

        // OZ UUPS upgradeToAndCall() always delegatecalls the new implementation.
        // Use a safe no-op view call to avoid triggering fallback reverts.
        shadow.upgradeToAndCall(address(newImpl), abi.encodeWithSignature("feeRecipient()"));

        assertEq(shadow.feeRecipient(), newFeeRecipient);
    }

    function test_claim_multipleClaims_withDifferentNullifiers() external {
        uint64 blockNumber = uint64(block.number);
        bytes32 blockHash = keccak256("blockhash");
        anchor.setBlockHash(blockNumber, blockHash);

        address recipient1 = address(0xBEEF);
        address recipient2 = address(0xCAFE);
        bytes32 nullifier1 = keccak256("nullifier1");
        bytes32 nullifier2 = keccak256("nullifier2");

        IShadow.PublicInput memory input1 = IShadow.PublicInput({
            blockNumber: blockNumber,
            chainId: block.chainid,
            amount: 1 ether,
            recipient: recipient1,
            nullifier: nullifier1
        });

        IShadow.PublicInput memory input2 = IShadow.PublicInput({
            blockNumber: blockNumber,
            chainId: block.chainid,
            amount: 2 ether,
            recipient: recipient2,
            nullifier: nullifier2
        });

        shadow.claim("", input1);
        assertTrue(shadow.isConsumed(nullifier1));
        assertFalse(shadow.isConsumed(nullifier2));

        etherMinter.reset();
        shadow.claim("", input2);
        assertTrue(shadow.isConsumed(nullifier1));
        assertTrue(shadow.isConsumed(nullifier2));
    }

    function test_claim_feeCalculation_boundaryCase_1wei() external {
        uint64 blockNumber = uint64(block.number);
        bytes32 blockHash = keccak256("blockhash");
        anchor.setBlockHash(blockNumber, blockHash);

        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: blockNumber,
            chainId: block.chainid,
            amount: 1,
            recipient: address(0xBEEF),
            nullifier: keccak256("nullifier-1wei")
        });

        shadow.claim("", input);
        // 1 / 1000 = 0 (no fee)
        assertEq(etherMinter.mintCount(), 1);
        assertEq(etherMinter.firstAmount(), 1);
    }

    function test_claim_feeCalculation_boundaryCase_1000wei() external {
        uint64 blockNumber = uint64(block.number);
        bytes32 blockHash = keccak256("blockhash");
        anchor.setBlockHash(blockNumber, blockHash);

        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: blockNumber,
            chainId: block.chainid,
            amount: 1000,
            recipient: address(0xBEEF),
            nullifier: keccak256("nullifier-1000wei")
        });

        shadow.claim("", input);
        // 1000 / 1000 = 1 (1 wei fee)
        assertEq(etherMinter.mintCount(), 2);
        assertEq(etherMinter.firstAmount(), 999);
        assertEq(etherMinter.secondAmount(), 1);
    }

    function test_claim_feeCalculation_boundaryCase_1001wei() external {
        uint64 blockNumber = uint64(block.number);
        bytes32 blockHash = keccak256("blockhash");
        anchor.setBlockHash(blockNumber, blockHash);

        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: blockNumber,
            chainId: block.chainid,
            amount: 1001,
            recipient: address(0xBEEF),
            nullifier: keccak256("nullifier-1001wei")
        });

        shadow.claim("", input);
        // 1001 / 1000 = 1 (1 wei fee, same as 1000)
        assertEq(etherMinter.mintCount(), 2);
        assertEq(etherMinter.firstAmount(), 1000);
        assertEq(etherMinter.secondAmount(), 1);
    }

    function test_claim_upgrade_preservesNullifierStorage() external {
        uint64 blockNumber = uint64(block.number);
        bytes32 blockHash = keccak256("blockhash");
        anchor.setBlockHash(blockNumber, blockHash);

        bytes32 nullifierValue = keccak256("nullifier-upgrade-test");
        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: blockNumber,
            chainId: block.chainid,
            amount: 1 ether,
            recipient: address(0xBEEF),
            nullifier: nullifierValue
        });

        shadow.claim("", input);
        assertTrue(shadow.isConsumed(nullifierValue));

        // Upgrade to new implementation
        address newFeeRecipient = address(0xCAFE);
        Shadow newImpl = new Shadow(address(shadowVerifier), address(etherMinter), newFeeRecipient);
        shadow.upgradeToAndCall(address(newImpl), abi.encodeWithSignature("feeRecipient()"));

        // Verify nullifier storage is preserved after upgrade
        assertTrue(shadow.isConsumed(nullifierValue));
    }
}
