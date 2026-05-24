const URL_LIKE = /^(https?:\/\/|ftp:\/\/|www\.|mailto:|tel:)/i;

export function looksLikeUrl(value) {
  if (!value) return false;
  const v = String(value).trim();
  if (!v) return false;
  if (URL_LIKE.test(v)) return true;
  return /^[^\s]+\.[a-z]{2,}(\/|$)/i.test(v);
}

export function parseEntries(input) {
  if (!input || typeof input !== 'string') return [];
  const seen = new Set();
  const entries = [];

  const add = (name, url) => {
    const cleanedUrl = String(url || '')
      .replace(/^["'<]+|["'>]+$/g, '')
      .trim();
    if (!cleanedUrl) return;
    if (seen.has(cleanedUrl)) return;
    seen.add(cleanedUrl);
    entries.push({ name: String(name || '').trim(), url: cleanedUrl });
  };

  const lines = input.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.includes('\t')) {
      const parts = line.split(/\t+/).map((s) => s.trim()).filter(Boolean);
      if (parts.length >= 2) {
        add(parts[0], parts[1]);
        continue;
      }
    }

    const pipeIdx = line.indexOf('|');
    if (pipeIdx > -1) {
      const left = line.slice(0, pipeIdx).trim();
      const right = line.slice(pipeIdx + 1).trim();
      if (left && right) {
        add(left, right);
        continue;
      }
    }

    if (line.includes(',')) {
      const commaParts = line.split(',').map((s) => s.trim()).filter(Boolean);
      const allUrls = commaParts.length >= 2 && commaParts.every(looksLikeUrl);
      if (allUrls) {
        for (const u of commaParts) add('', u);
        continue;
      }
      if (commaParts.length >= 2) {
        const first = commaParts[0];
        const rest = commaParts.slice(1).join(',').trim();
        if (looksLikeUrl(rest) && !looksLikeUrl(first)) {
          add(first, rest);
          continue;
        }
      }
    }

    add('', line);
  }

  return entries;
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

export function sanitizeFilename(name) {
  if (!name) return '';
  return name
    .replace(/[/\\?%*:|"<>\x00-\x1f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export function fileBaseFor(entry) {
  const safe = sanitizeFilename(entry.name);
  if (safe) return safe;
  return describeUrl(entry.url);
}
