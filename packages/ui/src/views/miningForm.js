import { el } from '../lib/dom.js';
import { ethToWei, weiToEth } from '../lib/format.js';

const MAX_NOTES = 5;
const MAX_TOTAL_WEI = BigInt('8000000000000000000');
const MIN_NOTE_WEI = BigInt('1000000000000');

function ensureState(state) {
  if (!state.miningNotes) {
    state.miningNotes = [{ recipient: '', amount: '', label: '' }];
    state.miningComment = '';
  }
}

function syncInputsToState(state) {
  state.miningNotes.forEach((note, index) => {
    const recipient = document.getElementById(`mine-recipient-${index}`);
    const amount = document.getElementById(`mine-amount-${index}`);
    const label = document.getElementById(`mine-label-${index}`);
    if (recipient) note.recipient = recipient.value;
    if (amount) note.amount = amount.value;
    if (label) note.label = label.value;
  });

  const comment = document.getElementById('mine-comment');
  if (comment) state.miningComment = comment.value;
}

function errorIds(errorKey) {
  const dashIndex = errorKey.lastIndexOf('-');
  const hasIndex = dashIndex > 0 && !Number.isNaN(Number(errorKey.slice(dashIndex + 1)));

  if (!hasIndex) {
    return { inputId: null, errorId: `mine-${errorKey}-error` };
  }

  const field = errorKey.slice(0, dashIndex);
  const index = errorKey.slice(dashIndex + 1);
  return {
    inputId: `mine-${field}-${index}`,
    errorId: `mine-${field}-error-${index}`,
  };
}

function setFieldError(state, key, message) {
  if (message) state.miningErrors[key] = message;
  else delete state.miningErrors[key];

  const { inputId, errorId } = errorIds(key);
  const errorEl = document.getElementById(errorId);
  if (errorEl) errorEl.textContent = message || '';

  if (!inputId) return;
  const inputEl = document.getElementById(inputId);
  if (!inputEl) return;

  if (message) inputEl.classList.add('form-input-invalid');
  else inputEl.classList.remove('form-input-invalid');
}

function validateTotalCap(state) {
  syncInputsToState(state);

  let total = 0n;
  let allValid = true;
  for (const note of state.miningNotes) {
    const weiStr = ethToWei(note.amount.trim());
    if (!weiStr || weiStr === '0') {
      allValid = false;
      continue;
    }
    total += BigInt(weiStr);
  }

  const message = allValid && total > MAX_TOTAL_WEI
    ? `Total ${weiToEth(total.toString())} ETH exceeds 8 ETH cap.`
    : '';
  setFieldError(state, 'total', message);
}

function validateAmountField(state, index, requireNonEmpty) {
  const value = state.miningNotes[index].amount.trim();
  const key = `amount-${index}`;

  if (!value && requireNonEmpty) {
    setFieldError(state, key, 'Amount is required.');
    return;
  }

  const weiStr = ethToWei(value);
  if (value && (!weiStr || weiStr === '0')) {
    setFieldError(state, key, 'Must be a positive number.');
    return;
  }

  if (value && weiStr && BigInt(weiStr) < MIN_NOTE_WEI) {
    setFieldError(state, key, 'Amount too small (min ~0.000001 ETH).');
    return;
  }

  setFieldError(state, key, '');
  validateTotalCap(state);
}

function validateRecipientField(state, index, requireNonEmpty, walletAddress) {
  const value = state.miningNotes[index].recipient.trim();
  const key = `recipient-${index}`;

  if (value && !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    setFieldError(state, key, 'Invalid address - must be 0x followed by 40 hex characters.');
  } else if (!value && requireNonEmpty) {
    setFieldError(state, key, 'Recipient address is required.');
  } else {
    setFieldError(state, key, '');
  }

  const warning = document.getElementById(`mine-recipient-warn-${index}`);
  if (!warning) return;

  const wallet = walletAddress?.toLowerCase();
  warning.textContent = wallet && value.toLowerCase() === wallet
    ? 'Warning: using your connected wallet as recipient may reveal your identity on-chain.'
    : '';
}

function parseNotes(notes) {
  return notes.map((note) => ({
    recipient: note.recipient.trim(),
    amount: ethToWei(note.amount.trim()) || '0',
    label: note.label.trim() || undefined,
  }));
}

function noteRow(state, index, walletAddress, onRemove) {
  const note = state.miningNotes[index];

  return el('div', { className: 'note-entry' }, [
    el('div', { className: 'note-entry-header' }, [
      `Note #${index}`,
      index > 0
        ? el('button', {
            className: 'btn-icon',
            onclick: () => onRemove(index),
            title: 'Remove',
          }, 'x')
        : null,
    ].filter(Boolean)),
    el('div', { className: 'form-row' }, [
      el('div', { className: 'form-group form-group-recipient' }, [
        el('label', { className: 'form-label' }, 'Recipient'),
        el('input', {
          className: state.miningErrors[`recipient-${index}`]
            ? 'form-input form-input-invalid'
            : 'form-input',
          id: `mine-recipient-${index}`,
          placeholder: '0x...',
          value: note.recipient,
          oninput: (event) => { state.miningNotes[index].recipient = event.target.value; },
          onblur: (event) => {
            state.miningNotes[index].recipient = event.target.value;
            validateRecipientField(state, index, false, walletAddress);
          },
        }),
        el('span', { className: 'form-field-error', id: `mine-recipient-error-${index}` },
          state.miningErrors[`recipient-${index}`] || ''),
        el('span', { className: 'form-field-warn', id: `mine-recipient-warn-${index}` }, ''),
      ]),
      el('div', { className: 'form-group form-group-amount' }, [
        el('label', { className: 'form-label' }, 'Amount (ETH)'),
        el('input', {
          className: state.miningErrors[`amount-${index}`]
            ? 'form-input form-input-invalid'
            : 'form-input',
          id: `mine-amount-${index}`,
          placeholder: '0.001',
          type: 'text',
          value: note.amount,
          oninput: (event) => { state.miningNotes[index].amount = event.target.value; },
          onblur: (event) => {
            state.miningNotes[index].amount = event.target.value;
            validateAmountField(state, index, false);
          },
        }),
        el('span', { className: 'form-field-error', id: `mine-amount-error-${index}` },
          state.miningErrors[`amount-${index}`] || ''),
      ]),
    ]),
    el('div', { className: 'form-group' }, [
      el('label', { className: 'form-label' }, 'Label (optional)'),
      el('input', {
        className: 'form-input form-input-note-label',
        id: `mine-label-${index}`,
        placeholder: `note #${index}`,
        value: note.label,
        oninput: (event) => { state.miningNotes[index].label = event.target.value; },
      }),
    ]),
  ]);
}

export function renderMiningFormView({ state, chainId, walletAddress, onSubmit, onClose }) {
  ensureState(state);

  const container = el('div', { className: 'mining-panel' });

  function addNote() {
    syncInputsToState(state);
    if (state.miningNotes.length < MAX_NOTES) {
      state.miningNotes.push({ recipient: '', amount: '', label: '' });
    }
    renderContent();
  }

  function removeNote(index) {
    syncInputsToState(state);
    state.miningNotes.splice(index, 1);
    renderContent();
  }

  function submit() {
    syncInputsToState(state);

    state.miningNotes.forEach((_note, index) => {
      validateRecipientField(state, index, true, walletAddress);
      validateAmountField(state, index, true);
    });
    validateTotalCap(state);

    if (Object.keys(state.miningErrors).length > 0) return;

    const comment = document.getElementById('mine-comment')?.value?.trim() || undefined;
    onSubmit({ notes: parseNotes(state.miningNotes), comment, chainId });
  }

  function renderContent() {
    container.innerHTML = '';

    container.appendChild(el('div', { className: 'mining-panel-header' }, [
      el('h3', {}, 'New Deposit'),
      el('button', {
        className: 'btn-icon',
        onclick: onClose,
        title: 'Close',
      }, 'x'),
    ]));

    container.appendChild(el('div', { className: 'form-group' }, [
      el('label', { className: 'form-label' }, 'Comment (optional)'),
      el('textarea', {
        className: 'form-input form-input-textarea',
        id: 'mine-comment',
        placeholder: 'Describe this deposit...',
        oninput: (event) => { state.miningComment = event.target.value; },
      }),
    ]));

    requestAnimationFrame(() => {
      const comment = document.getElementById('mine-comment');
      if (comment) comment.value = state.miningComment;
    });

    container.appendChild(el('div', { className: 'mining-notes-header' }, [
      el('span', { className: 'form-label form-label-inline' }, 'Notes (max 8 ETH total)'),
      state.miningNotes.length < MAX_NOTES
        ? el('button', { className: 'btn btn-small', onclick: addNote }, '+ Add Note')
        : null,
    ].filter(Boolean)));

    state.miningNotes.forEach((_note, index) => {
      container.appendChild(noteRow(state, index, walletAddress, removeNote));
    });

    container.appendChild(el('span', { className: 'form-field-error', id: 'mine-total-error' },
      state.miningErrors.total || ''));

    container.appendChild(el(
      'div',
      { className: 'form-actions-row' },
      [
        el('button', {
          className: 'btn btn-primary',
          disabled: state.mining,
          onclick: submit,
        }, state.mining ? 'Creating...' : 'Create Deposit'),
        state.mining ? el('span', { className: 'spinner' }) : null,
        state.mining ? el('span', { className: 'mining-status' }, 'Creating deposit...') : null,
      ].filter(Boolean),
    ));
  }

  renderContent();
  return container;
}
