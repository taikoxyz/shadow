pragma circom 2.1.9;

include "./sha256.circom";
include "./utils.circom";
include "./constants.circom";
include "circomlib/circuits/comparators.circom";

/// @title NoteValidator
/// @notice Validates note constraints and computes notesHash
/// @param maxNotes Maximum number of notes (e.g., 10)
template NoteValidator(maxNotes) {
    // Inputs
    signal input noteCount;                     // Actual number of notes [1, maxNotes]
    signal input amounts[maxNotes];             // Amount for each note in wei
    signal input recipientHashes[maxNotes][32]; // 32-byte recipientHash for each note

    // Outputs
    signal output notesHash[32];                // sha256(concat(note_0, ..., note_{n-1}))
    signal output totalAmount;                  // Sum of all amounts

    // Validate noteCount in [1, maxNotes]
    component noteCountRange = AssertRangeCheck(8);
    noteCountRange.in <== noteCount;
    noteCountRange.min <== 1;
    noteCountRange.max <== maxNotes;

    component isActive[maxNotes];
    component amountNonZero[maxNotes];
    component amountRange[maxNotes];
    signal activeAndZero[maxNotes];

    for (var i = 0; i < maxNotes; i++) {
        isActive[i] = LessThan(8);
        isActive[i].in[0] <== i;
        isActive[i].in[1] <== noteCount;

        amountNonZero[i] = IsNonZero();
        amountNonZero[i].in <== amounts[i];

        // Range constrain each amount to 128 bits for sound comparisons.
        amountRange[i] = Num2Bits(128);
        amountRange[i].in <== amounts[i];

        activeAndZero[i] <== isActive[i].out * (1 - amountNonZero[i].out);
        activeAndZero[i] === 0;
    }

    // Compute total amount (only for active notes)
    signal runningTotal[maxNotes + 1];
    runningTotal[0] <== 0;
    for (var i = 0; i < maxNotes; i++) {
        runningTotal[i + 1] <== runningTotal[i] + isActive[i].out * amounts[i];
    }
    totalAmount <== runningTotal[maxNotes];

    // Range constrain totalAmount to 128 bits for sound comparisons.
    component totalAmountRange = Num2Bits(128);
    totalAmountRange.in <== totalAmount;

    // Validate totalAmount <= 32 ETH (32 * 10^18 wei)
    component totalCheck = LessEqThan(128);
    totalCheck.in[0] <== totalAmount;
    totalCheck.in[1] <== MAX_TOTAL_WEI();
    totalCheck.out === 1;

    // Compute notesHash = sha256(concat(note_0, ..., note_{n-1}))
    // Each note is: amount (32 bytes BE) || recipientHash (32 bytes) = 64 bytes
    // Max input size: maxNotes * 64 bytes
    var maxInputBytes = maxNotes * 64;

    // Build concatenated notes data
    // Hash all maxNotes with zero-padding for inactive notes (canonical v1).
    component amountToBytes[maxNotes];
    signal noteData[maxNotes * 64];

    for (var i = 0; i < maxNotes; i++) {
        amountToBytes[i] = Uint256ToBytes32();
        amountToBytes[i].in <== amounts[i] * isActive[i].out; // Zero for inactive notes

        for (var j = 0; j < 32; j++) {
            noteData[i * 64 + j] <== amountToBytes[i].out[j] * isActive[i].out;
            noteData[i * 64 + 32 + j] <== recipientHashes[i][j] * isActive[i].out;
        }
    }

    // Hash all note data
    // Note: This uses fixed-size hashing. For variable length, we'd need padding logic.
    component hashNotes = Sha256BytesToBytes32(maxNotes * 64);
    for (var i = 0; i < maxNotes * 64; i++) {
        hashNotes.in[i] <== noteData[i];
    }

    for (var i = 0; i < 32; i++) {
        notesHash[i] <== hashNotes.out[i];
    }
}

/// @title RecipientHasher
/// @notice Computes recipientHash = sha256(MAGIC_RECIPIENT || recipient)
template RecipientHasher() {
    signal input recipient[20];     // 20-byte Ethereum address
    signal output hash[32];         // 32-byte hash

    var magic[32] = MAGIC_RECIPIENT();

    // Build input: MAGIC (32 bytes) || recipient padded to 32 bytes (20 bytes addr + 12 zeros)
    component sha = Sha256BytesToBytes32(64);

    for (var i = 0; i < 32; i++) {
        sha.in[i] <== magic[i];
    }
    // Pad recipient to 32 bytes (left-padded with zeros for address)
    for (var i = 0; i < 12; i++) {
        sha.in[32 + i] <== 0;
    }
    for (var i = 0; i < 20; i++) {
        sha.in[44 + i] <== recipient[i];
    }

    for (var i = 0; i < 32; i++) {
        hash[i] <== sha.out[i];
    }
}

/// @title NoteSelector
/// @notice Selects a note at given index and verifies recipient binding
/// @param maxNotes Maximum number of notes
template NoteSelector(maxNotes) {
    signal input noteIndex;
    signal input amounts[maxNotes];
    signal input recipientHashes[maxNotes][32];
    signal input recipient[20];

    signal output selectedAmount;
    signal output valid; // 1 if recipientHash matches

    // Select amount at index
    component amtSelector = ArraySelector(maxNotes);
    for (var i = 0; i < maxNotes; i++) {
        amtSelector.arr[i] <== amounts[i];
    }
    amtSelector.index <== noteIndex;
    selectedAmount <== amtSelector.out;

    // Compute expected recipientHash
    component hasher = RecipientHasher();
    for (var i = 0; i < 20; i++) {
        hasher.recipient[i] <== recipient[i];
    }

    // Select stored recipientHash at index
    component hashSelectors[32];
    signal selectedHash[32];
    for (var j = 0; j < 32; j++) {
        hashSelectors[j] = ArraySelector(maxNotes);
        for (var i = 0; i < maxNotes; i++) {
            hashSelectors[j].arr[i] <== recipientHashes[i][j];
        }
        hashSelectors[j].index <== noteIndex;
        selectedHash[j] <== hashSelectors[j].out;
    }

    // Compare hashes
    component isEq[32];
    signal matches[32];
    for (var i = 0; i < 32; i++) {
        isEq[i] = IsEqual();
        isEq[i].in[0] <== hasher.hash[i];
        isEq[i].in[1] <== selectedHash[i];
        matches[i] <== isEq[i].out;
    }

    // All bytes must match
    component allMatch = MultiAnd(32);
    for (var i = 0; i < 32; i++) {
        allMatch.in[i] <== matches[i];
    }
    valid <== allMatch.out;
}

/// @title NoteSetEnforcer
/// @notice Wraps validation + selection to keep Shadow.circom lean
/// @param maxNotes Maximum supported notes
template NoteSetEnforcer(maxNotes) {
    signal input noteCount;
    signal input noteIndex;
    signal input claimedAmount;
    signal input amounts[maxNotes];
    signal input recipientHashes[maxNotes][32];
    signal input recipient[20];

    signal output totalAmount;
    signal output notesHash[32];

    component validator = NoteValidator(maxNotes);
    validator.noteCount <== noteCount;
    for (var i = 0; i < maxNotes; i++) {
        validator.amounts[i] <== amounts[i];
        for (var j = 0; j < 32; j++) {
            validator.recipientHashes[i][j] <== recipientHashes[i][j];
        }
    }

    component indexCheck = LessThan(8);
    indexCheck.in[0] <== noteIndex;
    indexCheck.in[1] <== noteCount;
    indexCheck.out === 1;

    component selector = NoteSelector(maxNotes);
    selector.noteIndex <== noteIndex;
    for (var i2 = 0; i2 < maxNotes; i2++) {
        selector.amounts[i2] <== amounts[i2];
        for (var j2 = 0; j2 < 32; j2++) {
            selector.recipientHashes[i2][j2] <== recipientHashes[i2][j2];
        }
    }
    for (var r = 0; r < 20; r++) {
        selector.recipient[r] <== recipient[r];
    }

    selector.selectedAmount === claimedAmount;
    selector.valid === 1;

    totalAmount <== validator.totalAmount;
    for (var b = 0; b < 32; b++) {
        notesHash[b] <== validator.notesHash[b];
    }
}
