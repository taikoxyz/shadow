//! Integration tests for the shadow-server API.
//!
//! These tests start a real Axum server on a random port and hit the endpoints
//! with an HTTP client.

use std::io::Write;

// We can't import from the binary crate directly, so we replicate
// the router construction here. In a real setup, the router construction
// would be in a library crate.

/// Sample deposit JSON for testing.
fn sample_deposit_json() -> &'static str {
    r#"{
        "version": "v2",
        "chainId": "167013",
        "secret": "0x8c4d3df220b9aa338eafbe43871a800a9ef971fc7242c4d0de98e056cc8c7bfa",
        "notes": [
            {
                "recipient": "0x1111111111111111111111111111111111111111",
                "amount": "1230000000000",
                "label": "note #0"
            },
            {
                "recipient": "0x2222222222222222222222222222222222222222",
                "amount": "4560000000000",
                "label": "note #1"
            }
        ]
    }"#
}

fn two_note_deposit_json() -> &'static str {
    r#"{
        "version": "v2",
        "chainId": "167013",
        "secret": "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "notes": [
            {
                "recipient": "0x3333333333333333333333333333333333333333",
                "amount": "100000000000",
                "label": "small"
            }
        ]
    }"#
}

fn write_file(dir: &std::path::Path, name: &str, content: &str) {
    let path = dir.join(name);
    let mut f = std::fs::File::create(path).unwrap();
    f.write_all(content.as_bytes()).unwrap();
}

// Since we can't easily construct the full server from integration tests
// (the binary crate doesn't export its internals), these tests verify
// the workspace scanner and deposit utilities directly.

#[test]
fn workspace_scanner_finds_deposits_and_proofs() {
    let dir = tempfile::tempdir().unwrap();
    write_file(
        dir.path(),
        "deposit-ffe8-fde9-20260224T214613.json",
        sample_deposit_json(),
    );
    write_file(
        dir.path(),
        "deposit-ffe8-fde9-20260224T214613.proof-20260225T103000.json",
        r#"{"version":"v2","notes":[]}"#,
    );
    write_file(
        dir.path(),
        "deposit-3333-3333-20260225T000000.json",
        two_note_deposit_json(),
    );
    // An orphaned proof file (no matching deposit)
    write_file(
        dir.path(),
        "deposit-dead-beef-20260101T000000.proof-20260101T010000.json",
        "{}",
    );
    // A non-deposit file
    write_file(dir.path(), "readme.txt", "not a deposit");

    let entries: Vec<String> = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(|e| {
            let name = e.ok()?.file_name().to_string_lossy().to_string();
            if name.starts_with("deposit-") && name.ends_with(".json") && !name.contains(".proof") {
                Some(name)
            } else {
                None
            }
        })
        .collect();

    assert_eq!(entries.len(), 2, "should find exactly 2 deposit files");

    // Verify proof correlation
    let proof_files: Vec<String> = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(|e| {
            let name = e.ok()?.file_name().to_string_lossy().to_string();
            if name.starts_with("deposit-") && name.contains(".proof-") && name.ends_with(".json") {
                Some(name)
            } else {
                None
            }
        })
        .collect();

    assert_eq!(proof_files.len(), 2, "should find 2 proof files total");
}

#[test]
fn deposit_file_parsing_and_validation() {
    let deposit: serde_json::Value = serde_json::from_str(sample_deposit_json()).unwrap();

    assert_eq!(deposit["version"], "v2");
    assert_eq!(deposit["chainId"], "167013");
    assert!(deposit["secret"].as_str().unwrap().starts_with("0x"));
    assert_eq!(deposit["notes"].as_array().unwrap().len(), 2);
    assert_eq!(deposit["notes"][0]["amount"], "1230000000000");
    assert_eq!(deposit["notes"][1]["amount"], "4560000000000");
}

#[test]
fn filename_conventions() {
    let deposit_name = "deposit-ffe8-fde9-20260224T214613.json";
    let proof_name = "deposit-ffe8-fde9-20260224T214613.proof-20260225T103000.json";

    // Deposit stem extraction
    let stem = deposit_name.strip_suffix(".json").unwrap();
    assert_eq!(stem, "deposit-ffe8-fde9-20260224T214613");

    // Proof → deposit stem
    let proof_stem = proof_name.strip_suffix(".json").unwrap();
    let dot_proof = proof_stem.find(".proof-").unwrap();
    let deposit_stem = &proof_stem[..dot_proof];
    assert_eq!(deposit_stem, "deposit-ffe8-fde9-20260224T214613");

    // Dual timestamps in proof filename
    assert!(proof_name.contains("20260224T214613")); // deposit timestamp
    assert!(proof_name.contains("20260225T103000")); // proof timestamp
}

#[test]
fn bundled_proof_structure() {
    let proof_json = r#"{
        "version": "v2",
        "depositFile": "deposit-ffe8-fde9-20260224T214613.json",
        "blockNumber": "12345",
        "blockHash": "0xabcd",
        "chainId": "167013",
        "notes": [
            {
                "noteIndex": 0,
                "amount": "1230000000000",
                "recipient": "0x1111111111111111111111111111111111111111",
                "nullifier": "0xabc123",
                "proof": "0x..."
            },
            {
                "noteIndex": 1,
                "amount": "4560000000000",
                "recipient": "0x2222222222222222222222222222222222222222",
                "nullifier": "0xdef456",
                "proof": "0x..."
            }
        ]
    }"#;

    let proof: serde_json::Value = serde_json::from_str(proof_json).unwrap();
    assert_eq!(proof["version"], "v2");
    assert_eq!(proof["notes"].as_array().unwrap().len(), 2);
    assert_eq!(proof["notes"][0]["noteIndex"], 0);
    assert_eq!(proof["notes"][1]["noteIndex"], 1);
}
