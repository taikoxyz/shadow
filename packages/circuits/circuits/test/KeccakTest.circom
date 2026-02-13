// Test circuit for keccak wrapper utilities
pragma circom 2.1.9;

include "../lib/keccak_wrapper.circom";

template KeccakTest() {
    signal input varInput[64];
    signal input varLen;
    signal input expectedVarHash[32];
    signal output varHash[32];

    signal input addressInput[20];
    signal input expectedAddressHash[32];
    signal output addressHash[32];

    signal input wordInput[32];
    signal input expectedWordHash[32];
    signal output wordHash[32];

    component varKeccak = Keccak256BytesVariable(64, 1);
    for (var i = 0; i < 64; i++) {
        varKeccak.in[i] <== varInput[i];
    }
    varKeccak.len <== varLen;
    for (var i = 0; i < 32; i++) {
        varHash[i] <== varKeccak.out[i];
        varHash[i] === expectedVarHash[i];
    }

    component addrKeccak = Keccak256Bytes20();
    for (var i = 0; i < 20; i++) {
        addrKeccak.in[i] <== addressInput[i];
    }
    for (var i = 0; i < 32; i++) {
        addressHash[i] <== addrKeccak.out[i];
        addressHash[i] === expectedAddressHash[i];
    }

    component wordKeccak = Keccak256Bytes32Single();
    for (var i = 0; i < 32; i++) {
        wordKeccak.in[i] <== wordInput[i];
    }
    for (var i = 0; i < 32; i++) {
        wordHash[i] <== wordKeccak.out[i];
        wordHash[i] === expectedWordHash[i];
    }
}
