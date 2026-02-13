pragma circom 2.1.9;

include "circomlib/circuits/comparators.circom";
include "./vendor/worm/selector.circom";
include "./vendor/worm/array.circom";
include "./vendor/worm/assert.circom";
include "./vendor/worm/shift.circom";
include "./vendor/worm/convert.circom";
include "./keccak_wrapper.circom";
include "./rlp.circom";

/// @title LeafDetector
/// @notice Checks if an MPT node is a leaf node by looking at the path prefix
template LeafDetector(maxBytes) {
    signal input node[maxBytes];
    signal input nodeLen;
    signal output isLeaf;

    component nodeBound = AssertLessEqThan(16);
    nodeBound.a <== nodeLen;
    nodeBound.b <== maxBytes;

    component listPrefix = RlpLengthPrefix(maxBytes);
    for (var i = 0; i < maxBytes; i++) {
        listPrefix.data[i] <== node[i];
    }

    listPrefix.isList === 1;

    signal cursor <== listPrefix.payloadStart;
    component keySlice = ShiftLeft(maxBytes);
    for (var idx = 0; idx < maxBytes; idx++) {
        keySlice.in[idx] <== node[idx];
    }
    keySlice.count <== cursor;
    component keyPrefix = RlpLengthPrefix(maxBytes);
    for (var j = 0; j < maxBytes; j++) {
        keyPrefix.data[j] <== keySlice.out[j];
    }

    signal keyDataStart <== cursor + keyPrefix.payloadStart;
    component keyDataSlice = ShiftLeft(maxBytes);
    for (var kd = 0; kd < maxBytes; kd++) {
        keyDataSlice.in[kd] <== node[kd];
    }
    keyDataSlice.count <== keyDataStart;

    component keyBits = Num2Bits(8);
    keyBits.in <== keyDataSlice.out[0];

    signal highNibble <== keyBits.out[4]
        + keyBits.out[5] * 2
        + keyBits.out[6] * 4
        + keyBits.out[7] * 8;

    component isEvenLeaf = IsEqual();
    isEvenLeaf.in[0] <== highNibble;
    isEvenLeaf.in[1] <== 2;

    component isOddLeaf = IsEqual();
    isOddLeaf.in[0] <== highNibble;
    isOddLeaf.in[1] <== 3;

    isLeaf <== isEvenLeaf.out + isOddLeaf.out - isEvenLeaf.out * isOddLeaf.out;
}

/// @title HexPrefixDecode
/// @notice Decodes a hex-prefix encoded MPT key into path nibbles and metadata
template HexPrefixDecode(maxKeyBytes) {
    signal input keyBytes[maxKeyBytes];
    signal input keyLen;
    signal output isLeaf;
    signal output isExtension;
    signal output isOdd;
    signal output pathLen;
    signal output pathNibbles[2 * maxKeyBytes];

    component keyLenMin = AssertGreaterEqThan(16);
    keyLenMin.a <== keyLen;
    keyLenMin.b <== 1;

    component keyLenMax = AssertLessEqThan(16);
    keyLenMax.a <== keyLen;
    keyLenMax.b <== maxKeyBytes;

    component useByte[maxKeyBytes];
    signal paddedBytes[maxKeyBytes];
    for (var i = 0; i < maxKeyBytes; i++) {
        useByte[i] = LessThan(16);
        useByte[i].in[0] <== i;
        useByte[i].in[1] <== keyLen;
        paddedBytes[i] <== keyBytes[i] * useByte[i].out;
    }

    component rawNibbles = Bytes2Nibbles(maxKeyBytes);
    for (var j = 0; j < maxKeyBytes; j++) {
        rawNibbles.in[j] <== paddedBytes[j];
    }

    signal firstNibble <== rawNibbles.out[0];

    component isLeafEven = IsEqual();
    isLeafEven.in[0] <== firstNibble;
    isLeafEven.in[1] <== 2;
    component isLeafOdd = IsEqual();
    isLeafOdd.in[0] <== firstNibble;
    isLeafOdd.in[1] <== 3;
    isLeaf <== isLeafEven.out + isLeafOdd.out - isLeafEven.out * isLeafOdd.out;

    component isExtEven = IsEqual();
    isExtEven.in[0] <== firstNibble;
    isExtEven.in[1] <== 0;
    component isExtOdd = IsEqual();
    isExtOdd.in[0] <== firstNibble;
    isExtOdd.in[1] <== 1;
    isExtension <== isExtEven.out + isExtOdd.out - isExtEven.out * isExtOdd.out;

    isOdd <== isExtOdd.out + isLeafOdd.out - isExtOdd.out * isLeafOdd.out;

    pathLen <== 2 * keyLen - 2 + isOdd;

    component shiftNibbles = ShiftLeft(2 * maxKeyBytes);
    for (var k = 0; k < 2 * maxKeyBytes; k++) {
        shiftNibbles.in[k] <== rawNibbles.out[k];
    }
    // If even, drop two prefix nibbles. If odd, drop one.
    shiftNibbles.count <== 2 - isOdd;
    for (var n = 0; n < 2 * maxKeyBytes; n++) {
        pathNibbles[n] <== shiftNibbles.out[n];
    }
}

/// @title MptProofVerifier
/// @notice Verifies an account inclusion proof inside the Ethereum state trie
template MptProofVerifier(maxDepth, maxNodeBytes, maxNodeBlocks) {
    signal input stateRoot[32];
    signal input layers[maxDepth][maxNodeBytes];
    signal input layerLengths[maxDepth];
    signal input numLayers;
    signal input addressHash[32];

    signal output accountBalance;
    signal output accountNonce;
    signal output storageRoot[32];
    signal output codeHash[32];
    signal output valid;

    component lengthBounds[maxDepth];
    for (var i = 0; i < maxDepth; i++) {
        lengthBounds[i] = AssertLessEqThan(16);
        lengthBounds[i].a <== layerLengths[i];
        lengthBounds[i].b <== maxNodeBytes;
    }

    signal layerExists[maxDepth] <== Filter(maxDepth)(numLayers);
    component keccakLayers[maxDepth];
    signal reducedHashes[maxDepth][31];

    for (var d = 0; d < maxDepth; d++) {
        keccakLayers[d] = Keccak256BytesVariable(maxNodeBytes, maxNodeBlocks);
        for (var b = 0; b < maxNodeBytes; b++) {
            keccakLayers[d].in[b] <== layers[d][b];
        }
        keccakLayers[d].len <== layerLengths[d];
        reducedHashes[d] <== Fit(32, 31)(keccakLayers[d].out);
    }

    for (var k = 0; k < 32; k++) {
        keccakLayers[0].out[k] === stateRoot[k];
    }

    component numLayersBound = AssertGreaterEqThan(16);
    numLayersBound.a <== numLayers;
    numLayersBound.b <== 1;

    component addressNibbles = Bytes2Nibbles(32);
    for (var an = 0; an < 32; an++) {
        addressNibbles.in[an] <== addressHash[an];
    }

    signal pathIndex[maxDepth + 1];
    pathIndex[0] <== 0;

    signal nodeExists[maxDepth];
    signal nextExists[maxDepth];
    component nodePrefix[maxDepth];
    signal payloadStart[maxDepth];
    signal payloadEnd[maxDepth];

    signal branchCursor[maxDepth][18];
    signal branchItemStart[maxDepth][17];
    signal branchItemPayloadStart[maxDepth][17];
    signal branchItemPayloadLen[maxDepth][17];
    component branchItemPrefix[maxDepth][17];
    component branchItemSlice[maxDepth][17];
    component branchEndEq[maxDepth];
    signal isBranch[maxDepth];

    signal extCursor[maxDepth][3];
    signal extItemStart[maxDepth][2];
    signal extItemPayloadStart[maxDepth][2];
    signal extItemPayloadLen[maxDepth][2];
    component extItemPrefix[maxDepth][2];
    component extItemSlice[maxDepth][2];
    component extEndEq[maxDepth];
    signal isExtLeafCount[maxDepth];

    var maxKeyBytes = 33;
    signal keyBytes[maxDepth][33];
    component keySlice[maxDepth];
    component keyDecoder[maxDepth];
    signal isLeaf[maxDepth];
    signal isExtension[maxDepth];
    signal keyPathLen[maxDepth];
    signal isLast[maxDepth];

    component addressShift[maxDepth];
    component pathLenBound[maxDepth];
    component useNibble[maxDepth][64];
    signal nibbleMasked[maxDepth][64];

    component pathIndexBound[maxDepth];
    component currentNibbleSel[maxDepth];
    signal currentNibble[maxDepth];
    component branchStartSel[maxDepth];
    component branchLenSel[maxDepth];
    signal branchChildPayloadStart[maxDepth];
    signal branchChildPayloadLen[maxDepth];
    signal branchChildStartMasked[maxDepth];
    signal extChildStartMasked[maxDepth];
    signal branchChildLenMasked[maxDepth];
    signal extChildLenMasked[maxDepth];
    signal childPayloadStart[maxDepth];
    signal childPayloadLen[maxDepth];

    component childSlice[maxDepth];
    component isHash[maxDepth];
    component embedLenEq[maxDepth];
    component useEmbed[maxDepth][maxNodeBytes];
    signal hashGate[maxDepth];
    signal embedGate[maxDepth];
    signal embedByteGate[maxDepth][maxNodeBytes];

    signal nextPath[maxDepth];

    for (var depth = 0; depth < maxDepth; depth++) {
        nodeExists[depth] <== layerExists[depth];
        if (depth < maxDepth - 1) {
            nextExists[depth] <== layerExists[depth + 1];
        } else {
            nextExists[depth] <== 0;
        }

        nodePrefix[depth] = RlpLengthPrefix(maxNodeBytes);
        for (var nb = 0; nb < maxNodeBytes; nb++) {
            nodePrefix[depth].data[nb] <== layers[depth][nb];
        }
        nodePrefix[depth].isList * nodeExists[depth] === nodeExists[depth];

        payloadStart[depth] <== nodePrefix[depth].payloadStart;
        payloadEnd[depth] <== nodePrefix[depth].payloadStart + nodePrefix[depth].payloadLength;

        // Branch parsing (17 items)
        branchCursor[depth][0] <== payloadStart[depth];

        for (var bi = 0; bi < 17; bi++) {
            branchItemStart[depth][bi] <== branchCursor[depth][bi];
            branchItemSlice[depth][bi] = ShiftLeft(maxNodeBytes);
            for (var bj = 0; bj < maxNodeBytes; bj++) {
                branchItemSlice[depth][bi].in[bj] <== layers[depth][bj];
            }
            branchItemSlice[depth][bi].count <== branchCursor[depth][bi];

            branchItemPrefix[depth][bi] = RlpLengthPrefix(maxNodeBytes);
            for (var bk = 0; bk < maxNodeBytes; bk++) {
                branchItemPrefix[depth][bi].data[bk] <== branchItemSlice[depth][bi].out[bk];
            }

            branchItemPayloadStart[depth][bi] <== branchCursor[depth][bi] + branchItemPrefix[depth][bi].payloadStart;
            branchItemPayloadLen[depth][bi] <== branchItemPrefix[depth][bi].payloadLength;
            branchCursor[depth][bi + 1] <== branchItemPayloadStart[depth][bi] + branchItemPayloadLen[depth][bi];
        }

        branchEndEq[depth] = IsEqual();
        branchEndEq[depth].in[0] <== branchCursor[depth][17];
        branchEndEq[depth].in[1] <== payloadEnd[depth];
        isBranch[depth] <== branchEndEq[depth].out * nodeExists[depth];

        // Extension/leaf parsing (2 items)
        extCursor[depth][0] <== payloadStart[depth];

        for (var ei = 0; ei < 2; ei++) {
            extItemStart[depth][ei] <== extCursor[depth][ei];
            extItemSlice[depth][ei] = ShiftLeft(maxNodeBytes);
            for (var ej = 0; ej < maxNodeBytes; ej++) {
                extItemSlice[depth][ei].in[ej] <== layers[depth][ej];
            }
            extItemSlice[depth][ei].count <== extCursor[depth][ei];

            extItemPrefix[depth][ei] = RlpLengthPrefix(maxNodeBytes);
            for (var ek = 0; ek < maxNodeBytes; ek++) {
                extItemPrefix[depth][ei].data[ek] <== extItemSlice[depth][ei].out[ek];
            }

            extItemPayloadStart[depth][ei] <== extCursor[depth][ei] + extItemPrefix[depth][ei].payloadStart;
            extItemPayloadLen[depth][ei] <== extItemPrefix[depth][ei].payloadLength;
            extCursor[depth][ei + 1] <== extItemPayloadStart[depth][ei] + extItemPayloadLen[depth][ei];
        }

        extEndEq[depth] = IsEqual();
        extEndEq[depth].in[0] <== extCursor[depth][2];
        extEndEq[depth].in[1] <== payloadEnd[depth];
        isExtLeafCount[depth] <== extEndEq[depth].out * nodeExists[depth];

        isBranch[depth] + isExtLeafCount[depth] === nodeExists[depth];

        // Decode hex-prefix key for extension/leaf nodes
        keySlice[depth] = ShiftLeft(maxNodeBytes);
        for (var kb = 0; kb < maxNodeBytes; kb++) {
            keySlice[depth].in[kb] <== layers[depth][kb];
        }
        keySlice[depth].count <== extItemPayloadStart[depth][0];
        for (var kc = 0; kc < maxKeyBytes; kc++) {
            keyBytes[depth][kc] <== keySlice[depth].out[kc];
        }

        keyDecoder[depth] = HexPrefixDecode(maxKeyBytes);
        for (var kd = 0; kd < maxKeyBytes; kd++) {
            keyDecoder[depth].keyBytes[kd] <== keyBytes[depth][kd];
        }
        // HexPrefixDecode enforces keyLen >= 1. For branch nodes, feed a
        // dummy length so decoder constraints stay satisfiable while all
        // key-path checks remain gated by isExtLeafCount.
        keyDecoder[depth].keyLen <== extItemPayloadLen[depth][0] * isExtLeafCount[depth] + (1 - isExtLeafCount[depth]);

        isLeaf[depth] <== keyDecoder[depth].isLeaf * isExtLeafCount[depth];
        isExtension[depth] <== keyDecoder[depth].isExtension * isExtLeafCount[depth];
        keyPathLen[depth] <== keyDecoder[depth].pathLen * isExtLeafCount[depth];

        isLeaf[depth] + isExtension[depth] === isExtLeafCount[depth];

        isLast[depth] <== nodeExists[depth] - nextExists[depth];
        isLeaf[depth] * isLast[depth] === isLast[depth];
        isLeaf[depth] * nextExists[depth] === 0;

        // Ensure key path nibbles match address hash path for extension/leaf nodes
        addressShift[depth] = ShiftLeft(64);
        for (var sn = 0; sn < 64; sn++) {
            addressShift[depth].in[sn] <== addressNibbles.out[sn];
        }
        addressShift[depth].count <== pathIndex[depth];

        pathLenBound[depth] = AssertLessEqThan(7);
        pathLenBound[depth].a <== keyDecoder[depth].pathLen;
        pathLenBound[depth].b <== 64;

        for (var pn = 0; pn < 64; pn++) {
            useNibble[depth][pn] = LessThan(16);
            useNibble[depth][pn].in[0] <== pn;
            useNibble[depth][pn].in[1] <== keyDecoder[depth].pathLen;
            nibbleMasked[depth][pn] <== (keyDecoder[depth].pathNibbles[pn] - addressShift[depth].out[pn]) * useNibble[depth][pn].out;
            nibbleMasked[depth][pn] * isExtLeafCount[depth] === 0;
        }

        isLeaf[depth] * (pathIndex[depth] + keyDecoder[depth].pathLen - 64) === 0;

        // Select child reference from branch or extension node
        pathIndexBound[depth] = AssertLessEqThan(7);
        pathIndexBound[depth].a <== pathIndex[depth];
        pathIndexBound[depth].b <== 64;

        currentNibbleSel[depth] = Selector(64);
        for (var cn = 0; cn < 64; cn++) {
            currentNibbleSel[depth].vals[cn] <== addressNibbles.out[cn];
        }
        currentNibbleSel[depth].select <== pathIndex[depth];
        currentNibble[depth] <== currentNibbleSel[depth].out;

        branchStartSel[depth] = Selector(17);
        for (var bs = 0; bs < 17; bs++) {
            branchStartSel[depth].vals[bs] <== branchItemPayloadStart[depth][bs];
        }
        branchStartSel[depth].select <== currentNibble[depth];
        branchChildPayloadStart[depth] <== branchStartSel[depth].out;

        branchLenSel[depth] = Selector(17);
        for (var bl = 0; bl < 17; bl++) {
            branchLenSel[depth].vals[bl] <== branchItemPayloadLen[depth][bl];
        }
        branchLenSel[depth].select <== currentNibble[depth];
        branchChildPayloadLen[depth] <== branchLenSel[depth].out;

        branchChildStartMasked[depth] <== branchChildPayloadStart[depth] * isBranch[depth];
        extChildStartMasked[depth] <== extItemPayloadStart[depth][1] * isExtension[depth];
        childPayloadStart[depth] <== branchChildStartMasked[depth] + extChildStartMasked[depth];

        branchChildLenMasked[depth] <== branchChildPayloadLen[depth] * isBranch[depth];
        extChildLenMasked[depth] <== extItemPayloadLen[depth][1] * isExtension[depth];
        childPayloadLen[depth] <== branchChildLenMasked[depth] + extChildLenMasked[depth];

        childSlice[depth] = ShiftLeft(maxNodeBytes);
        for (var cs = 0; cs < maxNodeBytes; cs++) {
            childSlice[depth].in[cs] <== layers[depth][cs];
        }
        childSlice[depth].count <== childPayloadStart[depth];

        isHash[depth] = IsEqual();
        isHash[depth].in[0] <== childPayloadLen[depth];
        isHash[depth].in[1] <== 32;

        embedLenEq[depth] = IsEqual();
        embedLenEq[depth].in[0] <== childPayloadLen[depth];

        hashGate[depth] <== isHash[depth].out * nextExists[depth];
        embedGate[depth] <== (1 - isHash[depth].out) * nextExists[depth];

        if (depth < maxDepth - 1) {
            for (var hb = 0; hb < 32; hb++) {
                (childSlice[depth].out[hb] - keccakLayers[depth + 1].out[hb]) * hashGate[depth] === 0;
            }

            embedLenEq[depth].in[1] <== layerLengths[depth + 1];
            embedLenEq[depth].out * embedGate[depth] === embedGate[depth];

            for (var eb = 0; eb < maxNodeBytes; eb++) {
                useEmbed[depth][eb] = LessThan(16);
                useEmbed[depth][eb].in[0] <== eb;
                useEmbed[depth][eb].in[1] <== childPayloadLen[depth];
                embedByteGate[depth][eb] <== useEmbed[depth][eb].out * embedGate[depth];
                (childSlice[depth].out[eb] - layers[depth + 1][eb]) * embedByteGate[depth][eb] === 0;
            }
        } else {
            embedLenEq[depth].in[1] <== childPayloadLen[depth];
            embedLenEq[depth].out === 1;

            for (var hb = 0; hb < 32; hb++) {
                (childSlice[depth].out[hb] - childSlice[depth].out[hb]) * isHash[depth].out === 0;
            }

            for (var eb = 0; eb < maxNodeBytes; eb++) {
                useEmbed[depth][eb] = LessThan(16);
                useEmbed[depth][eb].in[0] <== eb;
                useEmbed[depth][eb].in[1] <== 0;
                embedByteGate[depth][eb] <== useEmbed[depth][eb].out * embedGate[depth];
                (childSlice[depth].out[eb] - childSlice[depth].out[eb]) * embedByteGate[depth][eb] === 0;
            }
        }

        nextPath[depth] <== pathIndex[depth]
            + isBranch[depth]
            + (isExtension[depth] + isLeaf[depth]) * keyDecoder[depth].pathLen;
        pathIndex[depth + 1] <== nextPath[depth] * nextExists[depth];
    }

    signal lastLayer[maxNodeBytes] <== SelectorArray1D(maxDepth, maxNodeBytes)(layers, numLayers - 1);
    signal lastLayerLen <== Selector(maxDepth)(layerLengths, numLayers - 1);

    component leafCheck = LeafDetector(maxNodeBytes);
    for (var i2 = 0; i2 < maxNodeBytes; i2++) {
        leafCheck.node[i2] <== lastLayer[i2];
    }
    leafCheck.nodeLen <== lastLayerLen;
    leafCheck.isLeaf === 1;

    component leafPrefix = RlpLengthPrefix(maxNodeBytes);
    for (var i3 = 0; i3 < maxNodeBytes; i3++) {
        leafPrefix.data[i3] <== lastLayer[i3];
    }
    leafPrefix.isList === 1;

    signal leafCursor[3];
    leafCursor[0] <== leafPrefix.payloadStart;

    component leafKeySlice = ShiftLeft(maxNodeBytes);
    for (var kIdx = 0; kIdx < maxNodeBytes; kIdx++) {
        leafKeySlice.in[kIdx] <== lastLayer[kIdx];
    }
    leafKeySlice.count <== leafCursor[0];
    component keyPrefix = RlpLengthPrefix(maxNodeBytes);
    for (var i4 = 0; i4 < maxNodeBytes; i4++) {
        keyPrefix.data[i4] <== leafKeySlice.out[i4];
    }

    signal keyDataStart <== leafCursor[0] + keyPrefix.payloadStart;
    component keyDataSlice = ShiftLeft(maxNodeBytes);
    for (var kd = 0; kd < maxNodeBytes; kd++) {
        keyDataSlice.in[kd] <== lastLayer[kd];
    }
    keyDataSlice.count <== keyDataStart;

    // Decode hex-prefix key for leaf and bind to remaining path
    var leafMaxKeyBytes = 33;
    signal leafKeyBytes[leafMaxKeyBytes];
    for (var lkb = 0; lkb < leafMaxKeyBytes; lkb++) {
        leafKeyBytes[lkb] <== keyDataSlice.out[lkb];
    }

    component leafKeyDecoder = HexPrefixDecode(leafMaxKeyBytes);
    for (var lkd = 0; lkd < leafMaxKeyBytes; lkd++) {
        leafKeyDecoder.keyBytes[lkd] <== leafKeyBytes[lkd];
    }
    leafKeyDecoder.keyLen <== keyPrefix.payloadLength;
    leafKeyDecoder.isLeaf === 1;

    signal lastPathIndex <== Selector(maxDepth + 1)(pathIndex, numLayers - 1);

    component leafAddressShift = ShiftLeft(64);
    component leafUseNibble[64];
    for (var lsn = 0; lsn < 64; lsn++) {
        leafAddressShift.in[lsn] <== addressNibbles.out[lsn];
    }
    leafAddressShift.count <== lastPathIndex;

    for (var lpn = 0; lpn < 64; lpn++) {
        leafUseNibble[lpn] = LessThan(16);
        leafUseNibble[lpn].in[0] <== lpn;
        leafUseNibble[lpn].in[1] <== leafKeyDecoder.pathLen;
        (leafKeyDecoder.pathNibbles[lpn] - leafAddressShift.out[lpn]) * leafUseNibble[lpn].out === 0;
    }

    leafKeyDecoder.pathLen + lastPathIndex === 64;

    signal afterKey <== leafCursor[0] + keyPrefix.payloadStart + keyPrefix.payloadLength;
    leafCursor[1] <== afterKey;

    component valueSlice = ShiftLeft(maxNodeBytes);
    for (var vIdx = 0; vIdx < maxNodeBytes; vIdx++) {
        valueSlice.in[vIdx] <== lastLayer[vIdx];
    }
    valueSlice.count <== leafCursor[1];
    component valuePrefix = RlpLengthPrefix(maxNodeBytes);
    for (var i5 = 0; i5 < maxNodeBytes; i5++) {
        valuePrefix.data[i5] <== valueSlice.out[i5];
    }

    signal accountStart <== leafCursor[1] + valuePrefix.payloadStart;
    signal accountLen <== valuePrefix.payloadLength;
    leafCursor[2] <== accountStart + accountLen;

    leafCursor[2] === leafPrefix.payloadStart + leafPrefix.payloadLength;

    component accountSlice = ShiftLeft(maxNodeBytes);
    for (var accIdx = 0; accIdx < maxNodeBytes; accIdx++) {
        accountSlice.in[accIdx] <== lastLayer[accIdx];
    }
    accountSlice.count <== accountStart;
    component accountDecoder = RlpAccountDecoder(maxNodeBytes);
    for (var i6 = 0; i6 < maxNodeBytes; i6++) {
        accountDecoder.data[i6] <== accountSlice.out[i6];
    }
    accountDecoder.dataLen <== accountLen;

    accountBalance <== accountDecoder.balance;
    accountNonce <== accountDecoder.nonce;
    for (var w = 0; w < 32; w++) {
        storageRoot[w] <== accountDecoder.storageRoot[w];
        codeHash[w] <== accountDecoder.codeHash[w];
    }

    valid <== 1;
}

/// @title AccountStateVerifier
/// @notice Wraps `MptProofVerifier` and enforces a minimum balance requirement
template AccountStateVerifier(maxDepth, maxNodeBytes, maxNodeBlocks) {
    signal input stateRoot[32];
    signal input addressHash[32];
    signal input requiredBalance;
    signal input proofNodes[maxDepth][maxNodeBytes];
    signal input proofNodeLengths[maxDepth];
    signal input proofDepth;

    signal output accountBalance;

    component verifier = MptProofVerifier(maxDepth, maxNodeBytes, maxNodeBlocks);
    for (var i = 0; i < 32; i++) {
        verifier.stateRoot[i] <== stateRoot[i];
        verifier.addressHash[i] <== addressHash[i];
    }
    for (var depth = 0; depth < maxDepth; depth++) {
        for (var j = 0; j < maxNodeBytes; j++) {
            verifier.layers[depth][j] <== proofNodes[depth][j];
        }
        verifier.layerLengths[depth] <== proofNodeLengths[depth];
    }
    verifier.numLayers <== proofDepth;

    component balanceCheck = GreaterEqThan(128);
    balanceCheck.in[0] <== verifier.accountBalance;
    balanceCheck.in[1] <== requiredBalance;
    balanceCheck.out === 1;

    accountBalance <== verifier.accountBalance;
}
