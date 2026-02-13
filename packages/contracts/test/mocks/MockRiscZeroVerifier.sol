// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {IRiscZeroVerifier} from "../../src/iface/IRiscZeroVerifier.sol";

contract MockRiscZeroVerifier is IRiscZeroVerifier {
    bool public shouldVerify = true;
    bool public validateArgs;

    bytes32 public expectedImageId;
    bytes32 public expectedJournalDigest;
    bytes32 public expectedSealHash;

    function setShouldVerify(bool _shouldVerify) external {
        shouldVerify = _shouldVerify;
    }

    function setExpectations(bytes32 _imageId, bytes32 _journalDigest, bytes calldata _seal, bool _validateArgs)
        external
    {
        expectedImageId = _imageId;
        expectedJournalDigest = _journalDigest;
        expectedSealHash = keccak256(_seal);
        validateArgs = _validateArgs;
    }

    function verify(bytes calldata _seal, bytes32 _imageId, bytes32 _journalDigest) external view {
        require(shouldVerify, "mock verify failed");

        if (!validateArgs) return;

        require(_imageId == expectedImageId, "unexpected image id");
        require(_journalDigest == expectedJournalDigest, "unexpected journal digest");
        require(keccak256(_seal) == expectedSealHash, "unexpected seal");
    }
}
