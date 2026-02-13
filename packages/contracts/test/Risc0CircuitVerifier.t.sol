// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test} from "forge-std/Test.sol";
import {IShadow} from "../src/iface/IShadow.sol";
import {Risc0CircuitVerifier} from "../src/impl/Risc0CircuitVerifier.sol";
import {ShadowPublicInputs} from "../src/lib/ShadowPublicInputs.sol";
import {MockRiscZeroVerifier} from "./mocks/MockRiscZeroVerifier.sol";

contract Risc0CircuitVerifierTest is Test {
    uint256 private constant _JOURNAL_LEN = 152;
    bytes32 private constant _IMAGE_ID = keccak256("shadow-image-id");

    MockRiscZeroVerifier internal risc0Verifier;
    Risc0CircuitVerifier internal adapter;

    function setUp() public {
        risc0Verifier = new MockRiscZeroVerifier();
        adapter = new Risc0CircuitVerifier(address(risc0Verifier), _IMAGE_ID);
    }

    function test_constructor_RevertWhen_VerifierIsZeroAddress() external {
        vm.expectRevert(Risc0CircuitVerifier.ZeroVerifier.selector);
        new Risc0CircuitVerifier(address(0), _IMAGE_ID);
    }

    function test_verifyProof_succeedsWhenBindingMatches() external {
        IShadow.PublicInput memory input = _sampleInput();
        uint256[] memory publicInputs = this._toArray(input);

        bytes memory seal = hex"010203";
        bytes memory journal = _buildJournal(input);
        bytes memory proof = abi.encode(seal, journal);

        risc0Verifier.setExpectations(_IMAGE_ID, sha256(journal), seal, true);
        bool ok = adapter.verifyProof(proof, publicInputs);
        assertTrue(ok);
    }

    function test_verifyProof_returnsFalseWhenJournalBindingMismatch() external {
        IShadow.PublicInput memory input = _sampleInput();
        uint256[] memory publicInputs = this._toArray(input);

        bytes memory seal = hex"aaaa";
        bytes memory journal = _buildJournal(input);
        bytes memory proof = abi.encode(seal, journal);

        publicInputs[35] = publicInputs[35] + 1;
        bool ok = adapter.verifyProof(proof, publicInputs);
        assertFalse(ok);
    }

    function test_verifyProof_returnsFalseWhenBlockNumberMismatch() external {
        IShadow.PublicInput memory input = _sampleInput();
        uint256[] memory publicInputs = this._toArray(input);

        bytes memory seal = hex"beef";
        bytes memory journal = _buildJournal(input);
        bytes memory proof = abi.encode(seal, journal);

        publicInputs[0] = publicInputs[0] + 1;
        bool ok = adapter.verifyProof(proof, publicInputs);
        assertFalse(ok);
    }

    function test_verifyProof_returnsFalseWhenChainIdMismatch() external {
        IShadow.PublicInput memory input = _sampleInput();
        uint256[] memory publicInputs = this._toArray(input);

        bytes memory seal = hex"cafe";
        bytes memory journal = _buildJournal(input);
        bytes memory proof = abi.encode(seal, journal);

        publicInputs[33] = publicInputs[33] + 1;
        bool ok = adapter.verifyProof(proof, publicInputs);
        assertFalse(ok);
    }

    function test_verifyProof_returnsFalseWhenNoteIndexMismatch() external {
        IShadow.PublicInput memory input = _sampleInput();
        uint256[] memory publicInputs = this._toArray(input);

        bytes memory seal = hex"0001";
        bytes memory journal = _buildJournal(input);
        bytes memory proof = abi.encode(seal, journal);

        publicInputs[34] = publicInputs[34] + 1;
        bool ok = adapter.verifyProof(proof, publicInputs);
        assertFalse(ok);
    }

    function test_verifyProof_returnsFalseWhenStateRootMismatch() external {
        IShadow.PublicInput memory input = _sampleInput();
        uint256[] memory publicInputs = this._toArray(input);

        bytes memory seal = hex"0002";
        bytes memory journal = _buildJournal(input);
        bytes memory proof = abi.encode(seal, journal);

        publicInputs[32] = (publicInputs[32] + 1) % 256;
        bool ok = adapter.verifyProof(proof, publicInputs);
        assertFalse(ok);
    }

    function test_verifyProof_returnsFalseWhenRecipientMismatch() external {
        IShadow.PublicInput memory input = _sampleInput();
        uint256[] memory publicInputs = this._toArray(input);

        bytes memory seal = hex"0003";
        bytes memory journal = _buildJournal(input);
        bytes memory proof = abi.encode(seal, journal);

        publicInputs[36] = (publicInputs[36] + 1) % 256;
        bool ok = adapter.verifyProof(proof, publicInputs);
        assertFalse(ok);
    }

    function test_verifyProof_returnsFalseWhenNullifierMismatch() external {
        IShadow.PublicInput memory input = _sampleInput();
        uint256[] memory publicInputs = this._toArray(input);

        bytes memory seal = hex"0004";
        bytes memory journal = _buildJournal(input);
        bytes memory proof = abi.encode(seal, journal);

        publicInputs[87] = (publicInputs[87] + 1) % 256;
        bool ok = adapter.verifyProof(proof, publicInputs);
        assertFalse(ok);
    }

    function test_verifyProof_returnsFalseWhenPowDigestMismatch() external {
        IShadow.PublicInput memory input = _sampleInput();
        uint256[] memory publicInputs = this._toArray(input);

        bytes memory seal = hex"0005";
        bytes memory journal = _buildJournal(input);
        bytes memory proof = abi.encode(seal, journal);

        publicInputs[116] = (publicInputs[116] + 1) % 256;
        bool ok = adapter.verifyProof(proof, publicInputs);
        assertFalse(ok);
    }

    function test_verifyProof_returnsFalseWhenVerifierRejects() external {
        IShadow.PublicInput memory input = _sampleInput();
        uint256[] memory publicInputs = this._toArray(input);

        bytes memory seal = hex"bbbb";
        bytes memory journal = _buildJournal(input);
        bytes memory proof = abi.encode(seal, journal);

        risc0Verifier.setShouldVerify(false);
        bool ok = adapter.verifyProof(proof, publicInputs);
        assertFalse(ok);
    }

    function test_verifyProof_returnsFalseWhenProofEncodingInvalid() external {
        IShadow.PublicInput memory input = _sampleInput();
        uint256[] memory publicInputs = this._toArray(input);

        bool ok = adapter.verifyProof(hex"12", publicInputs);
        assertFalse(ok);
    }

    function test_verifyProof_returnsFalseWhenPublicInputsLengthInvalid() external {
        bytes memory seal = hex"eeee";
        bytes memory journal = new bytes(_JOURNAL_LEN);
        bytes memory proof = abi.encode(seal, journal);

        uint256[] memory publicInputs = new uint256[](0);
        bool ok = adapter.verifyProof(proof, publicInputs);
        assertFalse(ok);
    }

    function test_verifyProof_returnsFalseWhenPublicInputByteOutOfRange() external {
        IShadow.PublicInput memory input = _sampleInput();
        uint256[] memory publicInputs = this._toArray(input);

        bytes memory seal = hex"cccc";
        bytes memory journal = _buildJournal(input);
        bytes memory proof = abi.encode(seal, journal);

        publicInputs[1] = 300;
        bool ok = adapter.verifyProof(proof, publicInputs);
        assertFalse(ok);
    }

    function test_verifyProof_returnsFalseWhenRecipientByteOutOfRange() external {
        IShadow.PublicInput memory input = _sampleInput();
        uint256[] memory publicInputs = this._toArray(input);

        bytes memory seal = hex"cccd";
        bytes memory journal = _buildJournal(input);
        bytes memory proof = abi.encode(seal, journal);

        publicInputs[36] = 300;
        bool ok = adapter.verifyProof(proof, publicInputs);
        assertFalse(ok);
    }

    function test_verifyProof_returnsFalseWhenJournalLengthInvalid() external {
        IShadow.PublicInput memory input = _sampleInput();
        uint256[] memory publicInputs = this._toArray(input);

        bytes memory seal = hex"dddd";
        bytes memory badJournal = new bytes(_JOURNAL_LEN - 1);
        bytes memory proof = abi.encode(seal, badJournal);

        bool ok = adapter.verifyProof(proof, publicInputs);
        assertFalse(ok);
    }

    function _toArray(IShadow.PublicInput calldata _input) external pure returns (uint256[] memory) {
        return ShadowPublicInputs.toArray(_input);
    }

    function _sampleInput() private view returns (IShadow.PublicInput memory) {
        return IShadow.PublicInput({
            blockNumber: 4_353_615,
            stateRoot: keccak256("state-root"),
            chainId: block.chainid,
            noteIndex: 0,
            amount: 1_230_000_000_000,
            recipient: 0xA92C80B3962F10e063Ad5463f996fe414F0E1F66,
            nullifier: keccak256("nullifier"),
            powDigest: bytes32(uint256(1) << 24)
        });
    }

    function _buildJournal(IShadow.PublicInput memory _input) private pure returns (bytes memory journal_) {
        journal_ = new bytes(_JOURNAL_LEN);

        _writeLe(journal_, 0, _input.blockNumber, 8);
        _writeBytes32(journal_, 8, _input.stateRoot);
        _writeLe(journal_, 40, _input.chainId, 8);
        _writeLe(journal_, 48, _input.noteIndex, 4);
        _writeLe(journal_, 52, _input.amount, 16);
        _writeAddress(journal_, 68, _input.recipient);
        _writeBytes32(journal_, 88, _input.nullifier);
        _writeBytes32(journal_, 120, _input.powDigest);
    }

    function _writeLe(bytes memory _buffer, uint256 _offset, uint256 _value, uint256 _len) private pure {
        for (uint256 i = 0; i < _len; ++i) {
            _buffer[_offset + i] = bytes1(uint8(_value >> (8 * i)));
        }
    }

    function _writeAddress(bytes memory _buffer, uint256 _offset, address _value) private pure {
        bytes20 encoded = bytes20(_value);
        for (uint256 i = 0; i < 20; ++i) {
            _buffer[_offset + i] = encoded[i];
        }
    }

    function _writeBytes32(bytes memory _buffer, uint256 _offset, bytes32 _value) private pure {
        for (uint256 i = 0; i < 32; ++i) {
            _buffer[_offset + i] = _value[i];
        }
    }
}
