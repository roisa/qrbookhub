import './style.css';
import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { parseEntries, fileBaseFor } from './url-parser.js';
import { csvToEntries, entriesToTextareaFormat } from './csv-parser.js';
import { createQr, qrToBlob } from './qr-generator.js';
import { runChunked, runChunkedAsync } from './scheduler.js';
import { initThemeToggle } from './theme.js';

const $ = (sel) => document.querySelector(sel);

const els = {
  textarea: $('#urls'),
  size: $('#qr-size'),
  margin: $('#qr-margin'),
  ecc: $('#qr-ecc'),
  generate: $('#generate'),
  download: $('#download'),
  clear: $('#clear'),
  importBtn: $('#import-btn'),
  fileInput: $('#file-input'),
  themeToggle: $('#theme-toggle'),
  search: $('#search'),
  status: $('#status'),
  progress: $('#progress'),
  progressFill: $('#progress-fill'),
  progressText: $('#progress-text'),
  grid: $('#grid'),
  empty: $('#empty-state'),
  count: $('#results-count'),
  dropOverlay: $('#drop-overlay'),
};

const state = {
  items: [],
  busy: false,
  searchTerm: '',
  observer: null,
  controller: null,
  renderOptions: null,
  renderedCount: 0,
};

initThemeToggle(els.themeToggle);

function setStatus(msg, kind = '') {
  els.status.textContent = msg || '';
  els.status.className = `status ${kind}`.trim();
}

function setProgress(done, total, label) {
  if (total <= 0) {
    els.progress.hidden = true;
    return;
  }
  els.progress.hidden = false;
  const pct = Math.round((done / total) * 100);
  els.progressFill.style.width = `${pct}%`;
  els.progressText.textContent = label || `${done} / ${total} rendered`;
}

function updateCount() {
  const n = state.items.length;
  if (n === 0) {
    els.count.textContent = '';
    els.empty.classList.remove('hidden');
    els.download.disabled = true;
    els.search.hidden = true;
    return;
  }
  const ok = state.items.filter((i) => !i.error).length;
  const visible = state.items.filter((i) => !i.hidden).length;
  const suffix = state.searchTerm ? ` · ${visible} shown` : '';
  els.count.textContent = `${ok} ready${ok !== n ? ` · ${n - ok} failed` : ''}${suffix}`;
  els.empty.classList.add('hidden');
  els.download.disabled = ok === 0 || state.busy;
  els.search.hidden = false;
}

function applyFilter() {
  const term = state.searchTerm.trim().toLowerCase();
  for (const item of state.items) {
    const matches =
      !term ||
      item.url.toLowerCase().includes(term) ||
      (item.name || '').toLowerCase().includes(term);
    item.hidden = !matches;
    if (item.cardEl) item.cardEl.classList.toggle('hidden', !matches);
  }
  updateCount();
}

function makeCard(item, index) {
  const card = document.createElement('div');
  card.className = 'qr-card pending';
  card.dataset.index = String(index);

  const canvas = document.createElement('div');
  canvas.className = 'qr-canvas';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'qr-name';
  nameInput.placeholder = 'Untitled';
  nameInput.value = item.name || '';
  nameInput.spellcheck = false;
  nameInput.setAttribute('aria-label', 'QR code name');
  nameInput.addEventListener('input', () => {
    item.name = nameInput.value;
  });

  const urlEl = document.createElement('div');
  urlEl.className = 'qr-url';
  urlEl.textContent = item.url;
  urlEl.title = item.url;

  const actions = document.createElement('div');
  actions.className = 'qr-actions';

  const dlPng = document.createElement('button');
  dlPng.type = 'button';
  dlPng.textContent = 'PNG';
  dlPng.addEventListener('click', () => downloadSingle(item, 'png'));

  const dlSvg = document.createElement('button');
  dlSvg.type = 'button';
  dlSvg.textContent = 'SVG';
  dlSvg.addEventListener('click', () => downloadSingle(item, 'svg'));

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.textContent = 'Copy';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(item.url);
      copy.textContent = 'Copied!';
      setTimeout(() => (copy.textContent = 'Copy'), 1200);
    } catch {
      copy.textContent = 'Failed';
    }
  });

  actions.append(dlPng, dlSvg, copy);
  card.append(canvas, nameInput, urlEl, actions);
  return { card, canvas };
}

function renderItem(item) {
  if (item.rendered || item.error) return false;
  try {
    const qr = createQr({ data: item.url, ...state.renderOptions });
    qr.append(item.canvasEl);
    item.qr = qr;
    item.rendered = true;
    item.cardEl.classList.remove('pending');
    state.renderedCount++;
    setProgress(state.renderedCount, state.items.length);
    return true;
  } catch (err) {
    item.error = err.message || 'Render failed';
    item.cardEl.classList.add('error');
    item.cardEl.classList.remove('pending');
    item.canvasEl.textContent = item.error;
    state.renderedCount++;
    setProgress(state.renderedCount, state.items.length);
    return true;
  }
}

async function ensureQrForBlob(item) {
  if (item.qr) return item.qr;
  return createQr({ data: item.url, ...state.renderOptions });
}

async function downloadSingle(item, ext) {
  if (item.error) return;
  try {
    const qr = await ensureQrForBlob(item);
    const blob = await qrToBlob(qr, ext);
    saveAs(blob, `${fileBaseFor(item)}.${ext}`);
  } catch (err) {
    console.error(err);
    setStatus(`Failed to download: ${err.message}`, 'error');
  }
}

function abortCurrent() {
  if (state.controller) {
    state.controller.abort();
    state.controller = null;
  }
  if (state.observer) {
    state.observer.disconnect();
    state.observer = null;
  }
}

async function generate() {
  if (state.busy) return;
  abortCurrent();

  const entries = parseEntries(els.textarea.value);
  if (entries.length === 0) {
    setStatus('No URLs detected. Paste links separated by newlines or commas.', 'error');
    return;
  }

  const controller = new AbortController();
  state.controller = controller;
  state.busy = true;
  els.generate.disabled = true;
  els.download.disabled = true;
  setStatus(`Preparing ${entries.length} QR code${entries.length === 1 ? '' : 's'}…`);

  els.grid.innerHTML = '';
  state.items = entries.map((e) => ({
    name: e.name,
    url: e.url,
    qr: null,
    rendered: false,
    error: null,
    hidden: false,
    cardEl: null,
    canvasEl: null,
  }));
  state.renderOptions = {
    size: Number(els.size.value),
    margin: Number(els.margin.value),
    ecc: els.ecc.value,
  };
  state.renderedCount = 0;

  const fragment = document.createDocumentFragment();
  for (let i = 0; i < state.items.length; i++) {
    const item = state.items[i];
    const { card, canvas } = makeCard(item, i);
    item.cardEl = card;
    item.canvasEl = canvas;
    fragment.appendChild(card);
  }
  els.grid.appendChild(fragment);

  updateCount();
  applyFilter();
  setProgress(0, state.items.length);

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const idx = Number(entry.target.dataset.index);
        const item = state.items[idx];
        if (item) renderItem(item);
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '300px 0px', threshold: 0 }
  );
  for (const item of state.items) observer.observe(item.cardEl);
  state.observer = observer;

  setStatus(`Rendering ${state.items.length} QR code${state.items.length === 1 ? '' : 's'} in the background…`);

  const result = await runChunked({
    count: state.items.length,
    work: (i) => renderItem(state.items[i]),
    signal: controller.signal,
  });

  state.busy = false;
  els.generate.disabled = false;
  updateCount();

  if (result.aborted) {
    setStatus('Cancelled.', 'error');
    setTimeout(() => setProgress(0, 0), 600);
    return;
  }

  const failed = state.items.filter((i) => i.error).length;
  if (failed === 0) {
    setStatus(`Done. ${state.items.length} QR code${state.items.length === 1 ? '' : 's'} ready.`, 'success');
  } else {
    setStatus(`Done with ${failed} error${failed === 1 ? '' : 's'}.`, 'error');
  }
  setTimeout(() => setProgress(0, 0), 800);
}

async function downloadZip() {
  if (state.busy) return;
  const ready = state.items.filter((i) => !i.error);
  if (ready.length === 0) return;

  abortCurrent();
  const controller = new AbortController();
  state.controller = controller;
  state.busy = true;
  els.download.disabled = true;
  els.generate.disabled = true;
  setStatus(`Packaging ${ready.length} QR code${ready.length === 1 ? '' : 's'}…`);
  setProgress(0, ready.length, `0 / ${ready.length} packed`);

  const zip = new JSZip();
  const folder = zip.folder('qrcodes');
  const seenNames = new Map();

  await runChunkedAsync({
    count: ready.length,
    concurrency: 2,
    yieldEvery: 4,
    signal: controller.signal,
    onProgress: (done, total) => setProgress(done, total, `${done} / ${total} packed`),
    work: async (i) => {
      const item = ready[i];
      try {
        const qr = await ensureQrForBlob(item);
        const blob = await qrToBlob(qr, 'png');
        const base = fileBaseFor(item);
        const count = (seenNames.get(base) || 0) + 1;
        seenNames.set(base, count);
        const name = count === 1 ? `${base}.png` : `${base}-${count}.png`;
        folder.file(name, blob);
      } catch (err) {
        console.error('zip add failed', err);
      }
    },
  });

  if (controller.signal.aborted) {
    state.busy = false;
    els.generate.disabled = false;
    updateCount();
    setStatus('Cancelled.', 'error');
    setTimeout(() => setProgress(0, 0), 600);
    return;
  }

  const manifestLines = state.items.map((it, i) => {
    const status = it.error ? 'ERROR' : 'OK';
    const name = (it.name || '').replace(/\t/g, ' ');
    return `${i + 1}\t${status}\t${name}\t${it.url}`;
  });
  folder.file(
    'manifest.tsv',
    `# index\tstatus\tname\turl\n${manifestLines.join('\n')}\n`
  );

  setStatus('Compressing…');
  const blob = await zip.generateAsync(
    { type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } },
    (meta) => {
      els.progressFill.style.width = `${Math.round(meta.percent)}%`;
      els.progressText.textContent = `Compressing… ${Math.round(meta.percent)}%`;
    }
  );

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  saveAs(blob, `qrbookhub-${stamp}.zip`);

  state.busy = false;
  els.generate.disabled = false;
  updateCount();
  setStatus(`Downloaded ${ready.length} QR code${ready.length === 1 ? '' : 's'} as ZIP.`, 'success');
  setTimeout(() => setProgress(0, 0), 800);
}

function clearAll() {
  abortCurrent();
  state.busy = false;
  els.textarea.value = '';
  els.search.value = '';
  state.items = [];
  state.searchTerm = '';
  state.renderedCount = 0;
  els.grid.innerHTML = '';
  els.generate.disabled = false;
  setStatus('');
  setProgress(0, 0);
  updateCount();
  els.textarea.focus();
}

async function handleFile(file) {
  if (!file) return;
  const name = file.name || 'file';
  const lowered = name.toLowerCase();
  const text = await file.text();

  let entries;
  if (lowered.endsWith('.csv') || lowered.endsWith('.tsv') || file.type === 'text/csv') {
    entries = csvToEntries(text);
  } else {
    entries = parseEntries(text);
  }

  if (entries.length === 0) {
    setStatus(`No URLs found in ${name}.`, 'error');
    return;
  }
  els.textarea.value = entriesToTextareaFormat(entries);
  setStatus(`Loaded ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} from ${name}.`, 'success');
}

els.importBtn.addEventListener('click', () => els.fileInput.click());
els.fileInput.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (file) await handleFile(file);
  els.fileInput.value = '';
});

let dragDepth = 0;
function isFileDrag(e) {
  if (!e.dataTransfer) return false;
  return Array.from(e.dataTransfer.types || []).includes('Files');
}

window.addEventListener('dragenter', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth++;
  els.dropOverlay.hidden = false;
});
window.addEventListener('dragover', (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('dragleave', (e) => {
  if (!isFileDrag(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) els.dropOverlay.hidden = true;
});
window.addEventListener('drop', async (e) => {
  if (!isFileDrag(e)) return;
  e.preventDefault();
  dragDepth = 0;
  els.dropOverlay.hidden = true;
  const file = e.dataTransfer.files && e.dataTransfer.files[0];
  if (file) await handleFile(file);
});

let searchDebounce = null;
els.search.addEventListener('input', () => {
  if (searchDebounce) clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => {
    state.searchTerm = els.search.value;
    applyFilter();
  }, 80);
});

els.generate.addEventListener('click', generate);
els.download.addEventListener('click', downloadZip);
els.clear.addEventListener('click', clearAll);

els.textarea.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    generate();
  }
});

updateCount();
