const URL_LIKE = /^(https?:\/\/|ftp:\/\/|www\.|mailto:|tel:)/i;

export function parseUrls(input) {
  if (!input || typeof input !== 'string') return [];

  const parts = input
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const seen = new Set();
  const result = [];
  for (const raw of parts) {
    const cleaned = raw.replace(/^["'<]+|["'>]+$/g, '').trim();
    if (!cleaned) continue;
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    result.push(cleaned);
  }
  return result;
}

export function looksLikeUrl(value) {
  if (!value) return false;
  if (URL_LIKE.test(value)) return true;
  return /\.[a-z]{2,}(\/|$)/i.test(value);
}

const GDRIVE_FILE = /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/;
const GDRIVE_OPEN = /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/;
const GDRIVE_UC = /drive\.google\.com\/uc\?(?:.*&)?id=([a-zA-Z0-9_-]+)/;

export function describeUrl(url) {
  const m = url.match(GDRIVE_FILE) || url.match(GDRIVE_OPEN) || url.match(GDRIVE_UC);
  if (m) return `gdrive-${m[1].slice(0, 10)}`;
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname.split('/').filter(Boolean).pop() || 'root';
    return `${host}-${path}`.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60);
  } catch {
    return url.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 60);
  }
}
