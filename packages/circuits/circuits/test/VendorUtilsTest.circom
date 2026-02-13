// Test circuit to verify vendored worm-privacy utilities compile correctly
pragma circom 2.1.9;

include "../lib/vendor/worm/assert.circom";
include "../lib/vendor/worm/array.circom";
include "../lib/vendor/worm/selector.circom";
include "../lib/vendor/worm/convert.circom";
include "../lib/vendor/worm/divide.circom";
include "../lib/vendor/worm/shift.circom";
include "../lib/vendor/worm/concat.circom";
include "../lib/vendor/worm/substring_check.circom";

template VendorUtilsTest() {
    signal input a;
    signal input b;
    signal output out;

    // Test AssertBits - a must be < 256 (8 bits)
    AssertBits(8)(a);

    // Test Filter - creates array [1,1,1,0,0] when input is 3
    signal filterOut[5] <== Filter(5)(3);

    // Test Selector - select element at index
    signal vals[4];
    vals[0] <== 10;
    vals[1] <== 20;
    vals[2] <== 30;
    vals[3] <== 40;
    signal selected <== Selector(4)(vals, 2);  // Should select 30

    // Test LittleEndianBytes2Num
    signal bytes[4];
    bytes[0] <== a;
    bytes[1] <== 0;
    bytes[2] <== 0;
    bytes[3] <== 0;
    signal num <== LittleEndianBytes2Num(4)(bytes);

    // Test Divide
    signal quotient;
    signal remainder;
    (quotient, remainder) <== Divide(16)(a, b);

    // Test SubstringCheck - check if [a, b] is in [1, 2, a, b, 5]
    signal mainArr[5];
    mainArr[0] <== 1;
    mainArr[1] <== 2;
    mainArr[2] <== a;
    mainArr[3] <== b;
    mainArr[4] <== 5;
    signal subArr[2];
    subArr[0] <== a;
    subArr[1] <== b;
    signal found <== SubstringCheck(5, 2)(mainArr, 5, subArr);

    out <== selected + num + quotient + found;
}
