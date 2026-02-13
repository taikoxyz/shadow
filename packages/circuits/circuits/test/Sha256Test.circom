pragma circom 2.1.9;

include "../lib/sha256.circom";

template Sha256Test() {
    signal input data[64];
    signal output hash[32];

    component sha = Sha256BytesToBytes32(64);
    for (var i = 0; i < 64; i++) {
        sha.in[i] <== data[i];
    }

    for (var i = 0; i < 32; i++) {
        hash[i] <== sha.out[i];
    }
}
