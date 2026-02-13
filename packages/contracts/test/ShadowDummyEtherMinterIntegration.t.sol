// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Shadow} from "../src/impl/Shadow.sol";
import {DummyEtherMinter} from "../src/impl/DummyEtherMinter.sol";
import {Nullifier} from "../src/impl/Nullifier.sol";
import {IShadow} from "../src/iface/IShadow.sol";
import {ShadowVerifier} from "../src/impl/ShadowVerifier.sol";
import {MockCircuitVerifier} from "./mocks/MockCircuitVerifier.sol";
import {MockCheckpointStore} from "./mocks/MockCheckpointStore.sol";

contract ShadowDummyEtherMinterIntegrationTest is Test {
    event EthMinted(address indexed recipient, uint256 amount);

    MockCheckpointStore internal checkpointStore;
    MockCircuitVerifier internal circuitVerifier;
    ShadowVerifier internal shadowVerifier;
    Nullifier internal nullifier;
    DummyEtherMinter internal etherMinter;
    Shadow internal shadow;

    function setUp() public {
        checkpointStore = new MockCheckpointStore();
        circuitVerifier = new MockCircuitVerifier();
        shadowVerifier = new ShadowVerifier(address(checkpointStore), address(circuitVerifier));
        etherMinter = new DummyEtherMinter();
        uint64 nonce = vm.getNonce(address(this));
        address predictedShadowProxy = vm.computeCreateAddress(address(this), nonce + 2);
        nullifier = new Nullifier(predictedShadowProxy);

        Shadow shadowImpl = new Shadow(address(shadowVerifier), address(etherMinter), address(nullifier));
        ERC1967Proxy shadowProxy =
            new ERC1967Proxy(address(shadowImpl), abi.encodeCall(Shadow.initialize, (address(this))));
        shadow = Shadow(address(shadowProxy));
    }

    function test_claim_emitsDummyMintedEvent() external {
        uint48 blockNumber = uint48(block.number);
        bytes32 stateRoot = keccak256("root");
        checkpointStore.setCheckpoint(blockNumber, bytes32(0), stateRoot);

        address recipient = address(0xBEEF);
        bytes32 nullifierValue = keccak256("nullifier");
        uint256 amount = 1 ether;

        IShadow.PublicInput memory input = IShadow.PublicInput({
            blockNumber: blockNumber,
            stateRoot: stateRoot,
            chainId: block.chainid,
            noteIndex: 1,
            amount: amount,
            recipient: recipient,
            nullifier: nullifierValue,
            powDigest: bytes32(uint256(1) << 24)
        });

        vm.expectEmit(true, false, false, true, address(etherMinter));
        emit EthMinted(recipient, amount);

        shadow.claim("", input);

        assertTrue(shadow.isConsumed(nullifierValue));
    }
}
