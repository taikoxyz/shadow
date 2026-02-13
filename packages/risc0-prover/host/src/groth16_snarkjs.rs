use std::{
    env,
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use anyhow::{anyhow, bail, Context, Result};
use rzup::{Component, Rzup, Version};
use tempfile::tempdir;

use crate::shrinkwrap;

/// Generates a Groth16 proof (as raw 256-byte seal) from an identity_p254 recursion seal using
/// `snarkjs` (no Docker).
pub(crate) fn shrink_wrap(identity_p254_seal_bytes: &[u8]) -> Result<Vec<u8>> {
    let root_dir = locate_groth16_component_dir()?;
    let graph_path = root_dir.join("stark_verify_graph.bin");
    let zkey_path = root_dir.join("stark_verify_final.zkey");

    if !graph_path.is_file() {
        bail!("missing groth16 graph artifact: {}", graph_path.display());
    }
    if !zkey_path.is_file() {
        bail!("missing groth16 zkey artifact: {}", zkey_path.display());
    }

    // If the user sets RISC0_WORK_DIR, keep intermediates there; otherwise use a temp dir.
    let tmp = tempdir().context("failed to create temporary work dir")?;
    let work_dir = match env::var("RISC0_WORK_DIR") {
        Ok(dir) => PathBuf::from(dir),
        Err(_) => tmp.path().to_path_buf(),
    };
    fs::create_dir_all(&work_dir).context("failed to create work dir")?;

    let input_json = shrinkwrap::to_json(identity_p254_seal_bytes).context("failed to encode seal->json")?;
    let input_path = work_dir.join("input.json");
    let witness_path = work_dir.join("witness.wtns");
    let proof_path = work_dir.join("proof.json");
    let public_path = work_dir.join("public.json");

    fs::write(&input_path, input_json).context("failed to write input.json")?;

    let graph = fs::read(&graph_path).context("failed to read stark_verify_graph.bin")?;
    let witness_bytes = circom_witnesscalc::calc_witness(&fs::read_to_string(&input_path)?, &graph)
        .map_err(|err| anyhow!("witness failure: {err}"))?;
    fs::write(&witness_path, witness_bytes).context("failed to write witness.wtns")?;

    run_snarkjs_groth16_prove(&zkey_path, &witness_path, &proof_path, &public_path)
        .context("snarkjs groth16 prove failed")?;

    let proof_json: risc0_groth16::ProofJson =
        serde_json::from_str(&fs::read_to_string(&proof_path).context("failed reading proof.json")?)
            .context("failed parsing proof.json")?;
    let seal: risc0_groth16::Seal = proof_json.try_into().context("failed converting proof->seal")?;

    Ok(seal.to_vec())
}

fn locate_groth16_component_dir() -> Result<PathBuf> {
    let version = Version::new(0, 1, 0);
    let root_dir = Rzup::new()
        .context("failed to initialize rzup")?
        .get_version_dir(&Component::Risc0Groth16, &version)
        .context(
            "missing required `risc0-groth16` rzup component. Install it with:\n  rzup install risc0-groth16",
        )?;
    Ok(root_dir)
}

fn resolve_snarkjs_bin() -> Option<PathBuf> {
    if let Ok(path) = env::var("SNARKJS_BIN") {
        let p = PathBuf::from(path);
        if p.is_file() {
            return Some(p);
        }
    }

    // Most common path in this repo: packages/risc0-prover/node_modules/.bin/snarkjs
    let local = PathBuf::from("node_modules").join(".bin").join("snarkjs");
    if local.is_file() {
        return Some(local);
    }

    // pnpm on Windows uses .cmd shim; keep this for portability.
    let local_cmd = PathBuf::from("node_modules").join(".bin").join("snarkjs.cmd");
    if local_cmd.is_file() {
        return Some(local_cmd);
    }

    None
}

fn run_snarkjs_groth16_prove(
    zkey_path: &Path,
    witness_path: &Path,
    proof_path: &Path,
    public_path: &Path,
) -> Result<()> {
    let snarkjs_bin = resolve_snarkjs_bin();

    let mut cmd = if let Some(bin) = snarkjs_bin {
        Command::new(bin)
    } else {
        Command::new("snarkjs")
    };

    let status = cmd
        .arg("groth16")
        .arg("prove")
        .arg(zkey_path)
        .arg(witness_path)
        .arg(proof_path)
        .arg(public_path)
        .status()
        .context("failed to spawn snarkjs")?;

    if !status.success() {
        bail!("snarkjs exited with status: {}", status);
    }

    Ok(())
}
