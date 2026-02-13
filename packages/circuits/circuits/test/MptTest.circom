pragma circom 2.1.9;

include "../lib/mpt.circom";

template MptTest(maxDepth, maxNodeBytes, maxNodeBlocks) {
    signal input stateRoot[32];
    signal input layers[maxDepth][maxNodeBytes];
    signal input layerLengths[maxDepth];
    signal input numLayers;
    signal input addressHash[32];

    signal input expectedNonce;
    signal input expectedBalance;
    signal input expectedStorageRoot[32];
    signal input expectedCodeHash[32];

    component verifier = MptProofVerifier(maxDepth, maxNodeBytes, maxNodeBlocks);
    for (var i = 0; i < 32; i++) {
        verifier.stateRoot[i] <== stateRoot[i];
        verifier.addressHash[i] <== addressHash[i];
    }
    for (var depth = 0; depth < maxDepth; depth++) {
        verifier.layerLengths[depth] <== layerLengths[depth];
        for (var j = 0; j < maxNodeBytes; j++) {
            verifier.layers[depth][j] <== layers[depth][j];
        }
    }
    verifier.numLayers <== numLayers;

    verifier.accountNonce === expectedNonce;
    verifier.accountBalance === expectedBalance;
    for (var k = 0; k < 32; k++) {
        verifier.storageRoot[k] === expectedStorageRoot[k];
        verifier.codeHash[k] === expectedCodeHash[k];
    }
}
