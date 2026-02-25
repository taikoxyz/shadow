// SPDX-License-Identifier: MIT
pragma solidity ^0.8.33;

import {Test, console2} from "forge-std/Test.sol";
import {RiscZeroGroth16Verifier} from "../src/risc0-v3/RiscZeroGroth16Verifier.sol";
import {ControlID} from "../src/risc0-v3/ControlID.sol";

contract Groth16DirectTest is Test {
    RiscZeroGroth16Verifier verifier;

    function setUp() public {
        verifier = new RiscZeroGroth16Verifier(ControlID.CONTROL_ROOT, ControlID.BN254_CONTROL_ID);
    }

    /// @notice Verify our Shadow claim Groth16 proof (note 0)
    function test_verifyShadowClaimProof() public view {
        // imageId in Digest::as_bytes() format (LE words, w0→w7)
        bytes32 imageId = hex"37a5e85c934ec15f7752cfced2f407f40e6c28978dffcb3b895dc100a76acaf8";

        bytes memory seal = hex"73c457ba299e901e4798ac8491ae6c98d194e326a2d491cb93db14934f576cb6f2bb434f2fcc0b92f1a4fd37358e212935dc664678f9b409f6136cc0b18c3fd915221abe263fa6d41e10810e07cbfb6f448885775c101cf2a1c41184b0efe972bb21e18916325aa6e3d5956805fde7322f78fbe876c8493a548ff22c6ecb8c72d696bafc2f3117aeb3e5b72494c9a6a21b937cea6b23f46bde51a9a44d0cb628e03bd0190d786117eee9a2a051cc5b8840b97a13066c1162098e42c0fa7f6e14900467170bffa8756ec38b7a950e883189508a0d8df2232a3c218048a56aeef34c2c8b2f0e8234d61ce75c2f2a15447925e987045a12a4dda47c7b080c74bbbcc33516b1";

        bytes memory journal = hex"b3b14800000000006a96fdcd6c36aacb7a58a6837f2d10aff5db3d5dad653b8fa6de5315db75eb46658c0200000000000080c6a47e8d03000000000000000000e36c0f16d5fb473cc5181f5fb86b6eb3299ad9cbba8f0a9667492da38b3aa74fdda2a54aaccf96ba57648873b4b93637eae5dc45";

        bytes32 journalDigest = sha256(journal);
        verifier.verify(seal, imageId, journalDigest);
    }

    /// @notice Verify official RISC Zero v3.0 test receipt (from submodule)
    function test_verifyOfficialTestReceipt() public view {
        bytes32 imageId = hex"11d264ed8dfdee222b820f0278e4d7f55d4b69a5472253a471c102265a91ea1a";
        bytes memory seal = hex"73c457ba2ccb718fd9092cc11546eeded62a44d3ed274076dd3ec154fae8739f3432050b2005be2c5dbe6c08bfd04b30601a462540962bc26a2f38c5cfc0a4d76d8f1b8015e690a1b230081234867edeedb2f98bcdf33d0471c2aa5e8db63b72333f871527eb5d1fcf0a7af50fb8f42e8699e2c4eda3cd93f4e2a930096ae78e38bea4020c5c3d963dc453b4b302170e47c0cf53382255143c8fcef474d8b6eaaa8daaaf092c2f650809a3afbd122ef128cb882c2de7a6ccddd2e544b645fa3fedf6bcc92e09be04876a07778231fd5b93305d35fd8af23f040a11682a8c64130370804f28f07a76fa538755276e42c04b5f7eb97b04b68b65fa50e3181a0452069a3667";
        bytes memory journal = hex"6a75737420612073696d706c652072656365697074";
        bytes32 journalDigest = sha256(journal);

        verifier.verify(seal, imageId, journalDigest);
    }
}
