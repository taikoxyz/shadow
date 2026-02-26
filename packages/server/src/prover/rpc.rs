//! Ethereum JSON-RPC client for fetching block data and account proofs.

use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// JSON-RPC request wrapper.
#[derive(Serialize)]
struct RpcRequest<'a> {
    jsonrpc: &'static str,
    id: u64,
    method: &'a str,
    params: Value,
}

/// JSON-RPC response wrapper.
#[derive(Deserialize)]
struct RpcResponse {
    result: Option<Value>,
    error: Option<RpcError>,
}

#[derive(Deserialize)]
struct RpcError {
    code: i64,
    message: String,
}

/// Perform a raw JSON-RPC call.
async fn rpc_call(client: &reqwest::Client, url: &str, method: &str, params: Value) -> Result<Value> {
    let req = RpcRequest {
        jsonrpc: "2.0",
        id: 1,
        method,
        params,
    };

    let resp: RpcResponse = client
        .post(url)
        .json(&req)
        .send()
        .await
        .with_context(|| format!("RPC request to {} failed", method))?
        .json()
        .await
        .with_context(|| format!("failed to parse RPC response for {}", method))?;

    if let Some(err) = resp.error {
        bail!("RPC error ({}): {}", err.code, err.message);
    }

    resp.result
        .ok_or_else(|| anyhow::anyhow!("RPC response has no result for {}", method))
}

/// Fetch `eth_chainId` and return it as a u64.
pub async fn eth_chain_id(client: &reqwest::Client, url: &str) -> Result<u64> {
    let result = rpc_call(client, url, "eth_chainId", serde_json::json!([])).await?;
    let hex_str = result.as_str().context("eth_chainId: expected string")?;
    parse_hex_u64(hex_str).context("eth_chainId: invalid hex")
}

/// Block data from `eth_getBlockByNumber`.
#[derive(Debug, Clone)]
pub struct BlockData {
    pub number: u64,
    pub hash: [u8; 32],
    pub header_rlp: Vec<u8>,
}

/// Fetch a block by number (or "latest") and encode its header as RLP.
pub async fn eth_get_block(client: &reqwest::Client, url: &str, block_tag: &str) -> Result<BlockData> {
    let result = rpc_call(
        client,
        url,
        "eth_getBlockByNumber",
        serde_json::json!([block_tag, false]),
    )
    .await?;

    let block = result.as_object().context("expected block object")?;

    let number = parse_hex_u64(
        block
            .get("number")
            .and_then(|v| v.as_str())
            .context("missing block number")?,
    )?;

    let header_rlp = encode_block_header_rlp(block)?;

    // Compute block hash as keccak256(headerRlp)
    let hash = keccak256(&header_rlp);

    // Optionally verify against reported hash
    if let Some(reported_hash) = block.get("hash").and_then(|v| v.as_str()) {
        let reported = parse_hex_bytes(reported_hash)?;
        if reported.len() == 32 && reported[..] != hash[..] {
            bail!(
                "block hash mismatch: RPC says {} but RLP hashes to 0x{}",
                reported_hash,
                hex::encode(hash)
            );
        }
    }

    Ok(BlockData {
        number,
        hash,
        header_rlp,
    })
}

/// Account proof from `eth_getProof`.
#[derive(Debug, Clone)]
pub struct AccountProofData {
    /// Balance as big-endian bytes (up to 32 bytes).
    #[allow(dead_code)]
    pub balance: Vec<u8>,
    /// Account proof nodes (each is an RLP-encoded trie node).
    pub proof_nodes: Vec<Vec<u8>>,
}

/// Fetch `eth_getProof` for an address at a given block number.
pub async fn eth_get_proof(
    client: &reqwest::Client,
    url: &str,
    address: &[u8; 20],
    block_number: u64,
) -> Result<AccountProofData> {
    let address_hex = format!("0x{}", hex::encode(address));
    let block_hex = format!("0x{:x}", block_number);

    let result = rpc_call(
        client,
        url,
        "eth_getProof",
        serde_json::json!([address_hex, [], block_hex]),
    )
    .await?;

    let obj = result.as_object().context("expected proof object")?;

    // Parse balance
    let balance_hex = obj
        .get("balance")
        .and_then(|v| v.as_str())
        .context("missing balance")?;
    let balance = parse_hex_bytes(balance_hex)?;

    // Parse account proof
    let proof_array = obj
        .get("accountProof")
        .and_then(|v| v.as_array())
        .context("missing accountProof")?;

    let mut proof_nodes = Vec::with_capacity(proof_array.len());
    for (i, node) in proof_array.iter().enumerate() {
        let hex_str = node
            .as_str()
            .with_context(|| format!("proof node {} is not a string", i))?;
        proof_nodes.push(parse_hex_bytes(hex_str)?);
    }

    Ok(AccountProofData {
        balance,
        proof_nodes,
    })
}

// ---------------------------------------------------------------------------
// Block header RLP encoding (ported from shadowcli.mjs encodeBlockHeaderFromJson)
// ---------------------------------------------------------------------------

/// Encode a block header as RLP from JSON block object.
///
/// Shanghai fork: 17 fields (London 16 + withdrawalsRoot).
fn encode_block_header_rlp(block: &serde_json::Map<String, Value>) -> Result<Vec<u8>> {
    let get_hex = |key: &str| -> Vec<u8> {
        block
            .get(key)
            .and_then(|v| v.as_str())
            .and_then(|s| parse_hex_bytes(s).ok())
            .unwrap_or_default()
    };

    let get_quantity = |key: &str| -> Vec<u8> {
        block
            .get(key)
            .and_then(|v| v.as_str())
            .map(|s| normalize_quantity(s))
            .unwrap_or_default()
    };

    // 17 header fields in order
    let fields: Vec<Vec<u8>> = vec![
        get_hex("parentHash"),         // 0
        get_hex("sha3Uncles"),         // 1
        get_hex("miner"),              // 2
        get_hex("stateRoot"),          // 3
        get_hex("transactionsRoot"),   // 4
        get_hex("receiptsRoot"),       // 5
        get_hex("logsBloom"),          // 6
        get_quantity("difficulty"),     // 7
        get_quantity("number"),        // 8
        get_quantity("gasLimit"),      // 9
        get_quantity("gasUsed"),       // 10
        get_quantity("timestamp"),     // 11
        get_hex("extraData"),          // 12
        get_hex("mixHash"),            // 13
        get_hex("nonce"),              // 14
        get_quantity(                   // 15
            if block.contains_key("baseFeePerGas") {
                "baseFeePerGas"
            } else {
                "baseFee"
            },
        ),
        get_hex("withdrawalsRoot"),    // 16
    ];

    // RLP-encode each field as a byte string, then wrap in a list
    let mut encoded_items: Vec<Vec<u8>> = Vec::with_capacity(fields.len());
    for field in &fields {
        encoded_items.push(rlp_encode_bytes(field));
    }

    Ok(rlp_encode_list(&encoded_items))
}

// ---------------------------------------------------------------------------
// Minimal RLP encoder
// ---------------------------------------------------------------------------

/// RLP-encode a byte string.
fn rlp_encode_bytes(data: &[u8]) -> Vec<u8> {
    if data.len() == 1 && data[0] <= 0x7f {
        return vec![data[0]];
    }

    if data.is_empty() {
        return vec![0x80];
    }

    if data.len() <= 55 {
        let mut out = Vec::with_capacity(1 + data.len());
        out.push(0x80 + data.len() as u8);
        out.extend_from_slice(data);
        return out;
    }

    let len_bytes = usize_to_min_be_bytes(data.len());
    let mut out = Vec::with_capacity(1 + len_bytes.len() + data.len());
    out.push(0xb7 + len_bytes.len() as u8);
    out.extend_from_slice(&len_bytes);
    out.extend_from_slice(data);
    out
}

/// RLP-encode a list of already-encoded items.
fn rlp_encode_list(items: &[Vec<u8>]) -> Vec<u8> {
    let payload_len: usize = items.iter().map(|it| it.len()).sum();
    let mut payload = Vec::with_capacity(payload_len);
    for it in items {
        payload.extend_from_slice(it);
    }

    if payload.len() <= 55 {
        let mut out = Vec::with_capacity(1 + payload.len());
        out.push(0xc0 + payload.len() as u8);
        out.extend_from_slice(&payload);
        return out;
    }

    let len_bytes = usize_to_min_be_bytes(payload.len());
    let mut out = Vec::with_capacity(1 + len_bytes.len() + payload.len());
    out.push(0xf7 + len_bytes.len() as u8);
    out.extend_from_slice(&len_bytes);
    out.extend_from_slice(&payload);
    out
}

fn usize_to_min_be_bytes(mut value: usize) -> Vec<u8> {
    if value == 0 {
        return vec![0];
    }
    let mut out = Vec::new();
    while value > 0 {
        out.push((value & 0xff) as u8);
        value >>= 8;
    }
    out.reverse();
    out
}

// ---------------------------------------------------------------------------
// Hex / quantity parsing helpers
// ---------------------------------------------------------------------------

/// Normalize a hex quantity (e.g. "0x1a") to minimal big-endian bytes.
/// "0x0" → empty vec (RLP encodes as 0x80).
fn normalize_quantity(hex_str: &str) -> Vec<u8> {
    let stripped = hex_str
        .strip_prefix("0x")
        .or_else(|| hex_str.strip_prefix("0X"))
        .unwrap_or(hex_str);

    // Remove leading zeros
    let trimmed = stripped.trim_start_matches('0');
    if trimmed.is_empty() {
        return Vec::new(); // zero quantity
    }

    // Ensure even number of hex chars
    let padded = if trimmed.len() % 2 == 1 {
        format!("0{}", trimmed)
    } else {
        trimmed.to_string()
    };

    hex::decode(&padded).unwrap_or_default()
}

fn parse_hex_bytes(hex_str: &str) -> Result<Vec<u8>> {
    let stripped = hex_str
        .strip_prefix("0x")
        .or_else(|| hex_str.strip_prefix("0X"))
        .unwrap_or(hex_str);

    if stripped.is_empty() {
        return Ok(Vec::new());
    }

    // Handle odd-length hex
    let padded = if stripped.len() % 2 == 1 {
        format!("0{}", stripped)
    } else {
        stripped.to_string()
    };

    hex::decode(&padded).context("invalid hex string")
}

fn parse_hex_u64(hex_str: &str) -> Result<u64> {
    let stripped = hex_str
        .strip_prefix("0x")
        .or_else(|| hex_str.strip_prefix("0X"))
        .unwrap_or(hex_str);
    u64::from_str_radix(stripped, 16).context("invalid hex u64")
}

fn keccak256(data: &[u8]) -> [u8; 32] {
    use tiny_keccak::{Hasher, Keccak};
    let mut keccak = Keccak::v256();
    keccak.update(data);
    let mut out = [0u8; 32];
    keccak.finalize(&mut out);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_quantity_zero() {
        assert!(normalize_quantity("0x0").is_empty());
        assert!(normalize_quantity("0x00").is_empty());
    }

    #[test]
    fn normalize_quantity_nonzero() {
        assert_eq!(normalize_quantity("0x1"), vec![0x01]);
        assert_eq!(normalize_quantity("0xff"), vec![0xff]);
        assert_eq!(normalize_quantity("0x0100"), vec![0x01, 0x00]);
    }

    #[test]
    fn rlp_encode_empty() {
        assert_eq!(rlp_encode_bytes(&[]), vec![0x80]);
    }

    #[test]
    fn rlp_encode_single_byte() {
        assert_eq!(rlp_encode_bytes(&[0x42]), vec![0x42]);
        assert_eq!(rlp_encode_bytes(&[0x80]), vec![0x81, 0x80]);
    }

    #[test]
    fn rlp_encode_short_string() {
        let data = b"hello";
        let encoded = rlp_encode_bytes(data);
        assert_eq!(encoded[0], 0x80 + 5);
        assert_eq!(&encoded[1..], b"hello");
    }

    #[test]
    fn rlp_encode_list_of_two() {
        let a = rlp_encode_bytes(&[0x01]);
        let b = rlp_encode_bytes(&[0x02]);
        let list = rlp_encode_list(&[a, b]);
        // [0x01, 0x02] → list prefix 0xc0+2 = 0xc2, then 0x01, 0x02
        assert_eq!(list, vec![0xc2, 0x01, 0x02]);
    }
}
