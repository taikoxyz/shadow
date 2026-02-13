pragma circom 2.1.9;

include "../lib/notes.circom";

template NoteValidatorTest(maxNotes) {
    signal input noteCount;
    signal input amounts[maxNotes];
    signal input recipientHashes[maxNotes][32];

    signal output notesHash[32];
    signal output totalAmount;

    component validator = NoteValidator(maxNotes);
    validator.noteCount <== noteCount;
    for (var i = 0; i < maxNotes; i++) {
        validator.amounts[i] <== amounts[i];
        for (var j = 0; j < 32; j++) {
            validator.recipientHashes[i][j] <== recipientHashes[i][j];
        }
    }

    for (var i = 0; i < 32; i++) {
        notesHash[i] <== validator.notesHash[i];
    }
    totalAmount <== validator.totalAmount;
}
