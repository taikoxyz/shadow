// Test circuit for ArraySelector and related vendor utilities
pragma circom 2.1.9;

include "../lib/vendor/worm/selector.circom";
include "../lib/vendor/worm/convert.circom";
include "../lib/vendor/worm/substring_check.circom";

// Test template combining multiple vendor utility tests
template ArraySelectorTest() {
    // Test 1: Selector - select element at index
    signal input vals[8];
    signal input selectIndex;
    signal output selectedValue;

    // Test 2: Num2BigEndianBytes - convert number to bytes
    signal input numberToConvert;
    signal output convertedBytes[4];

    // Test 3: SubstringCheck - find substring in array
    signal input mainArray[16];
    signal input mainLen;
    signal input subArray[4];
    signal output substringFound;

    // Execute Selector test
    selectedValue <== Selector(8)(vals, selectIndex);

    // Execute Num2BigEndianBytes test (4 bytes = 32 bits, max ~4 billion)
    convertedBytes <== Num2BigEndianBytes(4)(numberToConvert);

    // Execute SubstringCheck test
    substringFound <== SubstringCheck(16, 4)(mainArray, mainLen, subArray);
}
