pragma circom 2.1.9;
pragma custom_templates;

include "../lib/sha256.circom";
include "../lib/utils.circom";
include "../lib/constants.circom";
include "../lib/notes.circom";
include "../lib/address.circom";
include "../lib/mpt.circom";
include "circomlib/circuits/comparators.circom";

/// @title Shadow
/// @notice Main Shadow protocol circuit for privacy-forward claim verification
/// @param maxNotes Maximum number of notes (default 5)
/// @param maxProofDepth Maximum MPT proof depth (default 9)
/// @dev Proves:
///      1. Note set validity (amounts > 0, sum <= 32 ETH, count in [1,5])
///      2. Selected note matches public recipient + amount
///      3. Target address derivation from (secret, chainId, notesHash)
///      4. State root binding via public input + on-chain provider
///      5. Account proof valid under the provided stateRoot
///      6. Account balance >= sum of note amounts
///      7. Nullifier derivation
///      8. PoW validity
template Shadow(maxNotes, maxProofDepth) {
    // ===== PUBLIC SIGNALS =====
    signal input blockNumber;           // L1 block number
    signal input stateRoot[32];         // L1 state root (32 bytes)
    signal input chainId;               // Chain ID
    signal input noteIndex;             // Index of note being claimed
    signal input amount;                // Amount being claimed (wei)
    signal input recipient[20];         // Recipient address (20 bytes)
    signal output nullifier[32];        // Computed nullifier (32 bytes)
    signal output powDigest[32];        // PoW digest for verification

    // ===== PRIVATE SIGNALS =====
    signal input secret[32];            // User's secret (32 bytes)
    signal input noteCount;             // Number of active notes
    signal input amounts[maxNotes];     // Amount for each note
    signal input recipientHashes[maxNotes][32]; // recipientHash for each note

    // Account proof witness
    signal input proofNodes[maxProofDepth][544];
    signal input proofNodeLengths[maxProofDepth];
    signal input proofDepth;

    // ===== STEP 1: Validate Notes + Selection =====
    component notesModule = NoteSetEnforcer(maxNotes);
    notesModule.noteCount <== noteCount;
    notesModule.noteIndex <== noteIndex;
    notesModule.claimedAmount <== amount;
    for (var i = 0; i < maxNotes; i++) {
        notesModule.amounts[i] <== amounts[i];
        for (var j = 0; j < 32; j++) {
            notesModule.recipientHashes[i][j] <== recipientHashes[i][j];
        }
    }
    for (var r = 0; r < 20; r++) {
        notesModule.recipient[r] <== recipient[r];
    }

    signal notesHash[32];
    signal totalNoteAmount;
    for (var h = 0; h < 32; h++) {
        notesHash[h] <== notesModule.notesHash[h];
    }
    totalNoteAmount <== notesModule.totalAmount;

    // ===== STEP 2: Derive Target Address + Hash Anchor =====
    component targetBinding = TargetAddressBinding();
    for (var s = 0; s < 32; s++) {
        targetBinding.secret[s] <== secret[s];
        targetBinding.notesHash[s] <== notesHash[s];
    }
    targetBinding.chainId <== chainId;

    signal targetAddressHash[32];
    for (var th = 0; th < 32; th++) {
        targetAddressHash[th] <== targetBinding.addressHash[th];
    }

    // ===== STEP 3: Bind State Root Public Input =====
    // The contract queries IStateRootProvider(blockNumber) and compares it
    // against this public signal, so no block header witness is required.

    // ===== STEP 4: Verify Account Proof And Balance =====
    component accountVerifier = AccountStateVerifier(maxProofDepth, 544, 5);
    for (var i2 = 0; i2 < 32; i2++) {
        accountVerifier.stateRoot[i2] <== stateRoot[i2];
        accountVerifier.addressHash[i2] <== targetAddressHash[i2];
    }
    accountVerifier.requiredBalance <== totalNoteAmount;
    for (var depth = 0; depth < maxProofDepth; depth++) {
        for (var k = 0; k < 544; k++) {
            accountVerifier.proofNodes[depth][k] <== proofNodes[depth][k];
        }
        accountVerifier.proofNodeLengths[depth] <== proofNodeLengths[depth];
    }
    accountVerifier.proofDepth <== proofDepth;

    // ===== STEP 5: Derive Nullifier =====
    component nullifierDeriver = NullifierDeriver();
    for (var n = 0; n < 32; n++) {
        nullifierDeriver.secret[n] <== secret[n];
    }
    nullifierDeriver.chainId <== chainId;
    nullifierDeriver.noteIndex <== noteIndex;

    for (var nn = 0; nn < 32; nn++) {
        nullifier[nn] <== nullifierDeriver.nullifier[nn];
    }

    // ===== STEP 6: Verify PoW =====
    component powCheck = PowChecker();
    for (var p = 0; p < 32; p++) {
        powCheck.secret[p] <== secret[p];
    }
    powCheck.valid === 1;

    for (var pd = 0; pd < 32; pd++) {
        powDigest[pd] <== powCheck.powDigest[pd];
    }
}
