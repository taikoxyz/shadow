use std::path::PathBuf;

use anyhow::Result;
use clap::{Parser, Subcommand};
use shadow_prover_lib::{
    circuit_id_hex, compress_receipt, configure_risc0_env, describe_receipt_kind, export_proof,
    inspect_claim, load_claim_input, prove_claim, read_receipt, verify_receipt, write_json,
    write_receipt,
};
#[derive(Debug, Parser)]
#[command(name = "shadow-risc0-host")]
#[command(about = "Local RISC Zero prover for Shadow claims")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Generate a proof receipt and journal from an input JSON file.
    Prove {
        #[arg(long)]
        input: PathBuf,
        #[arg(long, default_value = "build/risc0/receipt.bin")]
        receipt: PathBuf,
        #[arg(long, default_value = "build/risc0/journal.json")]
        journal: PathBuf,
        #[arg(long, default_value = "composite")]
        receipt_kind: String,
    },
    /// Verify an existing receipt and print decoded journal.
    Verify {
        #[arg(long, default_value = "build/risc0/receipt.bin")]
        receipt: PathBuf,
    },
    /// Validate and inspect an input without running the prover.
    Inspect {
        #[arg(long)]
        input: PathBuf,
    },
    /// Export seal+journal bytes from a receipt for on-chain verification payloads.
    ExportProof {
        #[arg(long, default_value = "build/risc0/receipt.bin")]
        receipt: PathBuf,
        #[arg(long, default_value = "build/risc0/proof.json")]
        out: PathBuf,
    },
    /// Compress a succinct receipt to Groth16 for on-chain verification.
    /// This step requires Docker to be available.
    Compress {
        #[arg(long)]
        receipt: PathBuf,
        #[arg(long, default_value = "build/risc0/groth16-receipt.bin")]
        out: PathBuf,
    },
    /// Print the circuit ID (RISC Zero guest program hash).
    CircuitId,
}

fn main() -> Result<()> {
    configure_risc0_env();

    let cli = Cli::parse();

    match cli.command {
        Command::Prove {
            input,
            receipt,
            journal,
            receipt_kind,
        } => {
            let claim_input = load_claim_input(&input)?;
            let result = prove_claim(&claim_input, &receipt_kind)?;

            write_receipt(&receipt, &result.receipt)?;
            write_json(&journal, &result.journal)?;

            println!("Proved successfully in {:.2?}", result.elapsed);
            println!("Receipt: {}", receipt.display());
            println!("Journal: {}", journal.display());
            println!("Nullifier: 0x{}", hex::encode(result.journal.nullifier));
            println!(
                "Receipt kind: {}",
                describe_receipt_kind(&result.receipt.inner)
            );
            Ok(())
        }
        Command::Verify { receipt } => {
            let rcpt = read_receipt(&receipt)?;
            let journal = verify_receipt(&rcpt)?;
            println!("Receipt verified: {}", receipt.display());
            println!("Nullifier: 0x{}", hex::encode(journal.nullifier));
            Ok(())
        }
        Command::Inspect { input } => {
            let claim_input = load_claim_input(&input)?;
            let journal = inspect_claim(&claim_input)?;

            println!("Input validated: {}", input.display());
            println!("blockNumber: {}", journal.block_number);
            println!("chainId: {}", journal.chain_id);
            println!("noteIndex: {}", claim_input.note_index);
            println!("amount: {}", journal.amount);
            println!("nullifier: 0x{}", hex::encode(journal.nullifier));
            Ok(())
        }
        Command::ExportProof { receipt, out } => {
            let rcpt = read_receipt(&receipt)?;
            let exported = export_proof(&rcpt)?;
            write_json(&out, &exported)?;
            println!("Exported proof payload: {}", out.display());
            Ok(())
        }
        Command::Compress { receipt, out } => {
            let rcpt = read_receipt(&receipt)?;

            println!("Compressing succinct receipt to Groth16...");
            println!("This step requires Docker and may take several minutes.");

            let started = std::time::Instant::now();
            let compressed = compress_receipt(&rcpt)?;
            let elapsed = started.elapsed();

            write_receipt(&out, &compressed)?;

            println!("Compressed to Groth16 in {:.2?}", elapsed);
            println!("Output: {}", out.display());
            println!(
                "Receipt kind: {}",
                describe_receipt_kind(&compressed.inner)
            );
            Ok(())
        }
        Command::CircuitId => {
            println!("{}", circuit_id_hex());
            Ok(())
        }
    }
}
