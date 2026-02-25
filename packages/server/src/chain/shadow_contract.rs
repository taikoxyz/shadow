//! On-chain queries for the Shadow contract.
//!
//! Reads `isConsumed(nullifier)` to check claim status, and reads the circuit ID
//! from the verifier contract.

use std::{
    collections::HashMap,
    sync::Mutex,
    time::{Duration, Instant},
};

use anyhow::{bail, Context, Result};
use serde_json::Value;

/// Default TTL for cached on-chain query results.
const DEFAULT_CACHE_TTL: Duration = Duration::from_secs(300); // 5 minutes

/// Client for on-chain queries to the Shadow contract.
pub struct ChainClient {
    http: reqwest::Client,
    rpc_url: String,
    /// Nullifier consumption cache: nullifier_hex → (is_consumed, cached_at).
    nullifier_cache: Mutex<HashMap<String, (bool, Instant)>>,
    cache_ttl: Duration,
}

impl ChainClient {
    pub fn new(rpc_url: String) -> Self {
        Self {
            http: reqwest::Client::new(),
            rpc_url,
            nullifier_cache: Mutex::new(HashMap::new()),
            cache_ttl: DEFAULT_CACHE_TTL,
        }
    }

    /// Check if a nullifier has been consumed on-chain.
    ///
    /// `shadow_address` is the Shadow contract address (0x-prefixed hex).
    /// `nullifier` is the 32-byte nullifier (0x-prefixed hex).
    pub async fn is_consumed(
        &self,
        shadow_address: &str,
        nullifier: &str,
    ) -> Result<bool> {
        // Check cache first
        {
            let cache = self.nullifier_cache.lock().unwrap();
            if let Some(&(result, cached_at)) = cache.get(nullifier) {
                if cached_at.elapsed() < self.cache_ttl {
                    return Ok(result);
                }
            }
        }

        // Call isConsumed(bytes32 nullifier) on the Shadow contract
        // Function selector: keccak256("isConsumed(bytes32)") = first 4 bytes
        let selector = "0x6346e832"; // keccak256("isConsumed(bytes32)")[..4]
        let nullifier_padded = nullifier
            .strip_prefix("0x")
            .unwrap_or(nullifier);

        if nullifier_padded.len() != 64 {
            bail!("nullifier must be 32 bytes (64 hex chars)");
        }

        let calldata = format!("{}{}", selector, nullifier_padded);

        let result = self
            .eth_call(shadow_address, &calldata, "latest")
            .await
            .context("isConsumed call failed")?;

        // Result is a bool encoded as uint256 (32 bytes, last byte is 0 or 1)
        let result_hex = result
            .strip_prefix("0x")
            .unwrap_or(&result);
        let is_consumed = result_hex.ends_with('1');

        // Update cache
        {
            let mut cache = self.nullifier_cache.lock().unwrap();
            cache.insert(nullifier.to_string(), (is_consumed, Instant::now()));
        }

        Ok(is_consumed)
    }

    /// Force-refresh the claim status for a nullifier (bypass cache).
    pub async fn refresh_nullifier_status(
        &self,
        shadow_address: &str,
        nullifier: &str,
    ) -> Result<bool> {
        // Clear cache entry
        {
            let mut cache = self.nullifier_cache.lock().unwrap();
            cache.remove(nullifier);
        }
        self.is_consumed(shadow_address, nullifier).await
    }

    /// Read the circuit ID from the Risc0CircuitVerifier contract.
    ///
    /// `verifier_address` is the verifier contract address (0x-prefixed hex).
    pub async fn read_circuit_id(&self, verifier_address: &str) -> Result<String> {
        // imageId() selector: keccak256("imageId()")[..4]
        let selector = "0xef3f7dd5"; // keccak256("imageId()")[..4]

        let result = self
            .eth_call(verifier_address, selector, "latest")
            .await
            .context("imageId call failed")?;

        Ok(result)
    }


    /// Query ETH balance of an address (returns wei as decimal string).
    pub async fn get_balance(&self, address: &str) -> Result<String> {
        let req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_getBalance",
            "params": [address, "latest"]
        });

        let resp: serde_json::Value = self
            .http
            .post(&self.rpc_url)
            .json(&req)
            .send()
            .await?
            .json()
            .await?;

        if let Some(error) = resp.get("error") {
            bail!(
                "eth_getBalance error: {}",
                error.get("message").and_then(|v| v.as_str()).unwrap_or("unknown")
            );
        }

        let hex_balance = resp
            .get("result")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("eth_getBalance: no result"))?;

        // Convert hex balance to decimal string
        let stripped = hex_balance.strip_prefix("0x").unwrap_or(hex_balance);
        let value = u128::from_str_radix(stripped, 16)
            .context("invalid balance hex")?;
        Ok(value.to_string())
    }

    /// Perform an `eth_call` (read-only contract call).
    async fn eth_call(&self, to: &str, data: &str, block: &str) -> Result<String> {
        let req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "eth_call",
            "params": [{"to": to, "data": data}, block]
        });

        let resp: Value = self
            .http
            .post(&self.rpc_url)
            .json(&req)
            .send()
            .await?
            .json()
            .await?;

        if let Some(error) = resp.get("error") {
            bail!(
                "eth_call error: {}",
                error
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("unknown")
            );
        }

        resp.get("result")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .ok_or_else(|| anyhow::anyhow!("eth_call: no result"))
    }
}
