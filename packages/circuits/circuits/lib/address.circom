pragma circom 2.1.9;

include "./sha256.circom";
include "./utils.circom";
include "./constants.circom";
include "./keccak_wrapper.circom";

/// @title TargetAddressDeriver
/// @notice Derives target address from (secret, chainId, notesHash)
/// @dev target = sha256(MAGIC_ADDRESS || chainId || secret || notesHash)[12:]
template TargetAddressDeriver() {
    signal input secret[32];        // 32-byte secret
    signal input chainId;           // Chain ID as field element
    signal input notesHash[32];     // 32-byte notes hash

    signal output targetAddress[20]; // 20-byte derived address

    var magic[32] = MAGIC_ADDRESS();

    // Convert chainId to 32 bytes (big-endian)
    component chainIdBytes = Uint256ToBytes32();
    chainIdBytes.in <== chainId;

    // Build input: MAGIC (32) || chainId (32) || secret (32) || notesHash (32) = 128 bytes
    component sha = Sha256BytesToBytes32(128);

    for (var i = 0; i < 32; i++) {
        sha.in[i] <== magic[i];
    }
    for (var i = 0; i < 32; i++) {
        sha.in[32 + i] <== chainIdBytes.out[i];
    }
    for (var i = 0; i < 32; i++) {
        sha.in[64 + i] <== secret[i];
    }
    for (var i = 0; i < 32; i++) {
        sha.in[96 + i] <== notesHash[i];
    }

    // Extract last 20 bytes as address
    component extractAddr = AddressFromBytes32();
    for (var i = 0; i < 32; i++) {
        extractAddr.in[i] <== sha.out[i];
    }

    for (var i = 0; i < 20; i++) {
        targetAddress[i] <== extractAddr.out[i];
    }
}

/// @title TargetAddressBinding
/// @notice Derives the target address and exposes its keccak hash
template TargetAddressBinding() {
    signal input secret[32];
    signal input chainId;
    signal input notesHash[32];

    signal output targetAddress[20];
    signal output addressHash[32];

    component deriver = TargetAddressDeriver();
    for (var i = 0; i < 32; i++) {
        deriver.secret[i] <== secret[i];
        deriver.notesHash[i] <== notesHash[i];
    }
    deriver.chainId <== chainId;

    for (var addrIdx = 0; addrIdx < 20; addrIdx++) {
        targetAddress[addrIdx] <== deriver.targetAddress[addrIdx];
    }

    component hasher = Keccak256Bytes20();
    for (var j = 0; j < 20; j++) {
        hasher.in[j] <== targetAddress[j];
    }
    for (var h = 0; h < 32; h++) {
        addressHash[h] <== hasher.out[h];
    }
}

/// @title NullifierDeriver
/// @notice Derives nullifier from (secret, chainId, noteIndex)
/// @dev nullifier = sha256(MAGIC_NULLIFIER || chainId || secret || index)
template NullifierDeriver() {
    signal input secret[32];        // 32-byte secret
    signal input chainId;           // Chain ID
    signal input noteIndex;         // Note index

    signal output nullifier[32];    // 32-byte nullifier

    var magic[32] = MAGIC_NULLIFIER();

    component chainIdBytes = Uint256ToBytes32();
    chainIdBytes.in <== chainId;

    component indexBytes = Uint256ToBytes32();
    indexBytes.in <== noteIndex;

    // Build input: MAGIC (32) || chainId (32) || secret (32) || index (32) = 128 bytes
    component sha = Sha256BytesToBytes32(128);

    for (var i = 0; i < 32; i++) {
        sha.in[i] <== magic[i];
    }
    for (var i = 0; i < 32; i++) {
        sha.in[32 + i] <== chainIdBytes.out[i];
    }
    for (var i = 0; i < 32; i++) {
        sha.in[64 + i] <== secret[i];
    }
    for (var i = 0; i < 32; i++) {
        sha.in[96 + i] <== indexBytes.out[i];
    }

    for (var i = 0; i < 32; i++) {
        nullifier[i] <== sha.out[i];
    }
}

/// @title PowChecker
/// @notice Verifies PoW: sha256(MAGIC_POW || secret) mod 2^24 == 0
template PowChecker() {
    signal input secret[32];
    signal output powDigest[32];    // Full hash for public verification
    signal output valid;             // 1 if PoW passes

    var magic[32] = MAGIC_POW();

    // Build input: MAGIC (32) || secret (32) = 64 bytes
    component sha = Sha256BytesToBytes32(64);

    for (var i = 0; i < 32; i++) {
        sha.in[i] <== magic[i];
    }
    for (var i = 0; i < 32; i++) {
        sha.in[32 + i] <== secret[i];
    }

    for (var i = 0; i < 32; i++) {
        powDigest[i] <== sha.out[i];
    }

    component isZero29 = IsZero();
    component isZero30 = IsZero();
    component isZero31 = IsZero();

    isZero29.in <== sha.out[29];
    isZero30.in <== sha.out[30];
    isZero31.in <== sha.out[31];

    signal intermediate <== isZero29.out * isZero30.out;
    valid <== intermediate * isZero31.out;
}
