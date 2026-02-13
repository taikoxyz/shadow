pragma circom 2.1.9;

include "../lib/rlp.circom";

template RlpTest(maxHeaderBytes, maxAccountBytes) {
    signal input header[maxHeaderBytes];
    signal input headerLength;
    signal input expectedStateRoot[32];
    signal input expectedBlockNumber;

    signal input account[maxAccountBytes];
    signal input accountLength;
    signal input expectedNonce;
    signal input expectedBalance;
    signal input expectedStorageRoot[32];
    signal input expectedCodeHash[32];

    signal output parsedLength;
    signal output payloadLength;

    component headerDecoder = RlpBlockHeaderDecoderFull(maxHeaderBytes);
    for (var i = 0; i < maxHeaderBytes; i++) {
        headerDecoder.headerRlp[i] <== header[i];
    }
    headerDecoder.headerLength <== headerLength;

    component headerStateEq[32];
    for (var j = 0; j < 32; j++) {
        headerStateEq[j] = IsEqual();
        headerStateEq[j].in[0] <== headerDecoder.stateRoot[j];
        headerStateEq[j].in[1] <== expectedStateRoot[j];
        headerStateEq[j].out === 1;
    }

    headerDecoder.blockNumber === expectedBlockNumber;
    parsedLength <== headerDecoder.parsedLength;
    payloadLength <== headerDecoder.payloadLength;

    component accountDecoder = RlpAccountDecoder(maxAccountBytes);
    for (var k = 0; k < maxAccountBytes; k++) {
        accountDecoder.data[k] <== account[k];
    }
    accountDecoder.dataLen <== accountLength;

    accountDecoder.nonce === expectedNonce;
    accountDecoder.balance === expectedBalance;

    for (var m = 0; m < 32; m++) {
        accountDecoder.storageRoot[m] === expectedStorageRoot[m];
        accountDecoder.codeHash[m] === expectedCodeHash[m];
    }
}
