pragma circom 2.1.9;
pragma custom_templates;

include "circomlib/circuits/sha256/sha256.circom";
include "circomlib/circuits/bitify.circom";

/// @title Sha256Bytes
/// @notice Computes SHA256 hash of arbitrary byte input
/// @param nBytes Number of bytes in input
template Sha256Bytes(nBytes) {
    signal input in[nBytes];
    signal output out[256]; // Output as 256 bits

    var nBits = nBytes * 8;

    component bytesToBits[nBytes];
    for (var i = 0; i < nBytes; i++) {
        bytesToBits[i] = Num2Bits(8);
        bytesToBits[i].in <== in[i];
    }

    component sha = Sha256(nBits);
    for (var i = 0; i < nBytes; i++) {
        for (var j = 0; j < 8; j++) {
            // Big-endian byte order, MSB first within each byte
            sha.in[i * 8 + j] <== bytesToBits[i].out[7 - j];
        }
    }

    for (var i = 0; i < 256; i++) {
        out[i] <== sha.out[i];
    }
}

/// @title Sha256BytesToBytes32
/// @notice Computes SHA256 hash and outputs as 32 bytes (big-endian)
/// @param nBytes Number of bytes in input
template Sha256BytesToBytes32(nBytes) {
    signal input in[nBytes];
    signal output out[32];

    component sha = Sha256Bytes(nBytes);
    for (var i = 0; i < nBytes; i++) {
        sha.in[i] <== in[i];
    }

    component bitsToBytes[32];
    for (var i = 0; i < 32; i++) {
        bitsToBytes[i] = Bits2Num(8);
        for (var j = 0; j < 8; j++) {
            bitsToBytes[i].in[7 - j] <== sha.out[i * 8 + j];
        }
        out[i] <== bitsToBytes[i].out;
    }
}

/// @title Sha256TwoBytes32
/// @notice Computes SHA256(a || b) where a and b are 32-byte arrays
template Sha256TwoBytes32() {
    signal input a[32];
    signal input b[32];
    signal output out[32];

    component sha = Sha256BytesToBytes32(64);
    for (var i = 0; i < 32; i++) {
        sha.in[i] <== a[i];
        sha.in[32 + i] <== b[i];
    }
    for (var i = 0; i < 32; i++) {
        out[i] <== sha.out[i];
    }
}
