// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import "forge-std/Test.sol";
import {
    ReceiptClaim,
    ReceiptClaimLib,
    Output,
    OutputLib,
    ExitCode,
    SystemExitCode
} from "risc0-ethereum/IRiscZeroVerifier.sol";

contract ClaimDigestDebugTest is Test {
    using ReceiptClaimLib for ReceiptClaim;
    using OutputLib for Output;

    bytes32 constant IMAGE_ID = 0x7b8be5005af6a6a78b6030fbb3015b8a8a99bff941eb2908eaed4b0289305ffa;
    bytes constant JOURNAL = hex"7291470000000000f65f96982a3fb09f6d96bee5418f40772c67cfd62b7548dc45fe702b5198b68b658c0200000000000080c6a47e8d030000000000000000001111111111111111111111111111111111111111fa1bf61bf9bcc8145d7dc228456334da2461ef2a5685fd5ec7ae127b7a0d7377";

    function test_computeClaimDigest() public {
        // Compute journalDigest
        bytes32 journalDigest = sha256(JOURNAL);
        emit log_named_bytes32("journalDigest", journalDigest);

        // Create the claim using ReceiptClaimLib
        ReceiptClaim memory claim = ReceiptClaimLib.ok(IMAGE_ID, journalDigest);

        emit log_named_bytes32("preStateDigest (imageId)", claim.preStateDigest);
        emit log_named_bytes32("postStateDigest", claim.postStateDigest);
        emit log_named_bytes32("input", claim.input);
        emit log_named_bytes32("output", claim.output);
        emit log_named_uint("exitCode.system", uint256(claim.exitCode.system));
        emit log_named_uint("exitCode.user", claim.exitCode.user);

        // Compute claim digest
        bytes32 claimDigest = claim.digest();
        emit log_named_bytes32("claimDigest", claimDigest);
    }

    function test_verifyWithTestReceipt() public {
        // Use the official test receipt that works
        bytes memory seal = hex"73c457ba2ccb718fd9092cc11546eeded62a44d3ed274076dd3ec154fae8739f3432050b2005be2c5dbe6c08bfd04b30601a462540962bc26a2f38c5cfc0a4d76d8f1b8015e690a1b230081234867edeedb2f98bcdf33d0471c2aa5e8db63b72333f871527eb5d1fcf0a7af50fb8f42e8699e2c4eda3cd93f4e2a930096ae78e38bea4020c5c3d963dc453b4b302170e47c0cf53382255143c8fcef474d8b6eaaa8daaaf092c2f650809a3afbd122ef128cb882c2de7a6ccddd2e544b645fa3fedf6bcc92e09be04876a07778231fd5b93305d35fd8af23f040a11682a8c64130370804f28f07a76fa538755276e42c04b5f7eb97b04b68b65fa50e3181a0452069a3667";
        bytes memory journal = hex"6a75737420612073696d706c652072656365697074";
        bytes32 imageId = hex"11d264ed8dfdee222b820f0278e4d7f55d4b69a5472253a471c102265a91ea1a";

        bytes32 journalDigest = sha256(journal);
        emit log_named_bytes32("test journalDigest", journalDigest);

        ReceiptClaim memory claim = ReceiptClaimLib.ok(imageId, journalDigest);
        bytes32 claimDigest = claim.digest();
        emit log_named_bytes32("test claimDigest", claimDigest);
    }
}
