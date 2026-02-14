// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {ICircuitVerifier} from "../iface/ICircuitVerifier.sol";
import {IRiscZeroVerifier} from "../iface/IRiscZeroVerifier.sol";

/// @custom:security-contact security@taiko.xyz

/// @notice Adapter that binds Shadow public inputs to a RISC Zero journal and
/// delegates seal verification to a deployed RISC0 verifier contract.
contract Risc0CircuitVerifier is ICircuitVerifier {
    error ZeroVerifier();
    error InvalidPublicInputsLength(uint256 actual);
    error InvalidProofEncoding();
    error InvalidJournalLength(uint256 actual);
    error JournalBlockNumberMismatch(uint256 expected, uint256 actual);
    error JournalChainIdMismatch(uint256 expected, uint256 actual);
    error JournalNoteIndexMismatch(uint256 expected, uint256 actual);
    error JournalAmountMismatch(uint256 expected, uint256 actual);
    error JournalBlockHashMismatch(bytes32 expected, bytes32 actual);
    error JournalRecipientMismatch(address expected, address actual);
    error JournalNullifierMismatch(bytes32 expected, bytes32 actual);
    error JournalPowDigestMismatch(bytes32 expected, bytes32 actual);
    error PublicInputByteOutOfRange(uint256 index, uint256 value);

    IRiscZeroVerifier public immutable risc0Verifier;
    bytes32 public immutable imageId;

    uint256 private constant _PUBLIC_INPUTS_LEN = 120;
    uint256 private constant _IDX_BLOCK_NUMBER = 0;
    uint256 private constant _IDX_BLOCK_HASH = 1;
    uint256 private constant _IDX_CHAIN_ID = 33;
    uint256 private constant _IDX_NOTE_INDEX = 34;
    uint256 private constant _IDX_AMOUNT = 35;
    uint256 private constant _IDX_RECIPIENT = 36;
    uint256 private constant _IDX_NULLIFIER = 56;
    uint256 private constant _IDX_POW_DIGEST = 88;

    uint256 private constant _JOURNAL_LEN = 152;
    uint256 private constant _OFFSET_BLOCK_NUMBER = 0;
    uint256 private constant _OFFSET_BLOCK_HASH = 8;
    uint256 private constant _OFFSET_CHAIN_ID = 40;
    uint256 private constant _OFFSET_NOTE_INDEX = 48;
    uint256 private constant _OFFSET_AMOUNT = 52;
    uint256 private constant _OFFSET_RECIPIENT = 68;
    uint256 private constant _OFFSET_NULLIFIER = 88;
    uint256 private constant _OFFSET_POW_DIGEST = 120;

    constructor(address _risc0Verifier, bytes32 _imageId) {
        require(_risc0Verifier != address(0), ZeroVerifier());
        risc0Verifier = IRiscZeroVerifier(_risc0Verifier);
        imageId = _imageId;
    }

    /// @notice Decode proof payload `(bytes seal, bytes journal)`.
    function decodeProof(bytes calldata _proof) external pure returns (bytes memory _seal_, bytes memory _journal_) {
        (_seal_, _journal_) = abi.decode(_proof, (bytes, bytes));
    }

    function verifyProof(bytes calldata _proof, uint256[] calldata _publicInputs)
        external
        view
        returns (bool _isValid_)
    {
        bytes memory seal;
        bytes32 journalDigest;
        try this.decodeAndValidateProof(_proof, _publicInputs) returns (
            bytes memory decodedSeal, bytes32 decodedJournalDigest
        ) {
            seal = decodedSeal;
            journalDigest = decodedJournalDigest;
        } catch {
            return false;
        }

        try risc0Verifier.verify(seal, imageId, journalDigest) {
            _isValid_ = true;
        } catch {
            _isValid_ = false;
        }
    }

    /// @notice Decodes and validates proof payload and binding against public inputs.
    /// @dev Intended for internal `try/catch` orchestration in `verifyProof`.
    function decodeAndValidateProof(bytes calldata _proof, uint256[] calldata _publicInputs)
        external
        view
        returns (bytes memory seal_, bytes32 journalDigest_)
    {
        require(_publicInputs.length == _PUBLIC_INPUTS_LEN, InvalidPublicInputsLength(_publicInputs.length));

        bytes memory seal;
        bytes memory journal;
        try this.decodeProof(_proof) returns (bytes memory decodedSeal, bytes memory decodedJournal) {
            seal = decodedSeal;
            journal = decodedJournal;
        } catch {
            require(false, InvalidProofEncoding());
        }

        _requireJournalMatchesPublicInputs(journal, _publicInputs);
        seal_ = seal;
        journalDigest_ = sha256(journal);
    }

    function _requireJournalMatchesPublicInputs(bytes memory _journal, uint256[] calldata _publicInputs) private pure {
        require(_journal.length == _JOURNAL_LEN, InvalidJournalLength(_journal.length));

        uint256 blockNumber = _readLeUint(_journal, _OFFSET_BLOCK_NUMBER, 8);
        require(
            blockNumber == _publicInputs[_IDX_BLOCK_NUMBER],
            JournalBlockNumberMismatch(_publicInputs[_IDX_BLOCK_NUMBER], blockNumber)
        );

        uint256 chainId = _readLeUint(_journal, _OFFSET_CHAIN_ID, 8);
        require(chainId == _publicInputs[_IDX_CHAIN_ID], JournalChainIdMismatch(_publicInputs[_IDX_CHAIN_ID], chainId));

        uint256 noteIndex = _readLeUint(_journal, _OFFSET_NOTE_INDEX, 4);
        require(
            noteIndex == _publicInputs[_IDX_NOTE_INDEX],
            JournalNoteIndexMismatch(_publicInputs[_IDX_NOTE_INDEX], noteIndex)
        );

        uint256 amount = _readLeUint(_journal, _OFFSET_AMOUNT, 16);
        require(amount == _publicInputs[_IDX_AMOUNT], JournalAmountMismatch(_publicInputs[_IDX_AMOUNT], amount));

        bytes32 blockHash = _readBytes32(_journal, _OFFSET_BLOCK_HASH);
        bytes32 nullifier = _readBytes32(_journal, _OFFSET_NULLIFIER);
        bytes32 powDigest = _readBytes32(_journal, _OFFSET_POW_DIGEST);
        address recipient = _readAddress(_journal, _OFFSET_RECIPIENT);

        bytes32 expectedBlockHash = _readBytes32FromPublicInputs(_publicInputs, _IDX_BLOCK_HASH);
        require(blockHash == expectedBlockHash, JournalBlockHashMismatch(expectedBlockHash, blockHash));

        address expectedRecipient = _readAddressFromPublicInputs(_publicInputs, _IDX_RECIPIENT);
        require(recipient == expectedRecipient, JournalRecipientMismatch(expectedRecipient, recipient));

        bytes32 expectedNullifier = _readBytes32FromPublicInputs(_publicInputs, _IDX_NULLIFIER);
        require(nullifier == expectedNullifier, JournalNullifierMismatch(expectedNullifier, nullifier));

        bytes32 expectedPowDigest = _readBytes32FromPublicInputs(_publicInputs, _IDX_POW_DIGEST);
        require(powDigest == expectedPowDigest, JournalPowDigestMismatch(expectedPowDigest, powDigest));
    }

    function _readLeUint(bytes memory _data, uint256 _offset, uint256 _len) private pure returns (uint256 value_) {
        for (uint256 i = 0; i < _len; ++i) {
            value_ |= uint256(uint8(_data[_offset + i])) << (8 * i);
        }
    }

    function _readBytes32(bytes memory _data, uint256 _offset) private pure returns (bytes32 value_) {
        assembly {
            value_ := mload(add(add(_data, 0x20), _offset))
        }
    }

    function _readAddress(bytes memory _data, uint256 _offset) private pure returns (address addr_) {
        uint256 word;
        for (uint256 i = 0; i < 20; ++i) {
            word = (word << 8) | uint8(_data[_offset + i]);
        }
        addr_ = address(uint160(word));
    }

    function _readBytes32FromPublicInputs(uint256[] calldata _publicInputs, uint256 _offset)
        private
        pure
        returns (bytes32 value_)
    {
        uint256 word;
        for (uint256 i = 0; i < 32; ++i) {
            uint256 b = _publicInputs[_offset + i];
            require(b <= type(uint8).max, PublicInputByteOutOfRange(_offset + i, b));
            word = (word << 8) | b;
        }
        value_ = bytes32(word);
    }

    function _readAddressFromPublicInputs(uint256[] calldata _publicInputs, uint256 _offset)
        private
        pure
        returns (address addr_)
    {
        uint256 word;
        for (uint256 i = 0; i < 20; ++i) {
            uint256 b = _publicInputs[_offset + i];
            require(b <= type(uint8).max, PublicInputByteOutOfRange(_offset + i, b));
            word = (word << 8) | b;
        }
        addr_ = address(uint160(word));
    }
}
