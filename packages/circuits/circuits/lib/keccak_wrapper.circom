pragma circom 2.1.9;

include "./vendor/worm/keccak.circom";
include "./vendor/worm/array.circom";
include "circomlib/circuits/comparators.circom";

// Keccak256 over fixed-length byte input (big-endian bytes)
// maxBlocks must satisfy maxBlocks * 136 > nBytes to guarantee padding fits
template Keccak256Bytes(nBytes, maxBlocks) {
    signal input in[nBytes];
    signal output out[32];

    assert(maxBlocks * 136 > nBytes);
    var paddedBytes = maxBlocks * 136;

    signal padded[paddedBytes];
    for (var i = 0; i < paddedBytes; i++) {
        if (i < nBytes) {
            padded[i] <== in[i];
        } else {
            padded[i] <== 0;
        }
    }

    component keccak = KeccakBytes(maxBlocks);
    for (var i = 0; i < paddedBytes; i++) {
        keccak.in[i] <== padded[i];
    }
    keccak.inLen <== nBytes;
    for (var i = 0; i < 32; i++) {
        out[i] <== keccak.out[i];
    }
}

// Keccak256 over variable-length byte input, len specifies actual bytes used
// maxBlocks must satisfy maxBlocks * 136 > maxBytes
template Keccak256BytesVariable(maxBytes, maxBlocks) {
    signal input in[maxBytes];
    signal input len;
    signal output out[32];

    assert(maxBlocks * 136 > maxBytes);
    var paddedBytes = maxBlocks * 136;

    // Ensure len <= maxBytes
    component lenBound = LessThan(32);
    lenBound.in[0] <== len;
    lenBound.in[1] <== maxBytes + 1;
    lenBound.out === 1;

    signal padded[paddedBytes];
    component byteActive[maxBytes];
    for (var i = 0; i < maxBytes; i++) {
        byteActive[i] = LessThan(16);
        byteActive[i].in[0] <== i;
        byteActive[i].in[1] <== len;
        padded[i] <== in[i] * byteActive[i].out;
    }
    for (var i = maxBytes; i < paddedBytes; i++) {
        padded[i] <== 0;
    }

    component keccak = KeccakBytes(maxBlocks);
    for (var i = 0; i < paddedBytes; i++) {
        keccak.in[i] <== padded[i];
    }
    keccak.inLen <== len;
    for (var i = 0; i < 32; i++) {
        out[i] <== keccak.out[i];
    }
}

// Keccak256 over two concatenated 32-byte inputs
template Keccak256TwoBytes32() {
    signal input a[32];
    signal input b[32];
    signal output out[32];

    signal concat[64];
    for (var i = 0; i < 32; i++) {
        concat[i] <== a[i];
        concat[32 + i] <== b[i];
    }

    component keccak = Keccak256Bytes(64, 1);
    for (var i = 0; i < 64; i++) {
        keccak.in[i] <== concat[i];
    }
    for (var i = 0; i < 32; i++) {
        out[i] <== keccak.out[i];
    }
}

// Keccak of a 20-byte address input
template Keccak256Bytes20() {
    signal input in[20];
    signal output out[32];

    component keccak = Keccak256Bytes(20, 1);
    for (var i = 0; i < 20; i++) {
        keccak.in[i] <== in[i];
    }
    for (var i = 0; i < 32; i++) {
        out[i] <== keccak.out[i];
    }
}

// Keccak of a single 32-byte word
template Keccak256Bytes32Single() {
    signal input in[32];
    signal output out[32];

    component keccak = Keccak256Bytes(32, 1);
    for (var i = 0; i < 32; i++) {
        keccak.in[i] <== in[i];
    }
    for (var i = 0; i < 32; i++) {
        out[i] <== keccak.out[i];
    }
}
