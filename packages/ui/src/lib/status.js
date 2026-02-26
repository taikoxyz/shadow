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

export function getDepositStatus(deposit, queueJob, depositBalance) {
  const queueStatus = queueStatusForDeposit(queueJob, deposit.id);
  if (queueStatus) return queueStatus;
  if (depositBalance && !depositBalance.isFunded) return 'unfunded';
  if (!deposit.hasProof) return 'unproved';

  const { allClaimed, anyClaimed } = claimSummary(deposit.notes || []);
  if (allClaimed) return 'claimed';
  if (anyClaimed) return 'partial';
  return 'proved';
}

export function getCardStatus(deposit, queueJob) {
  const queueStatus = queueStatusForDeposit(queueJob, deposit.id);
  if (queueStatus === 'proving') return { label: 'Proving…', cls: 'badge-proving' };
  if (queueStatus === 'failed') return { label: 'Proof Failed', cls: 'badge-failed' };
  if (!deposit.hasProof) return { label: 'Unproved', cls: 'badge-no-proof' };

  const { allClaimed, anyClaimed } = claimSummary(deposit.notes || []);
  if (allClaimed) return { label: 'Claimed', cls: 'badge-claimed' };
  if (anyClaimed) return { label: 'Partial', cls: 'badge-claimed' };
  return { label: 'Proved', cls: 'badge-proof' };
}
