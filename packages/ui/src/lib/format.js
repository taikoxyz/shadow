export function weiToEth(weiStr) {
  try {
    const wei = BigInt(weiStr || '0');
    if (wei === 0n) return '0';

    const str = wei.toString().padStart(19, '0');
    const intPart = str.slice(0, -18) || '0';
    const fracPart = str.slice(-18).replace(/0+$/, '');
    if (!fracPart) return intPart;

    const trimmed = fracPart.slice(0, 6).replace(/0+$/, '');
    return `${intPart}.${trimmed}`;
  } catch {
    return '0';
  }
}

export function ethToWei(ethStr) {
  try {
    const s = ethStr.trim();
    if (!s || Number.isNaN(Number(s))) return null;

    const [intPart = '0', fracPart = ''] = s.split('.');
    const fracPadded = (fracPart + '000000000000000000').slice(0, 18);
    return (BigInt(intPart) * BigInt('1000000000000000000') + BigInt(fracPadded)).toString();
  } catch {
    return null;
  }
}

export function truncateDepositId(id) {
  return id || '';
}

export function formatElapsed(secs) {
  if (secs < 60) return `${Math.round(secs)}s`;
  const min = Math.floor(secs / 60);
  const sec = Math.round(secs % 60);
  return `${min}m ${sec}s`;
}

export function formatLogTime(date) {
  return date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatDate(isoStr) {
  try {
    return new Date(isoStr).toLocaleString();
  } catch {
    return isoStr;
  }
}

export function timeAgo(isoStr) {
  try {
    const sec = Math.floor((Date.now() - new Date(isoStr)) / 1000);
    if (sec < 60) return 'just now';

    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} minute${min === 1 ? '' : 's'} ago`;

    const hr = Math.floor(min / 60);
    if (hr < 24) return `${hr} hour${hr === 1 ? '' : 's'} ago`;

    const day = Math.floor(hr / 24);
    if (day < 30) return `${day} day${day === 1 ? '' : 's'} ago`;

    const mo = Math.floor(day / 30);
    if (mo < 12) return `${mo} month${mo === 1 ? '' : 's'} ago`;

    const yr = Math.floor(mo / 12);
    return `${yr} year${yr === 1 ? '' : 's'} ago`;
  } catch {
    return isoStr;
  }
}
