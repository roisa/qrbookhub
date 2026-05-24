import { looksLikeUrl } from './url-parser.js';

const NAME_KEYS = ['name', 'title', 'label', 'book', 'book name', 'bookname', 'filename'];
const URL_KEYS = ['url', 'link', 'href', 'address', 'uri'];

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    if (row.length === 1 && row[0] === '' && field === '') return;
    if (row.some((c) => c.trim() !== '') || field.trim() !== '') {
      rows.push(row);
    }
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
      } else if (c === ',' || c === '\t') {
        pushField();
      } else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        pushField();
        pushRow();
      } else {
        field += c;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    pushField();
    pushRow();
  }
  return rows;
}

export function csvToEntries(text) {
  const rows = parseCsv(text);
  if (rows.length === 0) return [];

  const firstRow = rows[0].map((c) => c.trim());
  const lowered = firstRow.map((c) => c.toLowerCase());

  let nameIdx = -1;
  let urlIdx = -1;
  lowered.forEach((h, i) => {
    if (nameIdx === -1 && NAME_KEYS.includes(h)) nameIdx = i;
    if (urlIdx === -1 && URL_KEYS.includes(h)) urlIdx = i;
  });

  const headerDetected = nameIdx !== -1 || urlIdx !== -1;
  const dataRows = headerDetected ? rows.slice(1) : rows;

  if (!headerDetected) {
    const sample = firstRow;
    if (sample.length >= 2 && looksLikeUrl(sample[1]) && !looksLikeUrl(sample[0])) {
      nameIdx = 0;
      urlIdx = 1;
    } else if (sample.length >= 2 && looksLikeUrl(sample[0]) && !looksLikeUrl(sample[1])) {
      urlIdx = 0;
      nameIdx = 1;
    } else {
      urlIdx = sample.length >= 2 ? 1 : 0;
      nameIdx = sample.length >= 2 ? 0 : -1;
    }
  }

  if (urlIdx === -1) {
    urlIdx = nameIdx === 0 ? 1 : 0;
  }

  const entries = [];
  for (const r of dataRows) {
    const url = (r[urlIdx] || '').trim();
    if (!url) continue;
    const name = nameIdx !== -1 ? (r[nameIdx] || '').trim() : '';
    entries.push({ name, url });
  }
  return entries;
}

export function entriesToTextareaFormat(entries) {
  return entries
    .map((e) => (e.name ? `${e.name} | ${e.url}` : e.url))
    .join('\n');
}
