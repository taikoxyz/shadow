pragma circom 2.1.9;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "circomlib/circuits/gates.circom";

/// @title RangeCheck
/// @notice Checks that value is in range [min, max]
template RangeCheck(nBits) {
    signal input in;
    signal input min;
    signal input max;
    signal output out; // 1 if in range, 0 otherwise

    component geMin = GreaterEqThan(nBits);
    geMin.in[0] <== in;
    geMin.in[1] <== min;

    component leMax = LessEqThan(nBits);
    leMax.in[0] <== in;
    leMax.in[1] <== max;

    out <== geMin.out * leMax.out;
}

/// @title AssertRangeCheck
/// @notice Asserts that value is in range [min, max]
template AssertRangeCheck(nBits) {
    signal input in;
    signal input min;
    signal input max;

    component rc = RangeCheck(nBits);
    rc.in <== in;
    rc.min <== min;
    rc.max <== max;
    rc.out === 1;
}

/// @title IsNonZero
/// @notice Outputs 1 if input is non-zero, 0 otherwise
template IsNonZero() {
    signal input in;
    signal output out;

    component isz = IsZero();
    isz.in <== in;
    out <== 1 - isz.out;
}

/// @title Uint256ToBytes32
/// @notice Converts a uint256 field element to 32 bytes (big-endian)
template Uint256ToBytes32() {
    signal input in;
    signal output out[32];

    component bits = Num2Bits(256);
    bits.in <== in;

    component bytesConv[32];
    for (var i = 0; i < 32; i++) {
        bytesConv[i] = Bits2Num(8);
        for (var j = 0; j < 8; j++) {
            // Big-endian: byte 0 is MSB
            bytesConv[i].in[7 - j] <== bits.out[255 - (i * 8 + j)];
        }
        out[i] <== bytesConv[i].out;
    }
}

/// @title Bytes32ToUint256
/// @notice Converts 32 bytes (big-endian) to a uint256 field element
template Bytes32ToUint256() {
    signal input in[32];
    signal output out;

    component byteBits[32];
    for (var i = 0; i < 32; i++) {
        byteBits[i] = Num2Bits(8);
        byteBits[i].in <== in[i];
    }

    component toNum = Bits2Num(256);
    for (var i = 0; i < 32; i++) {
        for (var j = 0; j < 8; j++) {
            // Big-endian: byte 0 is MSB
            toNum.in[255 - (i * 8 + j)] <== byteBits[i].out[7 - j];
        }
    }
    out <== toNum.out;
}

/// @title AddressFromBytes32
/// @notice Extracts 20-byte address from 32-byte hash (last 20 bytes)
template AddressFromBytes32() {
    signal input in[32];
    signal output out[20];

    // Address is last 20 bytes of sha256 hash
    for (var i = 0; i < 20; i++) {
        out[i] <== in[12 + i];
    }
}

/// @title ArraySelector
/// @notice Selects element at index from array
/// @param n Array size
template ArraySelector(n) {
    signal input arr[n];
    signal input index;
    signal output out;

    component isEq[n];
    signal products[n];

    for (var i = 0; i < n; i++) {
        isEq[i] = IsEqual();
        isEq[i].in[0] <== index;
        isEq[i].in[1] <== i;
        products[i] <== isEq[i].out * arr[i];
    }

    var sum = 0;
    for (var i = 0; i < n; i++) {
        sum += products[i];
    }
    out <== sum;
}

/// @title MultiAnd
/// @notice Computes AND of n boolean signals
/// @param n Number of inputs
template MultiAnd(n) {
    signal input in[n];
    signal output out;

    signal intermediate[n];
    intermediate[0] <== in[0];
    for (var i = 1; i < n; i++) {
        intermediate[i] <== intermediate[i-1] * in[i];
    }
    out <== intermediate[n-1];
}

/// @title BytesEqual
/// @notice Returns 1 if two byte arrays match element-wise
/// @param n Number of bytes to compare
template BytesEqual(n) {
    signal input a[n];
    signal input b[n];
    signal output out;

    component eq[n];
    for (var i = 0; i < n; i++) {
        eq[i] = IsEqual();
        eq[i].in[0] <== a[i];
        eq[i].in[1] <== b[i];
    }

    component all = MultiAnd(n);
    for (var j = 0; j < n; j++) {
        all.in[j] <== eq[j].out;
    }
    out <== all.out;
}

/// @title AssertBytesEqual
/// @notice Enforces byte-wise equality between two arrays
/// @param n Number of bytes to compare
template AssertBytesEqual(n) {
    signal input a[n];
    signal input b[n];

    component eq = BytesEqual(n);
    for (var i = 0; i < n; i++) {
        eq.a[i] <== a[i];
        eq.b[i] <== b[i];
    }
    eq.out === 1;
}

/// @title MaskBytesByLength
/// @notice Zeros bytes beyond the provided length to keep a fixed preimage
/// @param maxBytes Maximum byte length supported
template MaskBytesByLength(maxBytes) {
    signal input data[maxBytes];
    signal input len;
    signal output masked[maxBytes];

    component lenBound = LessThan(16);
    lenBound.in[0] <== len;
    lenBound.in[1] <== maxBytes + 1;
    lenBound.out === 1;

    component isActive[maxBytes];
    for (var i = 0; i < maxBytes; i++) {
        isActive[i] = LessThan(16);
        isActive[i].in[0] <== i;
        isActive[i].in[1] <== len;
        masked[i] <== data[i] * isActive[i].out;
    }
}
