import { el } from './dom.js';

function highlightJson(str) {
  const escaped = str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped.replace(
    /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+\.?\d*(?:[eE][+-]?\d+)?(?!\w))|(\btrue\b|\bfalse\b)|(\bnull\b)/g,
    (match, jsonString, colon, num, bool, nil) => {
      if (jsonString !== undefined) {
        return colon
          ? `<span class="jk">${jsonString}</span>${colon}`
          : `<span class="jv-s">${jsonString}</span>`;
      }
      if (num !== undefined) return `<span class="jv-n">${num}</span>`;
      if (bool !== undefined) return `<span class="jv-b">${bool}</span>`;
      if (nil !== undefined) return `<span class="jv-null">${nil}</span>`;
      return match;
    },
  );
}

function copyButton(copyFn) {
  const button = el('button', { className: 'btn btn-small' }, 'Copy');
  button.addEventListener('click', async () => {
    try {
      await copyFn();
      button.textContent = 'Copied!';
      setTimeout(() => { button.textContent = 'Copy'; }, 1500);
    } catch {
      button.textContent = 'Copy failed';
      setTimeout(() => { button.textContent = 'Copy'; }, 1500);
    }
  });
  return button;
}

export function confirmAction(title, message, onConfirm) {
  const overlay = el('div', { className: 'dialog-overlay' }, [
    el('div', { className: 'dialog-box' }, [
      el('h3', {}, title),
      el('p', {}, message),
      el('div', { className: 'dialog-actions' }, [
        el('button', { className: 'btn', onclick: () => overlay.remove() }, 'Cancel'),
        el('button', {
          className: 'btn btn-danger',
          onclick: () => {
            overlay.remove();
            onConfirm();
          },
        }, 'Confirm'),
      ]),
    ]),
  ]);

  document.body.appendChild(overlay);
}

export async function viewFileModal(filename, fetchUrl) {
  const pre = document.createElement('pre');
  pre.className = 'json-viewer-pre';
  pre.textContent = 'Loading...';

  let copyText = pre.textContent;
  const copyBtn = copyButton(() => navigator.clipboard.writeText(copyText));
  const closeBtn = el('button', { className: 'btn-icon', title: 'Close' }, '×');

  const box = el('div', { className: 'json-viewer-box' }, [
    el('div', { className: 'json-viewer-header' }, [
      el('span', { className: 'json-viewer-title' }, filename),
      el('div', { className: 'json-viewer-actions' }, [copyBtn, closeBtn]),
    ]),
    pre,
  ]);

  const overlay = el('div', { className: 'dialog-overlay' }, [box]);

  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKeyDown);
  };

  const onKeyDown = (event) => {
    if (event.key === 'Escape') close();
  };

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener('keydown', onKeyDown);
  document.body.appendChild(overlay);

  try {
    const resp = await fetch(fetchUrl);
    const text = await resp.text();
    const pretty = JSON.stringify(JSON.parse(text), null, 2);
    pre.innerHTML = highlightJson(pretty);
    copyText = pretty;
  } catch (error) {
    copyText = `Failed to load: ${error.message}`;
    pre.textContent = copyText;
  }
}
