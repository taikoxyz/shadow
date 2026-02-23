// Copyright 2024 RISC Zero, Inc.
// SPDX-License-Identifier: GPL-3.0

pragma solidity ^0.8.9;

import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

import {ControlID} from "./ControlID.sol";
import {Groth16Verifier} from "./Groth16Verifier.sol";
import {
    IRiscZeroVerifier,
    Receipt,
    ReceiptClaim,
    ReceiptClaimLib,
    Output,
    OutputLib,
    VerificationFailed
} from "./IRiscZeroVerifier.sol";
import {StructHash} from "./StructHash.sol";
import {reverseByteOrderUint256} from "./Util.sol";
import {IRiscZeroSelectable} from "./IRiscZeroSelectable.sol";

/// @notice A Groth16 seal over the claimed receipt claim.
struct Seal {
    uint256[2] a;
    uint256[2][2] b;
    uint256[2] c;
}

/// @notice Error raised when this verifier receives a receipt with a selector that does not match
///         its own. The selector value is calculated from the verifier parameters.
error SelectorMismatch(bytes4 received, bytes4 expected);

/// @notice Groth16 verifier contract for RISC Zero receipts of execution (v3.0.0).
contract RiscZeroGroth16Verifier is IRiscZeroVerifier, IRiscZeroSelectable, Groth16Verifier {
    using ReceiptClaimLib for ReceiptClaim;
    using OutputLib for Output;
    using SafeCast for uint256;

    /// @notice Semantic version of the RISC Zero system.
    string public constant VERSION = "3.0.0";

    /// @notice Control root hash binding the set of circuits.
    bytes16 public immutable CONTROL_ROOT_0;
    bytes16 public immutable CONTROL_ROOT_1;
    bytes32 public immutable BN254_CONTROL_ID;

    /// @notice A short key attached to the seal to select the correct verifier implementation.
    bytes4 public immutable SELECTOR;

    /// @notice Identifier for the Groth16 verification key encoded into the base contract.
    function verifier_key_digest() internal pure returns (bytes32) {
        // These constants are from the parent Groth16Verifier contract
        uint256 alphax = 20491192805390485299153009773594534940189261866228447918068658471970481763042;
        uint256 alphay = 9383485363053290200918347156157836566562967994039712273449902621266178545958;
        uint256 betax1 = 4252822878758300859123897981450591353533073413197771768651442665752259397132;
        uint256 betax2 = 6375614351688725206403948262868962793625744043794305715222011528459656738731;
        uint256 betay1 = 21847035105528745403288232691147584728191162732299865338377159692350059136679;
        uint256 betay2 = 10505242626370262277552901082094356697409835680220590971873171140371331206856;
        uint256 gammax1 = 11559732032986387107991004021392285783925812861821192530917403151452391805634;
        uint256 gammax2 = 10857046999023057135944570762232829481370756359578518086990519993285655852781;
        uint256 gammay1 = 4082367875863433681332203403145435568316851327593401208105741076214120093531;
        uint256 gammay2 = 8495653923123431417604973247489272438418190587263600148770280649306958101930;
        uint256 deltax1 = 1668323501672964604911431804142266013250380587483576094566949227275849579036;
        uint256 deltax2 = 12043754404802191763554326994664886008979042643626290185762540825416902247219;
        uint256 deltay1 = 7710631539206257456743780535472368339139328733484942210876916214502466455394;
        uint256 deltay2 = 13740680757317479711909903993315946540841369848973133181051452051592786724563;

        uint256 IC0x = 8446592859352799428420270221449902464741693648963397251242447530457567083492;
        uint256 IC0y = 1064796367193003797175961162477173481551615790032213185848276823815288302804;
        uint256 IC1x = 3179835575189816632597428042194253779818690147323192973511715175294048485951;
        uint256 IC1y = 20895841676865356752879376687052266198216014795822152491318012491767775979074;
        uint256 IC2x = 5332723250224941161709478398807683311971555792614491788690328996478511465287;
        uint256 IC2y = 21199491073419440416471372042641226693637837098357067793586556692319371762571;
        uint256 IC3x = 12457994489566736295787256452575216703923664299075106359829199968023158780583;
        uint256 IC3y = 19706766271952591897761291684837117091856807401404423804318744964752784280790;
        uint256 IC4x = 19617808913178163826953378459323299110911217259216006187355745713323154132237;
        uint256 IC4y = 21663537384585072695701846972542344484111393047775983928357046779215877070466;
        uint256 IC5x = 6834578911681792552110317589222010969491336870276623105249474534788043166867;
        uint256 IC5y = 15060583660288623605191393599883223885678013570733629274538391874953353488393;

        bytes32[] memory ic_digests = new bytes32[](6);
        ic_digests[0] = sha256(abi.encodePacked(IC0x, IC0y));
        ic_digests[1] = sha256(abi.encodePacked(IC1x, IC1y));
        ic_digests[2] = sha256(abi.encodePacked(IC2x, IC2y));
        ic_digests[3] = sha256(abi.encodePacked(IC3x, IC3y));
        ic_digests[4] = sha256(abi.encodePacked(IC4x, IC4y));
        ic_digests[5] = sha256(abi.encodePacked(IC5x, IC5y));

        return sha256(
            abi.encodePacked(
                sha256("risc0_groth16.VerifyingKey"),
                sha256(abi.encodePacked(alphax, alphay)),
                sha256(abi.encodePacked(betax1, betax2, betay1, betay2)),
                sha256(abi.encodePacked(gammax1, gammax2, gammay1, gammay2)),
                sha256(abi.encodePacked(deltax1, deltax2, deltay1, deltay2)),
                StructHash.taggedList(sha256("risc0_groth16.VerifyingKey.IC"), ic_digests),
                uint16(5) << 8
            )
        );
    }

    constructor(bytes32 control_root, bytes32 bn254_control_id) {
        (CONTROL_ROOT_0, CONTROL_ROOT_1) = splitDigest(control_root);
        BN254_CONTROL_ID = bn254_control_id;

        SELECTOR = bytes4(
            sha256(
                abi.encodePacked(
                    sha256("risc0.Groth16ReceiptVerifierParameters"),
                    control_root,
                    reverseByteOrderUint256(uint256(bn254_control_id)),
                    verifier_key_digest(),
                    uint16(3) << 8
                )
            )
        );
    }

    /// @notice splits a digest into two 128-bit halves to use as public signal inputs.
    function splitDigest(bytes32 digest) internal pure returns (bytes16, bytes16) {
        uint256 reversed = reverseByteOrderUint256(uint256(digest));
        return (bytes16(uint128(reversed)), bytes16(uint128(reversed >> 128)));
    }

    /// @inheritdoc IRiscZeroVerifier
    function verify(bytes calldata seal, bytes32 imageId, bytes32 journalDigest) external view {
        _verifyIntegrity(seal, ReceiptClaimLib.ok(imageId, journalDigest).digest());
    }

    /// @inheritdoc IRiscZeroVerifier
    function verifyIntegrity(Receipt calldata receipt) external view {
        return _verifyIntegrity(receipt.seal, receipt.claimDigest);
    }

    /// @notice internal implementation of verifyIntegrity.
    function _verifyIntegrity(bytes calldata seal, bytes32 claimDigest) internal view {
        // Check that the seal has a matching selector.
        if (SELECTOR != bytes4(seal[:4])) {
            revert SelectorMismatch({received: bytes4(seal[:4]), expected: SELECTOR});
        }

        // Run the Groth16 verify procedure.
        (bytes16 claim0, bytes16 claim1) = splitDigest(claimDigest);
        Seal memory decodedSeal = abi.decode(seal[4:], (Seal));
        bool verified = this.verifyProof(
            decodedSeal.a,
            decodedSeal.b,
            decodedSeal.c,
            [
                uint256(uint128(CONTROL_ROOT_0)),
                uint256(uint128(CONTROL_ROOT_1)),
                uint256(uint128(claim0)),
                uint256(uint128(claim1)),
                uint256(BN254_CONTROL_ID)
            ]
        );

        // Revert if verification failed.
        if (!verified) {
            revert VerificationFailed();
        }
    }
}
