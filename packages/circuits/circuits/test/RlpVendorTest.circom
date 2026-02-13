// Test circuit to verify vendored RLP utilities compile correctly
pragma circom 2.1.9;

include "../lib/vendor/worm/rlp/integer.circom";
include "../lib/vendor/worm/rlp/empty_account.circom";
include "../lib/vendor/worm/rlp/merkle_patricia_trie_leaf.circom";

template RlpVendorTest() {
    signal input balance;
    signal output rlpLen;
    signal output leafLen;

    // Test RlpInteger - encode a balance value
    signal (rlpOut[32], rlpOutLen) <== RlpInteger(31)(balance);
    rlpLen <== rlpOutLen;

    // Test RlpEmptyAccount - encode an empty account with the given balance
    signal (accountOut[101], accountOutLen) <== RlpEmptyAccount(31)(balance);

    // Test LeafDetector with a mock layer (simplified)
    signal layer[200];
    for (var i = 0; i < 200; i++) {
        layer[i] <== 0;
    }
    signal isLeaf <== LeafDetector(200)(layer, 75);

    leafLen <== accountOutLen + isLeaf;
}
