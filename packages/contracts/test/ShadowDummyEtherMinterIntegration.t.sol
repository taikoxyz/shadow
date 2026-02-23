// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {Shadow} from "../src/impl/Shadow.sol";
import {DummyEtherMinter} from "../src/impl/DummyEtherMinter.sol";
import {IShadow} from "../src/iface/IShadow.sol";
import {ShadowVerifier} from "../src/impl/ShadowVerifier.sol";
import {MockCircuitVerifier} from "./mocks/MockCircuitVerifier.sol";
import {MockAnchor} from "./mocks/MockAnchor.sol";

contract ShadowDummyEtherMinterIntegrationTest is Test {
    event EthMinted(address indexed recipient, uint256 amount);

    MockAnchor internal anchor;
    MockCircuitVerifier internal circuitVerifier;
    ShadowVerifier internal shadowVerifier;
    DummyEtherMinter internal etherMinter;
    Shadow internal shadow;

    function setUp() public {
        anchor = new MockAnchor();
        circuitVerifier = new MockCircuitVerifier();
        shadowVerifier = new ShadowVerifier(address(anchor), address(circuitVerifier));
        etherMinter = new DummyEtherMinter();

        Shadow shadowImpl = new Shadow(address(shadowVerifier), address(etherMinter), address(this));
        ERC1967Proxy shadowProxy =
            new ERC1967Proxy(address(shadowImpl), abi.encodeCall(Shadow.initialize, (address(this))));
        shadow = Shadow(address(shadowProxy));
    }

    function test_claim_emitsDummyMintedEvent() external {
        uint48 blockNumber = uint48(block.number);
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

        vm.expectEmit(true, false, false, true, address(etherMinter));
        emit EthMinted(recipient, amount - (amount / 1000));

        vm.expectEmit(true, false, false, true, address(etherMinter));
        emit EthMinted(address(this), amount / 1000);

        shadow.claim("", input);

        assertTrue(shadow.isConsumed(nullifierValue));
    }
}
