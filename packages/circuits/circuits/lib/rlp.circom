pragma circom 2.1.9;

include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";
include "./vendor/worm/assert.circom";
include "./vendor/worm/shift.circom";
include "./vendor/worm/selector.circom";
include "./keccak_wrapper.circom";
include "./utils.circom";

/// @title BigEndianBytesToNumber
/// @notice Converts up to maxBytes big-endian bytes into a field element
template BigEndianBytesToNumber(maxBytes) {
    signal input bytes[maxBytes];
    signal input len;
    signal output value;

    component lenBound = AssertLessEqThan(16);
    lenBound.a <== len;
    lenBound.b <== maxBytes;

    signal acc[maxBytes + 1];
    acc[0] <== 0;

    component useByte[maxBytes];
    signal candidate[maxBytes];
    signal includedValue[maxBytes];
    signal skippedValue[maxBytes];

    for (var i = 0; i < maxBytes; i++) {
        useByte[i] = LessThan(16);
        useByte[i].in[0] <== i;
        useByte[i].in[1] <== len;

        candidate[i] <== acc[i] * 256 + bytes[i];
        includedValue[i] <== useByte[i].out * candidate[i];
        skippedValue[i] <== (1 - useByte[i].out) * acc[i];
        acc[i + 1] <== includedValue[i] + skippedValue[i];
    }

    value <== acc[maxBytes];
}

/// @title RlpLengthPrefix
/// @notice Parses RLP length prefix and returns payload start/length
template RlpLengthPrefix(maxBytes) {
    signal input data[maxBytes];

    signal output payloadStart;
    signal output payloadLength;
    signal output isList;

    signal firstByte <== data[0];

    component lt80 = LessThan(16);
    lt80.in[0] <== firstByte;
    lt80.in[1] <== 0x80;
    signal isSingle <== lt80.out;

    component ltB8 = LessThan(16);
    ltB8.in[0] <== firstByte;
    ltB8.in[1] <== 0xb8;
    signal isShortString <== ltB8.out - isSingle;

    component ltC0 = LessThan(16);
    ltC0.in[0] <== firstByte;
    ltC0.in[1] <== 0xc0;
    signal isLongString <== ltC0.out - ltB8.out;

    component ltF8 = LessThan(16);
    ltF8.in[0] <== firstByte;
    ltF8.in[1] <== 0xf8;
    signal isShortList <== ltF8.out - ltC0.out;

    signal isLongList <== 1 - (isSingle + isShortString + isLongString + isShortList);
    isList <== isShortList + isLongList;

    var maxLenOfLen = 4;
    signal lenBytes[maxLenOfLen];
    for (var i = 0; i < maxLenOfLen; i++) {
        lenBytes[i] <== data[1 + i];
    }

    signal lenAcc[maxLenOfLen];
    for (var l = 0; l < maxLenOfLen; l++) {
        var sum = 0;
        for (var j = 0; j <= l; j++) {
            var pow = 1;
            for (var k = 0; k < (l - j); k++) {
                pow *= 256;
            }
            sum += lenBytes[j] * pow;
        }
        lenAcc[l] <== sum;
    }

    signal shortStringLen <== (firstByte - 0x80) * isShortString;
    signal shortListLen <== (firstByte - 0xc0) * isShortList;

    signal lenOfLenString <== (firstByte - 0xb7) * isLongString;
    signal lenOfLenList <== (firstByte - 0xf7) * isLongList;

    component lenOfLenStringBound = AssertLessEqThan(8);
    lenOfLenStringBound.a <== lenOfLenString;
    lenOfLenStringBound.b <== maxLenOfLen;

    component lenOfLenListBound = AssertLessEqThan(8);
    lenOfLenListBound.a <== lenOfLenList;
    lenOfLenListBound.b <== maxLenOfLen;

    component eqStr[maxLenOfLen];
    component eqList[maxLenOfLen];
    signal stringAcc[maxLenOfLen + 1];
    signal listAcc[maxLenOfLen + 1];
    stringAcc[0] <== 0;
    listAcc[0] <== 0;

    for (var idx = 0; idx < maxLenOfLen; idx++) {
        eqStr[idx] = IsEqual();
        eqStr[idx].in[0] <== lenOfLenString;
        eqStr[idx].in[1] <== idx + 1;

        eqList[idx] = IsEqual();
        eqList[idx].in[0] <== lenOfLenList;
        eqList[idx].in[1] <== idx + 1;

        stringAcc[idx + 1] <== stringAcc[idx] + lenAcc[idx] * eqStr[idx].out;
        listAcc[idx + 1] <== listAcc[idx] + lenAcc[idx] * eqList[idx].out;
    }

    signal longStringLen <== stringAcc[maxLenOfLen];
    signal longListLen <== listAcc[maxLenOfLen];

    signal longStringStart <== isLongString * (1 + lenOfLenString);
    signal longListStart <== isLongList * (1 + lenOfLenList);
    signal shortStringStart <== isShortString;
    signal shortListStart <== isShortList;

    payloadStart <== longStringStart + longListStart + shortStringStart + shortListStart;

    signal singleLenContribution <== isSingle;
    signal shortStringContribution <== isShortString * shortStringLen;
    signal longStringContribution <== isLongString * longStringLen;
    signal shortListContribution <== isShortList * shortListLen;
    signal longListContribution <== isLongList * longListLen;

    payloadLength <== singleLenContribution
        + shortStringContribution
        + longStringContribution
        + shortListContribution
        + longListContribution;
}

/// @title RlpBlockHeaderDecoderFull
/// @notice Decodes Ethereum block header into stateRoot and blockNumber
template RlpBlockHeaderDecoderFull(maxHeaderBytes) {
    signal input headerRlp[maxHeaderBytes];
    signal input headerLength;

    signal output stateRoot[32];
    signal output blockNumber;
    signal output valid;
    signal output parsedLength;
    signal output payloadLength;

    component lenCheck = AssertLessEqThan(16);
    lenCheck.a <== headerLength;
    lenCheck.b <== maxHeaderBytes;

    component prefix = RlpLengthPrefix(maxHeaderBytes);
    for (var i = 0; i < maxHeaderBytes; i++) {
        prefix.data[i] <== headerRlp[i];
    }

    prefix.isList === 1;
    valid <== prefix.isList;

    var fieldCount = 17;
    signal cursor[fieldCount + 1];
    signal fieldStarts[fieldCount];
    signal fieldLens[fieldCount];

    cursor[0] <== prefix.payloadStart;

    component headerSlices[fieldCount];
    component itemPrefixes[fieldCount];

    for (var f = 0; f < fieldCount; f++) {
        headerSlices[f] = ShiftLeft(maxHeaderBytes);
        for (var j = 0; j < maxHeaderBytes; j++) {
            headerSlices[f].in[j] <== headerRlp[j];
        }
        headerSlices[f].count <== cursor[f];

        itemPrefixes[f] = RlpLengthPrefix(maxHeaderBytes);
        for (var y = 0; y < maxHeaderBytes; y++) {
            itemPrefixes[f].data[y] <== headerSlices[f].out[y];
        }

        fieldStarts[f] <== cursor[f] + itemPrefixes[f].payloadStart;
        fieldLens[f] <== itemPrefixes[f].payloadLength;
        cursor[f + 1] <== fieldStarts[f] + fieldLens[f];
    }

    parsedLength <== cursor[fieldCount];
    payloadLength <== prefix.payloadStart + prefix.payloadLength;
    parsedLength === payloadLength;
    headerLength === payloadLength;

    component stateRootSlice = ShiftLeft(maxHeaderBytes);
    for (var sr = 0; sr < maxHeaderBytes; sr++) {
        stateRootSlice.in[sr] <== headerRlp[sr];
    }
    stateRootSlice.count <== fieldStarts[3];
    fieldLens[3] === 32;
    for (var i = 0; i < 32; i++) {
        stateRoot[i] <== stateRootSlice.out[i];
    }

    var maxBlockNumBytes = 32;
    component blockSlice = ShiftLeft(maxHeaderBytes);
    for (var bl = 0; bl < maxHeaderBytes; bl++) {
        blockSlice.in[bl] <== headerRlp[bl];
    }
    blockSlice.count <== fieldStarts[8];
    signal blockBytes[maxBlockNumBytes];
    for (var k = 0; k < maxBlockNumBytes; k++) {
        blockBytes[k] <== blockSlice.out[k];
    }

    component blockNum = BigEndianBytesToNumber(maxBlockNumBytes);
    for (var k2 = 0; k2 < maxBlockNumBytes; k2++) {
        blockNum.bytes[k2] <== blockBytes[k2];
    }
    blockNum.len <== fieldLens[8];
    blockNumber <== blockNum.value;
}

/// @title RlpAccountDecoder
/// @notice Decodes [nonce, balance, storageRoot, codeHash] account structure
template RlpAccountDecoder(maxBytes) {
    signal input data[maxBytes];
    signal input dataLen;

    signal output nonce;
    signal output balance;
    signal output storageRoot[32];
    signal output codeHash[32];

    component lenCheck = AssertLessEqThan(16);
    lenCheck.a <== dataLen;
    lenCheck.b <== maxBytes;

    component prefix = RlpLengthPrefix(maxBytes);
    for (var i = 0; i < maxBytes; i++) {
        prefix.data[i] <== data[i];
    }

    prefix.isList === 1;

    signal cursor[5];
    signal fieldStarts[4];
    signal fieldLens[4];

    cursor[0] <== prefix.payloadStart;

    component accountSlices[4];
    component accountPrefixes[4];

    for (var f = 0; f < 4; f++) {
        accountSlices[f] = ShiftLeft(maxBytes);
        for (var j = 0; j < maxBytes; j++) {
            accountSlices[f].in[j] <== data[j];
        }
        accountSlices[f].count <== cursor[f];

        accountPrefixes[f] = RlpLengthPrefix(maxBytes);
        for (var y = 0; y < maxBytes; y++) {
            accountPrefixes[f].data[y] <== accountSlices[f].out[y];
        }

        fieldStarts[f] <== cursor[f] + accountPrefixes[f].payloadStart;
        fieldLens[f] <== accountPrefixes[f].payloadLength;
        cursor[f + 1] <== fieldStarts[f] + fieldLens[f];
    }

    cursor[4] === prefix.payloadStart + prefix.payloadLength;
    dataLen === prefix.payloadStart + prefix.payloadLength;

    var maxFieldBytes = 32;

    component nonceSlice = ShiftLeft(maxBytes);
    for (var nIdx = 0; nIdx < maxBytes; nIdx++) {
        nonceSlice.in[nIdx] <== data[nIdx];
    }
    nonceSlice.count <== fieldStarts[0];
    signal nonceBytes[maxFieldBytes];
    for (var i = 0; i < maxFieldBytes; i++) {
        nonceBytes[i] <== nonceSlice.out[i];
    }
    component nonceNum = BigEndianBytesToNumber(maxFieldBytes);
    for (var i = 0; i < maxFieldBytes; i++) {
        nonceNum.bytes[i] <== nonceBytes[i];
    }
    nonceNum.len <== fieldLens[0];
    nonce <== nonceNum.value;

    component balanceSlice = ShiftLeft(maxBytes);
    for (var bIdx = 0; bIdx < maxBytes; bIdx++) {
        balanceSlice.in[bIdx] <== data[bIdx];
    }
    balanceSlice.count <== fieldStarts[1];
    signal balanceBytes[maxFieldBytes];
    for (var b = 0; b < maxFieldBytes; b++) {
        balanceBytes[b] <== balanceSlice.out[b];
    }
    component balanceNum = BigEndianBytesToNumber(maxFieldBytes);
    for (var b = 0; b < maxFieldBytes; b++) {
        balanceNum.bytes[b] <== balanceBytes[b];
    }
    balanceNum.len <== fieldLens[1];
    balance <== balanceNum.value;

    component storageSlice = ShiftLeft(maxBytes);
    for (var sIdx = 0; sIdx < maxBytes; sIdx++) {
        storageSlice.in[sIdx] <== data[sIdx];
    }
    storageSlice.count <== fieldStarts[2];
    fieldLens[2] === 32;
    for (var s = 0; s < 32; s++) {
        storageRoot[s] <== storageSlice.out[s];
    }

    component codeSlice = ShiftLeft(maxBytes);
    for (var cIdx = 0; cIdx < maxBytes; cIdx++) {
        codeSlice.in[cIdx] <== data[cIdx];
    }
    codeSlice.count <== fieldStarts[3];
    fieldLens[3] === 32;
    for (var c = 0; c < 32; c++) {
        codeHash[c] <== codeSlice.out[c];
    }
}

/// @title BlockHeaderBinding
/// @notice Verifies `keccak256(headerRlp) == blockHash` and extracts stateRoot
/// @param maxHeaderBytes Maximum header size in bytes
/// @param maxBlocks Maximum keccak sponge blocks (for padding)
template BlockHeaderBinding(maxHeaderBytes, maxBlocks) {
    signal input headerRlp[maxHeaderBytes];
    signal input headerLength;
    signal input blockHash[32];
    signal input blockNumber;

    signal output stateRoot[32];

    component masked = MaskBytesByLength(maxHeaderBytes);
    for (var i = 0; i < maxHeaderBytes; i++) {
        masked.data[i] <== headerRlp[i];
    }
    masked.len <== headerLength;

    component headerHasher = Keccak256BytesVariable(maxHeaderBytes, maxBlocks);
    for (var j = 0; j < maxHeaderBytes; j++) {
        headerHasher.in[j] <== masked.masked[j];
    }
    headerHasher.len <== headerLength;

    component hashCheck = AssertBytesEqual(32);
    for (var b = 0; b < 32; b++) {
        hashCheck.a[b] <== headerHasher.out[b];
        hashCheck.b[b] <== blockHash[b];
    }

    component decoder = RlpBlockHeaderDecoderFull(maxHeaderBytes);
    for (var r = 0; r < maxHeaderBytes; r++) {
        decoder.headerRlp[r] <== headerRlp[r];
    }
    decoder.headerLength <== headerLength;
    decoder.blockNumber === blockNumber;

    for (var s = 0; s < 32; s++) {
        stateRoot[s] <== decoder.stateRoot[s];
    }
}
