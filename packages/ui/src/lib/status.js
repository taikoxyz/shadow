const ACTIVE_JOB_STATUSES = new Set(['queued', 'running']);

function claimSummary(notes = []) {
  const allClaimed = notes.length > 0 && notes.every((n) => n.claimStatus === 'claimed');
  const anyClaimed = notes.some((n) => n.claimStatus === 'claimed');
  return { allClaimed, anyClaimed };
}

function queueStatusForDeposit(queueJob, depositId) {
  if (!queueJob || queueJob.depositId !== depositId) return null;
  if (ACTIVE_JOB_STATUSES.has(queueJob.status)) return 'proving';
  if (queueJob.status === 'failed') return 'failed';
  return null;
}

export function isProvingJob(queueJob) {
  return Boolean(queueStatusForDeposit(queueJob, queueJob?.depositId) === 'proving');
}

// Resolve the pre-proof status from on-chain balance data.
// Returns 'new' (no ETH), 'funding' (partial), or 'funded' (ready to prove).
function resolveNoProofStatus(depositBalance) {
  if (!depositBalance || depositBalance.error) return 'new';
  if (BigInt(depositBalance.balance || '0') === 0n) return 'new';
  if (!depositBalance.isFunded) return 'funding';
  return 'funded';
}

export function getDepositStatus(deposit, queueJob, depositBalance) {
  const queueStatus = queueStatusForDeposit(queueJob, deposit.id);
  if (queueStatus) return queueStatus;
  if (deposit.hasProof) {
    const { allClaimed, anyClaimed } = claimSummary(deposit.notes || []);
    if (allClaimed) return 'claimed';
    if (anyClaimed) return 'partial';
    return 'proved';
  }
  return resolveNoProofStatus(depositBalance);
}

export function getCardStatus(deposit, queueJob, depositBalance) {
  const queueStatus = queueStatusForDeposit(queueJob, deposit.id);
  if (queueStatus === 'proving') return { label: 'Proving…', cls: 'badge-proving' };
  if (queueStatus === 'failed') return { label: 'Proof Failed', cls: 'badge-failed' };
  if (deposit.hasProof) {
    const { allClaimed, anyClaimed } = claimSummary(deposit.notes || []);
    if (allClaimed) return { label: 'Claimed', cls: 'badge-claimed' };
    if (anyClaimed) return { label: 'Partial', cls: 'badge-claimed' };
    return { label: 'Proved', cls: 'badge-proof' };
  }
  const noProofStatus = resolveNoProofStatus(depositBalance);
  if (noProofStatus === 'funding') return { label: 'Funding', cls: 'badge-funding' };
  if (noProofStatus === 'funded') return { label: 'Funded', cls: 'badge-funded' };
  return { label: 'New', cls: 'badge-no-proof' };
}
